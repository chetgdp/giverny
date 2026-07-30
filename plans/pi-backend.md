# Plan: pi backend as the default agent harness (v2)

Replace `claude -p` as giverny's default backend with `pi` (pi-mono coding agent).
Claude Code stays available as a non-default backend. Rationale: Anthropic now bills
`claude -p` usage extra, which defeats the point of wrapping it. pi is provider-agnostic
(user runs local models) and has an extension API we can build on.

**A complete reference implementation exists on branch `pi-backend-v1`** (commit
b1e24cf). It is behaviorally correct: adversarially reviewed, 253 tests green,
validated end-to-end against real pi. Its weakness is code quality in the shell/commands
integration, which grew by accretion (see Style requirements). Consult it freely,
especially `src/pi.ts` and the two test files, which are close to right. Do not merge it.

## Verified facts (pi 0.82.1, verified against /Users/che/pi-mono source AND live runs)

- `pi --mode json` emits NDJSON on stdout. stdout is guarded (only event lines reach
  it); warnings/diagnostics go to stderr. Prompt is passed via stdin (piped stdin is
  the message). Do NOT pass `-p`: it greedily consumes the next argv as the prompt
  (skipping args starting with `-`), so `--mode json` alone is correct and sufficient.
- Line 1 is a session header: `{type:"session", version:3, id, timestamp, cwd}`.
  May be absent with `--no-session`; do not hard-require it.
- Events: `agent_start`, `turn_start`, `message_start`, `message_update` (deltas),
  `message_end`, `turn_end`, `agent_end {willRetry}`, `agent_settled`,
  `tool_execution_start/update/end`, `auto_retry_start/end`, plus housekeeping
  (`queue_update`, `compaction_*`, `bash_execution_update`). There is NO terminal
  result event. `agent_end` with `willRetry: false` means the run is complete.
- Assistant message (in `message_end`, discriminate on `message.role === "assistant"`;
  user and toolResult messages also arrive via `message_end`):
  `{role, content, usage, stopReason, errorMessage?, timestamp, api, provider, model}`.
  Content blocks: `{type:"text", text}`, `{type:"thinking", thinking}`,
  `{type:"toolCall", id, name, arguments}`.
  `usage`: `{input, output, cacheRead, cacheWrite, reasoning, totalTokens, cost}`.
  `stopReason`: `stop|length|toolUse|error|aborted` (also transient `pending`).
- `tool_execution_end`: `{toolCallId, toolName, result: {content:[{type:"text",text}], details?}, isError}`.
  No stdout/stderr split.
- Exit code is 0 in json mode even when the model errored. Errors surface only via
  `stopReason`/`errorMessage` inside message_end. Nonzero exit = real CLI failure.
