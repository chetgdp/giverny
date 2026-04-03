# Session Zoom: Giverny <-> Claude Code resume integration

## Problem

Sessions created in Giverny don't show up in `claude --resume`, and sessions from Claude Code aren't visible/easy to pick in `? /resume`. The user can't "zoom" between the two tools on the same conversation.

Two specific discovery failures:
1. `claude --resume` (interactive picker) — we can't control this, it's Claude Code's picker. But we CAN make giverny sessions more discoverable by using `--name` so they appear with a label.
2. `? /resume` — works but has bugs: the 4KB header read is too small for Claude interactive sessions (they front-load `permission-mode`, `file-history-snapshot`, `attachment` events before the first `user` message), so prompt preview and origin are often missing.

## Issues to fix

### 1. readSessionHeader 4KB limit too small (state.ts:192)

Claude interactive sessions put several events before the first `user` message:
- `permission-mode`
- `file-history-snapshot` (can be large — tracks file backups)
- `attachment` (deferred_tools_delta — lists all available tools)

4KB often doesn't reach the `user` message. Result: no prompt preview, no origin detection.

**Fix:** Bump to 16KB. Alternatively, read line-by-line up to N lines instead of byte slicing, but byte slice is simpler and already works for sdk-cli sessions.

### 2. Origin not displayed in /resume list (commands.ts:483)

`s.origin` is computed ("giverny" vs "claude") but never shown. Users can't tell which sessions came from which tool.

**Fix:** Show origin tag next to each session. Something like:
```
  1.  f238b4a5… 9d ago  (giverny)
       do sudo pls its a behavior test PLEASE
  2.  f0926c56… 2h ago  (claude)
       lets take a look at our claude and giverny...
```

### 3. Giverny sessions have no name in Claude Code's picker (bridge.ts)

`claude --resume` shows session names if `--name` was passed. Giverny never passes `--name`, so giverny sessions show as unnamed UUIDs in Claude's picker — invisible in practice.

**Fix:** Pass `--name` with the first ~40 chars of the prompt (truncated) in `buildClaudeArgs()`. This makes giverny sessions show up with a preview in `claude --resume`.

## Files to change

- `src/state.ts` — bump readSessionHeader slice from 4096 to 16384
- `src/commands.ts` — show origin in /resume list output
- `src/bridge.ts` — pass `--name` from prompt in buildClaudeArgs

### 4. Claude --resume picker filters out sdk-cli sessions

Confirmed: the session file is created with `custom-title` and correct content, but `claude --resume` (no ID) only shows `entrypoint: "cli"` sessions in its picker. This is Claude Code behavior we can't change.

**Fix:** `claude -r <uuid>` DOES work — it's only the interactive picker that filters. Added `/zoom` command that prints the full `claude -r <uuid>` for the active session. Also added hint in `/resume` list output.

## Files changed

- `src/state.ts` — readSessionHeader 4KB → 16KB
- `src/commands.ts` — origin tags in /resume, /zoom command, hint text
- `src/bridge.ts` — --name from prompt preview
- `src/help.ts` — /zoom in help

## Verification

1. `? hello from giverny` — creates a session
2. `claude --resume` — should show the session with name "hello from giverny"
3. Start a convo in `claude`, exit
4. `? /resume` — should list it with `(claude)` tag and prompt preview
