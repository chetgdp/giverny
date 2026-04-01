# Context Sliding Window for Completions Backend

## Context
Conversation history is persisted to `.giverny/conversations/<id>.json` and replayed in full to stateless completions servers on resume. As conversations grow, they'll exceed the model's context window. We need a sliding window that trims old messages to fit.

Two changes in one:
1. **Stop saving system prompt in conversation file** — inject it fresh each time so it stays current and doesn't eat into the window budget
2. **Trim old messages** when history exceeds context window

## Files to modify

- `src/bridge-loop.ts` — main changes in `runWithToolLoop()`
- `src/state.ts` — no changes needed (SavedConversation stays the same, just stores fewer messages)

## Implementation

### 1. Separate system prompt from conversation messages (`bridge-loop.ts`)

Current code (lines 90-103) mixes system prompt into the messages array. Change to:

```
messages = conversation turns only (user/assistant/tool)
fullMessages = [system prompt] + messages  (built just before generate())
```

- On resume: load saved messages (no system prompt), append new user message
- On fresh: just the user message (no system prompt in array)
- Before generate(): prepend system prompt to build `fullMessages`, pass as `_messages`
- Before save: save `messages` (no system prompt)

### 2. Sliding window trim (new function in `bridge-loop.ts`)

**Budget calculation:**
```
budget = contextWindow - systemPromptTokens - (contextWindow * 0.15)
```
- 15% headroom for the model's response
- System prompt always kept, never trimmed
- contextWindow from `this.backend.info.models[0].contextWindow`
- If contextWindow is 0 (unknown), skip trimming

**Token estimation:**
- ~4 chars per token (standard rough heuristic, no library needed)
- Count `msg.content` + `JSON.stringify(msg.tool_calls)` if present

**Trim strategy:**
- Drop messages from the front (oldest first)
- Keep trimming until under budget or only 1 message left

### 3. Updated flow in `runWithToolLoop()`

```
1. Load saved messages (no system prompt)
2. Append new user message
3. If contextWindow known: trim messages to fit budget
4. Build fullMessages = [systemPrompt, ...messages]
5. Pass fullMessages as _messages to generate()
6. ... loop runs (accumulates assistant/tool messages into `messages`) ...
7. Save `messages` to conversation file (no system prompt)
```

### 4. Trim also applies inside the tool loop

Each iteration adds assistant + tool results to `messages`. Before calling `generate()` on subsequent iterations, re-trim. This handles long multi-tool conversations within a single run.

## Verification

1. `bun test:unit` — existing tests still pass
2. Start local model, have a conversation:
   ```bash
   ? hello, remember the number 42
   ? what number did I say?
   ```
3. Check conversation file has no system prompt: `cat .giverny/conversations/conv-*.json | jq '.messages[0].role'` should be `"user"` not `"system"`
4. Check `/status` shows context length
5. For window testing: artificially set a small context window and verify old messages get dropped
