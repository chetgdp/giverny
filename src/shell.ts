// shell.ts
/*
* Giverny Shell Mode
*
*---- wrong, not just claude -p
* Wraps `claude -p` with native Claude Code tools enabled and persistent
* per-directory sessions. Streams output to the terminal with compact
* tool usage summaries.
*----
* The shell mode is one end of the bridge, this is the main UX of giverny
* we have shell <-> bridge <-> backend apis <-> models
*
* Usage: giverny <prompt>
*        giverny --tools "Read,Bash" <prompt>
*/

// we could clean these imports up? better order?
import { mkdirSync } from "fs";
import { CONFIG_DEFAULTS } from "./config";
import { getBackend } from "./backend";
import type { BridgeEvent, RunControl } from "./backend";
import { Bridge } from "./bridge-loop";
import {
    DIM, RED, ORANGE, SEA_GREEN, RESET, INV, PIPED,
    needsPermission, isDangerousCommand, summarizeTool, ui, isUUID,
} from "./shell-utils";
import { promptPermission } from "./tui";
import { TOOL_SYSTEM_PROMPT } from "./tools";
import { 
    GIVERNY_DIR, GLOBAL_CONFIG_FILE, USAGE_FILE, TRANSCRIPT_FILE,
    loadJSON, loadConfig, loadSession, loadApproved, loadUsage, 
    saveSession, saveUsage, saveApproved, clearSession, 
    discoverSessions, discoverConversations, resolvePromptFile  
} from "./state";
import { createSpinner } from "./spinner";
import { handleSlashCommand } from "./commands";
export { handleSlashCommand };

// what is this number doing here?
const MAX_RESULT_LINES = 8;

// LLM invocation via bridge ------------------------------------------------ /
//input
export interface RunShellOpts {
    prompt:         string;
    model:          string;
    effort:         string;
    perms:          string;
    tools:          string;
    output:         string;
    timeout?:       number;
    systemPrompt?:  string;
    url?:           string;
    apiKey?:        string;
    clusterId?:     string;
    // why is this an option? (opts?)
    bridge:         Bridge;
}

//output
interface ShellResult {
    sessionId:      string | null;
    approvedTools:  Set<string>;
    killed:         boolean;
    usage:          { input_tokens: number; output_tokens: number } | null;
    durationMs:     number | null;
    numTurns:       number;
    responseText:   string;
}

// the shell is doing the majority of its work here
export async function runShell(
    opts:           RunShellOpts, 
    sessionId:      string | null, 
    approvedTools:  Set<string>, 
    overridePerms?: string): 
