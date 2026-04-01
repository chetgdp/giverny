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
    ContentBlock,
} from "./backend";
import { TOOL_SCHEMAS } from "./tools";

// Extract shell commands from fenced code blocks (```bash / ```sh / ```)
function extractCodeBlocks(text: string): string[] {
    const re = /```(?:bash|sh|shell)\n([\s\S]*?)```/g;
    const commands: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        const cmd = m[1].trim();
        if (cmd) commands.push(cmd);
    }
    return commands;
}

const DEFAULT_URL = "http://localhost:8080";

function getBaseUrl(opts?: Record<string, any>): string {
    return opts?.url || process.env.COMPLETIONS_URL || DEFAULT_URL;
}

function getApiKey(opts?: Record<string, any>): string {
    return opts?.apiKey || process.env.COMPLETIONS_API_KEY || "";
}

function getClusterId(opts?: Record<string, any>): string {
    return opts?.clusterId || process.env.COMPLETIONS_CLUSTER_ID || "";
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
    const apiKey = getApiKey(opts.options);
    const clusterId = getClusterId(opts.options);
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
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
        if (clusterId) headers["X-Cluster-ID"] = clusterId;
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
    const blocks: ContentBlock[] = [];

    // Fallback: if model didn't use function calling but wrote code blocks,
    // extract them as exec tool calls. Many local models do this.
    if (fullText && toolCallAccum.size === 0) {
        const codeBlocks = extractCodeBlocks(fullText);
        if (codeBlocks.length > 0) {
            // Strip code blocks from the text to get surrounding prose
            let prose = fullText;
            for (const cmd of codeBlocks) {
                // Remove the fenced block that contained this command
                prose = prose.replace(/```(?:bash|sh|shell)?\n[^`]*```/s, "");
            }
            prose = prose.trim();
            if (prose) blocks.push({ type: "text", text: prose });

            for (let i = 0; i < codeBlocks.length; i++) {
                blocks.push({
                    type: "tool_use",
                    id: `call_fb_${Date.now()}_${i}`,
                    name: "exec",
                    input: { command: codeBlocks[i] },
                });
            }
        } else {
            blocks.push({ type: "text", text: fullText });
        }
    } else {
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
    }

    // Emit assistant event with all blocks
    if (blocks.length > 0) {
        onEvent({ type: "assistant", blocks }, control);
    }

    return { ok: true };
}

// Status check — verify server is running
async function checkStatus(opts?: Record<string, any>): Promise<Record<string, string>> {
    const baseUrl = getBaseUrl(opts);
    const apiKey = getApiKey(opts);
    const clusterId = getClusterId(opts);
    try {
        const headers: Record<string, string> = {};
        if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
        if (clusterId) headers["X-Cluster-ID"] = clusterId;
        const res = await fetch(`${baseUrl}/v1/models`, { headers });
        if (!res.ok) return { status: "error", url: baseUrl };
        const data = await res.json() as any;
        const m = data?.data?.[0];
        const model = m?.id || "unknown";
        const ctx = m?.meta?.n_ctx_train || m?.max_model_len || m?.context_length || 0;
        return { status: "running", url: baseUrl, model, context_length: ctx ? String(ctx) : "unknown" };
    } catch {
        return { status: "not running", url: baseUrl };
    }
}

// Probe server for model info — called once on first use
async function probeModels(baseUrl: string): Promise<BackendInfo> {
    try {
        const res = await fetch(`${baseUrl}/v1/models`);
        if (res.ok) {
            const data = await res.json() as any;
            const models = (data?.data || []).map((m: any) => ({
                id: m.id || "local",
                contextWindow: m.meta?.n_ctx_train || m.max_model_len || m.context_length || 0,
                description: m.id || "completions model",
            }));
            if (models.length > 0) return { ...baseInfo, models };
        }
    } catch {}
    return baseInfo;
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

let cachedInfo: BackendInfo | null = null;

export const completionsBackend: Backend = {
    get info(): BackendInfo {
        if (!cachedInfo) {
            // Kick off probe but return base info synchronously.
            // Next access will have the real info.
            const baseUrl = process.env.COMPLETIONS_URL || DEFAULT_URL;
            probeModels(baseUrl).then(i => { cachedInfo = i; });
            return baseInfo;
        }
        return cachedInfo;
    },
    generate,
    checkStatus,
};
