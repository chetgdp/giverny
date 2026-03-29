// protocol.ts
/*
* OpenAI protocol helperspure functions for converting between
* OpenAI chat/completions format and Claude's native format.
*
* Extracted from server.ts so they can be tested without starting the HTTP server.
*/

import { type ToolUseBlock } from "./backend";

// Response types ---------------------------------------------------------- /

export interface ParsedResponse {
    content: string | null;
    tool_calls?: ToolCall[];
    finish_reason: "stop" | "tool_calls";
}

export interface ToolCall {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
}

// Session key ------------------------------------------------------------- /
// Hash system prompt + tool names to identify a conversation

export function sessionKey(messages: any[], tools?: any[]): string {
    const sys = messages
        .filter((m: any) => m.role === "system")
        .map((m: any) => m.content)
        .join("");
    const toolNames = (tools || [])
        .map((t: any) => (t.function || t).name)
        .sort()
        .join(",");
    return Bun.hash(sys + toolNames).toString(36);
}

// System prompt builder ---------------------------------------------------- /
// injects Hermes tool defs so Claude knows what's available

export function buildSystemPrompt(messages: any[], tools?: any[]): string {
    const systemContent = messages
        .filter((m: any) => m.role === "system")
        .map((m: any) => m.content)
        .join("\n\n");

    let prompt = "";

    if (tools?.length) {
        prompt += `# Tool System

You have ${tools.length} tools available via an external runtime. When you call a tool, the runtime executes it and returns results. All tools listed below are fully connected and operational.

Use tools freely whenever a task requires them. Do not refuse or claim tools are unavailable.

If no tools are needed, respond normally with complete answers.

# Available Tools

`;

        for (const tool of tools) {
            const fn = tool.function || tool;
            prompt += `## ${fn.name}\n`;
            if (fn.description) prompt += `${fn.description}\n`;
            if (fn.parameters?.properties) {
                prompt += "Parameters:\n";
                for (const [name, schema] of Object.entries(
                    fn.parameters.properties,
                ) as any) {
                    const req = fn.parameters.required?.includes(name)
                        ? " (required)"
                        : "";
                    prompt += `  - ${name}: ${schema.type || "any"}${req}`;
                    if (schema.description) prompt += `${schema.description}`;
                    prompt += "\n";
                }
            }
            prompt += "\n";
        }

        prompt += "---\n\n";
    }

    prompt += systemContent || "You are a helpful AI assistant.";

    return prompt;
}

// Conversation formatter --------------------------------------------------- /
// turns OpenAI messages into a text prompt

export function formatMessages(messages: any[]): string {
    const parts: string[] = [];

    for (const msg of messages) {
        switch (msg.role) {
            case "system":
                break;
            case "user": {
                const content =
                    typeof msg.content === "string"
                        ? msg.content
                        : JSON.stringify(msg.content);
                parts.push(`H: ${content}`);
                break;
            }
            case "assistant": {
                let text = msg.content || "";
                if (msg.tool_calls?.length) {
                    for (const tc of msg.tool_calls) {
                        let args: any;
                        try {
                            args =
                                typeof tc.function.arguments === "string"
                                    ? JSON.parse(tc.function.arguments)
                                    : tc.function.arguments;
                        } catch {
                            args = tc.function.arguments;
                        }
                        text += `\n<tool_call>${JSON.stringify({ name: tc.function.name, arguments: args })}</tool_call>`;
                    }
                }
                parts.push(`A: ${text}`);
                break;
            }
            case "tool": {
                parts.push(
                    `<tool_result id="${msg.tool_call_id}">\n${msg.content}\n</tool_result>`,
                );
                break;
            }
        }
    }

    return parts.join("\n\n");
}

export function buildPrompt(messages: any[]): string {
    const nonSystem = messages.filter((m: any) => m.role !== "system");

    if (nonSystem.length === 1 && nonSystem[0].role === "user") {
        const content = nonSystem[0].content;
        return typeof content === "string" ? content : JSON.stringify(content);
    }

    return formatMessages(nonSystem);
}

export function buildDeltaPrompt(newMessages: any[]): string {
    const startIdx = newMessages.findIndex((m: any) => m.role !== "assistant");
    const delta = startIdx >= 0 ? newMessages.slice(startIdx) : newMessages;

    if (delta.length === 0) return "";

    if (delta.length === 1 && delta[0].role === "user") {
        const content = delta[0].content;
        return typeof content === "string" ? content : JSON.stringify(content);
    }

    return formatMessages(delta);
}

// ID generation ----------------------------------------------------------- /

