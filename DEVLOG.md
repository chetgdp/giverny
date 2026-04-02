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

Imagine giving a human programmer the claude code json harness anytime they wanted
to do anything in the shell. This inspired an interaction with claude about claude code after we read the leaked code:
>"Hey I need to read a file."   
>  
>"Sure, fill out this JSON schema: { "tool": "Read", "file_path": string, "offset": number, "limit": number }. We'll validate it, run cat for you, truncate the output to 2000 lines, and return a structured result."  
>
>"I just wanted to cat the file."  
>  
>"Sorry, cat isn't available. But you can use the Read tool. Make sure file_path is absolute, not relative. And if the file is over 2000 lines you'll need to specify offset and limit. And you can't read directories, use Bash for that. But don't use Bash for reading files, use Read. Also don't use head or tail, use Read with offset. Oh and if you want to search inside the file don't use Read, use Grep. But don't use grep, use Grep."  
>  
>"Man I just want to cat src/main.ts | grep TODO."  
>  
>"That's two tools. You'll need to submit a Read tool call first, wait for the result, then submit a Grep tool call with the pattern. Or you could use Bash but we'd prefer you didn't."  
>  
>"cat src/main.ts | grep TODO"  
>  
>"...yeah that works too."  

##
I have bridged the gap between shell and llm. The ease of composability means that humans can use it without much fuss. But imagine more elaborate orchestrator agnt frameworks with big contexts spawning off giverny infused shell programs. Cronjobs with intelligence built into them. The frameworks like openclaw and hermes agent, where they fail today is the mass amount of tokens they consume, you have to pay like the cost of lunch every day for normal use. These frameworks are better served by distributed inference, slower but way cheaper. The tasks you need it to complete are async, they can take their time.

##
you could have giverny shell mode hit the opencode server client and use their agent harness the same way we use claude code. just make system prompt empty. but then we can also make opencode hit the giverny server that uses claude code. and bybapp the whole anti claude oauth thing that happened. wow. the bridge idea is just exactly what giverny is. 

## refactoring
So far I have barely written any lines of this project over the course of 10 days of building it with claude code. not surprising to me, given that typescript(it's just js) is quite easy to just shit out. also I have a knack for holding the leash, I can spot stupid shit before it happens and have done so on this project. So far its under 5500 lines of source code. I've maintained the architectural design decisions. Time to see if it paid off. 

Now time to go into the mines and actually read it. A step that is quite rare
