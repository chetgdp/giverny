# Garry Runtime Analysis Plan

## Goal

Extract and understand the garry application code — the actual agent logic, tool definitions, system prompt, and TUI rendering — separate from the bundled Bun runtime and third-party dependencies. Particular focus on the native Ink addon (the core differentiator) and hidden/gated tooling.

## What we know

### From binary analysis
- 121 MB ELF binary, built with `bun build --compile`
- Embedded virtual filesystem (`$bunfs/root/`) contains:
  - `bin.js` — main bundled JS entrypoint
  - `garry` — bun runtime
  - `libink_output-*.{so,dylib,dll}` — native Ink rendering addon (all 3 platforms shipped in every binary)
- Stack: Bun + React + Ink + Vercel AI SDK + Anthropic provider
- JS bundle is minified but contains readable string literals
- Vercel AI SDK provider abstraction found (OpenAI-compatible response parsing: `finish_reason`, `tool_calls`, `choices`)

### From creator's public statements (@ctjlewis)
- **Timeline**: GSH/UPG primitives in 2023 → immersive prototype July 2024 (predates Claude Code by ~6 months) → current alpha at garry.sh
- **Native Ink addon**: custom-built native extensions for mouse scroll views, click/hover/focus/scroll events, animations. This is the core differentiator — stock Ink cannot do this.
- **Multi-pane layout**: chat + code editor + terminal execution panes. "Immersive experience."
- **Context strategy**: NO summarization/compacting. Instead, Claude gets a custom tool to search and navigate old conversation history. Opposite of Claude Code's approach.
- **Hidden tooling**: "big boy tooling they're not allowed to bring you yet because muh safety" — gated/unreleased tools exist in the binary.
- **Input evolution**: started with triple-Enter to send → now matches Claude Code's Shift+Enter convention.
- **Current priorities**: UI stability on low-end devices, then advanced (safety-gated) tooling.

## Size breakdown (estimated)

| Component | ~Size | Notes |
|---|---|---|
| Bun runtime | ~95 MB | Full JS runtime, JIT compiler, HTTP client, etc. |
| Native Ink addon (3 platforms) | ~few MB | .so + .dylib + .dll shipped in every binary |
| JS bundle (app + AI SDK + deps) | ~20 MB | Minified, includes Vercel AI SDK, React, Ink |
| **Total** | **121 MB** | |

For comparison:
| Binary | Size |
|---|---|
| garry | 121 MB |
| claude code | 218 MB (binary) / 665 MB (full install) |
| giverny (delegates to claude code) | 2.8 MB |
| bun runtime alone | 95 MB |

---

## Phase 1: Extract embedded files

Bun compile embeds the JS bundle and native addons at known offsets in the binary.

### 1a: Extract the JS bundle
- [ ] Scan for the bun compile trailer — bun appends metadata at the end of the ELF. The last bytes contain offsets to the embedded files
- [ ] Use `strings` or binary offset scanning to locate `bin.js` blob boundaries
- [ ] Try `./garry --help` or env vars to see if there's a dump/debug mode
- [ ] Use `dd` or a script to carve out the JS bundle
- [ ] Save to `extracted/bin.js`

### 1b: Extract the native Ink addon
- [ ] Locate `libink_output-jv52zrxd.so` in the binary (the Linux native addon)
- [ ] Carve it out using offset data from the bun trailer
- [ ] Save to `extracted/libink_output.so`
- [ ] Run `file`, `nm`, `readelf` on it to understand what it exposes
- [ ] This is the high-value target — scroll views, mouse events, animations live here

---

## Phase 2: Deobfuscate / make readable

The JS bundle will be minified. Make it workable.

- [ ] Run through `prettier` or `js-beautify` to restore formatting
- [ ] Save formatted output to `extracted/bin.formatted.js`
- [ ] Identify and label major sections by searching for known strings:
  - Tool names (`bash`, `read`, `write`, `edit`, `glob`, `grep`, etc.)
  - **Context search tool** (the conversation history navigator — grep for `search`, `history`, `navigate`, `context`)
  - **Hidden/gated tools** (grep for `safety`, `gated`, `disabled`, `experimental`, `hidden`)
  - System prompt text (`You are`, `assistant`, `instructions`)
  - Anthropic API calls (`messages`, `claude`, `anthropic`)
  - Ink/React components (`render`, `useState`, `useEffect`, `Box`, `Text`)
  - Multi-pane layout (`pane`, `editor`, `split`, `panel`, `layout`)
  - Mouse/scroll handling (`mouse`, `scroll`, `click`, `hover`, `focus`)
  - Input mechanics (`Enter`, `Shift`, `submit`, `newline`, `input`)

