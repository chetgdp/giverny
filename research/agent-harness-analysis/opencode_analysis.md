# OpenCode — Agent Harness Analysis

Platform by anomalyco (SST/terminal.shop team). Monorepo, MIT licensed.
Published as `opencode-ai`. CLI ships as `opencode`.

## Stack

| Layer | Tech |
|-------|------|
| Runtime | Bun (Node.js compat) |
| Language | TypeScript (strict, no `any`) |
| LLM Interface | Vercel AI SDK (`ai@6.0.138`) |
| Agent Loop | Custom via Vercel AI SDK `streamText` + Effect.ts |
| TUI | SolidJS + opentui (custom terminal framework) |
| Web UI | SolidJS + SolidStart + Vite |
| Desktop | Tauri v2 (+ legacy Electron) |
| Database | SQLite via Drizzle ORM |
| Server | Hono (HTTP framework) |
| Build | Bun workspaces + Turbo |
| Test | Vitest / BunTest / Playwright |

133K LOC in core package, 1,400 source files across monorepo, 20+ packages.

## Package Architecture

```
packages/opencode          # Core: server, CLI, TUI, agent loop, tools, sessions
packages/app               # Web frontend (SolidJS SPA)
packages/desktop           # Tauri v2 desktop wrapper
packages/desktop-electron  # Electron desktop wrapper
packages/ui                # Shared SolidJS component library (Tailwind, Kobalte)
packages/sdk/js            # Generated OpenAPI client SDK
packages/plugin            # Plugin type definitions + hook interfaces
packages/util              # Shared utilities + error handling
packages/script            # Build/version scripts
packages/web               # Marketing/docs site (Astro + Starlight)
packages/slack             # Slack bot integration
packages/console/*         # Admin console (app, core, function, mail, resource)
packages/enterprise        # Enterprise/SaaS features
packages/storybook         # Component showcase
```

The core architectural bet: **client/server separation**. The agent backend runs as an HTTP server (Hono, port 4096). Everything else — TUI, web app, desktop app, SDK — is a client speaking REST + SSE to that server. No other harness does this.

```
opencode serve → HTTP API on :4096
  ↑ REST + SSE
  ├── TUI (opentui, same process or remote)
  ├── Web app (SolidJS SPA, :5173)
  ├── Desktop (Tauri or Electron, wraps web app)
  ├── SDK (createOpencodeClient())
  └── Slack bot (@slack/bolt)
```

## 1. Agent Loop

Built on Vercel AI SDK's `streamText` with Effect.ts for service composition.

### Flow

```
User input
  |
  v
SessionProcessor receives prompt
  |
  v
LLM.stream({
  model: wrapLanguageModel(provider(modelId), middleware),
  messages: [system prompts + conversation history],
  tools: resolveTools(agent, model, permissions),
  maxOutputTokens,
  abortSignal
})
  |
  v
For each streamed event:
  - text-delta → stream to client
  - reasoning-start/delta/end → store extended thinking
  - tool-input-start → create pending tool part
  - tool-call → permission check → execute → return result
  - finish → persist message → check overflow → compact if needed
  |
  v
Loop continues until model sends end_turn
```

### Key Details

- **No explicit max steps** — loop continues until model stops (unlike Garry's 100 or Hermes's 90)
- **Doom loop detection** — DOOM_LOOP_THRESHOLD = 3: if same tool called 3 times with identical input, throws Permission.DeniedError
- **Tool call repair** — auto-lowercases tool names, routes broken calls to "invalid" tool with error details
- **LiteLLM compat** — injects noop tool when history contains tool calls but no tools available
- **Plugin middleware** — system prompt and messages can be transformed by plugins before reaching the model

## 2. Complete Tool Registry

**20 built-in tools + plugin-defined tools**

### Core File Operation Tools (7)

