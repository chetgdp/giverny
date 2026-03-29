# Shell extraction — shell.ts 1018 → ~290 lines

shell.ts has four independent chunks separated by comment headers. Extract each to its own module with zero behavior change.

## Extractions

**`src/commands.ts`** (~380 lines) — `handleSlashCommand` and its helpers. Big switch statement, no shared mutable state. Imports config loading from state.ts. Only export is `handleSlashCommand`.

**`src/state.ts`** (~110 lines) — Config cascade (`loadConfig`, `loadConfigWithSources`, `saveConfig`), session persistence (`loadSession`, `saveSession`, `clearSession`, `loadSessions`), usage tracking (`loadUsage`, `saveUsage`), approved tools (`loadApproved`, `saveApproved`). All the `.giverny/` file I/O. Exports pure async functions, no side effects.

**`src/spinner.ts`** (~90 lines) — `createSpinner` factory. Depends on `getKaomojiSet` and `KAOMOJI` from shell-utils. Self-contained animation loop, only writes to `ui` (stderr when piped).

**Permission prompt** (~55 lines) — `promptPermission` moves into `src/shell-utils.ts` where the other pure shell helpers already live. It reads from `/dev/tty` directly so it's independent of the rest.

## What stays in shell.ts

`runShell` (streaming orchestration + event handler), `main` (arg parsing, pipe detection, session bookkeeping), output routing constants (`PIPED`, `ui`), ANSI color constants. ~290 lines.

## Order

1. `src/state.ts` first — no dependencies on other new files, commands.ts needs it
2. `promptPermission` → `src/shell-utils.ts` — already adjacent in spirit
3. `src/spinner.ts` — only depends on shell-utils
4. `src/commands.ts` — depends on state.ts, shell-utils
5. Update shell.ts imports, delete moved code
6. `bun test` — all 129 tests should still pass unchanged
