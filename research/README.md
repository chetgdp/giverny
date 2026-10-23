# research

HCI research on agent harnesses: how people and models share a terminal, tools, and programs. Giverny is the umbrella; the harness work now lives in the omp fork at `~/TPP/oh-my-pi` ([chetgdp/oh-my-pi](https://github.com/chetgdp/oh-my-pi)), whose own design notes are in its `cheisms/` directory.

Files below are moved as written, wording unchanged. Dates are when each piece was written, from giverny git history or the clone's last commit.

## Layout

| Path | Contents | From | Date |
|---|---|---|---|
| `RESEARCH.md` | research ideas: pico judge, Terminal Bench, unix, REPL, VT100 | repo root | 2026-04-04 |
| `notes/` | PIPELINE, tool_call_map, unix | `slopfolder/research/` | 2026-03-29 |
| `notes/` | training-corpus | `slopfolder/research/` | 2026-03-30 |
| `notes/` | pico-judge, terminal-bench-experiment | `slopfolder/research/` | 2026-03-30 |
| `agent-harness-analysis/` | garry plan and analysis, opencode, pi-mono, TOOLS, DATA_TRANSFORMATION, DEVLOG | `slopfolder/agent_harness_analysis/` | ~2026-03/04 |
| `cli-llm-analysis/COMPARISON.md` | llm vs aichat | `slopfolder/cli_llm_analysis/` | ~2026-03 |
| `more-analysis/executor_analysis.md` | executor | `slopfolder/more_analysis/` | ~2026-04 |
| `omp-fork/neurosymbolic-lit.md` | lit review: code mode, pipelines, library learning, Recursive Language Models, DeepSeek Harness | omp session | 2026-10-22 |
| `sources/` | cloned repos and extracted binaries (gitignored) | `slopfolder/` | see below |

## sources/ (gitignored)

| Path | Origin | Last commit |
|---|---|---|
| `agent-harness/claude-code` | github.com/chatgptprojects/claude-code | 2026-04-01 |
| `agent-harness/claw-code` | github.com/instructkr/claw-code | 2026-03-31 |
| `agent-harness/hermes-agent` | github.com/NousResearch/hermes-agent | 2026-03-27 |
| `agent-harness/llm` | github.com/simonw/llm | 2026-03-17 |
| `agent-harness/opencode` | github.com/anomalyco/opencode | 2026-04-02 |
| `agent-harness/pi-mono` | github.com/badlogic/pi-mono | 2026-03-30 |
| `agent-harness/garry`, `agent-harness/extracted/` | garry binary and carved bundle | — |
| `cli-llm/aichat` | github.com/sigoden/aichat | 2026-02-23 |
| `cli-llm/llm` | github.com/simonw/llm (different checkout from the one above) | 2026-03-17 |
| `executor` | github.com/RhysSullivan/executor | 2026-04-07 |
| `nagent` | github.com/macton/nagent | 2026-06-07 |

## Old paths

Notes written before the move still name their old locations. Map them:

| Old | New |
|---|---|
| `slopfolder/agent_harness_analysis/<repo>` | `research/sources/agent-harness/<repo>` |
| `slopfolder/agent_harness_analysis/extracted/` | `research/sources/agent-harness/extracted/` |
| `slopfolder/agent_harness_analysis/*.md` | `research/agent-harness-analysis/` |
| `slopfolder/research/*.md` | `research/notes/` |