| # | Tool | What It Does | Permission |
|---|------|-------------|------------|
| 1 | **bash** | Execute shell commands with process spawning, output capture, timeout. Rolling buffer truncation. | Ask |
| 2 | **read** | Read files/directories with line numbers. 2000 line limit, offset support. Image support. | Allow (`.env*`: ask) |
| 3 | **write** | Create files with diff generation and LSP diagnostics on save. | Allow |
| 4 | **edit** | Modify files using old_string/new_string replacement. Unified diff output. Line ending detection. | Allow |
| 5 | **apply_patch** | Apply unified diff patches. Used instead of edit/write for GPT models. | Allow |
| 6 | **multiedit** | Apply multiple file edits atomically in a single call. | Allow |
| 7 | **ls** | List directory contents with file metadata. | Allow |

### Search Tools (3)

| # | Tool | What It Does |
|---|------|-------------|
| 8 | **glob** | Find files by glob patterns, max 100 results, sorted by mtime. |
| 9 | **grep** | Regex search via ripgrep with line truncation. |
| 10 | **codesearch** | Code/API doc search via Exa API. 1K-50K token results. Provider-gated. |

### Network Tools (2)

| # | Tool | What It Does |
|---|------|-------------|
| 11 | **webfetch** | HTTP fetch with HTML→markdown/text conversion. Timeout support. |
| 12 | **websearch** | Web search via Exa API with live crawling options. Provider-gated. |

### Agent/Session Tools (4)

| # | Tool | What It Does |
|---|------|-------------|
| 13 | **task** | Spawn subagent sessions (explore, general, custom agents). |
| 14 | **skill** | Load specialized skill bundles with injected instructions. |
| 15 | **todowrite** | Create/update structured task lists for progress tracking. |
| 16 | **question** | Interactive prompts for user input (multiple choice, free text). |

### Code Intelligence Tools (1)

| # | Tool | What It Does |
|---|------|-------------|
| 17 | **lsp** | Language Server Protocol ops: goToDefinition, findReferences, hover, rename, callHierarchy. Experimental. |

### Experimental/Special Tools (3)

| # | Tool | What It Does |
|---|------|-------------|
| 18 | **batch** | Execute multiple tools concurrently from a single request. Experimental. |
| 19 | **plan_exit** | Switch from plan agent to build agent. Experimental. |
| 20 | **invalid** | Fallback for malformed tool calls. Suggests alternatives. Never directly invocable. |

### Model-Aware Tool Filtering

Tools are filtered based on model and provider:

```
codesearch/websearch → only for opencode provider or with Exa flag
apply_patch → only for GPT models (not oss/gpt-4)
edit/write → disabled when apply_patch is active
lsp → requires OPENCODE_EXPERIMENTAL_LSP_TOOL flag
batch → requires experimental.batch_tool config
plan_exit → requires experimental flag + CLI client
```

This is the only harness that changes its tool set based on which model is being used.

## 3. System Prompt

The most distinctive design choice: **provider-specific system prompt templates**.

### Prompt Assembly

```
Provider-specific base prompt (anthropic.txt / beast.txt / gpt.txt / gemini.txt / ...)
  +
Environment context (cwd, platform, date, model, git status)
  +
Available skills (formatted descriptions)
  +
Plugin transformations (hooks can modify the prompt)
```

### Per-Provider Prompts

| Provider | Template | Tone | Length | Key Emphasis |
|----------|----------|------|--------|--------------|
| **Anthropic** | anthropic.txt | Pragmatic senior engineer | ~2K words | Professional objectivity, parallel tools, task tracking, concise output |
| **GPT-4/o1/o3** | beast.txt | Autonomous problem solver | ~4K words | Mandatory webfetch for libraries, recursive URL fetching, full workflow loop, persistent memory via `.github/instructions/memory.instruction.md` |
| **GPT (other)** | gpt.txt | Balanced assistant | ~2K words | Same core as anthropic, adapted for OpenAI models |
| **Gemini** | gemini.txt | Convention-obsessed engineer | ~3K words | Must analyze surrounding code first, verify libraries exist, sparse comments, path construction rules |
| **Trinity** | trinity.txt | Terse executor | ~1K words | Under 3 lines when practical, no chitchat, explain critical bash commands |
| **Default** | default.txt | CLI concise | ~500 words | "MUST answer concisely with fewer than 4 lines" |

