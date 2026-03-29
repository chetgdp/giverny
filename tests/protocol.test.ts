import { describe, it, expect } from "bun:test";
import {
    sessionKey,
    buildSystemPrompt,
    formatMessages,
    buildPrompt,
    buildDeltaPrompt,
    parseTextToolCalls,
    convertToolUseBlocks,
    makeOpenAIResponse,
    buildSSEStream,
} from "../src/protocol";

describe("sessionKey", () => {
    it("returns same key for same inputs", () => {
        const msgs = [{ role: "system", content: "be helpful" }];
        expect(sessionKey(msgs)).toBe(sessionKey(msgs));
    });

    it("returns different keys for different system prompts", () => {
        const a = sessionKey([{ role: "system", content: "a" }]);
        const b = sessionKey([{ role: "system", content: "b" }]);
        expect(a).not.toBe(b);
    });

    it("returns different keys for different tools", () => {
        const msgs = [{ role: "system", content: "x" }];
        const a = sessionKey(msgs, [{ name: "Bash" }]);
        const b = sessionKey(msgs, [{ name: "Read" }]);
        expect(a).not.toBe(b);
    });

    it("is tool-order independent (tools are sorted)", () => {
        const msgs = [{ role: "system", content: "x" }];
        const a = sessionKey(msgs, [{ name: "Bash" }, { name: "Read" }]);
        const b = sessionKey(msgs, [{ name: "Read" }, { name: "Bash" }]);
        expect(a).toBe(b);
    });

    it("ignores non-system messages", () => {
        const a = sessionKey([{ role: "system", content: "x" }, { role: "user", content: "hi" }]);
        const b = sessionKey([{ role: "system", content: "x" }, { role: "user", content: "bye" }]);
        expect(a).toBe(b);
    });

    it("handles OpenAI function wrapper format", () => {
        const msgs = [{ role: "system", content: "x" }];
        const a = sessionKey(msgs, [{ function: { name: "Bash" } }]);
        const b = sessionKey(msgs, [{ name: "Bash" }]);
        expect(a).toBe(b);
    });
});

describe("buildSystemPrompt", () => {
    it("returns default assistant prompt when no system or tools", () => {
        expect(buildSystemPrompt([])).toBe("You are a helpful AI assistant.");
    });

    it("returns system message content when present", () => {
        const msgs = [{ role: "system", content: "You are a pirate." }];
        expect(buildSystemPrompt(msgs)).toBe("You are a pirate.");
    });

    it("joins multiple system messages", () => {
        const msgs = [
            { role: "system", content: "First" },
            { role: "system", content: "Second" },
        ];
        expect(buildSystemPrompt(msgs)).toContain("First\n\nSecond");
    });

    it("includes tool section when tools provided", () => {
        const tools = [{ name: "Bash", description: "Run commands" }];
        const result = buildSystemPrompt([], tools);
        expect(result).toContain("# Tool System");
        expect(result).toContain("## Bash");
        expect(result).toContain("Run commands");
    });

    it("formats tool parameters with required flag", () => {
        const tools = [{
            name: "Grep",
            parameters: {
                properties: {
                    pattern: { type: "string", description: "regex" },
                    path: { type: "string" },
                },
                required: ["pattern"],
            },
        }];
        const result = buildSystemPrompt([], tools);
        expect(result).toContain("pattern: string (required)regex");
        expect(result).toContain("path: string");
        expect(result).not.toContain("path: string (required)");
    });
});

describe("formatMessages", () => {
    it("formats user messages with H: prefix", () => {
        expect(formatMessages([{ role: "user", content: "hello" }])).toBe("H: hello");
    });

    it("formats assistant messages with A: prefix", () => {
        expect(formatMessages([{ role: "assistant", content: "hi" }])).toBe("A: hi");
    });

    it("skips system messages", () => {
        expect(formatMessages([{ role: "system", content: "secret" }])).toBe("");
    });

    it("formats tool results", () => {
        const result = formatMessages([{ role: "tool", tool_call_id: "tc_1", content: "output" }]);
        expect(result).toContain('<tool_result id="tc_1">');
        expect(result).toContain("output");
    });

    it("includes tool_calls in assistant messages", () => {
        const msg = {
            role: "assistant",
            content: "Let me check",
            tool_calls: [{
                function: { name: "Read", arguments: '{"file_path":"/foo"}' },
            }],
        };
        const result = formatMessages([msg]);
        expect(result).toContain("A: Let me check");
        expect(result).toContain("<tool_call>");
        expect(result).toContain('"name":"Read"');
    });

    it("joins multiple messages with double newlines", () => {
        const result = formatMessages([
            { role: "user", content: "hi" },
            { role: "assistant", content: "hello" },
        ]);
        expect(result).toBe("H: hi\n\nA: hello");
    });

    it("stringifies non-string user content", () => {
        const result = formatMessages([{ role: "user", content: [{ type: "text", text: "hi" }] }]);
        expect(result).toContain("H: [");
    });
});

