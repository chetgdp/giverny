# Giverny
*terminal is computer*
<a href="https://en.wikipedia.org/wiki/Claude_Monet"><img src="assets/giverny_bridge.jpg" title="Claude Monet's painting of the bridge in the garden of his Giverny property" alt="bridge in giverny"></a>

>*juiced up `claude -p`*  
>*bridging the gap between the ephemeral and reality*  
>*the first composable agentic shell program to dissolve into userspace*  
>*removing the friction between LLMs and every process on a Unix system*  
>*simple composable primitives with strict interfaces that produce emergent complexity when mastered*

When you use Claude Code you are actually quite separated by the TUI from the rest of your terminal, sure you have the `!` pass through but it's not really the same, it feels clunky. This bridge to the shell allows you to bypass `ink.render()`, while react still sits loaded in memory when running `claude -p`.

```bash
# claude -p
claude -p --output-format stream-json --verbose --model opus --effort high \
  --permission-mode bypassPermissions "write a haiku to tmp/h" && \
  cat tmp/h | claude -p --output-format stream-json --verbose --model opus \
  --effort high --permission-mode bypassPermissions "review this"

# giverny
@ write a haiku to tmp/h && @ review (cat tmp/h)
```

## install

### one-liner
```
curl -fsSL https://raw.githubusercontent.com/chetgdp/giverny/main/install.sh | bash
```

### source
```
git clone https://github.com/chetgdp/giverny.git
cd giverny
./dev-install.sh
```
Symlinks the repo to your PATH, edits are live, no rebuild step. `./dev-install.sh clean` to uninstall. So if you feel like tinkering, go for it!

### dependencies
- <img src="https://bun.sh/logo.svg" height="20px" width="20px"> - Bun, Claude Code is built on this and so is Giverny.
- <img src="assets/clawd.png" height="20px" width="20px"> - Claude Code 
- An anthropic account with API key ~~or subscription (preferably max)~~

---

## the bridge
A bridge between Claude Code (Max) and various local LLM application frameworks.

features:
- [x] non streaming
- [x] tool calls
- [x] streaming
- [x] sessions

## the shell
*Claude 🤝 fish*