### Anthropic Prompt Highlights

```
You are OpenCode, the best coding agent on the planet.
...
# Professional objectivity
Prioritize technical accuracy and truthfulness over validating the user's beliefs.
Focus on facts and problem-solving, providing direct, objective technical info
without any unnecessary superlatives, praise, or emotional validation.
...
# Task Management
Use TodoWrite tools VERY frequently to ensure you are tracking tasks...
These tools are also EXTREMELY helpful for planning tasks...
If you do not use this tool when planning, you may forget to do important tasks
- and that is unacceptable.
...
# Tool usage policy
When doing file search, prefer to use the Task tool in order to reduce context usage.
```

### Key Differences from Other Harnesses

| Aspect | OpenCode | Claude Code | Pi | Garry |
|--------|----------|-------------|-----|-------|
| Prompt strategy | Per-model family | One monolithic | One minimal (~1K tokens) | One pragmatic (~1.5K words) |
| Prompt size | 500-4K words (varies) | ~10K words | ~1K tokens total | ~1.5K words |
| Task tracking | Mandatory TodoWrite | No dedicated tool | No dedicated tool | Dedicated `plan` tool |
| Tool guidance | Moderate | Extensive per-tool | Minimal | Moderate |
| Self-reference | "best coding agent on the planet" | Detailed persona | "expert coding assistant" | "helpful terminal assistant" |

## 4. Agent Definitions

### User-Facing Agents (4)

**build** (primary, default)
- Full tool access. Default permissions allow most operations.
- `.env` files: ask. External directories: whitelist + ask. Doom loop: ask.

**plan** (primary, read-only)
- Denies edit/write/bash except `.opencode/plans/*.md`.
- Can switch back to build via plan_exit.
- Ideal for exploring unfamiliar codebases.

**general** (subagent)
- Multi-step task execution. Complex searches and parallel work.
- Same permissions as build minus todowrite.
- Invoked via `@general` in messages or via task tool.

**explore** (subagent)
- Fast read-only search specialist.
- Only allows: grep, glob, ls, bash, webfetch, websearch, codesearch, read.
- Three thoroughness levels: quick, medium, very thorough.

### Hidden/Internal Agents (3)

**compaction** — generates context summaries when overflow detected.
**title** — generates session titles (temperature 0.5).
**summary** — generates session summaries.

### Custom Agents

Defined in `.opencode/agent/` and `~/.opencode/agent/`. Can specify model, prompt, permissions, temperature, topP, mode, color. Full override of defaults.

Agents can also be generated dynamically: `Agent.generate()` creates new agents from natural language descriptions.

## 5. Context Strategy

Three-phase compaction, similar to Claude Code but more explicit.

### Overflow Detection

Triggers when token count >= 85% of usable context. COMPACTION_BUFFER = 20,000 tokens.

```
usable = model.limit.input - reserved
reserved = cfg.compaction.reserved ?? min(COMPACTION_BUFFER, maxOutputTokens)
overflow = totalTokens >= usable
```

### Phase 1: Pruning

Scan backwards through messages. Erase old tool call outputs to free space.
- PRUNE_PROTECT = 40,000 tokens (recent calls kept intact)
- PRUNE_MINIMUM = 20,000 tokens (minimum space to free)
- Protected tools: `skill` (knowledge must survive compaction)

### Phase 2: Summarization

Invokes hidden "compaction" agent to generate structured summary.
- Summary captures: decisions made, work completed, current state
- Stored in message.summary field
- Replaces truncated messages in context

### Phase 3: Truncation

Removes oldest non-summary messages. Keeps parent message for continuity. Preserves last 2 turns.

### Comparison