describe("buildPrompt", () => {
    it("returns raw content for single user message", () => {
        const msgs = [{ role: "user", content: "just this" }];
        expect(buildPrompt(msgs)).toBe("just this");
    });

    it("returns raw content for single user with system present", () => {
        const msgs = [
            { role: "system", content: "ignored" },
            { role: "user", content: "just this" },
        ];
        expect(buildPrompt(msgs)).toBe("just this");
    });

    it("uses formatMessages for multi-message conversations", () => {
        const msgs = [
            { role: "user", content: "hi" },
            { role: "assistant", content: "hello" },
            { role: "user", content: "how are you" },
        ];
        const result = buildPrompt(msgs);
        expect(result).toContain("H: hi");
        expect(result).toContain("A: hello");
        expect(result).toContain("H: how are you");
    });
});

describe("buildDeltaPrompt", () => {
    it("skips leading assistant messages", () => {
        const msgs = [
            { role: "assistant", content: "I said this" },
            { role: "user", content: "new input" },
        ];
        expect(buildDeltaPrompt(msgs)).toBe("new input");
    });

    it("returns empty string for empty input", () => {
        expect(buildDeltaPrompt([])).toBe("");
    });

    it("returns raw content for single user delta", () => {
        expect(buildDeltaPrompt([{ role: "user", content: "hi" }])).toBe("hi");
    });
});

describe("parseTextToolCalls", () => {
    it("returns plain text with no tool_calls for regular text", () => {
        const result = parseTextToolCalls("Hello world");
        expect(result.content).toBe("Hello world");
        expect(result.tool_calls).toBeUndefined();
        expect(result.finish_reason).toBe("stop");
    });

    it("extracts a single tool_call tag", () => {
        const text = 'Some text <tool_call>{"name":"Bash","arguments":{"command":"ls"}}</tool_call>';
        const result = parseTextToolCalls(text);
        expect(result.content).toBe("Some text");
        expect(result.tool_calls).toHaveLength(1);
        expect(result.tool_calls![0].function.name).toBe("Bash");
        expect(result.finish_reason).toBe("tool_calls");
    });

    it("extracts multiple tool_call tags", () => {
        const text = '<tool_call>{"name":"Read","arguments":{"file_path":"/a"}}</tool_call><tool_call>{"name":"Read","arguments":{"file_path":"/b"}}</tool_call>';
        const result = parseTextToolCalls(text);
        expect(result.tool_calls).toHaveLength(2);
    });

    it("deduplicates identical tool calls", () => {
        const tc = '{"name":"Bash","arguments":{"command":"ls"}}';
        const text = `<tool_call>${tc}</tool_call><tool_call>${tc}</tool_call>`;
        const result = parseTextToolCalls(text);
        expect(result.tool_calls).toHaveLength(1);
    });

    it("skips invalid JSON in tool_call tags", () => {
        const text = '<tool_call>not json</tool_call><tool_call>{"name":"Bash","arguments":{}}</tool_call>';
        const result = parseTextToolCalls(text);
        expect(result.tool_calls).toHaveLength(1);
        expect(result.tool_calls![0].function.name).toBe("Bash");
    });

    it("returns null content when text is empty after tag removal", () => {
        const text = '<tool_call>{"name":"Bash","arguments":{}}</tool_call>';
        const result = parseTextToolCalls(text);
        expect(result.content).toBeNull();
    });

    it("generates call_ prefixed ids", () => {
        const text = '<tool_call>{"name":"Bash","arguments":{}}</tool_call>';
        const result = parseTextToolCalls(text);
        expect(result.tool_calls![0].id).toMatch(/^call_/);
    });
});

describe("convertToolUseBlocks", () => {
    it("converts Claude tool_use blocks to OpenAI format", () => {
        const blocks = [
            { type: "tool_use" as const, id: "tu_1", name: "Bash", input: { command: "ls" } },
        ];
        const result = convertToolUseBlocks(blocks);
        expect(result).toHaveLength(1);
        expect(result[0].type).toBe("function");
        expect(result[0].function.name).toBe("Bash");
        expect(result[0].function.arguments).toBe('{"command":"ls"}');
        expect(result[0].id).toMatch(/^call_/);
    });

    it("defaults missing input to empty object", () => {
        const blocks = [
            { type: "tool_use" as const, name: "Read", input: undefined as any },
        ];
        const result = convertToolUseBlocks(blocks);
        expect(result[0].function.arguments).toBe("{}");
    });
});

