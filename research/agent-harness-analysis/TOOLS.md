# Agent Harness Tool Registries

Complete tool listings for analyzed harnesses. Claude Code tools documented in MAP.md cross-reference table.

---

## Garry

**Total: 16 built-in tools + user-defined custom tools**

---

## Core Tools (11)

| # | Tool | What It Does | Approval |
|---|------|-------------|----------|
| 1 | **read** | Reads file contents with line numbers, or lists a directory. Supports `startLine`/`endLine` ranges. Max 1,000 lines per call. | No |
| 2 | **grep** | Regex search across file contents. Auto-excludes `node_modules`, `.git`, `dist`, `build`, `.next`, `coverage`. Searches up to 500 files. | No |
| 3 | **glob** | Finds files by glob pattern. Returns up to 100 matches. Options for `cwd`, `dot` files, `absolute` paths, `followSymlinks`, `onlyFiles`. | No |
| 4 | **analyze** | Analyzes files/directories and extracts relevant snippets. Accepts glob patterns + optional focus context. Streams results. | No |
| 5 | **ask** | Asks the user a question. Supports up to 4 multiple-choice options. | Yes |
| 6 | **create** | Creates a new file. Fails if file already exists unless `overwrite: true`. | Yes |
| 7 | **replace** | Replaces text in a file using pattern matching. Supports regex capture groups (`$1`, `$2`). File must already be loaded by read/grep/analyze. | No |
| 8 | **shell** | Executes bash commands (PowerShell on Windows). Default 120s timeout. Streaming output, truncated after 100 lines. | Yes |
| 9 | **diagnostics** | Gets language diagnostics (errors, warnings, hints) from IDE language services. | No |
| 10 | **plan** | Structured task tracking. Actions: `add`, `complete`, `cancel`, `clear`, `list`. Persisted in the UI. | No |
| 11 | **speak** | Text-to-speech output. Voice mode only. Requires OpenAI API key and macOS audio. | No |

---

## Extended Tools (2)

Added via Vercel AI SDK's Anthropic provider.

| # | Tool | What It Does | Limit |
|---|------|-------------|-------|
| 12 | **web_fetch** | Fetches a URL. Anthropic provider tool. | 1 use per turn |
| 13 | **web_search** | Web search. Anthropic provider tool. | 10 uses per turn |

---

## Hidden Tool (1)

Injected separately into message context, not part of the main tool registry.

| # | Tool | What It Does |
|---|------|-------------|
| 14 | **conversation** | Searches and reads the full conversation history, including messages pruned from context. Three actions: **list** (overview of all turns with context status), **read** (full content of a specific turn/message by index), **search** (case-insensitive substring search across all messages, up to 50 results). |

---

## Advanced/Gated Tools (2)

Feature-flagged behind `advanced-tool-use-2025-11-20`. Anthropic API-level features, not garry-specific.

| # | Tool | What It Does |
|---|------|-------------|
| 15 | **tool_search_tool_regex** | Searches a large tool catalog using regex matching. |
| 16 | **tool_search_tool_bm25** | Searches a large tool catalog using BM25 ranking. |

---

## Custom Tools

Loaded from `.garry/tools.ts` at startup. Each custom tool must export:

- `description` -- what the tool does
- `inputSchema` -- JSON schema for the tool's parameters
- `execute` -- function that runs the tool

Custom tools are merged into the full registry alongside all built-in tools.

---
---

## Hermes Agent (Nous Research)

**Total: 45+ built-in tools + 100+ bundled skills + MCP tools**

Python, 242K LOC, 578 files. The maximalist harness.

### Unix Rewrites (same as everyone else)

| # | Tool | What It Does | Unix Equivalent |
|---|------|-------------|-----------------|
| 1 | **read_file** | Read file contents. | `cat` |
| 2 | **write_file** | Write file contents. | `tee`, `cat >` |
| 3 | **patch** | Apply edits to a file. | `patch` |
| 4 | **search_files** | Search for text patterns across files. | `rg`, `grep` |
| 5 | **terminal** | Execute shell commands. Local, Docker, SSH, Modal, Daytona backends. | `sh -c` |
| 6 | **process** | Process management (kill, list). | `kill`, `ps` |
| 7 | **web_search** | Web search. | `curl` + search API |
| 8 | **web_extract** | Fetch and extract web content (Firecrawl). | `curl` |
| 9 | **text_to_speech** | TTS via Edge TTS (free) or ElevenLabs. | `espeak`, `say` |
| 10 | **todo** | Task tracking. | text file |
| 11 | **cronjob** | Scheduled task automation. | `crontab` |
| 12 | **execute_code** | Python sandbox execution. | `python -c` |

