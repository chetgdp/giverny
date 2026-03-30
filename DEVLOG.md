# devlog

## shell design notes
Knowing what we know about `claude -p` we can architect an interactive shell system. Instead of a terminal user interface, the terminal becomes a first class user of the giverny shell macro `@` or `?`. This uses giverny bridge as the engine.

What I imagined was that you use your shell normally, and there is a claude session being tracked in the background. You type `@ can you grep ./folder for something` and it executes the command. There would be perms modes: `--ask or --auto or --plan`, where it skips perms or always ask for perms. If you have ask for perms, you enter a small automated respond with 1, 2 or 3 similar to how Claude Code does. But the session is entirely native inside whatever shell you are already in.

The shell mode shouldn't skip tool calls like the server does, it should use claude code's native tools.

The fundamental data type that we are transforming around is streamed NDJSON (newline-delimited json).

```
claude -p --output-format stream-json --verbose
```

2ms for Bun itself. 10ms to import our code. Meanwhile claude -p takes 3,500ms. Rewriting Giverny in Rust would shave maybe 8ms off a 3,500ms call. That's 0.2%.

Worst case 1m full context window of raw text, around 4mb, then that data goes into NDJSON which is another couple mb added. Milliseconds. General case? 100+ kb, doesn't break a sweat here.

## other programs that are similar

I made this before I learned about Simon Willison's `llm` python module. I think it's better and more natural. The reason it exists is more so because of agent harnesses rather than models. A first class cli UX for claude code.

I looked into more programs that are similar. First aspect I notice is that giverny's automated alias setup turns it from just any shell program like `cat` into something like | or &&.
