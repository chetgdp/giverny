# Data Transformation Pipeline
need a way to take this dogshit llm generated file and turn it into something useful cause theres like 25% of this that is nice.

*for a minimal agentic shell architecture*

```
user intent 
    →  loop (
        -> model 
        →  NDJSON tool calls 
        →  parse 
        →  permission gate 
        →  execute 
        →  result 
    ) -> end condition
  -> response
```

## The Stack
```
                         ┌─── sh      (1977, C)  fork + exec  — orchestration, file I/O
                         │
NDJSON stream → parse → gate → perl    (1987, C)  fork + exec  — text transformation
                         │
                         ├─── curl    (1998, C)  socket + HTTP — networking
                         │
                         └─── browser (new)      headless      — web automation
```

Four tools and a model. The rest is a parser and a permission gate.

### The Harness
The harness is not a framework. It is four functions:

1. **Parse**: read NDJSON from model output, extract tool call
2. **Gate**: check permissions, prompt user if dangerous, ML model that learns from the user
3. **Execute**: compose the appropriate process execution (sh, perl, curl, browser)
4. **Return**: format result as NDJSON, feed back to model

No tool reimplementations, no Grep that calls grep. No JSON schemas describing cat. No virtual DOM to render monospace cells. No rendering pipeline, you have `write(fd, src, ??)`. Parse, gate, execute, return.

### The Protocol
NDJSON (newline-delimited JSON) is the wire format between model and harness.
```
->model outputs:   {"tool": "sh", "cmd": "rg -n 'TODO' src/"}
<-harness returns:  {"result": "src/main.rs:42: // TODO fix this", "exit": 0}

->model outputs:   {"tool": "perl", "cmd": "perl -pi -e 's/TODO fix this/DONE/' src/main.rs"}
<-harness returns:  {"result": "", "exit": 0}

->model outputs:   {"tool": "curl", "cmd": "curl -s https://api.example.com/status"}
<-harness returns:  {"result": "{\"status\": \"ok\"}", "exit": 0}
```

### The Permission Gate
**Simple programmatic**

**Auto-approved** (read-only, no side effects):
- sh: ls, cat, head, tail, find, tree, grep, rg, git status, git log, git diff
- perl: without -i or -p flags that modify files
- curl: GET requests

**Requires approval** (writes, deletes, network mutations):
- sh: rm, mv, cp, chmod, git push, any write operation
- perl: -pi (in-place edit), -i (in-place)
- curl: POST, PUT, DELETE
- browser: all actions (clicking, typing, navigating)

**Danger-flagged** (extra confirmation):
- rm -rf on / or ~, sudo, mkfs, dd of=/dev/, shutdown

**[Machine Learning](pico-judge.md)**

### The User
The user is whoever is at fd 0. The harness doesn't know and doesn't care.
```
human  ->stdin → harness → model → tools → stdout → human
script → stdin → harness → model → tools → stdout → script
cron   → stdin → harness → model → tools → stdout → log
LLM    → stdin → harness → model → tools → stdout → LLM
```

## What The Industry Built vs What Was Needed
Five harnesses were analyzed: Claude Code (Anthropic), Garry (garry.sh), OpenCode (SST team), Pi (Mario Zechner), and Hermes Agent (Nous Research). They represent the full spectrum from minimalist to maximalist. The pattern that emerges is not incompetence, these are talented teams, but accretion. Each layer solves a real problem, but the layers compound.

### The stack they all converge on
```
model → JSON schema → SDK → JS/Python tool handler → reimplemented Unix tool → syscall
```
Every harness reimplements `cat` (read), `grep` (grep/search), `find` (glob), `sed` (edit/replace), and wraps `sh -c` (bash/shell). The tool handlers validate input against JSON schemas, dispatch to a registry, execute the reimplementation, format the result, and feed it back. The model asks to read a file; the harness validates the schema, looks up the handler, calls `fs.readFile`, truncates the output, and returns it as a tool result. `cat -n` does the same thing.

### What each harness built on top

