# Pi Mono — Agent Harness Analysis

Monorepo by Mario Zechner (@badlogicgames). 7 packages, MIT licensed.
Published as `@mariozechner/pi-*`. CLI ships as `pi`.

## Stack

| Layer | Tech |
|-------|------|
| Runtime | Node.js (Bun for binary builds) |
| Language | TypeScript (strict, no `any`) |
| LLM Interface | Custom multi-provider abstraction (`pi-ai`) |
| Agent Loop | Custom event-driven loop (`pi-agent-core`) |
| TUI | Custom differential renderer (`pi-tui`) |
| Build | npm workspaces, lockstep versioning |
| Test | Vitest |
| Lint | Biome (tabs, 120 char width) |

Binary size not measured (source-only analysis). Seven packages total, four are the agent stack.

## Package Architecture

```
pi-ai                     # LLM provider abstraction (25+ providers)
  ↑
pi-agent-core              # Agent loop, tool execution, events
  ↑
pi-coding-agent            # CLI agent with tools, sessions, extensions
  ↑
pi-tui                     # Terminal UI with differential rendering

pi-mom                     # Slack bot agent (uses pi-agent-core + pi-ai)
pi-web-ui                  # Browser chat UI (mini-lit + Tailwind)
pi-pods                    # vLLM deployment CLI (GPU pod management)
```

The layering is clean. `pi-ai` knows nothing about agents. `pi-agent-core` knows nothing about coding tools or TUI. `pi-coding-agent` composes everything. Each layer is independently useful.

## 1. Agent Loop

Three-nested-loop architecture in `packages/agent/src/agent-loop.ts`:

```
OUTER LOOP (while true)
  ├─ Check for follow-up messages
  │
  MIDDLE LOOP (while hasToolCalls || pendingMessages)
  │ ├─ Inject pending steering messages
  │ ├─ Stream assistant response from LLM
  │ ├─ Extract tool calls from response
  │ ├─ Execute tool calls
  │ ├─ Poll for new steering messages
  │
  └─ If follow-ups exist → loop again; else break
```

Three levels because three kinds of injection:
- **Steering**: user interrupts mid-turn. Injected after tool execution, before next LLM call.
- **Follow-up**: user queues work for after the agent finishes. Checked when agent would otherwise stop.
- **Tool results**: standard agent loop mechanics.

No max iteration limit. Loop continues until no tool calls, no steering, no follow-ups. A misconfigured agent could loop forever.

### Tool Execution Modes

Two modes, configured per-agent:

**Sequential**: Each tool executes in order. Simple, predictable.

**Parallel**: Preparation (validation, beforeToolCall hook) runs sequentially. Execution runs concurrently via `Promise.all()`. Results emitted in source order.

The sequential preparation in parallel mode is deliberate — hooks that block tool execution need to run before spawning concurrent work.

### Message Context Pipeline

```
AgentMessage[]                    # May include custom message types
  ↓
transformContext()                # Hook: prune, inject, reorder
  ↓
convertToLlm()                   # Filter to user/assistant/toolResult only
  ↓
Message[]                         # Sent to LLM
```

`transformContext` operates on `AgentMessage` (rich types). `convertToLlm` strips custom messages. This separation lets extensions add UI-only messages that never reach the LLM.

### Event System

Fine-grained event stream:

```
agent_start
  turn_start
    message_start → message_update* → message_end    # Assistant response
    tool_execution_start → tool_execution_end         # Per tool call
    message_start → message_end                       # Tool result
  turn_end
agent_end
```

Events are processed synchronously: state reduction first, then listeners awaited in subscription order. Listeners receive an `AbortSignal` for cooperative cancellation.

### Steering and Follow-Up

Two independent queues with configurable drain modes:

| Queue | Trigger | Delivery | Drain Mode |
|-------|---------|----------|------------|
| Steering | User types while agent works | After tool execution, before next LLM call | "all" or "one-at-a-time" |
| Follow-up | User presses Alt+Enter | After agent would normally stop | "all" or "one-at-a-time" |

"one-at-a-time" means each drain returns one message, requiring the loop to iterate for each. "all" drains everything at once.

This is a first-class interruption system. Most harnesses either queue everything or ignore mid-turn input.

## 2. LLM Provider Abstraction

`pi-ai` is arguably the most ambitious part. Unified streaming interface for 25+ providers:

**Built-in providers**: Anthropic, OpenAI (Completions + Responses), Azure OpenAI, OpenAI Codex, Google (Generative AI, Vertex, Gemini CLI, Antigravity), Amazon Bedrock, Mistral, Groq, Cerebras, xAI, MiniMax, GitHub Copilot, OpenRouter, Vercel AI Gateway, ZAI, OpenCode Zen/Go, Kimi For Coding, Ollama, vLLM, LM Studio, any OpenAI-compatible API.

