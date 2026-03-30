# Shell extraction — shell.ts 1029 → ~310 lines

shell.ts has four independent chunks separated by comment headers. Extract each to its own module with zero behavior change.

## Extractions

**`src/state.ts`** (~125 lines) — File path constants (`GIVERNY_DIR`, `GLOBAL_CONFIG_FILE`, etc.), config cascade (`loadConfig`, `loadConfigWithSources`, `saveConfig`, `sourceTag`), session persistence (`loadSession`, `saveSession`, `clearSession`, `loadSessions`), usage tracking (`UsageStats`, `loadUsage`, `saveUsage`), approved tools (`loadApproved`, `saveApproved`). All the `.giverny/` file I/O. Imports `loadJSON`/`saveJSON` from shell-utils. Exports pure async functions, no side effects.

**`src/commands.ts`** (~420 lines) — `handleSlashCommand`, `timeAgo`, and the `VALID_VERBOSE` constant. Big switch statement, no shared mutable state. Imports state functions from state.ts, ANSI constants and `KAOMOJI` from shell-utils. Only export is `handleSlashCommand`.

**`src/spinner.ts`** (~95 lines) — `SpinnerCtx` interface and `createSpinner` factory. Depends on `getKaomojiSet`, `KAOMOJI`, `ui`, and ANSI constants from shell-utils. Self-contained animation loop.

**Permission prompt** (~55 lines) — `promptPermission` moves into `src/shell-utils.ts` where the other pure shell helpers already live. Reads from `/dev/tty` directly. Writes to `ui` (already in shell-utils after ANSI/output constants move there).

**ANSI + output constants** — `DIM`, `RED`, `BOLD`, `ORANGE`, `SEA_GREEN`, `BLUE`, `RESET`, `INV`, `PIPED`, `ui` move to shell-utils.ts. Used by commands.ts, spinner.ts, promptPermission, and shell.ts — must live in a shared leaf module to avoid circular imports.

## What stays in shell.ts

`RunShellOpts`/`ShellResult` interfaces, `runShell` (streaming orchestration + event handler), `main` (arg parsing, pipe detection, session bookkeeping), `MAX_RESULT_LINES`. ~310 lines. Imports from all four new/updated modules.

## Order

1. Move ANSI constants + `PIPED`/`ui` + `promptPermission` into shell-utils.ts — everything else depends on these
2. `src/state.ts` — depends on shell-utils (loadJSON/saveJSON), commands.ts needs it
3. `src/spinner.ts` — depends on shell-utils only
4. `src/commands.ts` — depends on state.ts + shell-utils
5. Update shell.ts imports, delete moved code
6. `bun test` — all tests should still pass unchanged
