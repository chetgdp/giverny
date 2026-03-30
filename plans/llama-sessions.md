# Client-Side Sessions for llama-server

## Context

llama-server backend is stateless — bridge-loop.ts runs the tool loop and accumulates messages in-memory, but they're lost when the process exits. Every invocation starts a blank conversation. This also causes the "Invalid input batch" 500 errors on multi-step tasks because there's no way to carry context across invocations (the user has to cram everything into one session).

Claude Code avoids this via `--resume SESSION_ID` (server-side state). For llama-server, we persist the message array client-side and replay it.

## Changes

### 1. `src/backend.ts` — add `messages` to BridgeResult (line 130)

Add `messages?: any[]` to the interface. Optional — only populated by the tool loop path.

### 2. `src/bridge-loop.ts` — accept history, return messages

- Add `history?: any[]` to `RunOptions` (line 37)
- In `runWithToolLoop` (line 89): insert `opts.history` after system prompt, before new user message
- Add final assistant text to messages before returning (after line 145, when loop breaks with no tool calls)
- Generate local session ID: `opts.sessionId || "local-" + Date.now().toString(36)`
- Return `messages: messages.filter(m => m.role !== "system")` and `sessionId: localSessionId` in result (line 205)
- Use `localSessionId` in the synthetic result event (line 193)

### 3. `src/state.ts` — message persistence

- Add `MESSAGES_FILE = join(GIVERNY_DIR, "messages.json")` with other path constants (line 19)
- Add `loadMessages()` / `saveMessages()` following the `loadUsage`/`saveUsage` pattern (after line 77)
- In `clearSession()` (line 115): add `try { await unlink(MESSAGES_FILE); } catch {}`

### 4. `src/shell.ts` — thread history through

- Add `history?: any[]` to `RunShellOpts` (line 37)
- Add `messages?: any[]` to `ShellResult` (line 47)
- Pass `history: opts.history` to `bridge.run()` (line 198)
- Return `messages: bridgeResult.messages` in result (line 224)
- In `main()`: load messages for non-agentLoop backends before calling runShell, save after
- Error-retry path (line 287): pass empty history on retry

### 5. `src/llama.ts` — flip sessions capability

Change `sessions: false` to `sessions: true` in `baseInfo.capabilities` (line 245). The bridge layer now provides session support.

## What doesn't change

- `llama.ts` generate logic — it already uses `_messages` from bridge-loop, no changes needed
- `server.ts` — manages its own in-memory sessions, ignores the `messages` field
- `commands.ts` — `/new` already calls `clearSession()` which will now clear messages too
- `protocol.ts`, `config.ts`, `tools.ts` — untouched

## Verify

1. `bun test` — existing tests pass
2. Start llama-server, run `? hello` then `? what did I just say` — second query should have context
3. `? /new` then `? what did I just say` — should have no context
4. `? /status` — should show session info instead of "not supported"
5. Multi-step task: `? create 5 files in /tmp/test one at a time` — tool loop works within session
6. Follow-up: `? list the files you just created` — cross-invocation context works
