// responses.ts
/*
* Responses Backend
*
* Implements the Backend interface for any server exposing a
* /v1/responses endpoint (OpenAI, OpenRouter, etc.).
*
* Like completions.ts, this is a single-turn completion primitive.
* The agent loop lives in Bridge (bridge-loop.ts).
*
* Key difference from completions: uses the responses API format
* with named SSE events (event: response.output_text.delta)
* instead of bare data: lines.
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

// Flatten OpenAI chat/completions tool format to responses format
// {type: "function", function: {name, description, parameters}}
// → {type: "function", name, description, parameters}
function flattenToolSchemas(tools: any[]): any[] {
    return tools.map(t => {
        if (t.function) {
            return {
                type: "function",
                name: t.function.name,
                description: t.function.description,
                parameters: t.function.parameters,
            };
        }
        return t;
    });
}

// Convert chat/completions message format to responses API input format.
// The bridge tool loop builds messages as:
//   {role: "assistant", content, tool_calls: [{id, type, function: {name, arguments}}]}
//   {role: "tool", tool_call_id, content}
// Convert chat/completions messages to responses API input format.
// Two flavors because implementations disagree:
//   "spec"     — OpenAI spec: {role, content: "string"} (actual.inc, OpenAI, OpenRouter)
//   "extended" — llama.cpp:   {type: "message", role, content: [{type: "output_text", text}]}
export function convertToResponsesInput(messages: any[], flavor: "spec" | "extended" = "spec"): any[] {
    const input: any[] = [];

    for (const msg of messages) {
        if (msg.role === "system") continue;

        if (msg.role === "assistant" && msg.tool_calls?.length) {
            if (msg.content) {
                input.push(flavor === "extended"
                    ? { type: "message", role: "assistant", content: [{ type: "output_text", text: msg.content }] }
                    : { role: "assistant", content: msg.content });
            }
            for (const tc of msg.tool_calls) {
                input.push({
                    type: "function_call",
                    call_id: tc.id,
                    name: tc.function?.name || tc.name,
                    arguments: typeof tc.function?.arguments === "string"
                        ? tc.function.arguments
                        : JSON.stringify(tc.function?.arguments || {}),
                });
            }
        } else if (msg.role === "tool") {
            input.push({
                type: "function_call_output",
                call_id: msg.tool_call_id,
                output: msg.content || "",
            });
        } else if (flavor === "extended" && msg.role === "assistant") {
            input.push({
                type: "message", role: "assistant",
                content: [{ type: "output_text", text: msg.content || "" }],
            });
        } else if (flavor === "extended") {
            // user messages with type wrapper
            input.push({ type: "message", role: msg.role, content: msg.content });
        } else {
            // spec: plain {role, content} for user and assistant
            input.push({ role: msg.role, content: msg.content });
        }
    }

    return input;
}

// Detect flavor from URL — actual.inc and known cloud APIs use strict spec,
// local servers (llama.cpp, ollama) use the extended format.
function detectFlavor(baseUrl: string): "spec" | "extended" {
    if (/actual\.inc|openai\.com|openrouter\.ai/i.test(baseUrl)) return "spec";
    return "extended";
}

// Build responses-format request body from GenerateOptions
function buildRequestBody(opts: GenerateOptions): any {
    const extra = opts.options || {};
    const baseUrl = getBaseUrl(extra);
    const flavor = detectFlavor(baseUrl);
    const body: any = {
        stream: true,
        tools: flattenToolSchemas(TOOL_SCHEMAS),
    };

    // Bridge tool loop passes accumulated messages via _messages
    if (extra._messages) {
        body.input = convertToResponsesInput(extra._messages, flavor);
        // Extract system/instructions from messages
        const sys = extra._messages
            .filter((m: any) => m.role === "system")
            .map((m: any) => m.content)
            .join("\n\n");
        if (sys) body.instructions = sys;
    } else {
        body.input = opts.prompt;
        if (opts.systemPrompt) body.instructions = opts.systemPrompt;
    }

    if (opts.model && opts.model !== "local") body.model = opts.model;
    if (extra.temperature !== undefined) body.temperature = extra.temperature;
    if (extra.top_p !== undefined) body.top_p = extra.top_p;

    return body;
}

// Parse named SSE events from the responses API stream.
// Returns the event type and parsed data, or null for non-data lines.
export function parseResponsesSSE(eventType: string, data: string): {
    text?: string;
    toolCall?: { id: string; name: string; argumentsDelta?: string; argumentsDone?: string };
    completed: boolean;
} {
    if (!eventType || !data) return { completed: false };

    try {
        const json = JSON.parse(data);

        switch (eventType) {
            case "response.output_text.delta":
                return { text: json.delta, completed: false };

            case "response.output_item.added":
                if (json.item?.type === "function_call") {
                    return {
                        toolCall: {
                            id: json.item.call_id || json.item.id,
                            name: json.item.name,
                        },
                        completed: false,
                    };
                }
                return { completed: false };

            case "response.function_call_arguments.delta":
                return {
                    toolCall: {
                        id: json.item_id,
                        name: "",
                        argumentsDelta: json.delta,
                    },
                    completed: false,
                };

            case "response.function_call_arguments.done":
                return {
                    toolCall: {
                        id: json.item_id,
                        name: json.name || "",
                        argumentsDone: json.arguments,
                    },
                    completed: false,
                };

            case "response.completed":
                return { completed: true };

            case "response.failed":
                return { completed: true };

            default:
                return { completed: false };
        }
    } catch {
        return { completed: false };
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

    const body = buildRequestBody(opts);

    let response: Response;
    try {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
        if (clusterId) headers["X-Cluster-ID"] = clusterId;
        response = await fetch(`${baseUrl}/v1/responses`, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            signal: abortController.signal,
        });
    } catch (e: any) {
        if (e.name === "AbortError") return { ok: true };
        return { ok: false, error: `responses connection failed: ${e.message}` };
    }

    if (!response.ok) {
        const text = await response.text().catch(() => "");
        return { ok: false, error: `responses ${response.status}: ${text}` };
    }

    // Parse named SSE stream
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    // Accumulate streamed content
    let fullText = "";
    const toolCallAccum: Map<string, { id: string; name: string; arguments: string }> = new Map();
    let streamDone = false;

    // Safety valve
    const READ_TIMEOUT_MS = 30_000;

    try {
        let currentEvent = "";

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
                // Named SSE: event: <type>
                if (line.startsWith("event: ")) {
                    currentEvent = line.slice(7).trim();
                    continue;
                }

                // Data line
                if (line.startsWith("data: ")) {
                    const data = line.slice(6).trim();
                    if (!data || !currentEvent) continue;

                    const parsed = parseResponsesSSE(currentEvent, data);
                    currentEvent = "";

                    if (parsed.text) {
                        fullText += parsed.text;
                    }

                    if (parsed.toolCall) {
                        const tc = parsed.toolCall;
                        if (tc.argumentsDone !== undefined) {
                            // Final arguments — overwrite any accumulated deltas
                            const existing = toolCallAccum.get(tc.id);
                            if (existing) {
                                existing.arguments = tc.argumentsDone;
                                if (tc.name) existing.name = tc.name;
                            }
                        } else if (tc.argumentsDelta !== undefined) {
                            // Argument chunk — accumulate
                            const existing = toolCallAccum.get(tc.id);
                            if (existing) {
                                existing.arguments += tc.argumentsDelta;
                            }
                        } else if (tc.name) {
                            // New tool call (from output_item.added)
                            toolCallAccum.set(tc.id, {
                                id: tc.id,
                                name: tc.name,
                                arguments: "",
                            });
                        }
                    }

                    if (parsed.completed) {
                        streamDone = true;
                        break;
                    }
                }

                // Empty line resets event (SSE block boundary)
                if (line.trim() === "") {
                    currentEvent = "";
                }
            }
        }
    } catch (e: any) {
        if (e.name === "AbortError") return { ok: true };
        return { ok: false, error: `responses stream error: ${e.message}` };
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
            let prose = fullText;
            for (const cmd of codeBlocks) {
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

// Backend export

const baseInfo: BackendInfo = {
    name: "responses",
    models: [
        { id: "local", contextWindow: 0, description: "responses model" },
    ],
    capabilities: {
        agentLoop: false,
        sessions: true,
        streaming: true,
    },
};

let cachedInfo: BackendInfo | null = null;

async function probeModels(baseUrl: string): Promise<BackendInfo> {
    try {
        const res = await fetch(`${baseUrl}/v1/models`);
        if (res.ok) {
            const data = await res.json() as any;
            const models = (data?.data || []).map((m: any) => ({
                id: m.id || "local",
                contextWindow: m.meta?.n_ctx_train || m.max_model_len || m.context_length || 0,
                description: m.id || "responses model",
            }));
            if (models.length > 0) return { ...baseInfo, models };
        }
    } catch {}
    return baseInfo;
}

export const responsesBackend: Backend = {
    get info(): BackendInfo {
        if (!cachedInfo) {
            const baseUrl = process.env.COMPLETIONS_URL || DEFAULT_URL;
            probeModels(baseUrl).then(i => { cachedInfo = i; });
            return baseInfo;
        }
        return cachedInfo;
    },
    generate,
    checkStatus,
};

// Exported for testing
export { parseResponsesSSE as _parseResponsesSSE, flattenToolSchemas as _flattenToolSchemas, buildRequestBody as _buildRequestBody, convertToResponsesInput as _convertToResponsesInput, detectFlavor as _detectFlavor };
