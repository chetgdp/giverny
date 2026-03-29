# Giverny

Wraps `claude -p` into two interfaces: a composable shell program (`?`/`,` prefix) and an OpenAI-compatible server. Shell is the primary focus.

## Architecture

Bun project. `run.ts` entry point, installed globally as `giverny`.

Core is `src/bridge.ts`, wraps `claude -p --output-format stream-json --verbose`, parses NDJSON, exposes streaming + collected interfaces. Everything builds on bridge.

- **Shell** (`giverny`) - default. Uses Claude Code's native tools. Composable: detects pipes on stdin/stdout. Piped stdin is prepended to the prompt, piped stdout gets clean text (UI chrome routes to stderr). `git diff | @ summarize | wl-copy` works.
- **Server** (`giverny -s`) - OpenAI `/v1/chat/completions` endpoint. Disables Claude Code tools, injects client definitions, converts to/from OpenAI format.

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
- `src/bridge.ts` - core `claude -p` wrapper
- `src/shell.ts` - shell mode (interactive + piped)
- `src/shell-utils.ts` - pure shell utilities (permissions, tool summaries, kaomoji)
- `src/server.ts` - HTTP server (Bun.serve)
- `src/protocol.ts` - OpenAI protocol conversion (messages, tool calls, SSE)
- `src/config.ts` - shared config (timeout, effort, model, logging)
- `src/setup.ts` - installs shell aliases

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

Pure functions in `protocol.ts` and `shell-utils.ts` can be imported without side effects. Integration tests start a real server.

## TODO

See `./todo`.