| Harness | Strategy | Trade-off |
|---------|----------|-----------|
| OpenCode | Prune tool outputs + LLM summary | Structured, moderate fidelity |
| Claude Code | Implicit summarization | Automatic, some fidelity loss |
| Garry | Prune + `conversation` tool for explicit search | Lower per-request cost, extra round-trips |
| Pi | Structured compaction + file tracking | Preserves structure, tracks modified files |
| Hermes | FTS5 full-text session search | Full text preserved, SQLite overhead |

OpenCode's approach is most similar to Pi's, minus the file tracking metadata.

## 6. Permission System

The most granular permission model across all analyzed harnesses.

### Rule Structure

```typescript
interface Rule {
  permission: string    // "edit", "bash", "read", "external_directory", etc.
  pattern: string       // File path glob or "*"
  action: "allow" | "deny" | "ask"
}
```

### Permission Flow

```
Tool calls ctx.ask({ permission, patterns })
  → Permission.evaluate() matches against ruleset (agent + session merged)
    → "allow": execute immediately
    → "deny": throw Permission.DeniedError
    → "ask": create UI request, wait for user reply ("once", "always", "reject")
```

### Special Gates

- **doom_loop**: 3 identical tool calls → ask (breaks infinite loops)
- **external_directory**: access outside project root → ask
- **read on .env***: ask (default allow for everything else)
- **plan_enter/exit**: mode switching permission
- **question**: deny in explore agent

### Default Build Agent Permissions

```
bash *           → ask
edit *           → allow
write *          → allow
read *           → allow
read .env*       → ask
external_dir *   → ask
doom_loop *      → ask
question *       → allow
plan_enter *     → allow
```

### Comparison

| Harness | Permission Model |
|---------|-----------------|
| OpenCode | Granular glob rules, per-agent, per-session, three actions |
| Claude Code | Permission modes (ask/auto/bypass) |
| Garry | Per-tool approval flag (needsApproval) |
| Pi | None (YOLO, use containers) |
| Hermes | Dangerous command detection |

## 7. TUI Architecture

Built with **SolidJS + opentui** — a custom terminal rendering framework created by the terminal.shop team. Not Ink. Not blessed. Not ncurses.

### Why opentui

Created specifically for advanced terminal UX. Supports mouse events, clickable links, dynamic layout, rich RGBA colors. Designed by neovim users who wanted neovim-grade terminal apps.

### Component Tree

```
App (root, CliRenderer)
├── RouteProvider
│   ├── DialogProvider (modal dialogs)
│   ├── SDKProvider (backend REST connection)
│   ├── SyncProvider (real-time state via SSE)
│   ├── LocalProvider (local state management)
│   ├── KeybindProvider (keyboard shortcuts)
│   ├── ThemeProvider (color system)
│   ├── CommandProvider (command palette, Ctrl+P)
│   ├── PromptHistoryProvider (input history)
│   ├── FrecencyProvider (frecent file access)
│   ├── ToastProvider (notifications)
│   └── TuiPluginRuntime (plugin slots)
│
├── Home Route (session list, tips, sidebar)
│
└── Session Route
    ├── Message list (chat history)
    ├── Footer (input, agent switcher via Tab)
    ├── Sidebar (timeline, todos, files, LSP, MCP)
    └── Dialogs (fork, detail, subagent, permissions)
```

### Key Features

- **Command palette** (Ctrl+P) — neovim-style
- **Agent switching** — Tab key toggles build/plan
- **Prompt stashing** — save/recall prompts
- **Frecency** — frequently + recently accessed files surface first
- **Mouse support** — clickable links, scrollable areas
- **Plugin slots** — routes, commands, sidebar views, system panels

### Comparison

