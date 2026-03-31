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


## tools
the whole industry is betting on the fact that json tools calls + their own tool harness becomes more consistent. but you have to RL the model on it. and each tool call is still different. Perl for text editing, just learn perl rather than learning some mystical json output format amongst the one billion other json things the model will learn. We expect the model to know C Rust Python Typescript JS Java etc etc but Perl is an afterthought? No, its better to just teach it the actual UNIX tools. The json tool call is an abstraction. The safety you get from your bespoke tool calling schema yes, thats solid. But the classifier idea. A tiny, in a millisecond running model that checks over each tool call, and deciding if its safe to go through or needs permissions? That one model covers your bases.

Cut out abstractions, see thats the giverny philosophy in action, learn the shell and you learn giverny. Learn the computer and you already know giverny

```
1. Can we not do this at all?
2. Can we do this only once?
3. Can we do this fewer times?
4. Can we approximate the results so no one notices?
5. Can we use a small lookup table?
6. Can we use a small FIFO?
6. Can we constrain the problem further?
t. Mike Acton
```
