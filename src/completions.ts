// completions.ts
/*
* Completions Backend
*
* Implements the Backend interface for any server exposing a
* /v1/chat/completions endpoint (llama.cpp, ollama, vllm,
* OpenRouter, etc.).
*
* This is a single-turn completion primitive. The agent loop
* (tool call → execute → re-prompt) lives in Bridge (bridge-loop.ts).
*/

import type {
    Backend,
    BackendInfo,
    GenerateOptions,
    GenerateResult,
    BridgeEvent,
    AbortControl,
} from "./backend";
import { TOOL_SCHEMAS } from "./tools";
import {
    getBaseUrl,
    buildAuthHeaders,
    buildBlocksFromAccumulated,
    checkEndpointStatus,
    createCachedInfoGetter,
} from "./backend-utils";

// Build OpenAI-format messages from GenerateOptions
function buildMessages(opts: GenerateOptions): any[] {
    const messages: any[] = [];
    if (opts.systemPrompt) {
        messages.push({ role: "system", content: opts.systemPrompt });
    }
    messages.push({ role: "user", content: opts.prompt });
    return messages;
}

// Parse an SSE data line into content delta and tool call fragments.
// Content is extracted BEFORE checking finish_reason so the last chunk's
// delta isn't silently dropped.
function parseSSEChunk(data: string): {
    text?: string;
    toolCalls?: Array<{ index: number; id?: string; name?: string; arguments?: string }>;
    finishReason?: string;
    done: boolean;
} {
    if (data === "[DONE]") return { done: true };

    try {
        const json = JSON.parse(data);
        const choice = json.choices?.[0];
        if (!choice) return { done: false };

        const delta = choice.delta;
        const result: ReturnType<typeof parseSSEChunk> = {
            done: !!choice.finish_reason,
        };
        if (choice.finish_reason) result.finishReason = choice.finish_reason;

        if (delta?.content) {
            result.text = delta.content;
        }

        if (delta?.tool_calls) {
            result.toolCalls = delta.tool_calls.map((tc: any) => ({
                index: tc.index ?? 0,
                id: tc.id,
                name: tc.function?.name,
                arguments: tc.function?.arguments,
            }));
        }

        return result;
    } catch {
        return { done: false };
    }
}

// Streaming generate — single completion turn
async function generate(
    opts: GenerateOptions,
    onEvent: (event: BridgeEvent, control: AbortControl) => void,
): Promise<GenerateResult> {
    const baseUrl = getBaseUrl(opts.options);
    const abortController = new AbortController();

    const control: AbortControl = {
        abort: () => abortController.abort(),
    };

    // Build request — messages come from Bridge's tool loop,
    // which passes accumulated conversation as the prompt for multi-turn.
    // For first turn, it's just the user's prompt.
    const messages = opts.options?._messages || buildMessages(opts);
    const extra = opts.options || {};

    const body: any = {
        messages,
        stream: true,
        tools: TOOL_SCHEMAS,
    };

    if (opts.model && opts.model !== "local") body.model = opts.model;
    if (extra.temperature !== undefined) body.temperature = extra.temperature;
    if (extra.top_p !== undefined) body.top_p = extra.top_p;

    let response: Response;
    try {
        const headers = { "Content-Type": "application/json", ...buildAuthHeaders(opts.options) };
        response = await fetch(`${baseUrl}/v1/chat/completions`, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            signal: abortController.signal,
        });
    } catch (e: any) {
        if (e.name === "AbortError") return { ok: true };
        return { ok: false, error: `completions connection failed: ${e.message}` };
    }

    if (!response.ok) {
        const text = await response.text().catch(() => "");
        return { ok: false, error: `completions ${response.status}: ${text}` };
    }

    // Parse SSE stream
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    // Accumulate streamed content
    let fullText = "";
    let finishReason: string | undefined;
    const toolCallAccum: Map<number, { id: string; name: string; arguments: string }> = new Map();

    let streamDone = false;

    // Safety valve: if server stops sending data without closing
    // the connection or sending [DONE], don't hang forever.
    const READ_TIMEOUT_MS = 30_000;

    try {
        while (!streamDone) {
            const readPromise = reader.read();
            let timeoutId: Timer;
            const timeout = new Promise<{ done: true; value: undefined }>(
                (resolve) => { timeoutId = setTimeout(() => resolve({ done: true, value: undefined }), READ_TIMEOUT_MS); },
            );
            const { done, value } = await Promise.race([readPromise, timeout]);
            clearTimeout(timeoutId!);
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
                if (!line.startsWith("data: ")) continue;
                const data = line.slice(6).trim();
                if (!data) continue;

                const chunk = parseSSEChunk(data);

                // Accumulate content BEFORE checking done — the final chunk
                // can carry both finish_reason and a content delta.
                if (chunk.text) {
                    fullText += chunk.text;
                }

                if (chunk.toolCalls) {
                    for (const tc of chunk.toolCalls) {
                        const existing = toolCallAccum.get(tc.index);
                        if (existing) {
                            if (tc.arguments) existing.arguments += tc.arguments;
                        } else {
                            toolCallAccum.set(tc.index, {
                                id: tc.id || `call_${tc.index}`,
                                name: tc.name || "",
                                arguments: tc.arguments || "",
                            });
                        }
                    }
                }

                if (chunk.done) {
                    finishReason = chunk.finishReason;
                    streamDone = true;
                    break;
                }
            }
        }
    } catch (e: any) {
        if (e.name === "AbortError") return { ok: true };
        return { ok: false, error: `completions stream error: ${e.message}` };
    } finally {
        reader.releaseLock();
    }

    // Build blocks from accumulated content
    const blocks = buildBlocksFromAccumulated(fullText, toolCallAccum);

    // Emit assistant event with all blocks
    if (blocks.length > 0) {
        onEvent({ type: "assistant", blocks }, control);
    }

    return { ok: true };
}

// Backend export

const baseInfo: BackendInfo = {
    name: "completions",
    models: [
        { id: "local", contextWindow: 0, description: "completions model" },
    ],
    capabilities: {
        agentLoop: false,
        sessions: true,
        streaming: true,
    },
};

const getInfo = createCachedInfoGetter(baseInfo, "completions model");

export const completionsBackend: Backend = {
    get info(): BackendInfo { return getInfo(); },
    generate,
    checkStatus: checkEndpointStatus,
};