| Aspect | OpenCode (opentui) | Garry (Rust Ink) | Pi (custom line-diff) | Claude Code (stock Ink) |
|--------|-------------------|-----------------|----------------------|------------------------|
| Framework | SolidJS in terminal | React + Ink + Rust FFI | Pure TypeScript | React + Ink |
| Rendering | SolidJS reactivity | Retained-mode tree diff | Line-level diff | Stock Ink (frame-level) |
| Components | SolidJS components | Yoga layout nodes | Pure `render(width)` | JSX/React components |
| Mouse | Yes | Via Ink | No | Limited |
| Image support | Unknown | Unknown | Kitty + iTerm2 | No |
| Desktop app | Tauri + Electron | No | No | Electron (VS Code ext) |
| Web app | SolidJS SPA | No | mini-lit web UI | No |

OpenCode is the only harness with a full web app and desktop app in addition to the TUI. The client/server split makes this possible without duplicating the agent logic.

## 8. Provider Abstraction

20+ providers via Vercel AI SDK. The broadest support of any analyzed harness.

### Bundled Providers

Anthropic, OpenAI, Google (Generative AI + Vertex), Azure OpenAI, Amazon Bedrock, Mistral, Groq, Cerebras, Cohere, DeepInfra, xAI, Together, Perplexity, OpenRouter, Vercel AI Gateway, GitHub Copilot, GitLab AI, Venice, OpenAI-compatible (custom endpoints), OpenCode Zen/Go.

### Model Resolution

```
User selects model → Provider.parseModel("openai/gpt-4o")
  → Provider.getModel(providerID, modelID)
  → Load provider SDK
  → Create LanguageModelV3 instance
  → Apply model-specific prompt template
  → Apply model-specific tool filtering
```

### Model-Aware Behavior

This is unique to OpenCode. The harness adapts three things per model:
1. **System prompt** — different template per provider family
2. **Tool set** — apply_patch for GPT, edit/write for Anthropic
3. **API options** — thinking budgets, cache control, reasoning effort mapped per provider

### Comparison

| Harness | Providers | Abstraction Layer |
|---------|-----------|-------------------|
| OpenCode | 20+ (Vercel AI SDK) | Full SDK with model-aware prompts and tools |
| Pi | 25+ (custom pi-ai) | Four API adapters, type-safe model registry |
| Garry | 4 (Vercel AI SDK) | Provider switch statement |
| Hermes | Multiple (config-driven) | Direct client libraries |
| Claude Code | 1 (Anthropic) | Direct integration |

Pi's custom abstraction is arguably cleaner (four API adapters vs SDK dependency), but OpenCode's gets broader coverage with less code via the Vercel AI SDK.

## 9. Plugin System

Three-tier plugin architecture with 18+ lifecycle hooks.

### Plugin Types

- **Server plugins** — backend extensions via MCP, tools, auth
- **TUI plugins** — frontend extensions (SolidJS components, routes, sidebar views)
- **Theme plugins** — visual theming only

### Hook Points (18+)

| Category | Hooks |
|----------|-------|
| Lifecycle | event, config |
| Tools | tool definition, tool execution, tool result |
| Auth | auth provider setup |
| Provider | model provider customization |
| Chat | message interception, parameter modification |
| Permission | prompt customization, rule evaluation |
| Command | command execution |
| Shell | environment customization, text completion |
| Session | compaction interception |
| Experimental | experimental feature flags |

### Plugin Loading

- Configuration in `.opencode/tui.json`
- npm package specs, file paths, or URLs
- Runtime enable/disable via KV store
- Hot-reload capable

### Comparison

| Harness | Extension Mechanism | Scope |
|---------|-------------------|-------|
| OpenCode | Plugin system (18+ hooks, SolidJS UI slots) | Tools, events, UI, providers, auth, context |
| Pi | TypeScript extensions (35+ events, full UI access) | Tools, events, UI, providers, context |
| Garry | `.garry/tools.ts` custom tools | Tool definitions only |
| Claude Code | Hooks (shell commands on events) | Pre/post tool execution |
| Hermes | MCP + skills system | Tools, skills |

