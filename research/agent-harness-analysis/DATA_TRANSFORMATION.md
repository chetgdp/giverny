# Giverny Data Transformation Table

What is the data? What are the operations? What is the minimum work?

## The Data

Everything is strings. UTF-8. The input is a user prompt (string). The output is an assistant response (string). In between: NDJSON (strings with structure).

```
Input:  user intent (string)
Output: system state change + response text (string)
Middle: NDJSON events from claude -p (string lines with JSON structure)
```

## The Operations

```
           | parse | format | spawn | route | gate  | convert | stream | persist |
           |       |        |       |       |       |         |        |         |
prompt     |       |   x    |       |       |       |         |        |         |
claude -p  |       |        |   x   |       |       |         |        |         |
NDJSON     |   x   |        |       |       |       |         |        |         |
text block |       |        |       |   x   |       |         |   x    |         |
tool_use   |       |        |       |   x   |   x   |         |   x    |         |
tool_result|       |        |       |   x   |       |         |   x    |         |
result     |       |        |       |   x   |       |         |        |   x     |
OpenAI req |   x   |   x    |       |       |       |   x     |        |         |
OpenAI res |       |        |       |       |       |   x     |   x    |         |
session    |       |        |       |       |       |         |        |   x     |
usage      |       |        |       |       |       |         |        |   x     |
```

### What each operation does to the data

| Operation | Input | Output | Syscall |
|-----------|-------|--------|---------|
| **parse** | NDJSON line (string) | BridgeEvent (object) | JSON.parse() |
| **format** | prompt + config (strings) | CLI args (string[]) | string concat |
| **spawn** | CLI args (string[]) | child process (fd) | fork + exec |
| **route** | BridgeEvent | stdout or stderr | write(1) or write(2) |
| **gate** | tool_use event | allow / deny | read(0) from stdin |
| **convert** | BridgeEvent ↔ OpenAI format | opposite format | JSON.stringify() |
| **stream** | text/events | chunked HTTP or raw stdout | write(fd) |
| **persist** | session/usage/transcript | JSON files | write(fd) |

## The Two Modes

### Shell Mode

```
user string → format(prompt + args) → spawn(claude -p) → parse(NDJSON) → route(stdout/stderr) → persist(session)
                                                              |
                                                         gate(tool_use) → allow/deny
```

Six operations. The interesting one is **gate** — that's the only operation that isn't pure data transformation. It requires human input (read from stdin). Everything else is: string in, string out, write to fd.

### Server Mode

```
HTTP body → parse(JSON) → convert(OpenAI→prompt) → format(prompt) → spawn(claude -p) → parse(NDJSON) → convert(bridge→OpenAI) → stream(SSE/JSON)
```

Seven operations. Two are **convert** — the round-trip tax of speaking OpenAI format to clients while speaking claude -p format to the backend.

## What Is Actually Happening

Strip away the code. What does each operation cost?

```
           | CPU           | Memory        | I/O           | Latency       |
parse      | JSON.parse    | ~1 obj/line   | none          | microseconds  |
format     | string concat | ~1 string     | none          | microseconds  |
spawn      | fork+exec     | child process | pipe fds      | ~3,500ms (!)  |
route      | if/else       | none          | write(fd)     | microseconds  |
gate       | UI render     | none          | read(0)       | seconds (human)|
convert    | JSON ↔ JSON   | ~1 object     | none          | microseconds  |
stream     | chunking      | buffer        | write(fd)     | microseconds  |
persist    | JSON.stringify | ~1 string     | write(fd)     | milliseconds  |
```

**spawn** dominates everything. 3,500ms for `claude -p` to start. Everything else is microseconds. The entire giverny runtime (Bun import + all logic) is ~12ms. The data transformation is essentially free — the bottleneck is the LLM process startup.

## Where The Harness Industry Adds Work

The harness table for comparison. Same transformation, more operations:

```
              | giverny          | pi / claude code / garry         |
              |                  |                                  |
user input    | string           | string                           |
tool schema   | —                | TypeBox/Zod validate             |
tool dispatch | —                | registry lookup + handler call   |
tool execute  | claude does it   | spawn + output buffer + truncate |
tool result   | NDJSON passthru  | format + schema validate         |
permission    | regex or human   | regex or human                   |
context mgmt  | --resume         | compaction / pruning / search    |
rendering     | write(fd)        | Ink / custom TUI / React         |
```

Giverny doesn't do tool dispatch, schema validation, output buffering, or context management. Claude Code does all of that internally. Giverny is a passthrough — it transforms the format (NDJSON ↔ text, NDJSON ↔ OpenAI) and routes output to the right fd.

## The Minimum Transformation

From the table, what can we eliminate?

```
1. Can we not do this at all?
   - convert: only needed for server mode (OpenAI compat)
   - persist: only needed if sessions matter
   - stream: only needed for server mode SSE
   → Shell mode minimum: parse, format, spawn, route, gate

2. Can we do this only once?
   - format: build CLI args once per invocation ✓
   - spawn: one process per invocation ✓

3. Can we do this fewer times?
   - parse: one JSON.parse per NDJSON line, can't reduce
   - route: one write per event, can't reduce

4. Can we approximate?
   - gate: static whitelist instead of human prompt (current isSafeBashCommand)
   - gate: or pico-judge (1M params, microseconds)

5. Can we use a small lookup table?
   - gate: SAFE_BASH set is already a lookup table
   - route: if(piped) stderr else stdout — one branch

6. Can we use a small FIFO?
   - NDJSON is already a FIFO. Lines come in, events go out.

7. Can we constrain the problem further?
   - v2: remove the spawn. The model IS the process.
   - v2: remove parse/format. The model emits exec(sh -c) directly.
   - v2: the entire transformation becomes: model → gate → exec → stdout
```

## v0 vs v2

```
v0 (current):  prompt → format → spawn(claude -p) → parse(NDJSON) → route → gate → persist
v2 (target):   intent → model → gate → exec(sh -c) → stdout
```

v0 has 7 operations. v2 has 4. The difference is the spawn/parse/format/persist layer — the cost of wrapping an external LLM process. When the model is local (pico on ANE), the process boundary disappears. No spawn, no NDJSON, no format. Just: inference → gate → exec.

## Histos Parallel

```
Histos:   Config → Fetch → Process → Encode → HtmlDoc → String
Giverny:  Prompt → Spawn → Parse   → Route  → Gate   → String
```

Both are string → string pipelines with a fetch step in the middle (HTTP for Histos, process spawn for Giverny). Both have an encoding/formatting step. Both end by writing a string to a file descriptor.

The difference: Histos fetches data to pack. Giverny fetches intelligence to act.
