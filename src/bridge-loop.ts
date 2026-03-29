// bridge-loop.ts
/*
* Bridge — agent loop dispatcher.
*
* Wraps any Backend into a consumer-friendly API. Shell and server
* talk to Bridge, never to Backend directly.
*
* For agentLoop backends (Claude Code): single generate() call,
* events pass through, pause/resume map to backend signals.
*
* For non-agentLoop backends (future): Bridge runs the tool
* execution loop itself.
*/

import { log } from "./config";
import {
    isProcessControl,
    type Backend,
    type BackendInfo,
    type BridgeEvent,
    type BridgeResult,
    type RunControl,
    type GenerateOptions,
    type ResultEvent,
    type ToolUseBlock,
    type ContentBlock,
} from "./backend";
import { executeTool } from "./tools";

export interface RunOptions {
    prompt: string;
    model?: string;
    systemPrompt?: string;
    sessionId?: string;
    timeout?: number;
    cwd?: string;
    options?: Record<string, any>;
}

export class Bridge {
    constructor(public readonly backend: Backend) {}

    get info(): BackendInfo { return this.backend.info; }

    // Streaming — used by shell
    async run(
        opts: RunOptions,
        onEvent: (event: BridgeEvent, control: RunControl) => void,
    ): Promise<BridgeResult> {
        if (this.backend.info.capabilities.agentLoop) {
            return this.runWithAgentLoop(opts, onEvent);
        }
        return this.runWithToolLoop(opts, onEvent);
    }

    // Collected — used by server
    async collect(opts: RunOptions): Promise<BridgeResult> {
        const result = await this.run(opts, () => {});

        if (result.isError) {
            throw new Error(result.errorText || "Backend error");
        }

        if (result.numTurns > 1) {
            let msg = `⚠ ${result.numTurns} internal turns`;
            if (result.toolUseBlocks.length > 0) msg += " (intercepted tool_use from turn 1)";
            log(msg);
        }

        return result;
    }

    // agentLoop:false path — Bridge owns the tool execution loop.
    // Backend is a single-turn completion primitive. Bridge calls generate(),
    // executes tool calls, appends results to messages, repeats.
    private async runWithToolLoop(
        opts: RunOptions,
        onEvent: (event: BridgeEvent, control: RunControl) => void,
    ): Promise<BridgeResult> {
        const MAX_ITERATIONS = 20;
        const startTime = Date.now();
        let aborted = false;
        let numTurns = 0;

        const runControl: RunControl = {
            abort: () => { aborted = true; },
        };

        // Build initial message history
        const messages: any[] = [];
        if (opts.systemPrompt) {
            messages.push({ role: "system", content: opts.systemPrompt });
        }
        messages.push({ role: "user", content: opts.prompt });

        let finalText = "";
        const allToolUseBlocks: ToolUseBlock[] = [];

        for (let i = 0; i < MAX_ITERATIONS; i++) {
            if (aborted) break;
            numTurns++;

            // Collect blocks from this generate() call
            const turnBlocks: ContentBlock[] = [];

            const genResult = await this.backend.generate(
                {
                    ...opts,
                    // Pass accumulated messages via options for multi-turn
                    options: { ...opts.options, _messages: messages },
                },
                (event, control) => {
                    if (event.type === "assistant") {
                        for (const block of event.blocks) {
                            turnBlocks.push(block);
                        }
                    }
                },
            );

            if (!genResult.ok) {
                return {
                    text: "", toolUseBlocks: [], sessionId: null,
                    durationMs: Date.now() - startTime, numTurns,
                    usage: null, isError: true,
                    errorText: genResult.error || "Backend generate failed",
                };
            }

            // Separate text and tool_use blocks
            let turnText = "";
            const turnToolCalls: ToolUseBlock[] = [];
            for (const block of turnBlocks) {
                if (block.type === "text") turnText += block.text;
                if (block.type === "tool_use") turnToolCalls.push(block);
            }

            // No tool calls — we're done
            if (turnToolCalls.length === 0) {
                finalText = turnText;
                // Emit final assistant event for the shell to display
                if (turnBlocks.length > 0) {
                    onEvent({ type: "assistant", blocks: turnBlocks }, runControl);
                }
                break;
            }

            // Has tool calls — emit assistant event, execute, loop
            onEvent({ type: "assistant", blocks: turnBlocks }, runControl);
            if (aborted) break;

            // Append assistant message to history
            for (const tc of turnToolCalls) allToolUseBlocks.push(tc);
            messages.push({
                role: "assistant",
                content: turnText || null,
                tool_calls: turnToolCalls.map(tc => ({
                    id: tc.id || `call_${Date.now()}`,
                    type: "function",
                    function: { name: tc.name, arguments: JSON.stringify(tc.input) },
                })),
            });

            // Execute each tool call
            for (const tc of turnToolCalls) {
                if (aborted) break;

                const result = await executeTool(tc.name, tc.input, opts.cwd);

                // Emit tool result for shell to display
                onEvent({
                    type: "tool_result",
                    toolUseId: tc.id || "",
                    content: result.stdout || result.stderr,
                    stdout: result.stdout,
                    stderr: result.stderr,
                    isError: result.isError,
                }, runControl);

                // Append tool result to message history
                messages.push({
                    role: "tool",
                    tool_call_id: tc.id || `call_${Date.now()}`,
                    content: result.stdout + (result.stderr ? `\nSTDERR: ${result.stderr}` : ""),
                });
            }
        }

        // Emit synthetic result event
        const durationMs = Date.now() - startTime;
        onEvent({
            type: "result",
            sessionId: null,
            isError: false,
            result: finalText,
            numTurns,
            durationMs,
            usage: null,
            permissionDenials: [],
        }, runControl);

        return {
            text: finalText,
            toolUseBlocks: allToolUseBlocks,
            sessionId: null,
            durationMs,
            numTurns,
            usage: null,
            isError: false,
            errorText: null,
        };
    }