Pi and OpenCode both have comprehensive plugin systems. Pi's has more events (35+) and deeper access. OpenCode's has the TUI slot system for UI extension.

## 10. Session Persistence

SQLite via Drizzle ORM. All sessions, messages, and parts stored in a local database.

### Schema

**SessionTable**: id, projectID, workspaceID, directory, parentID, title, slug, version, summary (additions/deletions/files/diffs), timestamps (created, updated, compacting, archived), revert state, permission ruleset.

**MessageV2**: id, sessionID, messageID, role, agent, model info, tokens (input, output, cache read/write, total), summary flag, timestamps.

**Parts**: type (text, tool, file, reasoning), tool metadata (name, callID, state, input, output).

### Comparison

| Harness | Format | Searchable | Branching |
|---------|--------|------------|-----------|
| OpenCode | SQLite (Drizzle ORM) | SQL queries | Via parentID |
| Pi | JSONL with parent IDs (tree) | Entry iteration | First-class tree |
| Garry | `~/.garry/messages.json` (flat array) | `conversation` tool | No |
| Claude Code | Internal session store | Via context | Limited |
| Hermes | SQLite FTS5 | Full-text search | No |

OpenCode and Hermes both use SQLite. Pi's tree-structured JSONL is more elegant for branching. OpenCode's SQL approach is more queryable for the admin console and remote access patterns.

## 11. Growth & Traction

Download tracking from STATS.md (self-reported):

| Date | GitHub | npm | Total |
|------|--------|-----|-------|
| 2025-06-29 | 18K | 39K | 58K |
| 2025-09-17 | 351K | 261K | 612K |
| 2025-12-15 | ~1M | ~800K | ~1.8M |
| 2026-01-06 | 1.96M | 1.38M | 3.34M (spike: +247K/day) |
| 2026-01-14 | 3.57M | 1.65M | 5.21M |
| 2026-01-29 | 7.82M | 2.37M | **10.19M** |

Escape velocity hit around Jan 6, 2026. Daily downloads went from ~45K to ~250K+. That's Claude Code adoption territory.

## 12. Harness Comparison

### Size & Complexity

| Metric | OpenCode | Pi | Garry | Claude Code | Hermes |
|--------|----------|-----|-------|-------------|--------|
| Source files | 1,400 | ~400 | 1 binary (126 MB) | 1 binary (218 MB) | 578 |
| Core LOC | 133K TypeScript | ~400 files TS | ~20 MB JS bundle | Unknown | 242K Python |
| Packages | 20+ | 7 | 1 | 1 | 1 |
| Default tools | 20 | 4 | 16 | ~18 | 45+ |
| System prompt | 500-4K words (per-model) | ~1K tokens | ~1.5K words | ~10K words | Unknown |
| Providers | 20+ (AI SDK) | 25+ (custom) | 4 (AI SDK) | 1 | Multiple |
| Plugin system | 18+ hooks | 35+ events | Custom tools file | Shell hooks | MCP + skills |
| Permission | Granular glob rules | None (YOLO) | Approval gate | Permission modes | Approval system |
| Desktop app | Tauri + Electron | No | No | VS Code extension | No |
| Web app | SolidJS SPA | mini-lit web UI | No | No | No |

### Architecture Style

| Harness | Style | Philosophy |
|---------|-------|-----------|
| OpenCode | Platform/ecosystem | Everything built-in, multi-client, multi-provider |
| Pi | Framework/modular | Clean layers, compose via extensions, minimal defaults |
| Garry | Monolith | Single binary, native rendering, tight integration |
| Claude Code | Walled garden | One provider, one binary, maximum control |
| Hermes | Maximalist | 45+ tools, kitchen sink |

## 13. Key Insights

### What OpenCode Gets Right

**Client/server separation.** The agent backend is an HTTP server. This is architecturally correct — the LLM loop, tool execution, and session state are backend concerns. UI is a client concern. This enables web app, desktop app, mobile app, SDK access, and remote operation from the same codebase. No other harness achieves this cleanly.