### Novel Tools (no Unix equivalent)

| # | Tool | What It Does | Why It Exists |
|---|------|-------------|---------------|
| 13 | **session_search** | FTS5 full-text search across all conversation sessions. | Model forgets (finite context). |
| 14 | **memory** | Persistent memory read/write (`~/.hermes/MEMORY.md`). | Model has no state between sessions. |
| 15 | **skill_manage** | Create, edit, version skills from experience. | Model can't learn permanently. |
| 16 | **skills_list** | Browse available skills. | Discovery for skill system. |
| 17 | **skill_view** | View skill contents. | Read access for skill system. |
| 18 | **delegate_task** | Spawn child agent with shared iteration budget. | Model can't parallelize itself. |
| 19 | **mixture_of_agents** | Multi-model reasoning (MoA). | Ensemble decision-making. |
| 20 | **vision_analyze** | Image analysis. | Model can't see (without multi-modal). |
| 21 | **image_generate** | Generate images via DALL-E / Fal.ai. | Model can't produce images natively. |
| 22-32 | **browser_*** (11 tools) | Navigate, click, type, scroll, screenshot via Browserbase. | Model can't interact with web UIs. |
| 33 | **send_message** | Cross-platform message delivery (15+ platforms). | Model has no output channel to humans. |
| 34-36 | **ha_*** (3 tools) | Home Assistant: list entities, get state, call service. | Model can't interact with physical world. |
| 37-39 | **honcho_*** (3 tools) | User modeling and context from prior sessions. | Model doesn't know who it's talking to. |
| 40+ | **rl_*** tools | Generate trajectories for reinforcement learning. | Model can't train itself. |

### Tool Execution Architecture

- **Parallel execution**: Read-only tools (web_search, read_file, session_search, vision_analyze) run concurrently via ThreadPoolExecutor (8 workers).
- **Sequential fallback**: Interactive tools (clarify) always run sequentially.
- **Approval system**: Dangerous commands detected and require human confirmation.
- **Availability checks**: Tools self-register with check_fn -- e.g., Telegram tool only loads if TELEGRAM_BOT_TOKEN is set.
- **MCP support**: External tools via Model Context Protocol client (~1050 LOC).
- **Iteration budget**: 90 steps default, shared between parent agent and all subagents.

---
---

## Pi (Mario Zechner)

**Default: 4 tools. Full set: 7 tools + extensions.**

TypeScript, ~400 source files across 7 packages. The minimalist-extensible harness.

### Default Tools (4)

The only tools enabled out of the box. System prompt + tool definitions: ~1,000 tokens total.

| # | Tool | What It Does | Unix Equivalent | Streaming |
|---|------|-------------|-----------------|-----------|
| 1 | **read** | Read file contents with offset/limit. Image support (auto-resize). 2000 lines / 50KB head truncation. | `cat -n`, `head`, `tail` | No |
| 2 | **write** | Create or overwrite file. Auto-creates parent dirs. | `tee`, `cat >` | No |
| 3 | **edit** | Exact text replacement with fuzzy fallback (normalizes smart quotes, dashes, unicode spaces). Multiple edits per call. Returns unified diff. | `sed`, `patch` | No |
| 4 | **bash** | Execute shell commands. Rolling buffer, tail truncation (2000 lines / 50KB). Overflow written to temp file. Timeout via AbortSignal. | `sh -c` | Yes |

### Optional Read-Only Tools (3)

Disabled by default. Enable with `--tools read,grep,find,ls` for read-only mode.

| # | Tool | What It Does | Backend | Streaming |
|---|------|-------------|---------|-----------|
| 5 | **grep** | Regex/literal search with ripgrep. 100 matches / 50KB. Lines truncated to 500 chars. Respects .gitignore. | `rg --json` | Kills on limit |
| 6 | **find** | Glob file search with fd. 1000 results. Respects all .gitignore files in tree. | `fd --glob` | No |
| 7 | **ls** | List directory contents, sorted, with `/` suffix for dirs. 500 entries. | `readdir` | No |

### Extension Tools

Extensions can register arbitrary LLM-callable tools at runtime:

```typescript
api.registerTool({
  name: "my_tool",
  description: "Does a thing",
  parameters: Type.Object({ input: Type.String() }),
  execute: async (id, args) => ({ content: [{ type: "text", text: "result" }] })
});
```

No built-in extension tools ship with pi. All "missing" features (web search, sub-agents, plan mode, MCP, sandbox, permission gates) are expected to be built or installed as extensions.

### Tool Architecture

All tools share:
- **Pluggable operations**: Every tool's I/O goes through an `*Operations` interface. Default: local filesystem. Swappable for SSH, containers, remote.
- **TypeBox schemas**: Parameter validation via AJV.
- **Split results**: Separate `content` (→ LLM) and `details` (→ UI). LLM gets text, UI gets structured data.
- **File mutation queue**: Serializes writes to same file across concurrent tool calls.
- **Truncation utilities**: Consistent head/tail truncation with continuation hints.

### Key Differences From Other Harnesses

- **No permission system**. Zero approval gates. YOLO by design.
- **No max iterations**. Loop until agent says done.
- **Fuzzy edit matching**: Smart quote/dash/unicode normalization. Most resilient edit tool across harnesses.
- **Pluggable I/O**: Only harness where tools can target remote execution without code changes.
- **4 defaults, not 18**: Bash is the catch-all. grep/find/ls are optimizations, not necessities.

---
---

## OpenCode (anomalyco / SST team)

**Total: 20 built-in tools + plugin-defined tools**

TypeScript, 133K LOC core, 1,400 source files across 20+ packages. The platform harness.

### Core File Operation Tools (7)

| # | Tool | What It Does | Permission |
|---|------|-------------|------------|
| 1 | **bash** | Execute shell commands with process spawning, output capture, timeout. | Ask |
| 2 | **read** | Read files/directories with line numbers. 2000 line limit, offset support. | Allow (`.env*`: ask) |
| 3 | **write** | Create files with diff generation and LSP diagnostics. | Allow |
| 4 | **edit** | Modify files via old_string/new_string replacement. Unified diff output. | Allow |
| 5 | **apply_patch** | Apply unified diff patches. Swapped in for GPT models (replaces edit/write). | Allow |
| 6 | **multiedit** | Apply multiple file edits atomically. | Allow |
| 7 | **ls** | List directory contents with metadata. | Allow |

### Search Tools (3)

| # | Tool | What It Does |
|---|------|-------------|
| 8 | **glob** | Find files by glob patterns, max 100 results, sorted by mtime. |
| 9 | **grep** | Regex search via ripgrep with line truncation. |
| 10 | **codesearch** | Code/API doc search via Exa API. Provider-gated. |

### Network Tools (2)

| # | Tool | What It Does |
|---|------|-------------|
| 11 | **webfetch** | HTTP fetch with HTML→markdown conversion. |
| 12 | **websearch** | Web search via Exa API with live crawling. Provider-gated. |

### Agent/Session Tools (4)

| # | Tool | What It Does |
|---|------|-------------|
| 13 | **task** | Spawn subagent sessions (explore, general, custom). |
| 14 | **skill** | Load skill bundles with injected instructions. |
| 15 | **todowrite** | Create/update structured task lists. |
| 16 | **question** | Interactive user prompts (multiple choice, free text). |

### Code Intelligence Tools (1)

| # | Tool | What It Does |
|---|------|-------------|
| 17 | **lsp** | Language Server Protocol: goToDefinition, findReferences, hover, rename. Experimental. |

### Experimental/Special Tools (3)

| # | Tool | What It Does |
|---|------|-------------|
| 18 | **batch** | Execute multiple tools concurrently. Experimental. |
| 19 | **plan_exit** | Switch from plan to build agent. Experimental. |
| 20 | **invalid** | Fallback for malformed tool calls. Never directly invocable. |

### Model-Aware Tool Filtering

Unique to OpenCode: tool set changes based on which model is active.
- `apply_patch` replaces `edit`/`write` for GPT models
- `codesearch`/`websearch` only available with opencode provider or Exa flag
- `lsp`, `batch`, `plan_exit` behind experimental flags

### Tool Architecture

- **Permission system**: Granular glob rules (allow/deny/ask) per-agent, per-session
- **Doom loop detection**: 3 identical tool calls → Permission.DeniedError
- **Tool call repair**: Auto-lowercase names, route broken calls to `invalid` tool
- **Plugin tools**: 18+ lifecycle hooks for tool definition and interception
- **Client/server split**: Tool execution on server, results streamed to any client via SSE