describe("makeOpenAIResponse", () => {
    it("has correct structure", () => {
        const parsed = { content: "hello", finish_reason: "stop" as const };
        const resp = makeOpenAIResponse(parsed, "opus");
        expect(resp.object).toBe("chat.completion");
        expect(resp.id).toMatch(/^chatcmpl-/);
        expect(resp.choices).toHaveLength(1);
        expect(resp.choices[0].message.role).toBe("assistant");
        expect(resp.choices[0].message.content).toBe("hello");
        expect(resp.choices[0].finish_reason).toBe("stop");
    });

    it("includes tool_calls when present", () => {
        const parsed = {
            content: null,
            tool_calls: [{ id: "call_1", type: "function" as const, function: { name: "Bash", arguments: "{}" } }],
            finish_reason: "tool_calls" as const,
        };
        const resp = makeOpenAIResponse(parsed, "opus");
        expect(resp.choices[0].message.tool_calls).toHaveLength(1);
    });

    it("omits tool_calls key when not present", () => {
        const parsed = { content: "hi", finish_reason: "stop" as const };
        const resp = makeOpenAIResponse(parsed, "opus");
        expect("tool_calls" in resp.choices[0].message).toBe(false);
    });

    it("maps usage correctly", () => {
        const parsed = { content: "hi", finish_reason: "stop" as const };
        const resp = makeOpenAIResponse(parsed, "opus", { input_tokens: 100, output_tokens: 50 });
        expect(resp.usage.prompt_tokens).toBe(100);
        expect(resp.usage.completion_tokens).toBe(50);
        expect(resp.usage.total_tokens).toBe(150);
    });

    it("defaults usage to zeros", () => {
        const parsed = { content: "hi", finish_reason: "stop" as const };
        const resp = makeOpenAIResponse(parsed, "opus");
        expect(resp.usage.total_tokens).toBe(0);
    });

    it("uses fallback model when empty", () => {
        const parsed = { content: "hi", finish_reason: "stop" as const };
        const resp = makeOpenAIResponse(parsed, "");
        expect(resp.model).toBe("claude-opus-4-6-20250514");
    });
});

describe("buildSSEStream", () => {
    async function collectSSE(stream: ReadableStream<Uint8Array>): Promise<string[]> {
        const reader = stream.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        const chunks: string[] = [];
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
        }
        // Split into individual data: lines
        for (const line of buf.split("\n")) {
            if (line.startsWith("data: ")) chunks.push(line.slice(6));
        }
        return chunks;
    }

    it("starts with role:assistant delta and ends with [DONE]", async () => {
        const parsed = { content: "hi", finish_reason: "stop" as const };
        const chunks = await collectSSE(buildSSEStream(parsed, "opus"));
        const first = JSON.parse(chunks[0]);
        expect(first.choices[0].delta.role).toBe("assistant");
        expect(chunks[chunks.length - 1]).toBe("[DONE]");
    });

    it("streams content in chunks", async () => {
        const parsed = { content: "hello world", finish_reason: "stop" as const };
        const chunks = await collectSSE(buildSSEStream(parsed, "opus"));
        // Should have role chunk, content chunk(s), finish chunk, [DONE]
        const contentChunks = chunks
            .filter(c => c !== "[DONE]")
            .map(c => JSON.parse(c))
            .filter(c => c.choices[0]?.delta?.content);
        expect(contentChunks.length).toBeGreaterThan(0);
        const reassembled = contentChunks.map(c => c.choices[0].delta.content).join("");
        expect(reassembled).toBe("hello world");
    });

    it("includes finish_reason in last data chunk", async () => {
        const parsed = { content: "hi", finish_reason: "stop" as const };
        const chunks = await collectSSE(buildSSEStream(parsed, "opus"));
        // Last chunk before [DONE]
        const last = JSON.parse(chunks[chunks.length - 2]);
        expect(last.choices[0].finish_reason).toBe("stop");
    });

    it("streams tool calls", async () => {
        const parsed = {
            content: null,
            tool_calls: [{ id: "call_1", type: "function" as const, function: { name: "Bash", arguments: '{"cmd":"ls"}' } }],
            finish_reason: "tool_calls" as const,
        };
        const chunks = await collectSSE(buildSSEStream(parsed, "opus"));
        const toolChunks = chunks
            .filter(c => c !== "[DONE]")
            .map(c => JSON.parse(c))
            .filter(c => c.choices[0]?.delta?.tool_calls);
        expect(toolChunks.length).toBeGreaterThan(0);
        expect(toolChunks[0].choices[0].delta.tool_calls[0].function.name).toBe("Bash");
    });

    it("includes usage chunk when provided", async () => {
        const parsed = { content: "hi", finish_reason: "stop" as const };
        const usage = { input_tokens: 10, output_tokens: 5 };
        const chunks = await collectSSE(buildSSEStream(parsed, "opus", usage));
        const usageChunks = chunks
            .filter(c => c !== "[DONE]")
            .map(c => JSON.parse(c))
            .filter(c => c.usage);
        expect(usageChunks).toHaveLength(1);
        expect(usageChunks[0].usage.total_tokens).toBe(15);
    });
});