### Streaming Contract

Every provider emits the same event stream:

```
start → (text_start → text_delta* → text_end)* →
        (thinking_start → thinking_delta* → thinking_end)* →
        (toolcall_start → toolcall_delta* → toolcall_end)* →
        done | error
```

Every event carries `partial: AssistantMessage` — the accumulating state. Consumers can read partial at any point without reconstructing from deltas.

### Model Registry

Two-level: static model registry (auto-generated from scripts) and dynamic API provider registry (lazy-loaded).

```typescript
getModel("openai", "gpt-4o")      // Type-safe: only valid combinations compile
getModels("anthropic")              // All models for provider
getProviders()                      // All known providers
```

Overload signatures ensure type safety — `getModel("openai", "nonexistent-model")` is a type error.

### Thinking/Reasoning Abstraction

Unified across providers:

```typescript
type ThinkingLevel = "minimal" | "low" | "medium" | "high" | "xhigh"
```

Mapped to provider-specific parameters:
- OpenAI: `reasoning_effort`
- Anthropic: thinking budget tokens
- Google: reasoning tokens
- OpenRouter: `reasoning.effort`
- Others: custom mapping via `reasoningEffortMap`

Thinking content appears as `ThinkingContent` blocks in the unified `AssistantMessage`, regardless of how the provider represents it.

### Compatibility Layer

For OpenAI-compatible APIs, URL-based auto-detection resolves quirks:

- `supportsStore` — response caching
- `supportsDeveloperRole` — vs system role
- `thinkingFormat` — "openai" | "openrouter" | "zai" | "qwen"
- `requiresToolResultName` — name field in tool results
- `requiresAssistantAfterToolResult` — message ordering
- `maxTokensField` — "max_completion_tokens" vs "max_tokens"

This is the compat layer that makes "OpenAI-compatible" actually compatible.

### Token Tracking and Cost

Every `AssistantMessage` includes:

```typescript
Usage {
  input, output, cacheRead, cacheWrite, totalTokens
  cost: { input, output, cacheRead, cacheWrite, total }  // dollars
}
```

Cost calculated from per-model pricing ($/million tokens). Cache read/write tracked separately.

## 3. Tool Registry

Seven core tools in `packages/coding-agent/src/core/tools/`:

| Tool | Backend | Streaming | Parameters |
|------|---------|-----------|------------|
| `bash` | spawn (local shell) | Yes (rolling buffer) | command, timeout? |
| `read` | fs.readFile | No | path, offset?, limit? |
| `write` | fs.writeFile | No | path, content |
| `edit` | custom diff | No | path, edits[{oldText, newText}] |
| `grep` | ripgrep (`rg`) | Kills on limit | pattern, path?, glob?, ignoreCase?, literal?, context?, limit? |
| `find` | `fd` | No | pattern, path?, limit? |
| `ls` | fs.readdir | No | path?, limit? |

### Pluggable Operations

Every tool defines an `*Operations` interface for its I/O:

```typescript
interface BashOperations { spawn(...): ChildProcess }
interface ReadOperations { readFile(...), access(...), detectImageMimeType?(...) }
interface EditOperations { readFile(...), writeFile(...), access(...) }
// etc.
```

Default implementations use the local filesystem. Custom implementations enable SSH, containers, remote execution — without changing the tool logic.

No other harness has this level of pluggability. Garry and Claude Code hardcode local I/O.

### Edit Tool: Fuzzy Matching

The edit tool has sophisticated fallback matching:

1. Exact match on original content
2. If not found: normalize (strip trailing whitespace, ASCII-ify smart quotes/dashes/unicode spaces), retry
3. Error only if no match or multiple matches

This handles copy-paste artifacts from chat interfaces where quotes and dashes get unicode-mangled. Claude Code does basic normalization. Pi's is more thorough.

### Truncation Strategy

Consistent across all tools:

| Tool | Default Limit | Strategy |
|------|--------------|----------|
| bash | 2000 lines / 50KB | Tail (keep latest output) |
| read | 2000 lines / 50KB | Head (keep beginning, offer offset) |
| grep | 100 matches / 50KB | Kill process at limit |
| find | 1000 results / 50KB | `fd --max-results` |
| ls | 500 entries / 50KB | Entry count cap |
| grep lines | 500 chars | Per-line truncation |

Bash output exceeding 50KB in memory gets written to a temp file. The tool result includes the path so the agent can `read` it.

### File Mutation Queue

`withFileMutationQueue()` serializes writes to the same file while allowing parallel writes to different files. Uses canonical paths (realpath) to catch symlink aliases.

## 4. System Prompt

Built dynamically in `packages/coding-agent/src/core/system-prompt.ts`.

