# The Pipeline

The minimal agentic shell architecture. Everything else is unnecessary.

## The Data Transformation

```
user intent → model → NDJSON tool calls → parse → permission gate → execute → result → model → response
```

## The Dispatch

```
                         ┌─── sh ────── fork + exec (orchestration, file ops)
                         │
NDJSON stream → parse → gate → perl ── fork + exec (text transformation)
                         │
                         ├─── curl ─── socket + HTTP  (networking)
                         │
                         └─── browser ─ headless      (web automation, the one new thing)
```

## The Tools

| Tool | Year | Language | Size | What It Does |
|---|---|---|---|---|
| sh | 1977 | C | installed | Process orchestration, file I/O, piping |
| perl | 1987 | C | 12 MB | Text read, search, replace, analyze, transform |
| curl | 1998 | C | installed | HTTP, networking, API calls |
| browser | new | TBD | TBD | Headless web automation (can't curl a SPA) |

## The Harness

The harness is not a framework. It is four functions:

1. **Parse** — read NDJSON from model output, extract tool call
2. **Gate** — check permissions, prompt user if dangerous
3. **Execute** — fork the appropriate tool (sh, perl, curl, browser)
4. **Return** — format result as NDJSON, feed back to model

That's it. No tool reimplementations. No JSON schemas describing cat. No virtual DOM. No rendering pipeline. Parse, gate, fork, return.

## The Protocol

NDJSON (newline-delimited JSON) is the wire format between model and harness.

```
→ model outputs:   {"tool": "sh", "cmd": "rg -n 'TODO' src/"}
← harness returns:  {"result": "src/main.rs:42: // TODO fix this", "exit": 0}

→ model outputs:   {"tool": "perl", "cmd": "perl -pi -e 's/TODO fix this/DONE/' src/main.rs"}
← harness returns:  {"result": "", "exit": 0}

→ model outputs:   {"tool": "curl", "cmd": "curl -s https://api.example.com/status"}
← harness returns:  {"result": "{\"status\": \"ok\"}", "exit": 0}
```

## The Permission Gate

Two tiers:

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

## The User

The user is whoever is at fd 0. The harness doesn't know and doesn't care.

```
human → stdin → harness → model → tools → stdout → human
script → stdin → harness → model → tools → stdout → script
cron   → stdin → harness → model → tools → stdout → log
LLM    → stdin → harness → model → tools → stdout → LLM
```

## The Delegation Model

Subagents are processes. Unix already solved this.

```
? do task A &        # background process 1
? do task B &        # background process 2
wait                 # synchronize
? review results     # next step
```

No delegate_task tool. No subagent framework. No iteration budgets. Just fork.

## The Context Model

Conversation history is a file. The model searches it with the tools it already has.

```
# full history on disk
cat .session/history.json

# search old context
grep -i "that function we discussed" .session/history.json

# feed relevant context back in
cat .session/history.json | ? "continue from where we left off"
```

No conversation tool. No context compacting. No summarization. Files and grep.

## The Learning Model

Knowledge is a text file. System prompt includes it.

```
# model learns something useful
echo "this project uses tabs not spaces" >> .agent/learnings.md

# next session, learnings are in the system prompt
cat .agent/learnings.md | ? "fix the formatting"
```

No skill_manage. No memory tool. No skill versioning. Cat and echo.

## What The Industry Built vs What Was Needed

```
Industry:
  model → JSON schema → SDK → JS/Python tool handler → reimplemented Unix tool → syscall
  + React + Ink + Yoga + Rust persistent tree + ANSI diff engine
  + 126-665 MB binary
  + 12-45 custom tools
  + subagent framework
  + skill system
  + context compacting engine
  + TUI rendering pipeline

Needed:
  model → NDJSON → parse → gate → sh/perl/curl/browser → syscall
  + a text file for memory
  + a text file for history
  + fork for delegation
```

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

## The Stack

```
sh      (1977, C)  — orchestration
perl    (1987, C)  — text transformation
curl    (1998, C)  — networking
browser (new)      — web automation
model   (202X)     — intent → composition
```

Four tools and a model. The rest is a parser and a permission gate.

---

# misc

## What Each Layer Removes

| Layer | Removes |
|---|---|
| Giverny | TUI, custom tool implementations, rendering pipeline |
| `claude -p` | Interactive UI (still has tools, agent loop) |
| Direct model → Unix | Tool reimplementations, agent harness |
