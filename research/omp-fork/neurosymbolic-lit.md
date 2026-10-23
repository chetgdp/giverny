# Neurosymbolic program synthesis lit review for omp eval, frozen pipelines, and tool mining

Legend: (a) model-written programs that chain tool and subagent calls; (b) human-frozen staged LLM pipelines with schema-checked outputs; (c) mining repeated programs and freezing them into tools.
Verification: [VERIFIED] = arXiv ID, title, first author and submission date checked against the arXiv API (export.arxiv.org); claims checked against the abstract where the abstract states them. Venues (PLDI/ICLR/etc.) were NOT checked and are marked "(venue unverified)". Claims that go beyond the abstract keep [UNVERIFIED-detail].

## Library learning / neurosymbolic synthesis
- DreamCoder: Ellis et al., arXiv 2020 (PLDI 2021, venue unverified), https://arxiv.org/abs/2006.08381 [VERIFIED]. It alternates two phases. A wake phase solves tasks. A sleep phase compresses repeated subprograms into a DSL library and trains a neural recognition model. Maps to (c), the canonical form.
- Stitch ("Top-Down Synthesis for Library Learning"): Bowers et al., arXiv 2022 (POPL 2023, venue unverified), https://arxiv.org/abs/2211.16605 [VERIFIED]. Corpus-guided top-down synthesis of abstractions; per the abstract, 3-4 orders of magnitude faster and 2 orders less memory than DreamCoder's compressor. Maps to (c).
- LILO: Grand et al., arXiv 2023 (ICLR 2024, venue unverified), https://arxiv.org/abs/2310.19791 [VERIFIED]. An LLM synthesizes programs, Stitch compresses them, and an LLM "AutoDoc" names and documents each abstraction. Maps to (c), and to (a) for the synthesis step.
- babble ("Learning Better Abstractions with E-Graphs and Anti-Unification"): Cao, Kunkel et al., https://arxiv.org/abs/2212.04596 [VERIFIED] (POPL 2023, venue unverified). Library learning modulo equational theories via e-graph anti-unification. Maps to (c).
- LLM-guided synthesis such as HySynth (https://arxiv.org/abs/2405.15880) and "Guiding Enumerative Program Synthesis with LLMs" (https://arxiv.org/abs/2403.03997) [VERIFIED existence via search]. An LLM acts as a prior for symbolic search. Background for (a).

## Code-as-action agents
- PAL ("Program-aided Language Models"): Gao et al., arXiv 2022 (ICML 2023, venue unverified), https://arxiv.org/abs/2211.10435 [VERIFIED]. The LLM writes a program, and an interpreter performs the computation. Maps to (a).
- Program of Thoughts: Chen et al., arXiv 2022 (TMLR 2023, venue unverified), https://arxiv.org/abs/2211.12588 [VERIFIED]. Separates reasoning, done as code, from computation. Maps to (a).
- CodeAct ("Executable Code Actions Elicit Better LLM Agents"): Wang et al., arXiv 2024 (ICML 2024, venue unverified), https://arxiv.org/abs/2402.01030 [VERIFIED]. Executable Python as the unified action space beats JSON/text actions, with up to 20% higher success. Maps to (a).
- Voyager: Wang et al., 2023, https://arxiv.org/abs/2305.16291 [VERIFIED id/title]. A Minecraft agent stores programs in a skill library retrieved by embedding and composes them later [UNVERIFIED-detail: embedding retrieval and JS]. Maps to (a) and (c).
- Cloudflare Code Mode: https://blog.cloudflare.com/code-mode-mcp [VERIFIED]. Turns MCP tools into a TypeScript API. The model writes code that runs in a sandbox, and 2,500 endpoints fit in about 1k tokens through search() and execute(). Maps to (a). This is the direct analogue of omp eval.
- Anthropic Programmatic Tool Calling: https://www.anthropic.com/engineering/advanced-tool-use [VERIFIED]. Claude invokes tools from a code execution environment, and intermediate results stay out of the context window. Maps to (a).

## LM programs / compiled pipelines
- DSPy: Khattab et al., arXiv 2023 (ICLR 2024, venue unverified), https://arxiv.org/abs/2310.03714 [VERIFIED]. Declarative modules with typed Signatures. Optimizers ("teleprompters") compile prompts and demos against a metric. Maps to (b). Its typed signatures correspond to the schema-checked stages.
- LMQL ("Prompting Is Programming"): Beurer-Kellner et al., arXiv 2022 (PLDI 2023, venue unverified), https://arxiv.org/abs/2212.06094 [VERIFIED]. A query language with constraints for decoding. Maps to (b).
- Guidance: https://github.com/guidance-ai/guidance [VERIFIED repo exists; originated at Microsoft, UNVERIFIED-detail]. Interleaves control flow with constrained generation using regex and CFG. Maps to (b).
- SGLang: Zheng et al., 2023, https://arxiv.org/abs/2312.07104 [VERIFIED]. A frontend language plus a runtime with RadixAttention prefix reuse for multi-call LM programs. Maps to (b), relevant to the performance of fixed pipelines.

## Workflow synthesis / automation
- ADAS (Automated Design of Agentic Systems): Hu et al., arXiv 2024 (ICLR 2025, venue unverified), https://arxiv.org/abs/2408.08435 [VERIFIED]. A meta-agent writes agent code and keeps an archive of discovered agents. Maps to (a) and (c).
- AFlow: Zhang et al., arXiv 2024 (ICLR 2025, venue unverified), https://arxiv.org/abs/2410.10762 [VERIFIED]. Uses MCTS over code-represented workflows built from reusable operators such as Ensemble and Review/Revise [UNVERIFIED-detail: operator names]. Maps to (b) and (c).
- Agent Workflow Memory: Wang et al., 2024, https://arxiv.org/abs/2409.07429 [VERIFIED]. Induces reusable workflows from past trajectories, both offline and online, and feeds them back as guidance. Maps to (c).

## Tool-making
- LATM (LLMs as Tool Makers): Cai et al., arXiv 2023 (ICLR 2024, venue unverified), https://arxiv.org/abs/2305.17126 [VERIFIED]. A tool-maker LLM crafts reusable tools; a tool-user LLM (can be cheaper) applies them, with tool caching as requests arrive. Maps to (c).
- CRAFT: Yuan et al., arXiv 2023 (ICLR 2024, venue unverified), https://arxiv.org/abs/2309.17428 [VERIFIED]. Builds toolsets from solutions, then abstracts, validates, and deduplicates them, with retrieval at inference time. Maps to (c).
- CREATOR: Qian et al., 2023, https://arxiv.org/abs/2305.14318 [VERIFIED]. Separates tool creation from tool use. Maps to (c).
- ToolMaker ("LLM Agents Making Agent Tools"): Wölflein et al., 2025, https://arxiv.org/abs/2502.11705 [VERIFIED]. Turns paper code repositories into LLM-compatible tools with closed-loop self-correction and unit tests. Maps to (c).

## Dialectic / debate
- Multi-agent debate: Du et al., arXiv 2023 (ICML 2024, venue unverified), https://arxiv.org/abs/2305.14325 [VERIFIED]. Several model instances debate over rounds, which improves factuality and reasoning. Maps to (b).
- MAD (encouraging divergent thinking): Liang et al., 2023, https://arxiv.org/abs/2305.19118 [VERIFIED]. An affirmative agent, a negative agent, and a judge address "degeneration of thought." Maps to (b). Its affirmative/negative/judge structure is closest to thesis/antithesis/synthesis.
- Self-Refine: Madaan et al., arXiv 2023 (NeurIPS 2023, venue unverified), https://arxiv.org/abs/2303.17651 [VERIFIED]. A single model loops through generate, feedback, refine. Maps to (b).
- Reflexion: Shinn et al., arXiv 2023 (NeurIPS 2023, venue unverified), https://arxiv.org/abs/2303.11366 [VERIFIED]. Verbal self-reflection stored in memory. Maps to (b) and (c).
- Caveat: "Large Language Models Cannot Self-Correct Reasoning Yet", Huang et al., arXiv 2023 (ICLR 2024, venue unverified), https://arxiv.org/abs/2310.01798 [VERIFIED]. Self-correction without external feedback can degrade results. This argues for schema checks and verifiers in (b).

## Does "dialogic program synthesis" exist?
A search for the exact phrase returned no academic hits [VERIFIED negative, one search only]. Close but different terms:
- "Dialogic Programming" (Substack, https://logicbombs.substack.com/p/introducing-dialogic-programming [VERIFIED]) means conversational and literate coding with LLMs. It is not synthesis of agent programs.
- Older HCI and synthesis terms: "interactive program synthesis" and "conversational programming / programming by dialogue" [UNVERIFIED].
- Neighbouring field labels:
  - "LM programs / compound AI systems" (DSPy, BAIR)
  - "code as policies / code-as-action" (CodeAct)
  - "library learning" (DreamCoder, LILO)
  - "agentic workflow / agent design search" (AFlow, ADAS)

## Closest existing term
The closest existing term is **interactive (human-in-the-loop) library learning over LM programs**. It combines the LILO/DreamCoder wake-sleep framing for (c), DSPy's "LM programs" for (b), and CodeAct's "code-as-action" for (a). In this literature, "neurosymbolic program synthesis" usually means synthesis guided by a DSL or grammar. "Dialogic" has no established technical meaning there. If the user uses the term, they should define it as dialectical staged generation (debate/MAD) inside an LM-program framework.

## Three ideas for freezing repeated eval programs into extensions
1. **Compression-driven mining (Stitch/LILO)**:
   - Log eval cells and parse them into ASTs.
   - Run anti-unification or Stitch-style compression across sessions to find the most-reused parameterized subprograms, ranked by token or call savings × frequency.
   - Have an LLM write the name, docstring, and parameter schema (LILO AutoDoc).
   - A human approves each extension before it is frozen.
2. **Verify before promoting (LATM/CRAFT/ToolMaker/Voyager)**:
   - Promote a candidate only after it reruns on the recorded inputs that produced it and matches outputs or a schema.
   - Deduplicate against existing tools by embedding plus signature (CRAFT).
   - Retrieve tools by description at call time instead of listing every tool in the prompt. This keeps context cost low, as in Code Mode's search().
3. **Typed signatures plus compile/optimize (DSPy/AFlow)**:
   - Freeze each mined pipeline as typed stages (Signature = input/output schema), which gives the schema checks of (b).
   - Keep a small eval set taken from the original sessions so prompts and demos can be re-optimized later without changing the program structure.
   - AFlow-style operator reuse lets frozen extensions become building blocks for later workflow search. One example is the thesis/antithesis/synthesis pipeline as a "Debate" operator.

## User-named papers
Template per entry: title / authors / date / link / mechanism / (a) programs chaining calls, (b) frozen pipelines, (c) mining into tools / omp `eval` relevance. Append new entries below as `### N.`. Claims come from the linked abstract/page; anything else is marked [UNVERIFIED].

### 1. "DeepSeek harness paper": confirmed by the user as 1a
**1a. DeepSeek Harness: Everything is a Plugin** (CONFIRMED by the user; software release with a citation entry, not an arXiv paper)
- Authors: DeepSeek-AI. Date: 2026 (public preview). Links: https://github.com/deepseek-ai/deepseek-harness, https://www.deepseek.com/en/harness/
- Mechanism: `dsh` is an open-source agent harness where models, tools, skills, sessions, sandboxes, loops, scheduling, and UI are all plugins on Cordis. In "Creator mode" the agent writes a plugin in chat, installs it through a `plugin_manager · install_bundle` tool call, and verifies it live. Plugins include subagents, agent teams, and scheduled tasks.
- Why it matches: the user confirmed this is the paper they meant. The README provides a bibtex entry. 1b and 1c below are related DeepSeek work, kept for context.
- (a) Partial: it uses a JSON tool-call loop. The pages I read show no model-written programs that chain calls. (b) Scheduled tasks re-run a fixed prompt on a schedule, which is a weak form of a frozen pipeline. (c) Strong: Creator mode turns a conversational request into a persistent, installed plugin, which is the human-approved "freeze into a tool" step.
- omp `eval`: this is the closest analogue to promoting eval cells into omp extensions. The key difference is that dsh freezes into a plugin package, not into a mined, reusable program.

**1b. A Programming Paradigm for Spatiotemporal Composability** (the "Cordis paper" that the DSH README cites for the harness design)
- Authors: Yifan Shi, Wei Zhang, Tianyi Cui. Date: 2026-08-26. Link: https://arxiv.org/abs/2608.25512
- Mechanism: The paper formalizes *revertible effects*: every context transformation carries an inverse, so removing a component undoes all of its side effects. It also formalizes *reactive coeffects*: components activate and deactivate as declared dependencies appear or disappear. Both are unified under a single "context" type, with a calculus of dynamic composition. Cordis implements this with hot module replacement. The abstract explicitly names "self-evolving agent harnesses" as a target.
- Why it matches: it is the only arXiv paper linked from DSH as describing the harness design. The authors are not listed as DeepSeek-AI; their affiliation is [UNVERIFIED].
- (a) No. (b) It gives formal grounds for safely hot-adding and removing frozen components. (c) It is the substrate for the self-evolving case: tools mined at runtime can be loaded and fully reverted.
- omp `eval`: relevant if mined tools are hot-registered into a live session. Revertible registration would let an experimental extension be unloaded without leftover state.

**1c. DeepSeek Elastic Compute (DSec): A Sandbox Infrastructure for Effective Agentic Training at Scale**
- Authors: DeepSeek-AI (Jialiang Huang, Hongxuan Tang, … Wenfeng Liang; 100+ authors). Date: 2026-09-19. Link: https://arxiv.org/abs/2609.22978
- Mechanism: DSec is a production sandbox platform with FnCall, container, microVM, and full-VM backends behind one SDK. It is co-designed with RL so that stateful rollouts are decoupled from GPU training, and it addresses reward hacking. It serves about 3M sandboxes/day, with over 380k concurrent.
- Why it matches: it is a DeepSeek paper about the execution "harness" for tool and code use. It is infrastructure, though, not an agent design.
- (a) It is infrastructure for running tool/code actions; it is not about programs chaining calls. (b), (c) Not addressed.
- omp `eval`: low relevance. It only matters for the sandboxing and isolation of kernels.
- Other DeepSeek candidate seen but not read: DeepSeek-V4 tech report (arXiv 2606.19348, 2026-04-26). Whether it contains a harness section is [UNVERIFIED].

### 2. Recursive Language Models (RLMs)
- Authors: Alex L. Zhang, Tim Kraska, Omar Khattab (MIT CSAIL). Date: v1 2025-12-31; v2 2026-01-28; v3 2026-05-11. Link: https://arxiv.org/abs/2512.24601 (code: https://github.com/alexzhang13/rlm)
- Mechanism: The prompt is loaded as a variable in a Python REPL instead of being placed in the context window. The LM writes code to peek into the prompt, decompose it, and "programmatically construct sub-tasks on which they can invoke themselves recursively", observing execution side effects iteratively. The external interface stays string in, string out. Results: it handles inputs about 100× beyond the context window (10M+ tokens). On GPT-5 it reports median gains of +130% vs CodeAct with sub-calls, +26% vs compaction, and +13% vs Claude Code. v3 also post-trains RLM-Qwen3-8B (+28.3% over the base model).
- (a) Strong: this is exactly a model-written program in a REPL that chains recursive LM sub-calls over symbolic handles to the data. (b) No: decomposition is chosen fresh per query, and nothing is frozen. (c) Not addressed. However, recurring decomposition patterns in RLM traces (chunk, map sub-LM, reduce) are natural candidates for mining.
- omp `eval`: this is nearly the same shape. The difference is that RLM passes the *input* by reference as a REPL variable and calls the LM recursively, whereas omp code calls `agent()`/`workpool()`/`judge_batch()` with payloads. Adopting "context as a kernel variable, not a prompt" (e.g., `read()` into a variable, then fanning slices out to `judge_batch`) is the direct takeaway.

### 3. "Plugin mode" (garbled voice input)
- No paper or feature named "plugin mode" was found. The most likely referent is DeepSeek Harness's **"Creator mode"**: plugins are created through chat inside DSH's "Everything is a plugin" system (entry 1a). Here the agent writes, installs, and verifies a new plugin, which maps onto (c), freezing work into a reusable tool. This identification is an [INFERENCE].
