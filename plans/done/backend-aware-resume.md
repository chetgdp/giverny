# Backend-Aware /resume

## Context

`/resume` only discovers Claude Code sessions from `~/.claude/projects/`. Giverny's own conversations (`.giverny/conversations/*.json`, used by completions/actual.inc) never appear. Showing Claude sessions when on a completions backend is useless — you can't resume them.

## Changes

### 1. `src/state.ts` — add `discoverConversations()`

New function alongside `discoverSessions()`. Reads `.giverny/conversations/*.json`, sorted by mtime descending. Returns same `DiscoveredSession` shape for reuse in commands.ts:

- `id` from filename (strip `.json`)
- `ts` from the saved `ts` field
- `prompt` from first `role: "user"` message content, sliced to 80 chars
- `model` from the saved `model` field (useful for display)
- `origin` always `"giverny"`
- `active` check against `loadSession()`

### 2. `src/commands.ts` — branch on backend in `/resume`

`bridge.info.name` is available. Two paths:

- `claude-code`: call `discoverSessions()` (current behavior, unchanged)
- `completions` / `actual.inc`: call `discoverConversations()`

Display for completions sessions drops the `· giverny ◆ claude code` legend and the claude projects path. Shows model name instead since completions users may switch models.

### 3. Display tweak

Completions conversations have real first-user-message content (not JSONL header parsing), so preview coverage should be ~100% vs the current patchy Claude session previews.

## Files

- `src/state.ts` — add `discoverConversations()`
- `src/commands.ts` — branch `/resume` on `bridge.info.name`

## Verify

1. `bun test:unit` passes
2. On completions backend: `/resume` lists `.giverny/conversations/` files with prompts
3. On claude-code backend: `/resume` still shows Claude sessions as before
4. `/resume 1` works on both backends