- Sessions: `--session-id <id>` opens an existing local session by exact id or
  creates one with that id. Id charset: `/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/`.
  pi-generated ids are UUIDv7 (so they match giverny's isUUID). Cannot combine with
  `-c`/`-r`/`--session`/`--fork`. Unknown id prints a stderr warning and creates.
- Thinking: `--thinking off|minimal|low|medium|high|xhigh|max` (max exists).
- Model: `--model <pattern>` (supports `provider/id`), `--provider <p>`. Passthrough.
- Tools (lowercase): `read {path, offset?, limit?}`, `bash {command, timeout?}`,
  `edit {path, edits: [{oldText, newText}]}`, `write {path, content}`, plus
  `grep {pattern, path?, ...}`, `find {pattern, path?}`, `ls {path?}` (those three
  are off by default). Models also emit `edits` as a JSON string and a legacy flat
  `{path, oldText, newText}`; pi normalizes both, so previews must handle them.
  `--tools <csv>` allowlist; `--no-tools` disables all.
- Unknown toolCall: pi answers the model itself with an error tool result and keeps
  looping. It never halts. Client-tool interception is therefore impossible without
  the Phase 2 extension; server mode stays on claude-code.
- No permission mechanism. Gating is shell-side (Phase 1) or extension (Phase 2).
- pi exits on its own after the prompt completes; bash children get piped (not
  inherited) stdio, but treat orphaned fds as possible anyway (tests inject fakes).
- User's pi config WORKS: default provider `av` (Qwen3.5-9B at 100.91.180.74:8888),
  set in `~/.pi/agent/settings.json` + `~/.pi/agent/models.json`. Real e2e is possible.

### Real captured events (pi 0.82.1, av provider), for fixtures

```
{"type":"session","version":3,"id":"019faf2e-0009-7f95-a9d3-513464abfe8a","timestamp":"2026-07-29T18:40:55.305Z","cwd":"/tmp"}
{"type":"message_end","message":{"role":"assistant","content":[{"type":"thinking","thinking":"...","thinkingSignature":"reasoning_content"},{"type":"text","text":"pong"}],"usage":{"input":571,"output":29,"cacheRead":5501,"cacheWrite":0,"reasoning":0,"totalTokens":6101,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}},"stopReason":"stop","errorMessage":null}}
{"type":"message_end","message":{"role":"assistant","content":[{"type":"toolCall","id":"J2PWQ7rTNcSDtyH7EXuR0KyydimN1Iyc","name":"bash","arguments":{"command":"echo giverny-e2e"}}],"stopReason":"toolUse"}}
{"type":"tool_execution_end","toolCallId":"J2PWQ7rTNcSDtyH7EXuR0KyydimN1Iyc","toolName":"bash","result":{"content":[{"type":"text","text":"giverny-e2e\n"}]},"isError":false}
{"type":"turn_end","toolResults":[]}
{"type":"agent_end","willRetry":false}
{"type":"agent_settled"}
```

## Style requirements (read first)

The v1 attempt was behaviorally correct but accreted. This repo's method (see DEVLOG.md
and shell.ts history): understand the data first, then write the one transformation
that handles it. Mike Acton's questions apply: can we not do this at all? once? fewer
times?

- Normalize then transform. One function maps messy input to a clean structure; one
  function consumes it. Do not write chains of name-string special cases.
- No defensive blanket try/catch. If an input shape is possible, handle it explicitly;
  if it's impossible, let it throw. A whole-body catch is an admission you don't know
  what arrives.
- No duplicated render/write loops. If the same loop appears twice, the data model is
  wrong.
- Backend differences belong in data (capability flags, lookup tables), not in
  `if (backend.name === ...)` branches scattered through commands.ts. Where v1 added
  name checks, prefer extending BackendInfo (e.g. models list empty = freeform).
- Comments state constraints the code can't show, or ask honest questions. Nothing else.
- Match the repo's visual idiom: section banner comments, aligned fields, small files.

## Phase 1: pi backend

### New file `src/pi.ts`

Mirrors `src/bridge.ts` structure: arg builder, NDJSON parser, generate(), info.
The v1 `src/pi.ts` is close to correct; reuse its logic, keep it clean.

