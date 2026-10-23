# Training Corpus for Shell Agent Model

Purpose-built training data for a model that knows Unix, programming, and technical knowledge — nothing else. The model's job is to receive intent via `@` and express computation via `exec(sh -c)`.

## Corpus

| Source | Tokens | Acquisition | Notes |
|---|---|---|---|
| POSIX spec + man pages + RFCs | ~10M | Free downloads, hours | The ground truth for sh behavior |
| GNU/Linux documentation | ~50M | Free, hours | coreutils, grep, sed, awk, find, etc. |
| Language docs (C, Perl, Rust, TS, Python, Go) | ~40M | Free, crawl in days | Std libs, reference manuals |
| Stack Overflow (filtered, high-vote technical) | ~1-2B | Data dump exists, filter in days | Q&A pairs for shell, code, sysadmin |
| Open source code (C, Perl, Rust, TS, Python, Go, shell) | ~20-50B | The Stack v2 dataset exists | Quality-filtered, popular repos |
| Shell scripts specifically | ~1-2B | Subset of The Stack | .sh, .bash, .zsh, Makefiles, Dockerfiles |
| Wikipedia technical subset (CS, math, engineering) | ~1B | Dump exists, filter in a day | Background knowledge for reasoning |
| Math (practical, not research papers) | ~1-2B | ArXiv dump + filter | Algorithms, data structures, complexity |
| **Total** | **~25-55B** | | |

## What's excluded

Everything that doesn't help the model compose shell commands:
- Fiction, creative writing
- News, social media, marketing copy
- Multilingual content (English only)
- Philosophy, ethics, psychology
- Medical, legal, financial advice
- Image/audio understanding

## Scaling law fit

Chinchilla scaling: optimal tokens ≈ 20-40x parameter count.

| Model tier | Params | Tokens needed | Corpus fit |
|---|---|---|---|
| pico | 50-300M | 1-12B | Overshoot — can curate aggressively |
| nano | 0.5B | 10-20B | Good fit with quality filtering |
| tiny | 1-3B | 20-120B | Right at the sweet spot |
| small | 7-14B | 140-560B | Need to augment or repeat |

The 25-55B corpus naturally fits the nano-to-tiny range.

## Acquisition timeline

| Phase | Duration | Who |
|---|---|---|
| Download existing datasets (The Stack v2, SO dump, Wikipedia dump) | 1 week | 1 person |
| Filter and clean (language filter, quality filter, dedup) | 2-4 weeks | 1 person |
| Tokenize and validate | 1 week | 1 person |
| **Total** | **1-2 months** | **1 person** |

Most of this data already exists as curated datasets. The work is filtering, not collecting.

## Training cost estimate

| Setup | Time | Cost |
|---|---|---|
| 1x A100 (80GB) | weeks | ~$5-15K cloud |
| 8x A100 cluster | days | ~$5-20K cloud |
| Own hardware (if available) | days | electricity |

## Post-training: RL in the shell

Pre-training gives the model knowledge. RL gives it judgment.

The model runs in an actual shell environment:
1. Receives a task prompt
2. Emits `exec(sh -c, command)`
3. Observes stdout/stderr/exit code
4. Decides next action or reports completion

Reward signals:
- **Concrete**: exit code 0, test passes, file exists, output matches expected
- **Efficiency**: fewer tool calls for same result
- **Safety**: doesn't touch files outside scope, doesn't rm -rf

The RL environment is just a container with a shell. The reward function is just "did the command work." The harness is the same `parse → gate → exec → return` loop that giverny already implements.

## The point

The model doesn't need to know how to write poetry or debate philosophy. It needs to know that `grep -rn "pattern" --include="*.ts" src/` finds text in TypeScript files. That `perl -pi -e 's/old/new/g' file.ts` edits in place. That `curl -s url | jq .field` extracts JSON.

Train on exactly that. Nothing else.