Base template (~800 words, contrast with Claude Code's ~10,000):

```
You are an expert coding assistant operating inside pi, a coding agent harness.
You help users by reading files, executing commands, editing code, and writing new files.

Available tools:
[one-line snippets per tool]

Guidelines:
[tool-specific guidelines + custom guidelines]

Pi documentation: [paths to docs, only consulted when user asks about pi]

# Project Context
[AGENTS.md content]

[Skills section if available]

Current date: [ISO date]
Current working directory: [cwd]
```

### Compositional Prompt Construction

The prompt grows based on configuration:

- **Tools selected** → each tool contributes `promptSnippet` (one-liner) and `promptGuidelines` (bullets)
- **Context files** → AGENTS.md, SYSTEM.md, APPEND_SYSTEM.md loaded from `.pi/` and `~/.pi/agent/`
- **Skills** → formatted as XML blocks with file paths
- **Extensions** → can modify prompt via `before_agent_start` event
- **Custom prompt** → replaces entire default template

This means a read-only agent, a full coding agent, and a specialized review agent all get different prompts from the same system. Claude Code uses one monolithic prompt regardless of context.

### Tool Guidelines (Conditional)

The prompt includes different advice depending on which tools are active:

- If only bash: "Use bash for file operations like ls, rg, find"
- If bash AND grep/find/ls: "Prefer grep/find/ls tools over bash for file exploration (faster, respects .gitignore)"

### AGENTS.md (Pi's CLAUDE.md)

The project's `AGENTS.md` covers:
- Code quality rules (strict typing, proper imports)
- Git safety (no reset --hard, no checkout ., no stash, specific file staging)
- Testing procedures
- PR workflow (no PRs from agents, work in feature branches)
- Changelog format
- Provider addition procedures
- Release versioning

Loaded as project context into the system prompt.

## 5. Context Strategy

Pi uses **compaction** — LLM-generated structured summaries when context approaches the window limit.

### When Compaction Triggers

- Automatic: `contextTokens > contextWindow - reserveTokens` (default reserve: 16,384)
- Manual: user invokes `/compact`
- Overflow recovery: API returns context overflow error → auto-retry with compaction

### Cut Point Detection

1. Walk backwards from newest message, accumulating token estimates (`chars / 4`)
2. Stop at `keepRecentTokens` (default: 20,000)
3. Find valid cut point — never cut between tool call and result
4. Optionally split mid-turn with a turn-start summary

### Summary Generation

Messages before the cut point are serialized and sent to the LLM with a structured prompt:

```
Goal:
Constraints & Preferences:
Progress: Done / In Progress / Blocked
Key Decisions:
Next Steps:
Critical Context:
```

If a previous summary exists, uses an UPDATE prompt to merge rather than regenerate from scratch.

### File Tracking

Compaction entries record `readFiles[]` and `modifiedFiles[]` extracted from tool call arguments. This metadata survives compaction — the agent knows which files were touched even after the conversation is summarized.

### Comparison to Other Context Strategies

| Harness | Strategy | Trade-off |
|---------|----------|-----------|
| Claude Code | Implicit summarization/compacting | Automatic, some fidelity loss |
| Garry | Aggressive pruning + `conversation` tool for explicit search | Lower per-request cost, extra round-trips |
| Hermes | FTS5 session search | Full-text search on history |
| Pi | Structured compaction with file tracking | Preserves structure, LLM cost for summary |
| PIPELINE (ideal) | Files and grep on history.json | Zero overhead, no fidelity loss |

Pi's approach is closest to Claude Code's but more structured. The file tracking and structured summary format make post-compaction context more useful than a prose summary.

## 6. Session Persistence

JSONL format with explicit tree structure.

### Entry Types

```jsonl
{"type":"session","version":3,"id":"uuid","timestamp":"...","cwd":"/path"}
{"type":"message","id":"uuid","parentId":"uuid","message":{...}}
{"type":"model_change","id":"uuid","parentId":"uuid","provider":"...","modelId":"..."}
{"type":"thinking_level_change","id":"uuid","parentId":"uuid","thinkingLevel":"..."}
{"type":"compaction","id":"uuid","parentId":"uuid","summary":"...","firstKeptEntryId":"uuid"}
{"type":"branch_summary","id":"uuid","parentId":"uuid","fromId":"uuid","summary":"..."}
{"type":"custom","id":"uuid","parentId":"uuid","customType":"myext","data":{...}}
{"type":"label","id":"uuid","parentId":"uuid","targetId":"uuid","label":"..."}
```

Every entry has `id` and `parentId` — forming a tree. Multiple entries sharing a `parentId` means branching.

### Tree Navigation

- `/tree` command: navigate and branch in-place
- `/fork` command: create new session from any entry
- Branch switching generates a summary of the abandoned branch before switching
- Full history queryable via `/export` (HTML) and `/share` (gist)

### Comparison to Other Persistence

| Harness | Format | Branching | Searchable |
|---------|--------|-----------|------------|
| Garry | `~/.garry/messages.json` (flat array) | No | Via `conversation` tool |
| Claude Code | Internal session store | Limited | Via context compacting |
| Hermes | SQLite FTS5 | No | Full-text search |
| Pi | JSONL with parent IDs (tree) | Yes, first-class | Via session entries |

Pi's tree-structured sessions are unique. Every other harness uses flat history.

## 7. TUI and Rendering

`pi-tui` is a custom terminal UI library. Not Ink. Not blessed. Not ncurses.

### Differential Rendering

Core algorithm in `packages/tui/src/tui.ts`:

1. Components render via `render(width): string[]` — pure functions returning line arrays
2. TUI compares new lines against `previousLines[]`
3. Finds `firstChanged` and `lastChanged` line indices
4. Only sends terminal escape sequences for changed lines
5. Uses synchronized output (`CSI 2026`) to batch updates atomically

**Full redraw triggers**: first render, terminal resize, content shrinks below working area.
**Everything else**: line-level diff.

### Component Model

```typescript
interface Component {
  render(width: number): string[]
  handleInput?(data: string): void
  invalidate(): void
}
```

12+ built-in components: Container, Box, Text, TruncatedText, Input, Editor (multi-line with autocomplete), Markdown (with syntax highlighting), SelectList, SettingsList, Loader, Spacer, Image (Kitty + iTerm2 protocols).

Rendering is cached by `(content, width)`. Invalidation cascades on theme change.

### Editor

Full multi-line editor with:
- Grapheme-aware cursor (handles emoji, CJK via `Intl.Segmenter`)
- Emacs keybindings (Ctrl+A/E/F/B/K/Y/Z, Alt+F/B/D/Y)
- Kill ring with yank-pop
- Undo/redo
- Bracketed paste mode
- Autocomplete: slash commands, prompt templates, extension commands, file paths (via `fd`)
- IME support via zero-width cursor marker (APC escape sequence)

### Overlay System

Modal overlays with focus management:
- Stack-based with focus order tracking
- Positioned: centered, anchored, absolute, or percentage-based
- Responsive: `visible(termWidth, termHeight)` callback
- Composited into line output after base content

### Comparison to Other TUI Approaches

| Aspect | Pi TUI | Garry (Rust Ink) | Claude Code (Stock Ink) |
|--------|--------|-----------------|----------------------|
| Rendering | Line diff (TypeScript) | Retained-mode tree diff (Rust FFI) | Stock Ink (React-like) |
| Components | Pure `render(width)` | Yoga layout nodes | JSX/React components |
| Image support | Kitty + iTerm2 | Unknown | No |
| IME | APC cursor marker | Unknown | Unknown |
| Differential | Line-level | Node-level | Frame-level |
| Binary cost | 0 (pure TypeScript) | ~375 KB native addon | ~95 MB (Bun runtime) |

Pi and Garry independently solved the same problem (Ink flickers) with different approaches. Pi stayed in TypeScript with line-level diffing. Garry went native with retained-mode tree rendering.

## 8. Extension System

Extensions are TypeScript modules loaded at runtime from `.pi/extensions/` or `~/.pi/agent/extensions/`.

### What Extensions Can Do

| Capability | Method |
|-----------|--------|
| Add LLM-callable tools | `registerTool(tool)` |
| Add slash commands | `registerCommand(name, handler)` |
| Add keyboard shortcuts | `registerShortcut(key, handler)` |
| Add feature flags | `registerFlag(name, type, default)` |
| Custom message rendering | `registerMessageRenderer(type, renderer)` |
| Modify context before LLM | `on("context", handler)` |
| Intercept tool calls | `on("tool_call", handler)` — can block |
| Transform tool results | `on("tool_result", handler)` — can modify |
| Inject system prompt | `on("before_agent_start", handler)` |
| Register LLM providers | `registerProvider(name, config)` |
| Execute bash commands | `exec(cmd, args, opts)` |
| Full UI access | Dialogs, widgets, editor, footer, header |

### Event Hooks

35+ events across lifecycle, agent, tool, session, and UI categories. Key ones:

- `before_agent_start` — inject messages, modify system prompt
- `context` — modify message history before LLM call
- `tool_call` — intercept and optionally block tool execution
- `tool_result` — modify content, details, or error flag
- `session_before_compact` — customize or replace compaction
- `before_provider_request` — transform API payload

Extensions are the mechanism for everything that isn't core: plan mode, sandbox execution, custom providers, subagent orchestration.

### Skills

Markdown files with YAML frontmatter, discovered from `.pi/skills/` and `~/.pi/agent/skills/`:

```markdown
---
name: my-skill
description: What this skill does
---
Usage instructions with {baseDir} path variable.
```

Skills are formatted as XML blocks in the system prompt. The agent uses the `read` tool to load a skill's file when a task matches.

### Custom Messages

Extensions can define custom message types via TypeScript declaration merging:

```typescript
declare module "@mariozechner/agent" {
  interface CustomAgentMessages {
    notification: NotificationMessage
    artifact: ArtifactMessage
  }
}
```

Custom messages flow through the agent loop, appear in the event stream, and persist in sessions — but are filtered out before reaching the LLM (via `convertToLlm`).

## 9. Mom: Ambient Agent

`pi-mom` is a Slack bot backed by `pi-agent-core`. Per-channel agent instances with persistent state.

### Architecture

```
Slack Socket Mode → Event Router → Per-Channel Queue → Agent Runner
                                                          ↓
                                                   context.jsonl (LLM messages)
                                                   log.jsonl (human-readable)
                                                   MEMORY.md (channel + workspace)
                                                   skills/ (self-managed)
                                                   events/ (scheduled wake-ups)
```

Each channel gets independent: agent state, session, memory, skills, scratch directory.

### Self-Managing

The agent can:
- Install packages (`apk`, `npm`, `apt`)
- Write CLI scripts as skills
- Configure credentials
- Schedule events (immediate, one-shot, periodic/cron)
- Respond `[SILENT]` to periodic events to avoid channel spam

### Event System

File-based scheduling in `data/events/`:

```json
{"type": "periodic", "channelId": "C123", "text": "Check inbox", "schedule": "0 9 * * 1-5", "timezone": "Europe/London"}
```

Three types: immediate (webhook-style), one-shot (alarm), periodic (cron). Max 5 events queued per channel.

### Context Management

Two files per channel:
- `context.jsonl` — structured messages for LLM (compactable)
- `log.jsonl` — full history (never compacted, source of truth)

Sync logic ensures context.jsonl stays consistent with log.jsonl across restarts.

## 10. Harness Comparison

### Tool Count

| Harness | Core | Extended | Hidden | Total |
|---------|------|----------|--------|-------|
| Pi | 7 (read, bash, edit, write, grep, find, ls) | Via extensions | — | 7 + extensions |
| Claude Code | 11 (Read, Bash, Edit, Write, Grep, Glob, Agent, WebFetch, WebSearch, AskUserQuestion, LSP) | TaskCreate/Update, NotebookEdit | — | ~18 |
| Garry | 11 core | 2 (web_fetch, web_search) | 3 (conversation, tool_search x2) | 16 |
| Hermes | 45+ | MCP | — | 45+ |
| PIPELINE (ideal) | 4 (sh, perl, curl, browser) | — | — | 4 |

Pi is minimal but extensible. 7 core tools cover the same ground as Claude Code's 11 because `grep`, `find`, and `ls` are separate tools rather than overloaded into `Glob` and `Grep`.

### Agent Loop

| Feature | Pi | Claude Code | Garry | Hermes |
|---------|-----|-------------|-------|--------|
| Steering (mid-turn interrupt) | First-class queues | Limited | Unknown | Unknown |
| Follow-up (post-completion) | First-class queues | Unknown | Unknown | Unknown |
| Parallel tool execution | Yes (preparation sequential) | Yes | Unknown | Yes (8 workers for read-only) |
| Max iterations | None (loop until exhausted) | Unknown | 100 steps | 90 steps |
| Custom message types | Declaration merging | No | No | No |
| Context transformation | Two-stage (transform + convert) | Single stage | Unknown | Unknown |

Pi's steering/follow-up system is the most sophisticated. No other harness has first-class mid-turn interruption with configurable drain modes.

### Context Strategy

| Harness | Strategy | Fidelity | Cost |
|---------|----------|----------|------|
| Pi | Structured compaction + file tracking | High (structured summary) | LLM call for summary |
| Claude Code | Implicit summarization | Medium | LLM call |
| Garry | Prune + conversation tool | Variable (depends on search) | Extra round-trips |
| Hermes | FTS5 search | High (full text preserved) | SQLite overhead |
| PIPELINE | Grep on history file | Full (nothing lost) | Zero |

### Rendering

| Harness | Approach | Flicker | Image Support | Binary Cost |
|---------|----------|---------|---------------|-------------|
| Pi | Line-level diff (TypeScript) | None | Kitty + iTerm2 | 0 |
| Garry | Retained-mode tree (Rust FFI) | None | Unknown | ~375 KB |
| Claude Code | Stock Ink | Some | No | ~95 MB runtime |
| Hermes | No TUI (Python CLI) | N/A | No | N/A |

### Provider Support

| Harness | Providers | Abstraction |
|---------|-----------|-------------|
| Pi | 25+ (unified API) | Full streaming abstraction with compat layer |
| Claude Code | 1 (Anthropic) | Direct integration |
| Garry | 4 (Anthropic, OpenAI, Grok, Google) | Vercel AI SDK |
| Hermes | Multiple (via config) | Direct client libraries |

Pi's provider abstraction is by far the most ambitious. Type-safe model lookup across 25+ providers with unified streaming, thinking, and tool calling.

### Extension/Plugin Architecture

| Harness | Mechanism | Scope |
|---------|-----------|-------|
| Pi | TypeScript extensions + skills + prompt templates | Tools, events, UI, providers, context |
| Claude Code | Hooks (shell commands on events) | Pre/post tool execution |
| Garry | `.garry/tools.ts` custom tools | Tool definitions only |
| Hermes | MCP + skills system | Tools, skills |

Pi's extension system is the most comprehensive. 35+ event hooks, full UI access, provider registration, context modification, tool interception.

## 11. Creator's Rationale (Primary Source)

Mario Zechner's blog post ("What I learned building an opinionated and minimal coding agent", 2025-11-30) provides the "why" behind every decision. This section documents his framing — where it aligns with, extends, or contradicts the PIPELINE thesis.

### Origin Story

> "Claude Code has turned into a spaceship with 80% of functionality I have no use for. The system prompt and tools also change on every release, which breaks my workflows and changes model behavior. I hate that. Also, it flickers."

Motivation: stability, simplicity, control. Not anti-framework — anti-bloat.

### "There Are Four APIs"

Zechner's key insight for pi-ai: despite 25+ providers, there are really only four APIs to implement: OpenAI Completions, OpenAI Responses, Anthropic Messages, Google Generative AI. Every provider maps to one of these. The abstraction is a thin layer over four adapters, not a universal abstraction over 25 backends.

He rejected the Vercel AI SDK after direct experience: "it doesn't play nice with self-hosted models for some reason, specifically when it comes to tool calling." Built his own because building on provider SDKs directly gives "full control and lets me design the APIs exactly as I want, with a much smaller surface area."

### Why No Max Steps

> "The agent loop doesn't let you specify max steps or similar knobs you'd find in other unified LLM APIs. I never found a use case for that, so why add it? The loop just loops until the agent says it's done."

Contrast with Garry (100 steps) and Hermes (90 steps). Zechner's position: if you need to limit steps, your agent design is wrong.

### "Four Tools Are All You Need"

> "These four tools are all you need for an effective coding agent. Models know how to use bash and have been trained on the read, write, and edit tools with similar input schemas."

Default toolset: read, write, edit, bash. The grep/find/ls tools exist as optional read-only additions. System prompt + tool definitions together: under 1,000 tokens.

> "You might think this is crazy. In all likelihood, the models have some training on their native coding harness. So using the native system prompt or something close to it would be most ideal. But it turns out that all the frontier models have been RL-trained up the wazoo, so they inherently understand what a coding agent is."

This is empirically validated: pi scores competitively on Terminal-Bench 2.0 against harnesses with 10x the system prompt and 3x the tools.

### YOLO By Default

> "pi runs in full YOLO mode and assumes you know what you're doing. No permission prompts for file operations or commands."

No permission system at all. Not configurable, not optional — absent. His reasoning: "If you look at the security measures in other coding agents, they're mostly security theater. As soon as your agent can write code and run code, it's pretty much game over."

This directly contradicts the PIPELINE thesis which proposes a learned permission gate (pico-judge). Zechner's counter: the only real solution is environment isolation (containers), not heuristic permission checks.

### Deliberate Omissions

Each omission has explicit reasoning:

**No MCP.** "MCP servers are overkill for most use cases, and they come with significant context overhead." Example: Playwright MCP dumps 13.7K tokens of tool descriptions on every session. Alternative: CLI tools with READMEs. The agent reads the README when needed (progressive disclosure), invokes via bash. Token cost only when relevant.

**No sub-agents.** "Using a sub-agent mid-session for context gathering is a sign you didn't plan ahead." Alternative: separate sessions for context gathering, create artifacts, use in fresh session. If you must spawn: `pi --print` via bash. Full observability on output.

**No background bash.** "Use tmux instead." Tmux gives full observability, direct interaction, session listing via CLI. Claude Code's background bash has "poor observability" and agents forgot about background processes after compaction.

**No plan mode.** "Telling the agent to think through a problem together with you, without modifying files, is generally sufficient." Alternative: write PLAN.md to disk. Collaborative editing, versioned with code, survives sessions.

**No built-in to-dos.** "To-do lists generally confuse models more than they help. They add state that the model has to track and update." Alternative: TODO.md file with checkboxes.

### The Observability Argument

A recurring theme across all omissions:

> "I need observability for planning and I don't get that with Claude Code's plan mode."
> "You have zero visibility into what that sub-agent does. It's a black box within a black box."
> "I want to inspect every aspect of my interactions with the model."

Zechner's meta-principle: anything that hides state from the user is wrong. Sub-agents hide their conversation. Background bash hides its output. Plan mode hides its sources. Context compacting hides what was forgotten. The alternative is always: make it a file, make it visible, make it greppable.

### Extensions as Escape Valve

> "Features that other agents bake in, you can build yourself."

The extension system exists precisely because the core is deliberately missing features. Plan mode? Extension. Sub-agents? Extension. Permission gates? Extension. MCP? Extension. Sandbox? Extension. This is the Unix philosophy applied to agent features: small core, compose the rest.

The website lists real examples: Doom running in pi, SSH execution, MCP integration, custom editors — all built as extensions, not core features.

### Context Engineering

> "I learned that context engineering is paramount. Exactly controlling what goes into the model's context yields better outputs, especially when it's writing code. Existing harnesses make this extremely hard or impossible by injecting stuff behind your back that isn't even surfaced in the UI."

This is the deeper motivation behind the minimal system prompt. It's not just about token efficiency — it's about the user being able to see and control every token that enters the context window. Pi surfaces everything. Claude Code injects invisible context (the 10K system prompt, sub-agent conversations, compacted summaries).

### Split Tool Results

A design detail worth noting: pi-ai's tool results have separate `content` (for LLM) and `details` (for UI). No other harness makes this distinction explicit. It means the UI can show rich structured data while the LLM gets compact text. This is an insight about the fundamental tension in tool design: LLMs want text, UIs want structure.

### TUI Philosophy

> "There's basically two ways to do it. One is to take ownership of the terminal viewport and treat it like a pixel buffer. I call these full screen TUIs. Amp and opencode use this approach."
> "The second approach is to just write to the terminal like any CLI program, appending content to the scrollback buffer."

Zechner chose scrollback-based because coding agents are linear chat. You get natural scrolling and search for free. The constraint (no arbitrary viewport control) is a feature — "constraints make for minimal programs."

### Benchmark Evidence

Pi with Claude Opus 4.5 scores competitively on Terminal-Bench 2.0 against Claude Code, Codex, Cursor, Windsurf — despite ~1,000 tokens of system prompt vs ~10,000+, 4 default tools vs 18+, and no permission system.

He also notes: "Terminus 2 is the Terminal-Bench team's own minimal agent that just gives the model a tmux session. The model sends commands as text to tmux and parses the terminal output itself. No fancy tools, no file operations, just raw terminal interaction. And it's holding its own."

Terminus 2 is closest to the PIPELINE thesis — a model composing shell commands directly, no tool wrappers. Its competitive performance validates the core claim.

## 12. Key Architectural Insights

### What Pi Gets Right

**Layered packages.** Each package has a clear boundary. `pi-ai` is useful without `pi-agent-core`. `pi-agent-core` is useful without `pi-coding-agent`. This isn't just good engineering — it means the agent loop can power Slack bots (mom), web UIs (web-ui), and CLIs (coding-agent) from the same core.

**Pluggable tool operations.** Every tool's I/O goes through an interface. This is the only harness where you could swap local execution for SSH without touching tool logic.

**First-class interruption.** Steering and follow-up queues with drain modes. Users can interact with the agent while it's working, not just wait.

**Compositional system prompt.** ~1,000 tokens total (prompt + tools). Tools self-describe. Compared to Claude Code's ~10,000+ tokens, this is 10x lighter — and benchmarks show no performance loss.

**Tree-structured sessions.** Branching, forking, navigation. Every other harness uses flat history.

**Observability as principle.** Everything visible. No hidden sub-agent conversations, no invisible context injection, no opaque compaction. Files you can grep, sessions you can export.

### The Four-Tool Thesis

Zechner proved empirically what the PIPELINE thesis argues theoretically: you don't need 18+ specialized tools. Four tools (read, write, edit, bash) plus a ~1,000-token prompt scores competitively on Terminal-Bench against harnesses with 10x the prompt and 3x the tools.

The interesting nuance: Zechner keeps bash as a catch-all rather than reducing to `exec(sh -c)`. The model can already `rg`, `fd`, `curl`, `tmux` via bash — the dedicated grep/find/ls tools exist as optional optimizations (.gitignore handling, structured output), not necessities. Pi defaults to four tools and the model gets by fine.

This is closer to the PIPELINE thesis than any other production harness. Not there yet — still JSON schemas instead of raw shell — but the gap is small.

### Permission: YOLO vs Pico-Judge

The sharpest divergence from the PIPELINE thesis. Zechner says permission systems are theater: "As soon as your agent can write code and run code, it's pretty much game over." The only real fix is environment isolation.

The pico-judge thesis says a learned classifier can reason about context (`rm -rf /tmp/test` vs `rm -rf /`). Zechner would counter: the model already has bash, so any permission gate is trivially bypassed by writing a script that does the dangerous thing.

Both are right about different things. Zechner is right that regex-based permission is theater. The pico-judge thesis is right that context-aware judgment is possible. But Zechner's deeper point stands: if you give an agent bash, you've already lost the security game. Containers are the only real boundary.

### Extensions: Unix Philosophy Applied to Agent Features

The extension system's true purpose is revealed by the creator's framing: it exists because the core deliberately omits features. Plan mode, sub-agents, permission gates, MCP, sandbox — all extensions. The core stays minimal.

This is the Unix philosophy: small core, compose the rest. But applied to agent infrastructure rather than system utilities. Where Unix composes via pipes, pi composes via event hooks and tool registration.

The cost: extension complexity (35+ events, declaration merging, runtime loading). The benefit: the core never accumulates features that some users want and others don't.

### Where Pi Converges With PIPELINE

Both independently arrive at:
- Minimal tool set (4 tools default, Unix via bash)
- Files as the substrate for memory, plans, todos (not special tools)
- Sub-agents as processes (spawn pi via bash, or use tmux)
- Context as files (grep on history, not custom search tools)
- No MCP (CLI tools with READMEs, progressive disclosure)
- Small system prompt (let the model's training do the work)

### Where Pi Diverges From PIPELINE

| Aspect | Pi | PIPELINE |
|--------|-----|----------|
| Tool interface | JSON schemas + TypeBox | `exec(sh -c)` directly |
| Permission | None (YOLO, use containers) | Learned classifier (pico-judge) |
| Provider | 25+ via abstraction | Single model (eventually local) |
| Compaction | LLM-generated structured summary | Grep on history file |
| TUI | Custom differential rendering | None (terminal is the UI) |
| Extensions | Full TypeScript plugin system | None (Unix is the plugin system) |

Pi is a framework for building agents across providers and interfaces. PIPELINE is a thesis about the minimal possible agent. They optimize for different things: Pi for flexibility, PIPELINE for reduction.

### Unique Contributions to Extract

**Provider abstraction (`pi-ai`).** Four API adapters (OpenAI Completions, OpenAI Responses, Anthropic Messages, Google Generative AI) covering 25+ providers. Type-safe model registry. Unified streaming with thinking normalization. Cross-provider context handoff. This is the hardest piece to build and the most independently valuable. Nothing else in the ecosystem does this as cleanly.

**Split tool results.** Separate `content` (for LLM) and `details` (for UI). Solves the fundamental tension: LLMs want text, UIs want structure. Simple insight, no other harness makes it explicit.

**Line-level TUI diffing.** Flicker-free terminal rendering in pure TypeScript. No native addons, no React, no Yoga layout. Just compare previous lines to new lines, send only the diff. CSI 2026 for atomic updates. Simpler than Garry's Rust approach, works just as well.

**Steering/follow-up queues.** First-class mid-turn user input with configurable drain modes. The only harness where the user can interact meaningfully with a working agent.

## 13. Size and Complexity

| Metric | Pi Mono | Garry | Claude Code | Hermes |
|--------|---------|-------|-------------|--------|
| Files | ~751 | 1 binary (126 MB) | 1 binary (218 MB) | 578 |
| Source files | ~400 TypeScript | ~20 MB JS bundle | Unknown | 242K LOC Python |
| Test files | ~70 | 0 (bundled) | Unknown | Unknown |
| Packages | 7 | 1 | 1 | 1 |
| Default tools | 4 (read, write, edit, bash) | 16 | ~18 | 45+ |
| System prompt | ~1,000 tokens | ~1,500 words | ~10,000 words | Unknown |
| Providers | 25+ (4 API adapters) | 4 (Vercel AI SDK) | 1 (Anthropic) | Multiple |
| Extensions | Full system (35+ events) | Custom tools file | Hooks | MCP + skills |
| Permission | None (YOLO) | Approval gate | Permission modes | Approval system |

Pi is the most modular and arguably the best-engineered harness analyzed. It's also the most complex in total moving parts — seven packages, hundreds of source files, a full extension system. But the complexity is layered: you can use pi-ai without any of the rest.

For the PIPELINE thesis: Pi is the closest production harness to the minimal ideal. Four default tools, ~1,000 token prompt, files for everything, sub-agents via bash. The remaining gap — JSON tool schemas instead of raw shell, 25+ provider abstraction instead of one model, TypeScript extension system instead of Unix composition — is framework overhead that serves a different goal: being a platform for many users, not a shell for one.