Arg builder `buildPiArgs(opts)`:
- Base: `["--mode", "json"]` (no `-p`, see facts)
- `--model <m>` passthrough only when opts.model is set and not `"default"`
  ("default" = defer to pi's own config)
- `--thinking <level>` from options.effort (pi levels used directly), fallback DEFAULT_EFFORT
- `--session-id <id>` when opts.sessionId matches pi's id regex
- `--system-prompt <text>` when set
- Tools/perms interaction: perms `plan` has no shell-side prompt and pi has no
  permission flag, so plan forces `--tools read,grep,find,ls`. Otherwise pass
  `--tools <csv>` when options.tools is set and not "all", LOWERCASED (a saved
  claude-code filter like "Read,Bash" must still match pi's names)
- Prompt via stdin (`stdin: new Response(opts.prompt)`), never argv
- Guard: whitespace-only prompt returns `{ok:false, error:"empty prompt"}` before
  spawning (pi silently no-ops on empty stdin)

Parser (stateful, since the result is synthesized): consumes lines, returns
BridgeEvents, accumulates result state.
- session header: capture sessionId
- `message_end` role assistant: emit `assistant` event; text as-is, toolCall to
  `{type:"tool_use", id, name, input: arguments}`; thinking dropped. Skip emission
  when blocks are empty (auto-retry produces zero-content error messages).
  Track: stopReason, errorMessage, last non-empty text, summed usage where
  input_tokens includes input + cacheRead + cacheWrite (they occupy context).
- `tool_execution_end`: emit `tool_result {toolUseId, content: joined text blocks,
  stdout: content, stderr: "", isError}`
- `turn_end`: count turns
- `agent_end` with `!willRetry`: mark settled (the early-exit signal)
- everything else ignored

Synthesized ResultEvent (only if an assistant message was seen; emitted via onEvent
BEFORE generate() resolves, else bridge-loop reports "No result event"):
- `isError`: last stopReason is `error` or `aborted`
- `result`: on error prefer errorMessage over stale mid-run text; else last text
- `usage {input_tokens, output_tokens}`, `numTurns` (min 1), `durationMs` (wall
  clock), `sessionId`, `permissionDenials: []`

generate() lifecycle. Same four invariants as bridge.ts (CLAUDE.md "Process
lifecycle"), with pi's shape:
- stderr drain via reader (cancellable), started before the read loop
- timeout backstop: kill(9) + cancel BOTH readers, each in its own try/catch;
  set a timedOut flag so the caller can report "pi timed out after Xms"
- read loop breaks early when settled (agent_end). Without this, an orphaned child
  holding the stdout pipe stalls generate() until the timeout.
- settled path ORDER MATTERS: clearTimeout FIRST (an armed timer firing inside the
  grace window would kill(9) pi mid session-write), then race proc.exited against a
  500ms grace, kill(9) only if still running, then cancel both readers WHILE THE
  LOCK IS HELD (releaseLock-then-cancel is a silent no-op; cancel releases the lock
  itself), emit the synthesized result, return ok:true
- no-settle path (stream ended: fake binary, pi died, or timeout): await proc.exited,
  clearTimeout, brief stderr flush race, cancel both readers; timedOut => ok:false;
  nonzero exit => ok:false with stderr; else emit result if any, ok:true
- ProcessControl: abort = SIGCONT then kill(9); pause/resume = SIGSTOP/SIGCONT
- `GIVERNY_PI_BIN` env var overrides the binary (default "pi"), used by checkStatus too

BackendInfo:
- name "pi"; models: [] (provider-agnostic; empty list = freeform, see commands);
- efforts: `["off","minimal","low","medium","high","xhigh","max"]`
- capabilities: agentLoop, sessions, streaming all true
- checkStatus: `pi --version` via GIVERNY_PI_BIN

### Registry and defaults

- `src/backend.ts` getBackend: add `case "pi"`; update the error message listing.
- `src/config.ts` CONFIG_DEFAULTS: backend `"pi"`, model `"default"` (sentinel:
  defer to the backend's own default).
- The sentinel must be handled by ALL backends: bridge.ts normalizeModel maps
  "default" to "opus" (preserving the old claude default); completions.ts and
  responses.ts suppress it from the request body exactly like "local".

### Sessions (state.ts + shell.ts)

claude-code and pi ids are both UUIDs, so id shape cannot identify the owning
backend. SessionEntry gains `backend?: string`; saveSession takes the backend name
(all callers: resultPersistence, /resume, resolveSession recovery). resolveSession
mismatch check: stored backend !== cfg.backend when present; legacy entries without
a backend fall back to the isUUID heuristic (UUID iff claude-code-or-pi). On
mismatch with backend pi: no discovery exists yet, clear the session.

### Shell-side (permissions, summaries, previews)

pi tool names are lowercase with different arg fields. Every match site must know
them (prefer a single tool-metadata table over scattered name checks if it
simplifies; the sites in v1: shell-utils SAFE_TOOLS + needsPermission bash bypass +
TOOL_SUMMARIES; shell.ts danger check + diffPreviewRender):
- safe (read-only) pi tools: read, grep, find, ls
- bash bypass + isDangerousCommand apply to `bash` like `Bash` (field `command`)
- summaries: bash=command, read/write/edit=path, grep/find=pattern+path, ls=path
- diffPreviewRender: rewrite normalize-then-render. One normalizer maps any edit
  shape (claude Edit old_string/new_string; pi edits array; pi edits as JSON string;
  pi legacy flat oldText/newText; Write/write content) to `{old, new}[]`, filtering
  malformed entries (null elements must not throw; a display bug must never crash
  the run loop, which would trigger runWithSessionRetry re-execution). One loop
  renders red/green.

### commands.ts

- `/model`: when info.models is empty (freeform backend), any id saves verbatim
  (no lowercasing), "default" defers to backend config; bare `/model` says so.
- `/opus /sonnet /haiku`: reject on freeform backends with a hint instead of saving
  an unresolvable model globally.
- effort shortcuts: add `/off /minimal /xhigh` alongside low/medium/high/max
  (claude-code rejects unsupported ones via existing validation). Effort help text
  gains descriptions for the new levels.
- `/context`: freeform backend has no known window; print counts + "window unknown",
  no fake 200k bar.
- `/resume`: on pi, print "session listing not supported for pi yet (use `pi -r`)"
  instead of listing .giverny/conversations (whose conv-* ids resolveSession would
  silently discard). Gate the "/resume <n> claude" hint to claude-code.

### setup.ts / help.ts

- setup: add pi to the backend prompt list (first); pi CLI presence/version check
  (mirroring the claude check; stale `|| "claude-code"` default becomes
  CONFIG_DEFAULTS.backend); pi branch sets model "default" and prompts effort with
  pi levels.
- help: reword claude-only lines (config, model/effort shortcuts, resume-claude,
  CLAUDE_EFFORT) to be backend-aware. Do NOT touch README.md.

### Docs

CLAUDE.md: backends list (pi default), pi JSON mode reference section, pi lifecycle
notes under "Process lifecycle" (agent_end early exit + grace + clearTimeout order),
GIVERNY_PI_BIN in Testing. The v1 branch's CLAUDE.md diff is a good base.

### Tests (run before any commit)

- `tests/pi.test.ts`: buildPiArgs (json mode, no -p, model passthrough/default,
  thinking, session-id validation, tools lowercase, plan toolset, no perms flag,
  system prompt), parser (header, assistant mapping, thinking dropped, role
  filtering, tool_execution_end, malformed lines, settled/willRetry, usage summing
  incl. cacheRead, error preference, retry sequence, null finish without assistant),
  registry. Base fixtures on the real captured events above.
- `tests/pi-hanging.test.ts`: mirror hanging.test.ts via GIVERNY_PI_BIN fake script:
  normal completion, tool cycle, stderr flood, error-stopReason with exit 0, empty
  output, nonzero exit, lingering process after agent_end (<3s), stuck process
  timeout, no trailing newline, malformed lines, orphan children (<2s), willRetry
  continuation, AND the subprocess test: a driver script that runs generate() with
  the orphan fake and no process.exit, spawned via `bun`, asserting the driver
  process itself exits promptly. This is the only test that catches removal of the
  settled-path reader cancels (in-process tests pass without them).
- package.json test:unit gains pi.test.ts.
- Existing suite must stay green. Known pre-existing failure: llama.test.ts
  "respects cwd" (/tmp vs /private/tmp on macOS), not yours to fix.
- Real e2e (pi config works now): `echo "reply with exactly: pong" | pi --mode json
  --no-session` sanity, then generate() through the backend, then a tool-call run.

## Out of scope

- Server mode (server.ts stays hardcoded to claude-code; pi's unknown-tool behavior
  makes interception impossible until Phase 2). Note it in CLAUDE.md.
- README.md.
- pi session discovery for /resume (follow-up).
- Phase 2: giverny pi extension (permission gating via the `tool_call` hook over a
  unix socket, custom tools). Separate plan.
