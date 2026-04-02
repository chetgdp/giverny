# Giverny Refactor Plan

## Context

5,552 lines across 21 files. Architecture is sound — Bridge pattern, Backend interface, clean separation between shell/server consumers. The refactor targets are copy-paste duplication and one overloaded file. No architectural changes needed.

## 1. Extract shared backend helpers (`src/backend-utils.ts`)

**Problem:** `completions.ts` (345 lines) and `responses.ts` (471 lines) share ~150 lines of identical or near-identical code.

**Duplicated functions:**
- `extractCodeBlocks` — identical in both
- `getBaseUrl`, `getApiKey`, `getClusterId` — identical in both
- `checkStatus` — near-identical (same fetch, same response parsing)
- `probeModels` — near-identical
- Block-building from accumulated content (the `fullText && toolCallAccum.size === 0` branch with code block fallback) — ~40 lines identical in both `generate()` functions
- Backend export boilerplate (cachedInfo pattern) — structurally identical

**New file `src/backend-utils.ts`** extracts:
- `extractCodeBlocks(text): string[]`
- `getBaseUrl(opts?)`, `getApiKey(opts?)`, `getClusterId(opts?)`
- `buildAuthHeaders(opts?)` — combines apiKey + clusterId header construction (repeated 4 times across both files)
- `checkEndpointStatus(opts?, baseUrl?)` — generic status checker
- `probeEndpointModels(baseUrl, baseInfo)` — generic model prober
- `buildBlocksFromAccumulated(fullText, toolCallAccum)` — the code-block-fallback block builder
- `createCachedInfoGetter(baseInfo, probeModels)` — the lazy-probe info getter pattern

Both backends shrink to their unique logic: SSE parsing format and request body construction.

**Files modified:** `src/completions.ts`, `src/responses.ts`
**File created:** `src/backend-utils.ts`

## 2. Split `shell-utils.ts` (392 lines)

**Problem:** "Pure utility functions for shell mode" contains raw TTY I/O (`promptPermission`), kaomoji animation data, JSON persistence, project registration, output routing, ANSI constants, permission classifiers, display width, tool summaries, and token formatting. Half the codebase imports it.

**Move kaomoji data + getKaomojiSet into `spinner.ts`** — spinner.ts is the only consumer. Removes the re-export hop.

**Move `loadJSON`, `saveJSON`, `registerProject` into `state.ts`** — state.ts is the only non-trivial consumer. These are persistence helpers, not "shell utilities." This makes state.ts self-contained for all file I/O.

**Move `promptPermission` into its own location or `tui.ts`** — it does raw TTY manipulation (stty, /dev/tty reads), not a pure function. `tui.ts` already exists for `selectPrompt` which does the same kind of thing.

What stays in `shell-utils.ts`: permission classifiers (`needsPermission`, `isSafeBashCommand`, `isDangerousCommand`), `normalizePerms`, `displayWidth`, `summarizeTool`, ANSI constants, output routing (`PIPED`, `DUMB`, `ui`), `formatTokens`.

**Files modified:** `src/shell-utils.ts`, `src/spinner.ts`, `src/state.ts`, `src/tui.ts`, `src/shell.ts` (import paths)

## 3. Dedup server handlers

**Problem:** `handleChatCompletions` and `handleResponses` in `server.ts` (384 lines) share the same flow: parse body -> build prompt with session resume -> call bridge.collect with resume fallback -> parse tool calls -> log timing -> build response.

**Extract a shared `handleRequest(opts)` helper** inside server.ts that owns:
- Resume-with-fallback logic (try resume, catch -> delete session -> retry fresh)
- Timing + logging
- Tool call parsing (structured vs text fallback)

The two handlers become thin wrappers that normalize their input format and call handleRequest, then format output to their respective protocols.

Also unify the two session maps (`sessions` and `responseSessions`) into one with a namespace key, since they share the same type and eviction logic.

**Files modified:** `src/server.ts`

## 4. Move `--use` logic out of `run.ts`

**Problem:** The `--use` case in `run.ts` has 30 lines of inline fs read/write/mkdir that duplicates patterns from state.ts.

**Add `setBackendConfig(backend, url?)` to `state.ts`**, call it from run.ts. The switch case shrinks to 5 lines.

**Files modified:** `run.ts`, `src/state.ts`

## Execution order

1 -> 2 -> 3 -> 4. Each step is independently testable. Step 1 is the biggest win (removes ~150 lines of duplication). Step 2 is the most files touched but low risk (just moving code + updating imports).

## Verification

- `bun test` after each step — all existing unit + integration tests must pass
- Manual: `giverny /status`, `giverny /help`, pipe test `echo hi | @ echo`, interactive mode
- Server: start `giverny -s`, hit `/v1/models` endpoint
