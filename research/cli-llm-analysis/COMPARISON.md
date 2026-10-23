# CLI LLM Tool Comparison

Side-by-side of giverny, llm (Simon Willison), and aichat (sigoden) doing the same tasks.

```
                          giverny                          llm                              aichat
                          ───────                          ───                              ──────
basic prompt              @ hello                          llm "hello"                      aichat hello
pipe in                   cat f.txt | @ summarize          cat f.txt | llm "summarize"      cat f.txt | aichat summarize
pipe out                  @ haiku > out.txt                llm "haiku" > out.txt            aichat haiku > out.txt
full pipeline             git diff | @ review | wl-copy    git diff | llm "review" | wl-copy   git diff | aichat review | wl-copy
continue session          @ and also...                    llm -c "and also..."             aichat -s tmp (then type)
new session               /new                             (default)                        .exit session
change model              /opus                            llm -m gpt-4o "prompt"           aichat -m claude:claude-3-5-sonnet "prompt"
set default model         /model opus                      llm models default gpt-4o        edit config.yaml → model: xxx
agentic task              @ fix the tests                  llm -T exec "fix the tests"      aichat -a my-agent "fix the tests"
file input                cat src/ | @ explain             llm -f src/ "explain"            aichat -f dir/ explain
shell command gen         @ how do I find large files      llm -s "cmd only" "find large files"   aichat -e "find large files"
interactive mode          @                                llm chat -m gpt-4o              aichat (enters REPL)
config                    ~/.giverny/config.json (3 fields)   keys.json + default_model.txt + plugins   config.yaml (316 lines)
setup                     giverny --setup                  llm keys set openai && llm models default x   edit config.yaml + API keys + tools + agents
```

## Key differences

**Session default**: giverny continues by default, llm starts fresh by default, aichat requires explicit session creation.

**Agentic capability**: giverny delegates to claude code's full agent loop (file editing, code search, subagents). llm and aichat have tool/function calling but require explicit tool setup.

**Config surface**: giverny has 3 fields. llm has keys + default model + plugins. aichat has 316 lines of YAML.

**The ergonomic pattern**: giverny is shorter in every row. No quotes around prompts, no flags for the common case, persistent slash commands instead of per-invocation flags.
