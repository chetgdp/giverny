# Giverny

Wraps `claude -p` into two interfaces: a composable shell program (`?`/`,` prefix) and an OpenAI-compatible server. Shell is the primary focus.

## Architecture

Bun project. `run.ts` entry point, installed globally as `giverny`.

Multi-backend design: `src/backend.ts` defines the Backend interface, `src/bridge-loop.ts` (Bridge) wraps any backend into a consumer-friendly API with agent loop support. Shell and server talk to Bridge, never to backends directly.

- **Shell** (`giverny`) - default. Uses Claude Code's native tools. Composable: detects pipes on stdin/stdout. Piped stdin is prepended to the prompt, piped stdout gets clean text (UI chrome routes to stderr). `git diff | @ summarize | wl-copy` works.
- **Server** (`giverny -s`) - OpenAI `/v1/chat/completions` and `/v1/responses` endpoints. Disables Claude Code tools, injects client definitions, converts to/from OpenAI format.

### Backends

- `claude-code` (default) — wraps `claude -p`, agentLoop=true, sessions via Claude Code's native storage
- `completions` — OpenAI-compatible `/v1/chat/completions` API, agentLoop=false (Bridge runs tool loop)
- `responses` — OpenAI `/v1/responses` API, agentLoop=false

Non-agentLoop backends use `src/tools.ts` for tool definitions and execution (single `exec` tool). System prompt is configurable: `default` (built-in shell agent), `none`, or custom string via `/prompt`.

## claude -p reference

- `--output-format stream-json --verbose` gives NDJSON with structured tool_use blocks
- `--tools ""` disables built-in tools (`--allowedTools` is the old flag). LSP stays active.
- `--system-prompt` replaces default system prompt. `--append-system-prompt` appends. CLAUDE.md from cwd still loads.
- `--resume SESSION_ID` resumes a session. Tool turns get fresh sessions (tool_use rejection corrupts state).
- Claude emits structured `tool_use` even with `--tools ""`. Server mode intercepts these from stream-json.
- Latency ~2-7s per invocation. Token tracking: `input_tokens` and `output_tokens` only.
- The entire project exists because `claude -p` works surprisingly well as a programmable LLM backend.

## Key Files

- `run.ts` - entry point, routes --server/--setup/--help
- `src/backend.ts` - Backend interface contract (any LLM backend implements this)
- `src/bridge-loop.ts` - Bridge class, agent loop dispatcher (shell/server talk to this)
- `src/bridge.ts` - claude-code backend (`claude -p` wrapper, NDJSON parser)
- `src/completions.ts` - completions backend (OpenAI chat completions API)
- `src/responses.ts` - responses backend (OpenAI responses API)
- `src/tools.ts` - tool definitions + executor for non-agentLoop backends (single `exec` tool)
- `src/shell.ts` - shell mode (interactive + piped)
- `src/shell-utils.ts` - pure shell utilities (permissions, tool summaries, kaomoji)
- `src/commands.ts` - slash command handler (/model, /effort, /prompt, /resume, etc.)
- `src/state.ts` - config cascade, session persistence, usage tracking, conversations
- `src/server.ts` - HTTP server (Bun.serve)
- `src/protocol.ts` - OpenAI chat completions protocol conversion
- `src/responses-protocol.ts` - OpenAI responses protocol conversion
- `src/config.ts` - shared config types, defaults, logging
- `src/spinner.ts` - terminal spinner for shell mode
- `src/setup.ts` - installs shell aliases
- `src/help.ts` - help text

## Why not just `claude -p`?

`claude -p` is composable, but verbose. Giverny wraps it into a single character:

```bash
# claude -p
claude -p --output-format stream-json --verbose --model opus --effort high \
  --permission-mode bypassPermissions "write a haiku to tmp/h" && \
  cat tmp/h | claude -p --output-format stream-json --verbose --model opus \
  --effort high --permission-mode bypassPermissions "review this"

# giverny
@ write a haiku to tmp/h && @ review (cat tmp/h)
```

Same backend, same tools. Giverny manages the flags, sessions, output routing, and permissions so the command line stays short enough to actually compose.

## Running

```bash
giverny                    # interactive shell (default)
giverny -s                 # start server
PORT=9000 giverny -s       # custom port
```

Server endpoint: `http://localhost:8741/v1`, API key `sk-giverny`.

## Testing

```bash
bun test                   # all tests
bun test:unit              # unit only (config, bridge, protocol, shell-utils)
bun test:integration       # HTTP integration (server on port 18741)
```

Pure functions in `protocol.ts` and `shell-utils.ts` can be imported without side effects. Integration tests start a real server. `tests/hanging.test.ts` tests process lifecycle — uses `GIVERNY_CLAUDE_BIN` to inject a fake claude script.

## Process lifecycle (do not break)

`src/bridge.ts` spawns `claude -p` and reads NDJSON from stdout. Four invariants that prevent hanging:

1. **Stderr must drain in background** — started before the read loop. If claude blocks on a stderr write (64KB pipe buffer full), stdout stalls. The drain runs as a fire-and-forget promise.
2. **Timeout must cancel the stdout reader** — `proc.kill(9)` alone is not enough. Orphaned child processes (tool executions) inherit pipe fds and keep them open. The timeout handler must call both `proc.kill(9)` AND `reader.cancel()` to break the read loop. Each op is wrapped in try/catch so one failing doesn't skip the others.
3. **gotResult path must cancel readers and return immediately** — after receiving a result event, kill the process, `reader.cancel()` stdout (not just `releaseLock` — that leaves the pipe fd open), `stderrReader.cancel()`, and return. Do not await `proc.exited` or `stderrDrain` — orphaned agent children inherit pipe fds and keep them open indefinitely, which holds the event loop alive and prevents the process from exiting.
4. **Shell main must `process.exit(0)` explicitly** — even with the gotResult cancels, the Bun event loop stays alive because orphaned tool-runner children hold the inherited stdio pipe fds. Without the explicit exit, the terminal never gets control back and the user sees a stuck spinner frame after output. Server mode is long-running and doesn't need this.

The `GIVERNY_CLAUDE_BIN` env var overrides the claude binary path (defaults to `"claude"`). Used by tests to inject controlled behavior.

## Responses API tool call IDs (do not break)

The OpenAI responses API uses two distinct IDs for function calls: `item.id` (the item's own identifier, e.g. `fc_123`) and `item.call_id` (for matching function_call_output to function_call, e.g. `call_abc`). The streaming events `function_call_arguments.delta` and `.done` reference the item via `item_id`, which is `item.id` — NOT `call_id`.

`parseResponsesSSE` returns both: `id` (item.id, for accumulation map keying) and `callId` (call_id, for the output block identity used in bridge tool result matching). The accumulation map keys by `id` so delta/done lookups succeed, and stores `callId` so the bridge loop's tool_call_id matching works downstream.

## Plans

When asked to "make a plan", write a markdown file in `./plans/`. Do NOT use EnterPlanMode — write the plan as a file. Completed plans move to `./plans/done/`.

## TODO

See `./todo`.
