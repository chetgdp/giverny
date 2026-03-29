# Tool Call Abstraction Map
*written by claude based on agent harness codebase analysis, edited by the user*

The goal of this research is to analyze the tools used by agent harnesses, then map them to their most basic UNIX implementations. We have found that there are many abstraction layers between a model and the actual operation.

### File & Search (the universal set)
| Unix | Garry | Claude Code | Hermes | What Actually Happens |
|---|---|---|---|---|
| `cat`, `head`, `tail` | read | Read | read_file | read(fd) on a file |
| `grep`, `rg` | grep | Grep | search_files | regex match on byte stream |
| `find`, `fd`, `ls` | glob | Glob | (via search_files) | readdir + pattern match |
| `grep` + `cat` | analyze | Agent (Explore) | (via search_files) | read + regex, multiple files |
| `cat >`, `tee` | create | Write | write_file | write(fd) to a file |
| `sed`, `patch` | replace | Edit | patch | regex replace on byte stream |
| the shell itself | shell | Bash | terminal | fork + exec |
| `curl` | web_fetch | WebFetch | web_extract | socket connect, HTTP GET, read |
| `curl` + search API | web_search | WebSearch | web_search | socket connect, HTTP GET, read |
| `read` (bash builtin) | ask | AskUserQuestion | (clarify) | read(0) from stdin |
| `tsc --noEmit`, compiler | diagnostics | LSP | - | parse source, report errors |
| `say`, `espeak` | speak | - | text_to_speech | audio device write |
| a text file | plan | TaskCreate/Update | todo | write(fd) to a file |
| `crontab` | - | - | cronjob | scheduled task execution |
| `kill`, `ps` | - | - | process | signal delivery, process list |

### Novel Tools (no Unix equivalent)
These exist because LLMs are not Unix processes.

| Problem | Garry | Claude Code | Hermes | Why It Exists |
|---|---|---|---|---|
| Model forgets | conversation | context compacting | session_search (FTS5) | Context windows are finite; Unix pipes aren't |
| Model learns | - | - | skill_manage, skills_list | Procedural memory from experience |
| Model delegates | - | Agent (subagents) | delegate_task, mixture_of_agents | Spawn child agents with budget |
| Model needs approval | approval gate | permission mode | approval system | Can't trust unsupervised `rm -rf` |
| Model sees images | - | - | vision_analyze | Multi-modal input |
| Model browses | - | - | browser_* (11 actions) | Web automation without curl |
| Model generates images | - | - | image_generate | Multi-modal output |
| Model messages humans | - | - | send_message (15+ platforms) | Cross-platform delivery |
| Model controls home | - | - | ha_* tools | Home Assistant integration |
| Model trains itself | - | - | rl_* tools | RL trajectory generation |
| Tool discovery | tool_search_regex, tool_search_bm25 | - | - | Anthropic API feature |

## Wrapping Depth
```
Hermes:   model → JSON schema → Python tool handler → Unix syscall (+ SQLite, browser, HA, RL)
Garry:    model → JSON schema → Vercel AI SDK → JS tool handler → Unix syscall
Claude:   model → JSON schema → custom handler → JS tool handler → Unix syscall
```

## What Each Layer Adds
| Layer | What It Does | What It Costs |
|---|---|---|
| JSON schema | Describes the tool for the model | Token overhead per request |
| Vercel AI SDK | Provider abstraction, agent loop | Bundle size, indirection |
| JS tool handler | Parses args, formats output, error handling | Latency, memory, complexity |
| React + Ink | Renders tool output in TUI components | 95 MB runtime, rendering pipeline |
| Rust persistent tree | Diffs TUI output for terminal | 375 KB, FFI overhead |
| Terminal emulator | Retained mode character grid | Already running, cost is zero |

## Harness Size Comparison
```
Garry:         126 MB    11 tools    Bun/JS     Rust renderer + Vercel AI SDK
Claude Code:   218 MB    ~12 tools   Node.js    custom agent loop
Hermes:        126 MB    45+ tools   Python     SQLite + 15 platform adapters + skills + RL
```
All four reimplement `cat`, `grep`, `find`, `sed`, `curl` as JSON-schema'd tool handlers. Hermes does it the most.

## Exact Unix Implementations
If the model could call Unix directly, every tool maps to a real command:

| Tool | Unix Command | Notes |
|---|---|---|
| read | `cat -n file`, `sed -n '10,20p' file`, `ls` | line ranges via sed, dirs via ls |
| grep | `rg -n --glob '!node_modules' 'pattern' .` | ripgrep with exclusions |
| glob | `fd -g '*.ts' .` | or `find . -name '*.ts'` |
| analyze | `rg -C5 'pattern' file` | grep with surrounding context lines |
| create | `tee newfile.ts <<'EOF'` | write stdin to file |
| replace | `patch -p0 < diff` | model outputs unified diff, patch applies it |
| shell | `sh -c 'command'` | already Unix |
| ask | read from stdin | wait for human input |
| web_fetch | `curl -s URL` | HTTP GET |
| web_search | `curl` + search API | or `ddgr -n5 'query'` |
| speak | `espeak "text"` / `say "text"` | platform-dependent |
| diagnostics | `tsc --noEmit`, `eslint`, `pyright` | run the compiler/linter |
| plan | `echo "- [ ] step" >> plan.md` | structured task file |
| conversation | **nothing** | no Unix equivalent |

## The Hard Ones
**replace/edit** -- `sed -i 's/old/new/' file` works for single-line substitutions. Multi-line surgical edits need `patch`. The Unix-native way to express "change these exact lines in this file" is a unified diff. The model generates the diff, `patch` applies it. `ed` is the other option -- non-interactive line editor, commands like `3s/old/new/`.

**conversation/context** -- no Unix equivalent. A Unix process doesn't forget -- it has the full pipe stream. An LLM forgets because context windows are finite. This is the one tool that exists to solve a problem the LLM architecture created. It has to be built from scratch.

**permission gating** -- closest analog is `sudo`. But `sudo` is binary (root or not). Agent approval is per-operation, with context shown to the human. The Unix pattern would be: write the proposed command to stdout, wait for a signal to proceed. Which is what `claude -p --permission-mode default` already does.

## The Actually Novel Tools
Across all three harnesses, the tools that have no Unix equivalent share one trait: they compensate for what LLMs lack compared to Unix processes.

| LLM Limitation | Tool Solution | Harness(es) |
|---|---|---|
| Finite context (forgets) | conversation, session_search, context compacting | All three |
| No persistent learning | skill_manage, skills auto-creation | Hermes only |
| Can't be trusted unsupervised | approval gates, permission modes | All three |
| Can't see | vision_analyze | Hermes only |
| Can't browse interactively | browser_* | Hermes only |
| Can't delegate | subagents, delegate_task, MoA | Claude Code, Hermes |

Everything else is `$PATH` with extra steps.