| | Claude Code | Garry | OpenCode | Pi | Hermes |
|---|---|---|---|---|---|
| **size** | 218-665 MB, 1 binary | 126 MB, 1 binary | 133K LOC, 20+ packages | ~400 files, 7 packages | 242K LOC, 578 files |
| **tools** | ~18 | 16 | 20 | 4 default, 7 total | 45+ |
| **skills** | yes | no | yes | yes | 100+ bundled |
| **subagents** | yes | no | yes (task tool) | no | yes (delegate_task) |
| **custom tools** | MCP servers | .garry/tools.ts | plugins | extensions | MCP + skills |
| **TUI** | React+Ink (stock) | React+Ink + Rust FFI (375KB addon) | SolidJS + opentui | custom line-diff | — |
| **rendering** | frame-level | retained-mode tree diff (Rust) | SolidJS reactivity | line-level diff | — |
| **context mgmt** | implicit summarization | prune + conversation search tool | 3-phase: prune/LLM summary/truncate | structured compaction + file tracking | FTS5 full-text session search |
| **system prompt** | ~10K words | ~1.5K words | 500-4K words (per model!) | ~800 words | unknown |
| **providers** | 1 (Anthropic) | 4 | 20+ (Vercel AI SDK) | 25+ (custom) | multiple |
| **permissions** | mode flag | per-tool approval | glob rules, per-agent, doom loop | none | approval system |
| **plugin system** | shell hooks | tool file | 18+ hooks | 35+ events | MCP + skills |

### What the extra layers actually do
**Tool reimplementations**, read, grep, glob, edit, ls — exist because harnesses want to truncate output, track which files the model touched, validate parameters, and gate permissions. These are real concerns. But the model already knows `cat`, `rg`, and `find`. The reimplementations add schema tokens to every request, dispatch overhead per call, and a maintenance surface that tracks upstream behavior imperfectly.

**TUI rendering pipelines**, Garry wrote a 375KB Rust addon for retained-mode differential terminal rendering. OpenCode built opentui, a custom SolidJS terminal framework with mouse support and command palettes. Pi wrote a line-level diff renderer. Claude Code uses stock Ink. All four solve the same problem: `write(fd, buf, len)` flickers when you do it naively. Three teams independently built custom renderers instead of using the terminal as-is.

**Context management**, every harness compacts, prunes, or summarizes conversation history to stay within the context window. Five different strategies, five different trade-offs between fidelity and token cost. The alternative: history is a file, the model greps it with the tools it already has.

**Plugin/extension systems**, OpenCode has 18+ lifecycle hooks. Pi has 35+ events. Hermes has MCP + a skill system with 100+ bundled skills. These exist because a fixed tool set can't anticipate every use case. But Unix already solved this: tools are programs, composition is pipes, extension is `$PATH`.

### What was needed
```
model → NDJSON → parse → gate → sh/perl/curl/browser → syscall
  + a text file for memory
  + a text file for history
  + fork for delegation
```

### The dialectical point
This is not "they're wrong." Pi proved that 4 tools match 18+ on Terminal-Bench. OpenCode proved that model-aware prompting is an insight (different models need different steering). Garry proved that explicit context search beats implicit summarization for recall fidelity. These are genuine contributions.

But the pattern across all five is the same: the harness grows to compensate for not trusting the model with the real tools. Reimplemented `cat` because raw `cat` might return too much. Reimplemented `grep` because raw `rg` output isn't truncated. Built a permission system because `sh -c` is dangerous. Built a context engine because the model can't manage its own memory. Each compensation adds weight. The 126-665 MB binary range is the weight of not asking: what if the model just used `sh`, and we only handled the gate?

## What Each Layer Removes
| Layer | Removes | Keeps |
|---|---|---|
| Industry harness | nothing, this is the full stack | 16-45 tool reimplementations, JSON schema validation, TUI rendering pipeline (React+Ink / SolidJS+opentui / Rust FFI), context compaction engine, plugin system (18-35+ hooks), subagent framework, skill system, 500-10K word system prompt, provider SDK abstraction |
| Giverny | TUI rendering, tool reimplementations, tool dispatch registry, context compaction, plugin/extension system, skill system, custom tool loading | parse (NDJSON), gate (permissions), session management, output routing (stdout/stderr), pipe detection, OpenAI protocol conversion (server mode) |
| Direct model → Unix | agent loop, NDJSON parse/format, process spawn boundary, session management, protocol conversion | gate, exec. The model emits `sh -c` directly, the harness is a permission check and a syscall |

## The Model Tiers
The simpler the harness, the simpler the model can be.

| Tier | Size | What It Does |
|---|---|---|
| cloud | 200B+ | Full reasoning, complex multi-step (current, via API) |
| medium | 30B | Solid shell composition, multi-file operations |
| small | 7-14B | Reliable sh + perl + curl generation |
| tiny | 1-3B | Single-task commands, simple transforms |
| nano | 0.5B | Trained on shell composition specifically |
| pico | 50-300M | ANE accelerated, instant inference, pure shell agent |

The endgame: a pico model on dedicated silicon, composing three C programs from the 70s, 80s, and 90s, at hardware speed, in your shell.
---

