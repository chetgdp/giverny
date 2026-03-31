# Terminal-Bench Experiment: Tools vs Shell

## Hypothesis

JSON-schema'd tool wrappers (Read, Write, Edit, Grep, Glob, etc.) do not meaningfully improve agent performance over raw shell access (`exec(sh -c)`). The harness is overhead, not value.

## Method

A/B benchmark on Terminal-Bench 2.0, same model (Claude), same tasks, two configurations:

### A — Full Harness (Control)

Giverny wrapping `claude -p`. The model gets Claude Code's native toolset:

- 18 tools: Read, Write, Edit, Bash, Grep, Glob, Agent, WebFetch, WebSearch, etc.
- ~10,000 word system prompt
- Permission mode: bypass

This is the industry standard approach. Every tool call goes through JSON schema validation, TypeBox/Zod parsing, custom handlers, then down to the same syscalls the shell would make.

### B — Shell Only (Experiment)

Giverny server mode (`giverny -s`) as backend. Giverny CLI as client. The model gets:

- 1 tool: `exec(sh -c, command)`
- Minimal system prompt (the agent is a shell, use Unix tools directly)
- Same model, same context window, same temperature

The model must `cat` instead of Read, `perl -pi -e` instead of Edit, `tee` instead of Write, `rg` instead of Grep, `fd` instead of Glob. Everything through bash. Per the PIPELINE thesis, the three tools are `sh` (1977), `perl` (1987), `curl` (1998) — perl is the text processing layer, not sed/patch.

## What Each Outcome Means

### B ≈ A (within ~5%)

The tool-wrapping layer is provably overhead. Models already know Unix. 18 JSON-schema'd tools and 10,000 words of system prompt add complexity without improving capability. The entire harness industry is re-implementing what the model already knows how to do.

Implication: the minimal agent is `exec(sh -c)` + a permission gate. Everything else is unnecessary.

### A >> B (significant gap)

Structured tools help in specific ways. The gap will reveal exactly where:

- **File editing**: Even with `perl -pi -e` (more capable than sed for multi-line), in-place text replacement is harder to get right than a schema'd `{oldText, newText}`. The edit tool normalizes fuzzy matching, handles BOM, preserves line endings. But perl is a real language — regex, multi-line, capture groups, entire file slurping. The question is whether the model is better at writing perl one-liners or JSON edit schemas.
- **Search**: `rg` with correct flags vs a schema'd grep that handles .gitignore and truncation automatically.
- **Output parsing**: Tool results are structured. Bash output is raw text the model has to parse.
- **Error recovery**: Schema validation catches malformed tool calls before execution. Shell commands just fail.

Implication: there's a small set of operations where structured tools genuinely help (probably edit and maybe search). Build those few, not 18.

### B >> A (unlikely but interesting)

The system prompt and tool overhead actively confuse the model. The 10,000 words of instructions constrain rather than guide. The model is better at composing shell commands than following harness-specific tool schemas.

Implication: system prompts and tool schemas are net negative. Strip everything.

## Implementation

### Harbor Integration

Terminal-Bench uses the Harbor framework. Agents are Python classes:

```python
class GivernyNativeAgent(AbstractInstalledAgent):
    """Config A: giverny wrapping claude -p, native Claude Code tools."""

    @staticmethod
    def name() -> str:
        return "giverny-native"

    # install: curl giverny install script, set ANTHROPIC_API_KEY
    # run: giverny -p "{instruction}" (passes through to claude -p)

class GivernyShellAgent(AbstractInstalledAgent):
    """Config B: giverny server + CLI, exec(sh -c) only."""

    @staticmethod
    def name() -> str:
        return "giverny-shell"

    # install: curl giverny install script, set ANTHROPIC_API_KEY
    # run: start giverny -s, then giverny -p "{instruction}" hitting localhost:8741
```

### System Prompt for Config B

```
You are a shell agent. You have one tool: exec(sh -c, command).
Your toolkit is Unix: sh for orchestration, perl for text processing,
curl for networking. cat to read, perl -pi -e to edit, tee to write,
rg to search, fd to find. Complete the task using shell commands.
```

### Variables Controlled

| Variable | Config A | Config B |
|----------|----------|----------|
| Model | Claude (same) | Claude (same) |
| Context window | Same | Same |
| Tasks | Terminal-Bench 2.0 (89 tasks) | Same |
| Container | Same Docker env | Same |
| Tool count | 18 | 1 |
| System prompt | ~10,000 words | ~50 words |
| Tool interface | JSON schemas | Raw shell |

### Trials

5 trials per task per config (Terminal-Bench standard for leaderboard submission).

## Prior Evidence

- **Pi** (Zechner): 4 tools + ~1,000 token prompt scores competitively against 18-tool harnesses on Terminal-Bench 2.0. Suggests tool count doesn't scale with performance.
- **Terminus 2**: Zero tools (just tmux). Holds its own on the leaderboard. Strongest existing evidence that shell-only works.
- **Zechner's observation**: "All the frontier models have been RL-trained up the wazoo, so they inherently understand what a coding agent is."

## Cost Estimate

Terminal-Bench 2.0: 89 tasks × 5 trials × 2 configs = 890 runs. At ~$0.50-2.00 per run (Claude Opus/Sonnet), budget ~$450-1,800. Use Sonnet to keep costs down; the comparison is relative, not absolute.

## What This Doesn't Test

- Whether a **smaller model** (7B, 3B, pico) can do shell-only. That's the v2 question.
- Whether a **learned permission gate** (pico-judge) works. Orthogonal experiment.
- Whether **streaming UX** matters. Terminal-Bench is headless, no human in the loop.
- Whether **session/context management** matters. Tasks are single-shot.

This tests one thing: does wrapping Unix in JSON schemas help the model solve coding tasks?