export function randomId(prefix: string, bytes = 4): string {
    return (
        prefix +
        Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) =>
            b.toString(16).padStart(2, "0"),
        ).join("")
    );
}

// Text fallback parserextract <tool_call> tags if structured tool_use wasn't found
const TOOL_CALL_RE = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;

export function parseTextToolCalls(text: string): ParsedResponse {
    const toolCalls: ToolCall[] = [];
    const seen = new Set<string>();
    let match: RegExpExecArray | null;

    TOOL_CALL_RE.lastIndex = 0;

    while ((match = TOOL_CALL_RE.exec(text)) !== null) {
        const raw = (match[1] || "").trim();
        if (!raw) continue;
        try {
            const data = JSON.parse(raw);
            const key = JSON.stringify({ n: data.name, a: data.arguments });
            if (seen.has(key)) continue;
            seen.add(key);

            toolCalls.push({
                id: randomId("call_"),
                type: "function",
                function: {
                    name: data.name,
                    arguments: JSON.stringify(data.arguments || {}),
                },
            });
        } catch {}
    }

    const firstTag = text.indexOf("<tool_call>");
    const content =
        firstTag >= 0 ? text.substring(0, firstTag).trim() : text.trim();

    return {
        content: content || null,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
        finish_reason: toolCalls.length > 0 ? "tool_calls" : "stop",
    };
}

// Convert bridge tool_use blocks to OpenAI ToolCall format
export function convertToolUseBlocks(blocks: ToolUseBlock[]): ToolCall[] {
    return blocks.map((block) => ({
        id: randomId("call_"),
        type: "function" as const,
        function: {
            name: block.name,
            arguments: JSON.stringify(block.input || {}),
        },
    }));
}

// OpenAI response formatters ----------------------------------------------- /

export function makeOpenAIResponse(
    parsed: ParsedResponse,
    model: string,
    usage?: { input_tokens: number; output_tokens: number },
): any {
    return {
        id: randomId("chatcmpl-", 8),
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: model || "claude-opus-4-6-20250514",
        choices: [
            {
                index: 0,
                message: {
                    role: "assistant",
                    content: parsed.content,
                    ...(parsed.tool_calls ? { tool_calls: parsed.tool_calls } : {}),
                },
                finish_reason: parsed.finish_reason,
            },
        ],
        usage: {
            prompt_tokens: usage?.input_tokens || 0,
            completion_tokens: usage?.output_tokens || 0,
            total_tokens: (usage?.input_tokens || 0) + (usage?.output_tokens || 0),
        },
    };
}

// SSE streaming helpers --------------------------------------------------- /

export function buildSSEStream(
    parsed: ParsedResponse,
    model: string,
    usage?: { input_tokens: number; output_tokens: number },
): ReadableStream<Uint8Array> {
    const id = randomId("chatcmpl-", 8);
    const encoder = new TextEncoder();
    const m = model || "claude-opus-4-6-20250514";

    // Encodes a single SSE chunkwraps delta into the OpenAI stream format
    const sse = (delta: any, finishReason: string | null = null) =>
        encoder.encode(`data: ${JSON.stringify({
            id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: m,
            choices: [{ index: 0, delta, finish_reason: finishReason }],
        })}\n\n`);

    return new ReadableStream({
        start(controller) {
            controller.enqueue(sse({ role: "assistant" }));

            if (parsed.content) {
                const words = parsed.content.split(/(\s+)/);
                let buf = "";
                for (const word of words) {
                    buf += word;
                    if (buf.length >= 80 || buf.includes("\n")) {
                        controller.enqueue(sse({ content: buf }));
                        buf = "";
                    }
                }
                if (buf) controller.enqueue(sse({ content: buf }));
            }

            if (parsed.tool_calls?.length) {
                for (let i = 0; i < parsed.tool_calls.length; i++) {
                    const tc = parsed.tool_calls[i];
                    controller.enqueue(sse({
                        tool_calls: [{ index: i, id: tc.id, type: "function", function: { name: tc.function.name, arguments: "" } }],
                    }));
                    const args = tc.function.arguments;
                    for (let j = 0; j < args.length; j += 100) {
                        controller.enqueue(sse({
                            tool_calls: [{ index: i, function: { arguments: args.slice(j, j + 100) } }],
                        }));
                    }
                }
            }

            if (usage) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                    id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: m,
                    choices: [],
                    usage: {
                        prompt_tokens: usage.input_tokens || 0,
                        completion_tokens: usage.output_tokens || 0,
                        total_tokens: (usage.input_tokens || 0) + (usage.output_tokens || 0),
                    },
                })}\n\n`));
            }

            controller.enqueue(sse({}, parsed.finish_reason));
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
        },
    });
}
