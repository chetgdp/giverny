# some research ideas

## pico gate/judge/classifier
a tiny 1m to 50m parameter or whatever it takes to be good, sized model. the goal being, it reads what goes inside `sh -c (...)` and evaluates whether the command is safe to run or not. 

ideally runs in the microsecond to 2ms ish speed, could be entirely cpu or hardware accel, fit on L2 cache.

the current way giverny and other agent harnesses setup permissions for something like `bash()` commands is via whitelists checking whats actually being called. lookup tables are good sure, but sometimes, something that is actually easily reasoned to be safe is flagged as dangerous. it can get annoying having to keep granting perms just for a model to read files outside its directory.

so a classifier would only need to output a binary value, safe or not, true or false. 

the key reason any of this is actually worth doing is that the user's input for anything declared unsafe, if they allow it, then the model could learn from that signal and adjust to the user.

a system like this is probably lighter than difficult to maintain algorithmic whitelists on top of a long "please behave safely" system prompt. 

can use llms to come up with training data

## Terminal Bench Test
run our minimal agent "harness" of just `exec sh -c` against terminal bench. slopfolder contains some more info on this, i havent read the docs personally.

## what is unix
https://en.wikipedia.org/wiki/Linux

what is POSIX? why is unix the superior agent harness?

### Portable Operating System Interface
a standard for computer systems to be compatible with each other 

## REPL (Read-Eval-Print Loop)
*type input, evaluate, print* aka *stdin -> compute -> stdout*

Claude Code, OpenCode, all of these agent harnesses are REPLs I believe. But the terminal is already an REPL. So why are you nesting an REPL inside an REPL?

### VT100
*outputting text to a terminal was solved in 1978 on a computer with 3KB of RAM*

My understanding is that this is where ANSI escape codes come from. Which already solve many problems that the custom TUIs are trying to do. Not sure why people are building a virtual DOM and doing React/Ink stuff for a terminal display. I'm typing this on my laptop where the fullscreen terminal is 32 rows by 139 column. Imagine telling a game programmer that you were having trouble rendering to a 139x32 pixel viewport in a 16ms/60fps frame budget

Breaking down my understanding of Ink, the React terminal renderer (lol). This is what claude code and other TUIs use. 

Ink runs in immediate mode (what games do or dear imgui for example) where the state is rendered every however many FPS you want. So Ink runs through the React tree (virtual dom type of thing) and outputs ANSI text to the terminal. So the cause of the flicker in CC is because walking through the virtual dom tree each render is slow, while say the model is generating text. This has been quite an issue for CC team for a year, and is one of the reasons for original post that caused me to rethink everything I thought about the programming industry. 

https://x.com/trq212/status/2014051499798831291

The diff checking, not that slow but walking the tree is slow, everything he's describing here is slow. Why they need a tree to represent text that is being streamed, I still do not know.

The problem theyre facing has already been solved in 1978. The fact that theyre trying to build a a TUI that locks you out of the actual Terminal REPL loop is why they have to come up with all these convoluted methods. Maybe that's why claude code's codebase is 500k LOC. Crazy dude.

Instead of doing:

React -> Yoga (layout) -> Rasterize -> diff -> ANSI try this one cool trick instead:

ANSI escape codes and this POSIX function:
```C
#include <unistd.h>
ssize_t pwrite(int fildes, const void *buf, size_t nbyte, off_t offset);
ssize_t write(int fildes, const void *buf, size_t nbyte);
```
You write an nbyte buffer to a file descriptor, stdin is 0, stdout is 1, stderr is 2. Very simple, very fast.


## program synthesis as infra: pipelines
the very first thing that triggered this fork of omp was a way to create a tool call that would chain tool calls together rather than making it something the model controls. it was like code. this prompt outputs this, and that output goes into this next tool call, and you programmatically create a chain.

what `workflowz` really is, what the eval tool really is, is neurosymbolic program synthesis, and it's an extremely powerful thing. the model writes the eval program basically. that is a really powerful abstraction. theoretically if i asked a model to workflowz the dialectic, it could come up with something like the dialectic extension.

so naturally we should be looking to freeze workflows. we're doing the same workflow over and over, the model's running the same thing, and we "freeze" it: we simply create an extension out of it. this is how we're just gonna get a model to write extensions. that's what creator mode is ([DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)), just write extensions. the process here is the user asks the model to make an extension, instead of the model just doing it on its own. the `write-extension` skill (`~/.omp/agent/skills/write-extension/SKILL.md`) is that.

what matters is that they're reusable workflows. things that worked really good, but also if i want to write it myself, i can.

pipeline, program? pipeline could be program. sure, it's too broad, but it kind of is that. it's something between pipeline and program. what i do, i call dialogic program synthesis.

lit review: [omp-fork/neurosymbolic-lit.md](omp-fork/neurosymbolic-lit.md)