---

## Phase 3: Analyze the native addon (high priority)

This is where the real innovation lives. Stock Ink is a React renderer for terminal text. The native addon is what makes garry's TUI different from every other terminal AI tool.

- [ ] **Exported symbols**: `nm -D` or `readelf --dyn-syms` on the extracted .so — what functions does it expose to JS?
- [ ] **FFI bindings**: search the JS bundle for how it loads/calls the native addon (Bun FFI, N-API, or NAPI-RS)
- [ ] **Capabilities**: map exported symbols to claimed features:
  - Native mouse scroll views
  - Click/hover/focus event capture
  - Animations / smooth rendering
  - Multi-pane layout management
- [ ] **Dependencies**: `ldd` on the .so — does it link against ncurses, notcurses, or something custom?
- [ ] **Language**: is it C, Rust (NAPI-RS), or Zig? Check for telltale strings/symbols

---

## Phase 4: Map the application architecture

### 4a: Agent loop
- [ ] Does it use the Vercel AI SDK's built-in agent loop (`streamText` with `maxSteps`) or a custom loop?
- [ ] How does it handle tool call → execution → result → next turn?
- [ ] How does streaming work (SSE parsing, token-by-token rendering)?

### 4b: Tool registry (high priority)
- [ ] **Standard tools**: file read/write, bash exec, glob, grep, edit — compare to Claude Code's tool set
- [ ] **Context search tool**: the conversation history navigator (confirmed by creator). Extract its schema and implementation. This is a deliberate architectural divergence from Claude Code.
- [ ] **Hidden/gated tools**: "big boy tooling" — what tools exist in the binary but aren't exposed in the current alpha?
- [ ] Extract full tool schemas (names, descriptions, parameters, JSON schema)

### 4c: System prompt
- [ ] Extract the full system prompt template
- [ ] Compare to Claude Code's known system prompt structure
- [ ] Look for dynamic sections (project context injection, tool availability toggles)

### 4d: TUI components
- [ ] Map the Ink component tree:
  - Chat/conversation view
  - Code editor pane
  - Terminal execution pane
  - Input box (with Shift+Enter handling)
  - Status bar / progress indicators
  - Scroll views (powered by native addon)
- [ ] How do panes communicate? Shared state? Event bus?

### 4e: Config / auth / persistence
- [ ] API key handling (env var? config file? keychain?)
- [ ] Settings / config file format and location
- [ ] Conversation persistence (since there's no compacting, how is history stored?)
- [ ] Project-level config (equivalent to CLAUDE.md?)

---

## Phase 5: Document findings

- [ ] Create `ANALYSIS.md` with:
  - Complete tool list with schemas
  - System prompt (full text if extractable)
  - Agent loop flow diagram (text-based)
  - Native addon capability map
  - TUI component tree
  - Context strategy deep dive (search tool vs compacting)
  - Hidden/gated tool inventory
  - Config/auth/persistence flow
  - Architecture comparison: garry vs claude code vs giverny

---

## Key questions to answer

1. What tools does garry expose to the model? Are they the same as Claude Code's?
2. **What is the context search tool?** Schema, implementation, how it replaces compacting.
3. What is the system prompt? How does it differ from Claude Code's?
4. **What does the native Ink addon actually do?** What C/Rust functions power the scroll views and mouse events?
5. **What are the hidden/gated "big boy" tools?** What's in the binary but not enabled?
6. How does it handle tool execution sandboxing (if any)?
7. Does it use the Vercel AI SDK's agent loop or a custom one?
8. What Ink components make up the TUI? How does multi-pane work?
9. Is there any local state/memory/persistence beyond the conversation?
10. How much of the 121 MB is actually garry vs runtime + deps?

## Tools needed

- `strings`, `dd`, `xxd` — binary extraction
- `nm`, `readelf`, `ldd`, `objdump` — native addon analysis
- `prettier` / `js-beautify` — JS formatting (install via bun/npm if needed)
- `grep` — navigating the extracted JS
- Optionally: `binwalk` for embedded file detection, hex editor for precise offset carving