><(((º> fish shell is a first class user with the `giverny` alias: `?`, works naturally, no globbing with punctuation as you get with bash/zsh who are forced to use the `@` prefix.

Use your shell normally and talk to Claude with Claude Code's native tools. Session tracked in the background if `/keep` is set. Three permission modes: `/ask`, `/auto`, `/plan`. 

### commands
| command | description |
|---|---|
| `/help` | show all commands |
| `/status` | show version, session, account |
| `/config` | show giverny + claude code settings |
| `/context` | show context window + token usage |
| `/model <name>` | set model (opus, sonnet, haiku) |
| `/effort <level>` | set effort (low, medium, high, max) |
| `/ask` `/auto` `/plan` | set permissions mode |
| `/perms [mode]` | show or set permissions |
| `/tools [list]` | show available tools, or set filter |
| `/session <mode>` | set session mode |
| `/fresh` `/keep` | each query fresh, or resume across queries |
| `/quiet` `/normal` `/verbose` | set tool output level |
| `/diff [instruction]` | analyze git diff (default: summarize) |
| `/export [file]` | export transcript (to file or stdout) |
| `/last` `/copy` | print last response (pipe to clipboard) |
| `/compact [focus]` | compact conversation context |
| `/resume [id]` | list sessions, or resume by number/id |
| `/new` `/clear` [prompt] | clear session (optionally pass a prompt) |
| `/reset` | reset all config to defaults |

### chaining
Giverny is a normal process, so all shell operators just work.

```sh
? write me a haiku | ? what does this poem mean?
? write a haiku to tmp/h && ? review (cat tmp/h)
? explain this error > notes.txt
? explain this error | wl-copy
? slow thing &
```

#### full chaining examples
Pipe-in: when stdin isn't a TTY, giverny reads it and appends to your prompt args (`echo "code" | ? review this` becomes `"review this\n\ncode"`).

```sh
? write me a haiku | ? what does this poem mean?
? write a haiku to tmp/h && ? review (cat tmp/h)
? do thing || echo "that didn't work"
? write code; ? test it
? explain this error > notes.txt
? more thoughts >> notes.txt
? < prompt.txt
? review $(cat file.ts)
? slow thing &
? explain this error | wl-copy
wl-paste | ? review this                  # clipboard contents appended to prompt
```

#### ralph wiggum loop
The [ralph wiggum loop](https://awesomeclaude.ai/ralph-wiggum) feeds Claude the same prompt in a `while true` until a PRD is done. Giverny replaces the flag wall with `@`.

```sh
# basic ralph
while :; do cat PRD.md | @ "read this PRD. check progress. implement next incomplete task. run tests. if all tasks pass write DONE to .ralph-status" && grep -q DONE .ralph-status && break; done

# ralph with review pass
while :; do
  cat PRD.md | @ "implement next incomplete PRD task, run tests, update PROGRESS.md" \
  && @ "review PROGRESS.md against PRD.md — if all done write COMPLETE to .ralph-status" \
  && grep -q COMPLETE .ralph-status && break
done

# for comparison, raw claude -p ralph
while :; do claude -p --output-format stream-json --verbose --model opus \
  --effort high --permission-mode bypassPermissions \
  "$(cat PRD.md) implement next task, run tests, write DONE to .ralph-status" \
  && grep -q DONE .ralph-status && break; done
```

### nvim
use `:!` to expand nvim shell pass through. `%` expands to the current filename.
```sh
:! @ explain %
:! @ refactor %
```
use `:term` to enter a terminal inside nvim, this becomes the easiest way to integrate llms with neovim, you don't need any plugins, it just works naturally.

### config
Settings cascade: `defaults -> ~/.giverny/config.json -> .giverny/config.json`

Commands save to global (`~/.giverny`) by default. Add `--local` to override per-directory.

```sh
? /model haiku            # set globally
? /model haiku --local    # override for this directory only
? /config                 # show all settings with source (global/local)
```

### permissions
Three modes: `/ask` (default), `/auto`, `/plan`

**Auto-approved** (no prompt in ask mode):
- Read-only tools: `Read`, `Glob`, `Grep`, `WebSearch`, `WebFetch`, `LSP`
- Read-only bash: `ls`, `cat`, `head`, `tail`, `find`, `tree`, `grep`, `rg`, `jq`, `git status`, `git log`, `git diff`, etc.
- `sed` without `-i`

**Prompts in ask mode, passes in auto:**
- `Write`, `Edit`, `Bash` with side effects, `Agent`

**Danger-flagged** (extra confirmation even in auto mode):
- `rm -r` on `/` or `~`, `sudo`, `mkfs`, `dd of=/dev/`, `shutdown`/`reboot`/`halt`/`poweroff`, `curl | bash`, fork bombs, recursive `chmod`/`chown` on `/`

## license
MIT and Apache idk man, this is not third party api spoofing, it just is claude code in the terminal...

---
# devlog

## shell design notes
Knowing what we know about `claude -p` we can architect an interactive shell system. Instead of a terminal user interface, the terminal becomes a first class user of the giverny shell macro `@` or `?`. This uses giverny bridge as the engine.

What I imagined was that you use your shell normally, and there is a claude session being tracked in the background. You type `@ can you grep ./folder for something` and it executes the command. There would be perms modes: `--ask or --auto or --plan`, where it skips perms or always ask for perms. If you have ask for perms, you enter a small automated respond with 1, 2 or 3 similar to how Claude Code does. But the session is entirely native inside whatever shell you are already in.

The shell mode shouldn't skip tool calls like the server does, it should use claude code's native tools.

The fundamental data type that we are transforming around is streamed NDJSON (newline-delimited json).

```
claude -p --output-format stream-json --verbose
```

2ms for Bun itself. 10ms to import our code. Meanwhile claude -p takes 3,500ms. Rewriting Giverny in Rust would shave maybe 8ms off a 3,500ms call. That's 0.2%.

Worst case 1m full context window of raw text, around 4mb, then that data goes into NDJSON which is another couple mb added. Milliseconds. General case? 100+ kb, doesn't break a sweat here.

## prior art
`giverny --server` or `giverny -s`

In server mode we juice up `claude -p` to mock the OpenAI `/v1/chat/completions` and `/v1/models`, API. ~~This allows agent harnesses to maintain stateless communication, while our server uses --resume with Claude Code. Currently works with various agent harnesses such as hermes-agent.~~My lawyer advised me that actually it doesn't work and you shouldn't even bother to try it :P

similar projects that have been done:

- https://github.com/thhuang/claude-max-api-proxy-rs Rust proxy, wraps `claude -p`, exposes both OpenAI and Anthropic APIs
- https://github.com/meaning-systems/claude-code-proxy use Max subscription as a local OpenAI-compatible endpoint, daemon setup guides
- https://github.com/dtzp555-max/ocp OpenClaw Control Plane, zero-dependency Max-to-OpenAI proxy
- https://github.com/router-for-me/CLIProxyAPI wraps multiple CLI tools (Claude, Gemini, Codex, Qwen) as OpenAI-compatible APIs
- https://github.com/CaddyGlow/ccproxy-api plugin-based reverse proxy unifying Claude + Codex behind one API
- https://github.com/jimmc414/claude_n_codex_api_proxy Claude Code + Codex API routing proxy
- https://github.com/rynfar/opencode-claude-max-proxy uses Claude Code SDK + OAuth, not CLI wrapping
- https://github.com/fuergaosi233/claude-code-proxy reverse direction: lets Claude Code use OpenAI/Azure/Ollama
- https://github.com/1rgs/claude-code-proxy reverse direction: run Claude Code on OpenAI models via LiteLLM
- https://github.com/nielspeter/claude-code-proxy reverse direction: Claude Code → OpenRouter, OpenAI, Ollama

### shell AI tools

- https://github.com/bakks/butterfish Go, wraps bash/zsh, capital letter = AI prompt, `!` = agent goal mode. Closest to giverny but it's a shell *wrapper* (spawns child shell), not a shell guest. No structured tools.
- https://github.com/alvinunreal/tmuxai AI pane alongside your terminal, reads all tmux panes for context. Requires tmux. Observe/prepare/watch modes.
- https://www.answer.ai/posts/2024-12-05-introducing-shell-sage.html ~150 lines, uses tmux `capture-pane` for context. Read-only, teaches rather than executes. Requires tmux.
- https://github.com/Realiserad/fish-ai fish shell plugin, `Ctrl+P` converts comments to commands, `Ctrl+Space` for autocomplete. One-shot, no session.
- https://github.com/TheR1D/shell_gpt 12k stars, `sgpt` CLI tool with chat sessions and REPL mode. A tool you invoke from your shell, not an agent in it.
- https://github.com/jonboh/shai Rust, fzf-style keybinding integration. Deliberately memoryless, command generation only.

