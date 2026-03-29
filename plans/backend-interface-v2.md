# Plan: Backend Interface v2

## Problem

The current Backend interface is Claude-shaped. It works for the one backend we have, but every method leaks subprocess assumptions: `invokeStreaming` returns `{ exitCode, stderr }`, `StreamControl` assumes SIGSTOP/SIGCONT, `InvokeOptions` has Claude-specific fields (`effort`, `perms`, `tools` as a name string), `checkStatus` returns `{ version, subscription, rateTier }`, and `normalizeModel`/`mapPermissions` are Claude concepts on a generic interface. The fundamental issue: Claude Code runs its own agent loop internally, but for a backend like llama-server, giverny IS the agent loop.

## Approach

Split "call the LLM" from "run the agent loop." The Backend interface becomes a single-turn completion primitive. A new Bridge layer owns the agent loop, dispatching based on whether the backend runs its own loop (Claude Code) or needs giverny to loop for it (llama-server). Claude-specific options move off the interface into the implementation.

## Interface

### Backend — single completion, universal

```ts
interface Backend {
    info: BackendInfo;
    generate(
        opts: GenerateOptions,
        onEvent: (event: GenerateEvent, control: AbortControl) => void,
    ): Promise<GenerateResult>;
    checkStatus?(): Promise<Record<string, string>>;
}

interface BackendInfo {
    name: string;
    models: ModelInfo[];
    capabilities: {
        agentLoop: boolean;   // true = backend runs tool execution internally (claude -p)
        sessions: boolean;    // true = backend can resume conversations
        streaming: boolean;   // true = events stream during generation
    };
    // Backend-specific metadata (efforts, context windows, etc.)
    meta?: Record<string, any>;
}

interface GenerateOptions {
    prompt: string;
    model?: string;
    systemPrompt?: string;
    sessionId?: string;
    timeout?: number;
    cwd?: string;
    // Backend-specific options. Claude puts effort, perms, tools filter here.
    // Llama-server puts temperature, top_p, tool schemas here.
    options?: Record<string, any>;
}

interface AbortControl {
    abort(): void;
}

interface GenerateResult {
    ok: boolean;
    error?: string;
}
```

### GenerateEvent — what comes back during generation

Same event types as today, but the `result` event simplifies:

```ts
// AssistantEvent — unchanged (text blocks + tool_use blocks)
// ToolResultEvent — unchanged (for backends with internal agent loops)

interface ResultEvent {
    type: "result";
    text: string;
    toolUseBlocks: ToolUseBlock[];
    sessionId: string | null;
    usage: { input_tokens: number; output_tokens: number } | null;
    numTurns: number;
    durationMs: number | null;
    isError: boolean;
}
```

### Bridge — agent loop + consumer API

Bridge is not an interface — it's a concrete class that wraps any Backend. Shell and server talk to Bridge, never to Backend directly.

```ts
class Bridge {
    constructor(private backend: Backend) {}

    // Streaming — used by shell
    async run(
        opts: RunOptions,
        onEvent: (event: BridgeEvent, control: RunControl) => void,
    ): Promise<BridgeResult> { ... }

    // Collected — used by server
    async collect(opts: RunOptions): Promise<BridgeResult> { ... }
}
```

`RunControl` is the consumer-facing control:

```ts
interface RunControl {
    abort(): void;
    // Only meaningful when backend has agentLoop capability.
    // When giverny owns the loop, the loop itself handles the pause
    // (it just waits before executing the tool — no signal needed).
    pause?(): void;
    resume?(): void;
}
```

Bridge.run() dispatches based on `backend.info.capabilities.agentLoop`:

- **agentLoop: true** (Claude Code) — Single `backend.generate()` call. Events pass through to the consumer's `onEvent`. `RunControl.pause/resume` map to backend-specific process signals. This is the current behavior.

- **agentLoop: false** (llama-server) — Bridge runs the loop:
  1. Call `backend.generate()` with prompt
  2. Collect response. If no tool_use blocks → done, emit result
  3. If tool_use blocks → emit assistant event to consumer, execute tools (respecting permissions via onEvent callback), emit tool_result events
  4. Build new prompt with tool results appended, call `generate()` again
  5. Repeat until no tool_use or max turns reached

The permission system falls out naturally: for agentLoop backends, the consumer pauses/resumes the process. For non-agentLoop backends, Bridge controls the loop and can wait for permission before executing each tool — no pause needed.

## Steps

