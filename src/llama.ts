// llama.ts
/*
* llama-server Backend
*
* Implements the Backend interface for llama.cpp's llama-server,
* which exposes an OpenAI-compatible /v1/chat/completions endpoint.
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
    ContentBlock,
} from "./backend";
import { TOOL_SCHEMAS } from "./tools";

const DEFAULT_URL = "http://localhost:8080";

function getBaseUrl(opts?: Record<string, any>): string {
    return opts?.url || process.env.LLAMA_URL || DEFAULT_URL;
}

// Build OpenAI-format messages from GenerateOptions
function buildMessages(opts: GenerateOptions): any[] {
    const messages: any[] = [];
    if (opts.systemPrompt) {
        messages.push({ role: "system", content: opts.systemPrompt });
    }
    messages.push({ role: "user", content: opts.prompt });
    return messages;
}

// Parse an SSE data line into content delta and tool call fragments
function parseSSEChunk(data: string): {
    text?: string;
    toolCalls?: Array<{ index: number; id?: string; name?: string; arguments?: string }>;
    done: boolean;
} {
    if (data === "[DONE]") return { done: true };

    try {
        const json = JSON.parse(data);
        const choice = json.choices?.[0];
        if (!choice) return { done: false };

        if (choice.finish_reason) return { done: true };

        const delta = choice.delta;
        if (!delta) return { done: false };

        const result: ReturnType<typeof parseSSEChunk> = { done: false };

        if (delta.content) {
            result.text = delta.content;
        }

        if (delta.tool_calls) {
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
        response = await fetch(`${baseUrl}/v1/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: abortController.signal,
        });
    } catch (e: any) {
        if (e.name === "AbortError") return { ok: true };
        return { ok: false, error: `llama-server connection failed: ${e.message}` };
    }

    if (!response.ok) {
        const text = await response.text().catch(() => "");
        return { ok: false, error: `llama-server ${response.status}: ${text}` };
    }

    // Parse SSE stream
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    // Accumulate streamed content
    let fullText = "";
    const toolCallAccum: Map<number, { id: string; name: string; arguments: string }> = new Map();

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
                if (!line.startsWith("data: ")) continue;
                const data = line.slice(6).trim();
                if (!data) continue;

                const chunk = parseSSEChunk(data);
                if (chunk.done) break;

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
            }
        }
    } catch (e: any) {
        if (e.name === "AbortError") return { ok: true };
        return { ok: false, error: `llama-server stream error: ${e.message}` };
    } finally {
        reader.releaseLock();
    }

    // Build blocks from accumulated content
    const blocks: ContentBlock[] = [];

    if (fullText) {
        blocks.push({ type: "text", text: fullText });
    }

    for (const [, tc] of toolCallAccum) {
        let input: Record<string, any> = {};
        try { input = JSON.parse(tc.arguments); } catch {}
        blocks.push({
            type: "tool_use",
            id: tc.id,
            name: tc.name,
            input,
        });
    }

    // Emit assistant event with all blocks
    if (blocks.length > 0) {
        onEvent({ type: "assistant", blocks }, control);
    }

    return { ok: true };
}

// Status check — verify llama-server is running
async function checkStatus(): Promise<Record<string, string>> {
    const baseUrl = process.env.LLAMA_URL || DEFAULT_URL;
    try {
        const res = await fetch(`${baseUrl}/v1/models`);
        if (!res.ok) return { status: "error", url: baseUrl };
        const data = await res.json() as any;
        const model = data?.data?.[0]?.id || "unknown";
        return { status: "running", url: baseUrl, model };
    } catch {
        return { status: "not running", url: baseUrl };
    }
}

// Probe llama-server for model info — called once on first use
async function probeModels(baseUrl: string): Promise<BackendInfo> {
    try {
        const res = await fetch(`${baseUrl}/v1/models`);
        if (res.ok) {
            const data = await res.json() as any;
            const models = (data?.data || []).map((m: any) => ({
                id: m.id || "local",
                contextWindow: m.context_length || 0,
                description: m.id || "llama-server model",
            }));
            if (models.length > 0) return { ...baseInfo, models };
        }
    } catch {}
    return baseInfo;
}

// Backend export

const baseInfo: BackendInfo = {
    name: "llama-server",
    models: [
        { id: "local", contextWindow: 0, description: "llama-server model" },
    ],
    capabilities: {
        agentLoop: false,
        sessions: false,
        streaming: true,
    },
};

let cachedInfo: BackendInfo | null = null;

export const llamaBackend: Backend = {
    get info(): BackendInfo {
        if (!cachedInfo) {
            // Kick off probe but return base info synchronously.
            // Next access will have the real info.
            const baseUrl = process.env.LLAMA_URL || DEFAULT_URL;
            probeModels(baseUrl).then(i => { cachedInfo = i; });
            return baseInfo;
        }
        return cachedInfo;
    },
    generate,
    checkStatus,
};