**Model-aware prompting.** Different models respond differently to different prompts. The Gemini prompt obsesses over convention adherence because Gemini needs that. The GPT "beast" prompt mandates webfetch because GPT models don't naturally reach for tools as aggressively. This is an insight no other harness acts on — everyone else uses one prompt for all models.

**Model-aware tooling.** Swapping edit/write for apply_patch on GPT models. This acknowledges that tool calling behavior varies by model. Combined with model-aware prompts, OpenCode is the only harness that adapts its entire interface to the model.

**Permission granularity.** Glob-based rules with per-agent overrides. The doom loop detector is clever — breaks infinite tool call cycles that no other harness handles. The `.env` ask-by-default is a good security default without being annoying.

**Traction.** 10M+ downloads in ~7 months. This is market validation of the "full platform" approach.

### What OpenCode Gets Wrong (for the PIPELINE thesis)

**Complexity.** 133K LOC in the core package. 20 tools. 20+ packages. Plugin system with 18 hooks. This is the opposite of reduction. The harness is larger than many of the applications it helps build.

**Abstraction overhead.** Effect.ts adds a functional programming layer on top of TypeScript. Drizzle ORM on top of SQLite. Vercel AI SDK on top of provider APIs. opentui on top of terminal I/O. Each layer is defensible in isolation but the stack is deep.

**The prompt paradox.** Model-specific prompts implicitly validate that less is more. If you need different prompts for each model family, the "right" amount of prompt guidance is model-dependent, not maximizable. Pi's ~1K-token approach sidesteps this by trusting the model's training. OpenCode's approach is more work and more maintenance for unclear benefit — they haven't published benchmarks showing model-aware prompts outperform a minimal universal prompt.

**Tool count.** 20 tools is the most of any harness except Hermes (45+). Pi proved that 4 tools (read, write, edit, bash) match 18+ on Terminal-Bench. Each additional tool adds schema tokens, dispatch complexity, and potential for confusion. `codesearch`, `websearch`, `batch`, `multiedit`, `apply_patch`, `todowrite` — these could all be handled by bash or by the model's native behavior.

### Where OpenCode Converges With PIPELINE

- **Per-model adaptation** — the insight that one prompt doesn't fit all models aligns with the thesis that models have different native capabilities
- **Client/server separation** — PIPELINE's v2 vision (model IS the process) benefits from the same split; the terminal is just a client
- **Subagents as sessions** — task tool spawns child sessions, which is conceptually similar to spawning processes

### Where OpenCode Diverges From PIPELINE

| Aspect | OpenCode | PIPELINE |
|--------|----------|----------|
| Tool interface | 20 JSON schema tools | `exec(sh -c)` directly |
| Permission | Granular glob rules | Learned classifier (pico-judge) |
| Provider | 20+ via SDK abstraction | Single model (eventually local) |
| Context | Prune + LLM summary | Grep on history file |
| TUI | SolidJS + opentui | None (terminal is the UI) |
| Plugins | 18+ hook system | None (Unix is the plugin system) |
| Complexity | 133K LOC, 20+ packages | Minimal possible |

OpenCode is a framework for building AI-powered development across providers, interfaces, and environments. PIPELINE is a thesis about the minimal possible agent. They optimize for different things: OpenCode for reach and ecosystem, PIPELINE for reduction and directness.

### The Market Signal

OpenCode's 10M downloads prove there is massive demand for a provider-agnostic, open-source Claude Code alternative. The platform approach works commercially. But the interesting question is whether the complexity is load-bearing — would a minimal version with 4 tools and a universal prompt achieve the same results? Pi's Terminal-Bench data suggests yes. OpenCode's download numbers don't prove the 20-tool, model-specific-prompt approach is _better_, only that it's _viable_ and _popular_.

The real innovation in OpenCode isn't the tools or the prompts — it's the client/server architecture and the model-aware adaptation. Those are genuine advances over every other harness analyzed.