Promise<ShellResult> {
    // where does this come from?
    const { prompt, model, effort, perms, tools, 
        output, url, apiKey, clusterId, bridge } = opts;
    const effectivePerms = overridePerms || perms;
    const isAskMode = effectivePerms === "ask";
    const isConfirmMode = effectivePerms === "confirm";
    // what is killed? the process?
    let killed = false;

    // hmmm this is important UX
    const spinner = createSpinner({ effort });
    // thinking set here because its for dumb mode non TTY mode?
    spinner.start("thinking");
    let streamedText = false;
    let responseText = "";
    // what is an event? also what is a block?
    // from src/backend.ts
    const onEvent = (event: BridgeEvent, control: RunControl) => {
        // one of the ways we stop hanging?
        if (killed) return;
        // this many nested ifs now thats what I call slopus 4.6
        
        // ASSISTANT -------------------------------------------------------- /
        if (event.type === "assistant") {
            for (const block of event.blocks) {
                if (killed) return;
                if (block.type === "tool_use") {
                    // we stopping the spinner here because tool use
                    spinner.stop();

                    // Ensure tool summary starts on its own line
                    if (streamedText && !responseText.endsWith("\n")) {
                        ui.write("\n");
                    }

                    const summary = summarizeTool(block.name, block.input);
                    ui.write(`${DIM}[${block.name}] ${summary}${RESET}\n`);

                    // Show diff preview for write operations (always full length)
                    if (block.name === "Edit" && block.input.old_string != null) {
                        const oldLines = block.input.old_string.split("\n");
                        const newLines = (block.input.new_string || "").split("\n");
                        for (const line of oldLines) {
                            ui.write(`${RED}  - ${line}${RESET}\n`);
                        }
                        for (const line of newLines) {
                            ui.write(`${SEA_GREEN}  + ${line}${RESET}\n`);
                        }
                    } else if (block.name === "Write" && block.input.content != null) {
                        const lines = block.input.content.split("\n");
                        for (const line of lines) {
                            ui.write(`${SEA_GREEN}  + ${line}${RESET}\n`);
                        }
                    }

                    // Ask mode: pause before dangerous tools, prompt user
                    // Confirm mode: pause before ALL tools, no safe-list bypass
                    if ((isAskMode || isConfirmMode) && !approvedTools.has(block.name) && (isConfirmMode || needsPermission(block.name, block.input))) {
                        control.pause?.();

                        // Extra warning for catastrophic commands — flips default to deny
                        const danger = block.name === "Bash"
                            ? isDangerousCommand(block.input?.command || "")
                            : null;
                        if (danger) {
                            ui.write(`  ${RED}⚠ ${danger}${RESET}\n`);
                        }

                        const choice = promptPermission(block.name, !!danger);
                        if (choice === "tool") {
                            approvedTools.add(block.name);
                            control.resume?.();
                        } else if (choice === "allow") {
                            control.resume?.();
                        } else {
                            killed = true;
                            control.abort();
                            return;
                        }
                    }

                    // Show tool execution in spinner
                    if (!killed) {
                        const label = block.name;
                        spinner.start(label);
                    }
                }

                if (block.type === "text") {
                    spinner.stop();
                    // what is the point of this ternary?
                    //
                    const text = streamedText ? block.text : block.text.replace(/^\n+/, "");
                    process.stdout.write(text);
                    responseText += text;
                    streamedText = true;
                }
            }
        }

        // TOOL_USE --------------------------------------------------------- /
        if (event.type === "tool_result") {
            if (killed) return;
            spinner.stop();

            if (output === "normal" || output === "verbose") {
                const toolOutput = event.stdout || event.content;
                if (toolOutput) {
                    const color = event.isError ? RED : DIM;
                    const lines = toolOutput.split("\n");
                    const maxLines = output === "verbose" ? Infinity : MAX_RESULT_LINES;
                    const shown = lines.slice(0, maxLines);
                    for (const line of shown) {
                        ui.write(`${color}  ${line}${RESET}\n`);
                    }
                    if (lines.length > maxLines) {
                        ui.write(`${color}  ... ${lines.length - maxLines} more lines${RESET}\n`);
                    }
                }
            }
            if (event.stderr) {
                ui.write(`${RED}  ${event.stderr.trim()}${RESET}\n`);
            }

            // Claude processes the result next
            spinner.start("thinking");
        }

        // RESULT ----------------------------------------------------------- /
        if (event.type === "result") {
            spinner.stop();
            if (event.isError && !killed) {
                process.stderr.write(`Error: ${event.result || "unknown"}\n`);
                process.exit(1);
            }
            // Print result text if we haven't streamed content yet
            if (!streamedText && event.result && !killed) {
                process.stdout.write(event.result);
                responseText = event.result;
            }
        }
    };

    // In ask mode, we bypass the backend's permission system (which can only
    // deny in -p mode) and handle permissions ourselves via pause/resume.
    // Non-agentLoop backends (completions etc.) need a system prompt —
    // agentLoop backends (claude -p) supply their own.
    // Config: "default" → TOOL_SYSTEM_PROMPT, "none" → no prompt, anything else → custom.
    // Resolve system prompt: file reference → file content, inline text → as-is
    const rawPrompt = opts.systemPrompt;
    const promptFile = rawPrompt && rawPrompt !== "default"
        ? await resolvePromptFile(rawPrompt) : null;
    const resolvedPrompt = promptFile ? promptFile.content : rawPrompt;
    const systemPrompt = bridge.info.capabilities.agentLoop ? undefined
        : resolvedPrompt === "default" ? TOOL_SYSTEM_PROMPT
        : resolvedPrompt || undefined;

    const bridgeResult = await bridge.run(
        {
            prompt,
            model,
            systemPrompt,
            sessionId: sessionId || undefined,
            timeout: opts.timeout ? opts.timeout * 1000 : undefined,
            options: {
                effort,
                perms: (isAskMode || isConfirmMode) ? "auto" : effectivePerms,
                tools,
                url: url || undefined,
                apiKey: apiKey || undefined,
                clusterId: clusterId || undefined,
            },
        },
        onEvent,
    );

    spinner.stop();

    // Don't error on intentional kill
    if (!killed && bridgeResult.isError && !streamedText) {
        process.stderr.write(bridgeResult.errorText || "Backend error\n");
        process.exit(1);
    }

    process.stdout.write("\n");
    return {
        sessionId: bridgeResult.sessionId,
        approvedTools,
        killed,
        usage: bridgeResult.usage,
        durationMs: bridgeResult.durationMs,
        numTurns: bridgeResult.numTurns,
        responseText,
    };
}


