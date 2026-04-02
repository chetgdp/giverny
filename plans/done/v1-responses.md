# v1/responses backend — consuming responses API for shell streaming

## Context

The shell is the primary product. When pointed at non-claude backends (actual.inc, completions), it currently consumes `/v1/chat/completions` SSE which works but uses the older format. The v1/responses API has richer streaming semantics (named events, granular lifecycle). This enables better shell UX — real streaming with proper event structure.

The goal: a new `responses` backend that hits `POST /v1/responses` with `stream: true`, parses the named SSE events, and emits `BridgeEvent`s that the bridge/shell already understand. Then wire actual.inc setup to let the user choose between completions or responses protocol.

## Files

| File | Action |
|---|---|
| `src/responses.ts` | **Create** — new backend implementing Backend interface, consumes v1/responses |
| `src/backend.ts` | **Modify** — add "responses" case to getBackend registry |
| `src/config.ts` | **Modify** — add `protocol` field to BackendConfig |
| `src/setup.ts` | **Modify** — add protocol choice for actual.inc |
| `src/state.ts` | **Modify** — resolve protocol from backend config |
| `tests/responses.test.ts` | **Create** — unit tests for SSE parsing |

## Design

### New backend: `src/responses.ts`

Mirrors `completions.ts` structure. Key differences:

- Hits `POST {baseUrl}/v1/responses` instead of `/v1/chat/completions`
- Request body: `{ model, input, instructions, tools, stream: true }` instead of `{ messages, tools, stream: true }`
- Parses named SSE events (`event: response.output_text.delta\ndata: {...}`) instead of bare `data:` lines
- Extracts text from `response.output_text.delta` events (`.delta` field)
- Extracts tool calls from `response.function_call_arguments.delta` + `.done` events
- Stream ends at `response.completed` event (no `data: [DONE]`)

Same capabilities as completions: `agentLoop: false`, bridge owns tool loop.

**SSE parser** — adapted from completions parseSSEChunk to handle named events:

```
event: response.output_text.delta
data: {"type":"response.output_text.delta","delta":"Hello","sequence_number":5}
```

Parse by tracking current `event:` line, then processing `data:` line based on event type.

**Request building** — convert GenerateOptions to responses format:
- `opts.prompt` → `input`
- `opts.systemPrompt` → `instructions`
- `opts.options._messages` (from bridge tool loop) → need to convert to responses `input` array format
- Tool schemas from TOOL_SCHEMAS, flattened (no nested `function` key — responses format is `{type, name, parameters}`)

### Backend registry: `src/backend.ts`

Add case:
```typescript
case "responses": {
    const { responsesBackend } = require("./responses");
    return responsesBackend;
}
```

### actual.inc protocol choice: `src/setup.ts`

After actual.inc cluster/model selection, add a protocol prompt:
```
protocol (arrows + enter)
  > 1) completions  /v1/chat/completions (default)
    2) responses    /v1/responses streaming
```

Store in `backends["actual.inc"].protocol`. Default to `completions` for backwards compat.

### Config: `src/config.ts`

Add `protocol?: string` to `BackendConfig`.

### State resolution: `src/state.ts`

When `actual.inc` is selected and `protocol === "responses"`, `getBackend` needs to return the responses backend instead of completions. Two options:
- a) Resolve at config level: if protocol is "responses", change the effective backend name
- b) Resolve at getBackend level: pass protocol through

Simplest: in `getBackend`, the `actual.inc` case checks `protocol` from config and returns either completionsBackend or responsesBackend. This means getBackend needs access to the protocol setting.

Cleanest approach: `getBackend(name, opts?)` where opts can carry protocol. The shell already passes backend-specific options through `options` in RunOptions → GenerateOptions. So:

```typescript
case "actual.inc": {
    if (opts?.protocol === "responses") {
        const { responsesBackend } = require("./responses");
        return responsesBackend;
    }
    const { completionsBackend } = require("./completions");
    return completionsBackend;
}
```

The shell resolves protocol from config and passes it to getBackend.

### Tool schema conversion

completions.ts uses `TOOL_SCHEMAS` from `src/tools.ts`. Responses format tools are flat: `{type: "function", name, description, parameters}` instead of `{type: "function", function: {name, description, parameters}}`. Need to flatten these in the responses backend.

### Message format for tool loop

Bridge's `runWithToolLoop` builds messages as `[{role, content}]` and passes them via `opts.options._messages`. For the responses backend, these need to be converted to the responses input format. The responses API accepts `input: [{role, content}]` so the same array works — just passed as `input` instead of `messages`.

## Implementation steps

### Step 1: Add `protocol` to config

`src/config.ts` — add `protocol?: string` to BackendConfig.
`src/state.ts` — resolve protocol in `resolveBackendConfig`.

### Step 2: Create `src/responses.ts`

New backend file. Structure:
1. SSE event parser for named events
2. `generate()` — builds responses-format request, streams named SSE, accumulates text + tool calls, emits BridgeEvent
3. `checkStatus()` — same as completions (hits /v1/models)
4. Backend export with `agentLoop: false`

### Step 3: Register in `src/backend.ts`

Add "responses" case. Update "actual.inc" case to check protocol option.

### Step 4: Wire protocol in shell

`src/shell.ts` — pass `protocol` from resolved config through to getBackend and bridge options.

### Step 5: Setup prompt

`src/setup.ts` — add protocol choice after actual.inc model selection. Store in `backends["actual.inc"].protocol`.

### Step 6: Tests

`tests/responses.test.ts` — test SSE event parsing, tool schema flattening, request building.

## Verification

```bash
bun test:unit                     # new + existing tests pass
bun test:integration              # server tests pass
# Manual: configure actual.inc with responses protocol, run shell query
```
