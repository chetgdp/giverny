# Plan: Backend-Agnostic Bridge

## Context

Giverny is named after a bridge, and it should be one. Right now it's hardwired to `claude -p`. The goal is to make it work with any agentic backend — Claude Code is just the first. The coupling is concentrated in `src/bridge.ts` (~317 lines). Everything above it (shell, server, protocol, utils) is already ~85% generic.

## Approach

Create a `Backend` interface. Make bridge.ts the Claude Code implementation of it. Update consumers to talk to the interface, not to Claude directly. No plugin system, no registry — just a switch statement and a contract.

## Steps

### 1. Create `src/backend.ts` — the interface (~80 lines)

New file. Types and interface only, no implementation.

```
BackendInfo     — name, models[], efforts[], capabilities (sessions, tools, stream control)
ModelInfo       — id, contextWindow, description
InvokeOptions   — prompt, model, effort, sessionId, systemPrompt, tools, perms, cwd, timeout
BridgeEvent     — AssistantEvent | ResultEvent | ToolResultEvent (renamed from Claude*)
StreamControl   — pause/resume/kill (unchanged)
BridgeResult    — text, toolUseBlocks, sessionId, usage, isError, etc.
Backend         — info, invokeStreaming(), invoke(), mapPermissions(), normalizeModel(), checkStatus?()
```

Plus a `getBackend(name: string): Backend` function (plain switch).

### 2. Update `src/bridge.ts` — implement Backend

- Import types from `backend.ts` instead of defining them locally
- Keep `buildClaudeArgs()` and `parseNdjsonLine()` as private internals
- Wrap existing functions into `export const claudeCodeBackend: Backend`
- Move `normalizeModel()` from config.ts into this file (it's Claude-specific)
- Move `PERMS_TO_CLAUDE` from config.ts into `mapPermissions()` method
- Add `info` with Claude's models/efforts/context windows
- Add `checkStatus()` for `claude --version` + credentials check
- Re-export generic types under old `Claude*` names temporarily for smooth migration

### 3. Update `src/config.ts`

- Add `backend: string` to `ShellConfig` and `CONFIG_DEFAULTS` (default: `"claude-code"`)
- Remove `normalizeModel()` (moved to bridge.ts)
- Remove `PERMS_TO_CLAUDE` (moved to bridge.ts)
- Rename `CLAUDE_EFFORT` / `CLAUDE_TIMEOUT` to `DEFAULT_EFFORT` / `DEFAULT_TIMEOUT`

### 4. Update consumers

**protocol.ts** (2 lines): `ClaudeToolUseBlock` → `ToolUseBlock` import from backend.ts

**server.ts** (~10 lines):
- Get backend via `getBackend()`
- Replace `invokeClaude()` with `backend.invoke()`
- Dynamic model list from `backend.info.models`
- Rename `claudeSessionId` → `backendSessionId`

**shell.ts** (~30 lines scattered):
- Replace `invokeClaudeStreaming()` with `backend.invokeStreaming()`
- Replace hardcoded `VALID_MODELS` with `backend.info.models.map(m => m.id)`
- Replace hardcoded `VALID_EFFORTS` with `backend.info.efforts`
- Replace hardcoded `CONTEXT_WINDOWS` with `backend.info.models` lookup
- Replace `PERMS_TO_CLAUDE[x]` with `backend.mapPermissions(x)`
- `/status` uses `backend.checkStatus?.()` instead of hardcoded claude checks
- Load backend in `main()` from config, pass through to `runShell()`

**setup.ts**: Add `backend` to setup prompts (just claude-code for now, but the field exists)

**help.ts**: Add `/backend` to command list

### 5. Clean up

- Remove `Claude*` type aliases from bridge.ts once all consumers migrated
- Update existing tests

## Files to modify

- `src/backend.ts` — **NEW** (interface + getBackend)
- `src/bridge.ts` — implement Backend, keep all Claude logic
- `src/config.ts` — add backend field, remove Claude-specific helpers
- `src/shell.ts` — use Backend interface instead of direct bridge calls
- `src/server.ts` — use Backend interface
- `src/protocol.ts` — type rename
- `src/help.ts` — add /backend command
- `src/setup.ts` — add backend to config prompts

## What this enables

Adding a new backend = one new file implementing `Backend` + one case in the switch. Shell automatically picks up the new backend's models, efforts, context windows. Permission system, server mode, pipe composability all work unchanged.

Future backends:
- Claude API direct (HTTP, no CLI dependency)
- OpenAI API
- Local models (ollama, llama.cpp)
- Tiny purpose-built models (pico tier, Apple Neural Engine)
- Other agentic CLIs (codex, aider, etc.)

## Verification

1. `bun test` — all existing tests pass
2. `giverny` — shell mode works identically with claude-code backend
3. `echo "hello" | giverny` — pipe in still works
4. `giverny /status` — shows backend info
5. `giverny /backend` — shows current backend
6. `giverny -s` — server mode works, `/v1/models` returns dynamic list