### 1. Create new types in `src/backend.ts`

Replace the current interface with the v2 types. Keep the old types temporarily as `V1*` aliases so bridge.ts can migrate incrementally.

New types: `GenerateOptions`, `GenerateEvent`, `GenerateResult`, `AbortControl`, `RunOptions`, `RunControl`, `BackendInfo` (updated with `agentLoop` capability).

Keep: `BridgeEvent`, `BridgeResult`, `ToolUseBlock`, `ContentBlock`, `AssistantEvent`, `ResultEvent`, `ToolResultEvent` — these are the event/result types that Bridge exposes to consumers. They stay the same.

### 2. Create `src/bridge-loop.ts` — the Bridge class

New file. The agent loop lives here.

```
class Bridge {
    constructor(backend: Backend)
    run(opts, onEvent) → Promise<BridgeResult>
    collect(opts) → Promise<BridgeResult>
}
```

For the agentLoop:true path, this is essentially the current `invokeStreaming`/`invoke` consumer logic moved up a layer. For the agentLoop:false path, this is new code: the tool execution loop.

Tool execution for non-agentLoop backends needs a tool registry — a way to actually run Read, Bash, Write, etc. That's a separate concern (the tools themselves). For now, implement only the agentLoop:true path and stub the false path with a TODO.

### 3. Update `src/bridge.ts` — implement Backend v2

- `invokeStreaming` → `generate`. Same internals (spawn claude, parse NDJSON), but returns `{ ok, error? }` instead of `{ exitCode, stderr }`. Exit code checking moves inside.
- Remove `invoke` (Bridge.collect handles this now).
- Remove `normalizeModel`, `mapPermissions` from the export object. They stay as private helpers called inside `generate` when unpacking `options.effort`, `options.perms`, etc.
- `checkStatus` returns `Record<string, string>` instead of a typed object.
- `info.capabilities.agentLoop = true`.
- `StreamControl` → pass `AbortControl` to onEvent. Pause/resume become backend-internal (Bridge.run passes them through via RunControl when capability is present).

### 4. Update consumers

**shell.ts:**
- Import `Bridge` from `bridge-loop.ts` instead of `Backend` + `getBackend`
- Construct `new Bridge(getBackend(cfg.backend))` in main()
- `bridge.run(opts, onEvent)` instead of `backend.invokeStreaming(opts, onEvent)`
- `RunControl` instead of `StreamControl`
- Remove `backend.mapPermissions()` calls — pass perms in `options.perms`, bridge handles it
- Model/effort validation: still from `backend.info` (accessible via `bridge.backend.info` or a `bridge.info` passthrough)

**server.ts:**
- `bridge.collect(opts)` instead of `backend.invoke(opts)`
- Model list from `bridge.info.models`

**GenerateOptions.options for Claude Code:**
```ts
{
    prompt: "...",
    model: "opus",
    systemPrompt: "...",
    sessionId: "...",
    options: {
        effort: "high",
        perms: "bypassPermissions",
        tools: "Read,Bash",
    }
}
```

### 5. Update `src/backend.ts`

Remove old interface, keep only v2 types. Remove `getBackend` (or keep as convenience, but Bridge is the entry point now).

### 6. Clean up

- Remove `StreamControl` from backend.ts (replaced by `AbortControl` + `RunControl`)
- Remove `InvokeOptions` (replaced by `GenerateOptions`)
- Update tests

## Files

- `src/backend.ts` — v2 types (GenerateOptions, AbortControl, RunControl, updated BackendInfo)
- `src/bridge-loop.ts` — **NEW** Bridge class (agent loop)
- `src/bridge.ts` — Claude Code backend, implements Backend v2
- `src/shell.ts` — uses Bridge instead of Backend directly
- `src/server.ts` — uses Bridge instead of Backend directly
- `src/config.ts` — no changes expected

## What this enables

Adding llama-server: implement `Backend.generate()` as an HTTP fetch to `/v1/chat/completions`, set `agentLoop: false`. Bridge runs the tool loop. Shell gets streaming tool summaries, permission prompts, everything — for free. No changes to shell.ts or server.ts.

## What this doesn't do yet

- Tool execution for non-agentLoop backends (the actual Read/Bash/Write implementations). That's a separate plan.
- Message history management for multi-turn non-agentLoop conversations. Bridge.run handles one agent loop invocation; conversation history is a layer above.
- Backend selection at runtime (switching backends mid-session). Current `getBackend` switch is fine for now.
