// shell.ts
/*
* Giverny Shell Mode
*
* Wraps `claude -p` with native Claude Code tools enabled and persistent
* per-directory sessions. Streams output to the terminal with compact
* tool usage summaries.
*
* Usage: giverny <prompt>
*        giverny --tools "Read,Bash" <prompt>
*/

import { mkdirSync } from "fs";
import { CONFIG_DEFAULTS } from "./config";
import { getBackend } from "./backend";
import type { BridgeEvent, RunControl } from "./backend";
import { Bridge } from "./bridge-loop";
import { needsPermission, isDangerousCommand, summarizeTool, DIM, RED, ORANGE, SEA_GREEN, RESET, INV, PIPED, ui } from "./shell-utils";
import { promptPermission } from "./tui";
import { TOOL_SYSTEM_PROMPT } from "./tools";
import { loadJSON, loadConfig, loadSession, saveSession, clearSession, loadUsage, saveUsage, loadApproved, saveApproved, discoverSessions, discoverConversations, GIVERNY_DIR, GLOBAL_CONFIG_FILE, USAGE_FILE, TRANSCRIPT_FILE } from "./state";
import { createSpinner } from "./spinner";
import { handleSlashCommand } from "./commands";
export { handleSlashCommand };

const MAX_RESULT_LINES = 10;

// Claude invocation via bridge --------------------------------------------- /

export interface RunShellOpts {
    prompt: string;
    model: string;
    effort: string;
    perms: string;
    tools: string;
    output: string;
    timeout?: number;
    systemPrompt?: string;
    url?: string;
    apiKey?: string;
    clusterId?: string;
    bridge: Bridge;
}

interface ShellResult {
    sessionId: string | null;
    approvedTools: Set<string>;
    killed: boolean;
    usage: { input_tokens: number; output_tokens: number } | null;
    durationMs: number | null;
    numTurns: number;
    responseText: string;
}

