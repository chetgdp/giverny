# Plan: Agent Loop Detection

## Context

When an agent runs via `claude -p`, it can get stuck alternating between tools (e.g. `Write` → `TodoWrite` → `Write` → `TodoWrite`) without producing meaningful text output. The user has no way to know this is happening besides watching the spinner flip tool names. The agent burns tokens and time going nowhere.

## Detection

Track tool calls in the `onEvent` handler in `runShell()` (shell.ts ~759). The data is already there — every `tool_use` block has a `name`.

**Signal: tool oscillation without text output.**

State to track (inside `onEvent` closure, alongside existing `streamedText`, `responseText`, etc.):

```typescript
let toolHistory: string[] = [];          // rolling window of last N tool names
let lastTextAt: number = Date.now();     // when we last saw a text block
```

On each `tool_use` block:
- Push `block.name` to `toolHistory`
- If `toolHistory.length >= 6` (3 full cycles of a 2-tool loop), check for a repeating pattern

Pattern detection (simple):
```typescript
function isLooping(history: string[]): boolean {
    if (history.length < 6) return false;
    const last6 = history.slice(-6);
    // Check for AB AB AB pattern
    const a = last6[0], b = last6[1];
    return last6[2] === a && last6[3] === b && last6[4] === a && last6[5] === b;
}
```

Additional signal: time since last text output. If `Date.now() - lastTextAt > 60_000` (60s with no text) AND tool oscillation detected, high confidence it's stuck.

On each `text` block:
- Update `lastTextAt = Date.now()`
- Reset `toolHistory = []` (text output means progress)

## Response

When loop detected, pause the process and prompt the user:

```typescript
if (isLooping(toolHistory) && Date.now() - lastTextAt > 30_000) {
    spinner.stop();
    control.pause();  // SIGSTOP

    ui.write(`\n${ORANGE}loop detected: ${a} ↔ ${b} (${toolHistory.length} calls, no text output)${RESET}\n`);

    // Reuse existing promptPermission-style selector or a simpler prompt
    const action = promptLoopAction();  // "continue" | "inject" | "kill"

    if (action === "continue") {
        control.resume();
        toolHistory = [];  // reset, give it another chance
    } else if (action === "inject") {
        control.kill();
        // Re-invoke with an appended instruction
        // "Stop looping. Complete the task directly without updating todos."
        // This means returning a signal from onEvent that runShell picks up
        loopInject = true;
    } else {
        killed = true;
        control.kill();
    }
}
```

## The inject path

Killing and re-invoking with the same session + an appended prompt. The session resume (`--resume`) picks up where it left off, but the new prompt carries the correction:

```
"You are looping between tools without making progress. Stop updating todos between every action. Complete the remaining work directly."
```

This is a new invocation of `claude -p --resume SESSION_ID` with the inject text as the prompt. The existing session state carries context, the inject steers behavior.

`runShell()` would need to return a signal that `main()` picks up to re-invoke with the inject, or handle it internally by spawning a new bridge call within the same `runShell` execution. The latter is simpler — kill the current proc, start a new streaming invocation inline, reattach the same `onEvent`.

## Prompt for user

Minimal horizontal selector, same pattern as permission prompt:

```
⚠ loop detected: Write ↔ TodoWrite (8 calls, no text in 45s)
  > continue    nudge    kill
```

- **continue**: resume, reset detection, give it another chance
- **nudge**: kill + re-invoke with inject prompt on same session
- **kill**: kill, return to shell

## Changes

### `src/shell.ts` — `runShell()` onEvent handler

- Add `toolHistory: string[]` and `lastTextAt: number` state vars
- On `tool_use`: push to history, check `isLooping()` + time threshold
- On `text`: reset history, update `lastTextAt`
- When detected: pause, prompt, handle action
- For nudge: kill proc, re-invoke with `--resume` + inject prompt

### `src/shell.ts` — new `promptLoopAction()` function

Similar to `promptPermission()` — raw terminal selector with 3 options. ~30 lines (can probably extract a shared selector helper from `promptPermission` at the same time).

### `src/shell-utils.ts` — `isLooping()` pure function

Pattern detection on a string array. Testable. ~10 lines.

## Files

- `src/shell.ts` — loop detection in onEvent, promptLoopAction(), nudge re-invocation
- `src/shell-utils.ts` — isLooping() pure function
- `tests/shell-utils.test.ts` — test isLooping()

## Open questions

- Threshold tuning: 6 tool calls and 30s no text? Or more conservative?
- Should the nudge inject text be configurable or hardcoded?
- Should this only apply in `/auto` mode where the agent runs unattended? In `/ask` mode the user is already approving each tool call and would notice the loop.