    // agentLoop:true path — single generate() call, events pass through
    private async runWithAgentLoop(
        opts: RunOptions,
        onEvent: (event: BridgeEvent, control: RunControl) => void,
    ): Promise<BridgeResult> {
        let resultEvent: ResultEvent | null = null;
        let text = "";
        const toolUseBlocks: ToolUseBlock[] = [];
        let firstAssistantSeen = false;

        const genOpts: GenerateOptions = {
            prompt: opts.prompt,
            model: opts.model,
            systemPrompt: opts.systemPrompt,
            sessionId: opts.sessionId,
            timeout: opts.timeout,
            cwd: opts.cwd,
            options: opts.options,
        };

        const genResult = await this.backend.generate(genOpts, (event, control) => {
            // Build RunControl from backend's AbortControl.
            // ProcessControl backends (agentLoop) provide pause/resume.
            const proc = isProcessControl(control);
            const runControl: RunControl = {
                abort: () => control.abort(),
                pause: proc ? () => control.pause() : undefined,
                resume: proc ? () => control.resume() : undefined,
            };

            onEvent(event, runControl);

            // Collect state for BridgeResult
            if (event.type === "assistant" && !firstAssistantSeen) {
                firstAssistantSeen = true;
                for (const block of event.blocks) {
                    if (block.type === "text") text += block.text;
                    if (block.type === "tool_use") toolUseBlocks.push(block);
                }
            }
            if (event.type === "result") {
                resultEvent = event;
            }
        });

        if (!resultEvent) {
            if (!genResult.ok) {
                return {
                    text: "",
                    toolUseBlocks: [],
                    sessionId: null,
                    durationMs: null,
                    numTurns: 0,
                    usage: null,
                    isError: true,
                    errorText: genResult.error || "Backend generate failed",
                };
            }
            return {
                text: "",
                toolUseBlocks: [],
                sessionId: null,
                durationMs: null,
                numTurns: 0,
                usage: null,
                isError: true,
                errorText: "No result event from backend",
            };
        }

        const r = resultEvent as ResultEvent;

        return {
            text: toolUseBlocks.length > 0 ? text : (r.result || ""),
            toolUseBlocks,
            sessionId: r.sessionId,
            durationMs: r.durationMs,
            numTurns: r.numTurns,
            usage: r.usage,
            isError: r.isError,
            errorText: r.isError ? r.result : null,
        };
    }
}