export async function runShell(opts: RunShellOpts, sessionId: string | null, approvedTools: Set<string>, overridePerms?: string): Promise<ShellResult> {
    const { prompt, model, effort, perms, tools, output, url, apiKey, clusterId, bridge } = opts;
    const effectivePerms = overridePerms || perms;
    const isAskMode = effectivePerms === "ask";
    const isConfirmMode = effectivePerms === "confirm";
    let killed = false;

    const spinner = createSpinner({ effort });
    spinner.start("thinking");
    let streamedText = false;
    let responseText = "";
    const onEvent = (event: BridgeEvent, control: RunControl) => {
        if (killed) return;

        if (event.type === "assistant") {
            for (const block of event.blocks) {
                if (killed) return;
                if (block.type === "tool_use") {
                    spinner.stop();

                    // Ensure tool summary starts on its own line
                    if (streamedText && !responseText.endsWith("\n")) {
                        ui.write("\n");
                    }

                    {
                        const summary = summarizeTool(block.name, block.input);
                        ui.write(`${DIM}[${block.name}] ${summary}${RESET}\n`);

                        // Show diff preview for write operations
                        if (block.name === "Edit" && block.input.old_string != null) {
                            const oldLines = block.input.old_string.split("\n");
                            const newLines = (block.input.new_string || "").split("\n");
                            const maxLines = output === "verbose" ? Infinity : MAX_RESULT_LINES;
                            let count = 0;
                            for (const line of oldLines) {
                                if (count++ >= maxLines) break;
                                ui.write(`${RED}  - ${line}${RESET}\n`);
                            }
                            for (const line of newLines) {
                                if (count++ >= maxLines) break;
                                ui.write(`${SEA_GREEN}  + ${line}${RESET}\n`);
                            }
                            const total = oldLines.length + newLines.length;
                            if (total > maxLines) {
                                ui.write(`${DIM}  ... ${total - count} more lines${RESET}\n`);
                            }
                        } else if (block.name === "Write" && block.input.content != null) {
                            const lines = block.input.content.split("\n");
                            const maxLines = output === "verbose" ? Infinity : MAX_RESULT_LINES;
                            const shown = lines.slice(0, maxLines);
                            for (const line of shown) {
                                ui.write(`${SEA_GREEN}  + ${line}${RESET}\n`);
                            }
                            if (lines.length > maxLines) {
                                ui.write(`${DIM}  ... ${lines.length - maxLines} more lines${RESET}\n`);
                            }
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
                    const text = streamedText ? block.text : block.text.replace(/^\n+/, "");
                    process.stdout.write(text);
                    responseText += text;
                    streamedText = true;
                }
            }
        }

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
    const systemPrompt = bridge.info.capabilities.agentLoop ? undefined
        : opts.systemPrompt === "none" ? undefined
        : opts.systemPrompt && opts.systemPrompt !== "default" ? opts.systemPrompt
        : TOOL_SYSTEM_PROMPT;

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

export async function main() {
    // Argument parsing
    const argv = process.argv.slice(2);
    let prompt = argv.join(" ");

    // Piped stdin: `cat file | ? analyze this` or `echo data | ,`
    if (!process.stdin.isTTY) {
        const piped = (await new Response(process.stdin).text()).trim();
        if (piped) {
            prompt = prompt ? `${prompt}\n\n${piped}` : piped;
        }
    } else if (!prompt) {
        // Interactive mode (no pipe, no args) — safe from shell expansion
        process.stdout.write(`${DIM}interactive mode: ctrl+d to send${RESET}\n> `);
        prompt = (await new Response(process.stdin).text()).trim();
    }

    if (!prompt) {
        const pfx = (await loadJSON<{ prefix?: string }>(GLOBAL_CONFIG_FILE, {})).prefix || CONFIG_DEFAULTS.prefix;
        console.log(`Usage: ${pfx} <prompt>    (or /help for commands)`);
        process.exit(0);
    }

    // Load config and backend
    const cfg = await loadConfig();
    const bridge = new Bridge(getBackend(cfg.backend || "claude-code", { protocol: cfg.protocol }));

    // Slash command dispatch
    if (prompt.startsWith("/")) {
        const result = await handleSlashCommand(prompt, bridge);
        if (result === true) process.exit(0);
        prompt = result;
    }

    const model = cfg.model;
    const effort = cfg.effort;
    const perms = cfg.perms;
    const tools = cfg.tools;
    const output = cfg.output;
    const shellOpts: RunShellOpts = { prompt, model, effort, perms, tools, output, timeout: cfg.timeout, systemPrompt: cfg.systemPrompt, url: cfg.url, apiKey: cfg.apiKey, clusterId: cfg.clusterId, bridge };

    // Session init — detect backend/session mismatch from backend switches.
    // claude-code needs UUID sessions; completions/responses use conv-* IDs.
    const isClaudeBackend = (cfg.backend || "claude-code") === "claude-code";
    const isUUID = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    const isFresh = cfg.session === "fresh";
    let sessionId = isFresh ? null : await loadSession();
    if (sessionId && !isFresh) {
        const mismatch = isClaudeBackend ? !isUUID(sessionId) : isUUID(sessionId);
        if (mismatch) {
            // Auto-recover: find the most recent session for the current backend
            const discovered = isClaudeBackend
                ? await discoverSessions(1)
                : await discoverConversations(1);
            const best = discovered.sessions[0];
            if (best) {
                sessionId = best.id;
                await saveSession(best.id);
            } else {
                sessionId = null;
                await clearSession();
            }
        }
    }
    let approvedTools = await loadApproved();

    let result: ShellResult;
    try {
        result = await runShell(shellOpts, sessionId, approvedTools);
    } catch (e: any) {
        // If resume failed, retry without session
        if (sessionId && e.message?.includes("error")) {
            await clearSession();
            result = await runShell(shellOpts, null, new Set());
        } else {
            process.stderr.write(`Error: ${e.message}\n`);
            process.exit(1);
        }
    }

    // Always preserve session and approved tools — denying one tool call
    // shouldn't destroy context. Null checks protect against partial state.
    if (!isFresh && result.sessionId) {
        await saveSession(result.sessionId);
    }
    if (result.approvedTools.size > 0) await saveApproved(result.approvedTools);

    if (!result.killed) {
        // Append to transcript (skip on kill — response may be mid-sentence)
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
