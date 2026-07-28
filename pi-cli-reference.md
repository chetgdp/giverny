# pi CLI Reference

## Basic Usage

`pi "hello"` — yes, any non-flag positional argument is treated as a user message. This runs interactively with the message as the initial prompt.

```bash
pi "hello"                         # Interactive with "hello" as initial message
pi -p "Summarize this"             # One-shot, print to stdout
cat README.md | pi -p "Summarize"  # Piped stdin one-shot
pi --model openai/gpt-4o "Help me" # Specific provider/model
pi --tools read,grep -p "Review"   # Read-only tools
pi -c                              # Continue last session
pi --name "release audit" -p "Audit"  # Named one-shot session
pi --thinking high "Solve this"    # High thinking mode
```

## File Arguments

Prefix files with `@` to include content in the message:

```bash
pi @prompt.md "Answer this"
pi -p @screenshot.png "What's in this image?"
pi @code.ts @test.ts "Review these files"
```

---

## All CLI Options

### Basic

| Flag | Short | Description |
|------|-------|-------------|
| `--help` | `-h` | Show help |
| `--version` | `-v` | Show version |
| `--mode <text\|json\|rpc>` | | Output mode (default: interactive TUI) |
| `--print` | `-p` | Non-interactive: print output and exit |
| `--provider <name>` | | Provider (e.g. `openai`, `anthropic`) |
| `--model <name>` | | Model (e.g. `gpt-4o`, `sonnet`). Use prefix `openai/gpt-4o` or thinking shorthand `sonnet:high` |
| `--api-key <key>` | | API key |
| `--thinking <level>` | | Thinking level: `off`, `minimal`, `low`, `medium`, `high`, `xhigh` |
| `--name <name>` | `-n` | Named session |
| `--verbose` | | Force verbose startup |
| `--offline` | | Disable network operations |

### Session

| Flag | Short | Description |
|------|-------|-------------|
| `--continue` | `-c` | Continue last session |
| `--resume` | `-r` | Resume a specific session |
| `--no-session` | | No session recording |
| `--session <id>` | | Session ID |
| `--session-id <id>` | | Session ID (alias) |
| `--fork <id>` | | Fork a session |
| `--session-dir <path>` | | Override session storage directory |
| `--export <path>` | | Export session to a file |

### Tools

| Flag | Short | Description |
|------|-------|-------------|
| `--tools <a,b,c>` | `-t` | Allowlisted tools (comma-separated) |
| `--exclude-tools <a,b>` | `-xt` | Excluded tools |
| `--no-tools` | `-nt` | Disable all tools |
| `--no-builtin-tools` | `-nbt` | Disable only built-in tools |

### Extensions, Skills, Templates, Themes

| Flag | Short | Description |
|------|-------|-------------|
| `--extension <file>` | `-e` | Load extension |
| `--no-extensions` | `-ne` | Disable extensions |
| `--skill <name>` | | Load skill |
| `--no-skills` | `-ns` | Disable skills |
| `--prompt-template <name>` | | Load prompt template |
| `--no-prompt-templates` | `-np` | Disable prompt templates |
| `--theme <name>` | | Load theme |
| `--no-themes` | | Disable themes |

### Context & Models

| Flag | Short | Description |
|------|-------|-------------|
| `--no-context-files` | `-nc` | Disable context files (AGENTS.md, etc.) |
| `--list-models [pattern]` | | List available models (optional search pattern) |
| `--models <a,b>` | | Comma-separated model filter (limits cycling) |

### System Prompt

| Flag | Description |
|------|-------------|
| `--system-prompt <text>` | Replace the default system prompt |
| `--append-system-prompt <text>` | Append to the system prompt (repeatable) |

### Extension Flags

Any `--unknown-flag` or `--unknown-flag=value` is passed through to extensions as `unknownFlags`. Extensions can register their own CLI flags this way.

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `PI_CODING_AGENT_DIR` | Override config directory (default: `~/.pi/agent`) |
| `PI_CODING_AGENT_SESSION_DIR` | Override session storage directory |
| `PI_PACKAGE_DIR` | Override package directory (for Nix/Guix) |
| `PI_OFFLINE` | Disable startup network operations (`1`/`true`/`yes`) |
| `PI_SKIP_VERSION_CHECK` | Skip the Pi version update check |
| `PI_TELEMETRY` | Override telemetry (`1`/`true`/`yes` or `0`/`false`/`no`) |
| `PI_CACHE_RETENTION` | Set to `long` for extended prompt cache |
| `VISUAL`, `EDITOR` | External editor for Ctrl+G |

---

## Built-in Tool Names

`read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`

---

## Providers

Anthropic, OpenAI, Azure OpenAI, DeepSeek, NVIDIA NIM, Google Gemini, Google Vertex, Amazon Bedrock, Mistral, Groq, Cerebras, Cloudflare AI Gateway, Cloudflare Workers AI, xAI, OpenRouter, Vercel AI Gateway, ZAI, OpenCode Zen, OpenCode Go, Hugging Face, Fireworks, Together AI, Kimi For Coding, MiniMax, Xiaomi MiMo, and more.

Custom providers via `~/.pi/agent/models.json` (OpenAI, Anthropic, Google API formats).
