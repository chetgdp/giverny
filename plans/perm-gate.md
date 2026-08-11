# Plan: fix the permission prompt (1/2/3 + arrows dead on macOS)

## Diagnosis (verified)

`promptPermission` (src/tui.ts:124-125, 163) shells out to `stty -F /dev/tty`.
`-F <device>` is GNU coreutils; BSD/macOS stty spells it `-f` and errors on `-F`
("stty: stdin isn't a terminal"). Both spawnSync calls fail silently, so:

- raw mode never engages: /dev/tty stays canonical (line-buffered)
- pressing `1` delivers `"1\n"`, arrows deliver `"\x1b[A\n"` after Enter
- every exact-match comparison (`key === "1"`, `key === "\x1b[C"`) misses
- only bare Enter matches, which confirms the default selection
- the save/restore pair also no-ops (harmless, since raw was never set)

It worked on Linux (GNU stty); on Darwin it never could. `selectPrompt` is
unaffected in normal use because it runs `execSync("stty raw -echo", {stdio:
"inherit"})` against inherited stdin, which is the tty in interactive mode, but
it has the same latent bug when stdin is not the tty (piped invocations), since
it too reads keys from /dev/tty.

## Fix

### 1. One portable raw-tty helper in src/tui.ts

Both prompts get their tty handling from a single helper:

```ts
function withRawTty<T>(fn: (fd: number) => T): T
```

- open `/dev/tty` once (read fd)
- save settings: run `stty -g` with the tty fd as the child's stdin - stty
  operates on its stdin by default, POSIX-portable, no -F/-f at all
  (node:child_process spawnSync with `stdio: [fd, "pipe", "ignore"]`; verify
  Bun.spawnSync accepts a numeric fd for stdin first and prefer it if so)
- enter raw: `stty raw -echo` the same way
- run fn(fd), restore saved settings + close fd in finally
- if /dev/tty cannot be opened or stty fails (no controlling terminal: cron,
  CI), promptPermission returns "deny" and selectPrompt returns the default -
  never hang on a read that cannot receive keys

`selectPrompt` moves onto the helper too (drops its `execSync("stty ...",
{stdio:"inherit"})` pair and its cursor hide/show stays as is), fixing its
piped-stdin variant of the same bug.

`selectPrompt` preserves its existing Escape/Ctrl+C contract: the key handler
returns a cancellation result, the tty and cursor are restored, then the
process exits with status 130. `promptPermission` maps either key to deny. The
key handler must not call `process.exit` before cleanup because Bun skips
`finally` in that case.

### 2. Tolerant key decoding, extracted pure

Extract decoding into a pure function so it is unit-testable and survives a
terminal that is stuck in canonical mode anyway (defense in depth):

```ts
type Key = { kind: "enter" | "escape" | "up" | "down" | "left" | "right"
           | "digit" | "vim-up" | "vim-down" | "other"; digit?: number };
export function decodeKey(bytes: Buffer, n: number): Key
```

- strip trailing `\r`/`\n` before matching, then: bare CR/LF = enter
- escape sequences by prefix (`\x1b[A` etc.), lone `\x1b` = escape
- digits 1-9, `j`/`k`, ctrl+C = escape
- promptPermission and selectPrompt both consume Key values; the duplicated
  byte-matching in the two functions collapses into one table

### 3. Tests

- `tests/tui.test.ts`: decodeKey covers raw bytes (`"1"`, `"\x1b[C"`, `"\r"`),
  canonical-mode bytes (`"1\n"`, `"\x1b[A\n"`), ctrl+C, lone escape, garbage.
- The stty layer is manual-only (no tty in bun test): verify on macOS AND linux
  - `@ touch /tmp/x` → prompt appears, `2` selects allow-all instantly,
    arrows move the highlight, Enter confirms, Esc denies
  - `giverny --setup backend` selector still works; Escape/Ctrl+C exits 130
    immediately and leaves the terminal sane on macOS and Linux
  - `echo hi | @ summarize` (piped stdin) still prompts via /dev/tty
- `bun test` green before commit (known pre-existing llama.test.ts failure).

## Execution constraints

- Branch pi-backend-v2, do not commit, do not touch files outside src/tui.ts,
  tests/tui.test.ts (plus imports if the Key type is shared).
- Report: files changed, test counts, and the manual tty checklist results
  you could not run (list them for the user).

## Out of scope

- The SIGSTOP race (pi/claude may begin executing a tool before the pause
  signal lands) and detached children surviving deny. That is the Phase 2 pi
  extension (blockable tool_call hook), not a prompt fix.