// Main --------------------------------------------------------------------- /
// another giga beast the main argument parsing function
export async function main() {
    // Argument parsing, remove first two: `bun run.ts`
    const argv = process.argv.slice(2);
    // prompt becomes everything else, args[2]=text arg[3]=of arg[4]=prompt
    // join on space to get "text of prompt" together
    // maybe we rename prompt because, its not just a text prompt, its commands
    let prompt = argv.join(" ");

    // a bit of UX magic mode
    // does cat a | ? prompt 'a'
    // Piped stdin: `cat file | ? analyze this` or `echo data | ,`
    // this flag tells you if the process is connected a terminal or a pipe/file
    // true = terminal, false = pipe. so it's, if not terminal, we have a pipe
    if (!process.stdin.isTTY) {
        const piped = (await new Response(process.stdin).text()).trim();
        if (piped) {
            prompt = prompt ? `${prompt}\n\n${piped}` : piped;
        }
    // if user is terminal cause above is true
    // then if no prompt we go into interactive mode
    // (no pipe, no args), safe from shell expansion
    } else if (!prompt) {
        process.stdout.write(`${DIM}interactive mode: ctrl+d to send${RESET}\n> `);
        prompt = (await new Response(process.stdin).text()).trim();
    }
    
    // if pipe stdin but empty pipe + no arguments - echo "" | ? or
    // interactive mode and the prompt is empty
    if (!prompt) {
        const pfx = (await loadJSON<{ prefix?: string }>(GLOBAL_CONFIG_FILE, {})).prefix || CONFIG_DEFAULTS.prefix;
        console.log(`Usage: ${pfx} <prompt>    (or /help for commands)`);
        process.exit(0);
    }

    // Load config and backend
    const cfg = await loadConfig();
    console.assert(cfg.backend, "loadConfig must provide a backend");
    console.assert(cfg.model, "loadConfig must provide a model");
    const bridge = new Bridge(getBackend(cfg.backend, { protocol: cfg.protocol }));

    // Slash command dispatch - src/commands.ts
    // this is where we handle the command chaining
    if (prompt.startsWith("/")) {
        const result = await handleSlashCommand(prompt, bridge);
        if (result === true) process.exit(0);
        prompt = result;
    }

    // seperator ---------

    // now that we have processed the prompting part we can build the llm call
    const shellOpts: RunShellOpts = { 
        prompt,
        model:          cfg.model,
        effort:         cfg.effort,
        perms:          cfg.perms,
        tools:          cfg.tools,
        output:         cfg.output,
        timeout:        cfg.timeout, 
        systemPrompt:   cfg.systemPrompt, 
        url:            cfg.url, 
        apiKey:         cfg.apiKey, 
        clusterId:      cfg.clusterId, 
        bridge 
    };

    // Session init: detect backend/session mismatch from backend switches.
    // claude-code needs UUID sessions; completions/responses use conv-* IDs.
    // some flags
    const isClaudeBackend = cfg.backend === "claude-code";
    const isFresh = cfg.session === "fresh";
    let sessionId = isFresh ? null : await loadSession();
    // on existing session
    if (sessionId && !isFresh) {
        // CC expects UUID
        const mismatch = isUUID(sessionId) != isClaudeBackend; 
        // if we are CC then we need sessionId to be a UUID otherwise no
        // just look at this absolutely dogwater code you get from LLM hahaha
        // backwarsd double negative ternary assignemnt
        //const mismatch = isClaudeBackend ? !isUUID(sessionId) : isUUID(sessionId);
        if (mismatch) {
            // Auto-recover: find the most recent session for the current backend
            const discovered = isClaudeBackend
                // omg the sessions vs conversations jesus is rizzen save me
                ? await discoverSessions(1)
                : await discoverConversations(1);
            // top one?
            const best = discovered.sessions[0];
            // huh, im so confused, this whole mismatch block, 
            // were having issues
            // i mena makes sesnse to have diff CC and Giverny message history
            // Message History is what sessions/conversations are
            // would be best to figure out how to do proper CC <-> Giverny integration
            if (best) {
                sessionId = best.id;
                await saveSession(best.id);
            } else {
                sessionId = null;
                await clearSession();
            }
        }
    }

    // src/state.ts
    let approvedTools = await loadApproved();

    // responseText key, local interface for printing
    let result: ShellResult;
    
    // the core data transformation starts here
    // we process and back the prompt, then hand it off
    try {
        result = await runShell(shellOpts, sessionId, approvedTools);
    } catch (e: any) {
        // If resume failed, retry without session
        // as in resume session
        if (sessionId && e.message?.includes("error")) {
            await clearSession();
            result = await runShell(shellOpts, null, new Set());
        } else {
            process.stderr.write(`Error: ${e.message}\n`);
            process.exit(1);
        }
    }

    // another source of pain
    // what if we did tree sessions as our core?
    // Always preserve session and approved tools, denying one tool call
    // shouldn't destroy context. Null checks protect against partial state.
    if (!isFresh && result.sessionId) {
        await saveSession(result.sessionId);
    }
    if (result.approvedTools.size > 0) await saveApproved(result.approvedTools);

    if (!result.killed) {
        // Append to transcript (skip on kill, response may be mid-sentence)
        if (result.responseText) {
            const { appendFileSync } = await import("fs");
            mkdirSync(GIVERNY_DIR, { recursive: true });
            appendFileSync(TRANSCRIPT_FILE, `<|user|>\n${prompt}\n<|end|>\n<|assistant|>\n${result.responseText.trim()}\n<|end|>\n`);
        }

        // Accumulate session usage
        if (result.usage) {
            const prev = await loadUsage();
            await saveUsage({
                input_tokens: prev.input_tokens + result.usage.input_tokens,
                output_tokens: prev.output_tokens + result.usage.output_tokens,
                turns: prev.turns + result.numTurns,
                duration_ms: prev.duration_ms + (result.durationMs || 0),
            });
        }
    }

    process.stdout.write("\n");
}

if (import.meta.main) main();
