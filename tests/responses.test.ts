import { describe, it, expect } from "bun:test";

// Import the exported test helpers
const { _parseResponsesSSE: parseResponsesSSE, _flattenToolSchemas: flattenToolSchemas, _buildRequestBody: buildRequestBody, _convertToResponsesInput: convertToResponsesInput } = await import("../src/responses");

describe("parseResponsesSSE", () => {
    it("extracts text from output_text.delta", () => {
        const result = parseResponsesSSE(
            "response.output_text.delta",
            JSON.stringify({ type: "response.output_text.delta", delta: "Hello", sequence_number: 5 }),
        );
        expect(result.text).toBe("Hello");
        expect(result.completed).toBe(false);
    });

    it("extracts tool call from output_item.added (function_call)", () => {
        const result = parseResponsesSSE(
            "response.output_item.added",
            JSON.stringify({
                type: "response.output_item.added",
                output_index: 0,
                item: { type: "function_call", id: "fc_123", call_id: "call_abc", name: "exec" },
            }),
        );
        expect(result.toolCall).toBeDefined();
        expect(result.toolCall!.id).toBe("call_abc");
        expect(result.toolCall!.name).toBe("exec");
    });

    it("ignores output_item.added for message type", () => {
        const result = parseResponsesSSE(
            "response.output_item.added",
            JSON.stringify({
                type: "response.output_item.added",
                item: { type: "message", id: "msg_123", role: "assistant" },
            }),
        );
        expect(result.toolCall).toBeUndefined();
        expect(result.completed).toBe(false);
    });

    it("extracts argument delta", () => {
        const result = parseResponsesSSE(
            "response.function_call_arguments.delta",
            JSON.stringify({ type: "response.function_call_arguments.delta", item_id: "fc_123", delta: '{"cmd":' }),
        );
        expect(result.toolCall).toBeDefined();
        expect(result.toolCall!.id).toBe("fc_123");
        expect(result.toolCall!.argumentsDelta).toBe('{"cmd":');
    });

    it("extracts arguments done", () => {
        const result = parseResponsesSSE(
            "response.function_call_arguments.done",
            JSON.stringify({
                type: "response.function_call_arguments.done",
                item_id: "fc_123",
                name: "exec",
                arguments: '{"command":"ls"}',
            }),
        );
        expect(result.toolCall).toBeDefined();
        expect(result.toolCall!.argumentsDone).toBe('{"command":"ls"}');
        expect(result.toolCall!.name).toBe("exec");
    });

    it("detects response.completed", () => {
        const result = parseResponsesSSE(
            "response.completed",
            JSON.stringify({ type: "response.completed", response: { status: "completed" } }),
        );
        expect(result.completed).toBe(true);
    });

    it("detects response.failed", () => {
        const result = parseResponsesSSE(
            "response.failed",
            JSON.stringify({ type: "response.failed", response: { status: "failed" } }),
        );
        expect(result.completed).toBe(true);
    });

    it("ignores unknown event types", () => {
        const result = parseResponsesSSE(
            "response.in_progress",
            JSON.stringify({ type: "response.in_progress" }),
        );
        expect(result.text).toBeUndefined();
        expect(result.toolCall).toBeUndefined();
        expect(result.completed).toBe(false);
    });

    it("handles empty event type", () => {
        const result = parseResponsesSSE("", "{}");
        expect(result.completed).toBe(false);
    });

    it("handles invalid JSON gracefully", () => {
        const result = parseResponsesSSE("response.output_text.delta", "not json");
        expect(result.completed).toBe(false);
    });
});

describe("flattenToolSchemas", () => {
    it("flattens OpenAI function wrapper format", () => {
        const tools = [{
            type: "function",
            function: {
                name: "exec",
                description: "Execute a command",
                parameters: { type: "object", properties: { command: { type: "string" } } },
            },
        }];
        const flat = flattenToolSchemas(tools);
        expect(flat[0].name).toBe("exec");
        expect(flat[0].description).toBe("Execute a command");
        expect(flat[0].parameters.properties.command.type).toBe("string");
        expect(flat[0].function).toBeUndefined();
    });

    it("passes through already-flat format", () => {
        const tools = [{
            type: "function",
            name: "exec",
            description: "Execute",
            parameters: {},
        }];
        const flat = flattenToolSchemas(tools);
        expect(flat[0].name).toBe("exec");
    });
});

describe("buildRequestBody", () => {
    it("builds string input request", () => {
        const body = buildRequestBody({
            prompt: "hello",
            systemPrompt: "be helpful",
            model: "qwen3",
        });
        expect(body.input).toBe("hello");
        expect(body.instructions).toBe("be helpful");
        expect(body.model).toBe("qwen3");
        expect(body.stream).toBe(true);
        expect(body.tools).toBeDefined();
    });

    it("uses _messages when available (tool loop)", () => {
        const messages = [
            { role: "system", content: "be helpful" },
            { role: "user", content: "hi" },
            { role: "assistant", content: "hello" },
            { role: "user", content: "do something" },
        ];
        const body = buildRequestBody({
            prompt: "ignored",
            options: { _messages: messages },
        });
        // System messages extracted to instructions
        expect(body.instructions).toBe("be helpful");
        // Non-system messages as input
        expect(body.input).toHaveLength(3);
        expect(body.input[0].role).toBe("user");
    });

    it("omits model for 'local'", () => {
        const body = buildRequestBody({ prompt: "hi", model: "local" });
        expect(body.model).toBeUndefined();
    });

    it("omits instructions when no system prompt", () => {
        const body = buildRequestBody({ prompt: "hi" });
        expect(body.instructions).toBeUndefined();
    });

    it("converts tool call messages to responses format", () => {
        const messages = [
            { role: "system", content: "be helpful" },
            { role: "user", content: "list files" },
            {
                role: "assistant",
                content: "I'll list the files.",
                tool_calls: [{
                    id: "call_1",
                    type: "function",
                    function: { name: "exec", arguments: '{"command":"ls"}' },
                }],
            },
            { role: "tool", tool_call_id: "call_1", content: "file1.txt\nfile2.txt" },
            { role: "user", content: "now what?" },
        ];
        const body = buildRequestBody({
            prompt: "ignored",
            options: { _messages: messages },
        });
        expect(body.instructions).toBe("be helpful");
        // input should have: user, assistant text, function_call, function_call_output, user
        expect(body.input).toHaveLength(5);
        // Default URL is localhost → extended flavor
        expect(body.input[0].type).toBe("message");
        expect(body.input[0].role).toBe("user");
        expect(body.input[1].type).toBe("message");
        expect(body.input[1].role).toBe("assistant");
        expect(body.input[1].content[0].text).toBe("I'll list the files.");
        expect(body.input[2].type).toBe("function_call");
        expect(body.input[2].call_id).toBe("call_1");
        expect(body.input[2].name).toBe("exec");
        expect(body.input[3].type).toBe("function_call_output");
        expect(body.input[3].call_id).toBe("call_1");
        expect(body.input[3].output).toBe("file1.txt\nfile2.txt");
        expect(body.input[4].type).toBe("message");
        expect(body.input[4].role).toBe("user");
    });
});

describe("convertToResponsesInput", () => {
    it("spec flavor: plain {role, content} for messages", () => {
        const input = convertToResponsesInput([
            { role: "user", content: "hi" },
            { role: "assistant", content: "hello" },
        ], "spec");
        expect(input).toHaveLength(2);
        expect(input[0]).toEqual({ role: "user", content: "hi" });
        expect(input[1]).toEqual({ role: "assistant", content: "hello" });
    });

    it("extended flavor: typed messages with structured content", () => {
        const input = convertToResponsesInput([
            { role: "user", content: "hi" },
            { role: "assistant", content: "hello" },
        ], "extended");
        expect(input).toHaveLength(2);
        expect(input[0]).toEqual({ type: "message", role: "user", content: "hi" });
        expect(input[1]).toEqual({
            type: "message", role: "assistant",
            content: [{ type: "output_text", text: "hello" }],
        });
    });

    it("strips system messages", () => {
        const input = convertToResponsesInput([
            { role: "system", content: "ignored" },
            { role: "user", content: "hi" },
        ]);
        expect(input).toHaveLength(1);
        expect(input[0].role).toBe("user");
    });

    it("converts assistant tool_calls to function_call items", () => {
        const input = convertToResponsesInput([{
            role: "assistant",
            content: null,
            tool_calls: [{
                id: "call_abc",
                type: "function",
                function: { name: "exec", arguments: '{"command":"ls"}' },
            }],
        }]);
        expect(input).toHaveLength(1);
        expect(input[0].type).toBe("function_call");
        expect(input[0].call_id).toBe("call_abc");
        expect(input[0].name).toBe("exec");
        expect(input[0].arguments).toBe('{"command":"ls"}');
    });

    it("splits assistant text + tool_calls into separate items", () => {
        const input = convertToResponsesInput([{
            role: "assistant",
            content: "checking...",
            tool_calls: [{ id: "call_1", type: "function", function: { name: "exec", arguments: '{}' } }],
        }]);
        expect(input).toHaveLength(2);
        expect(input[0]).toEqual({ role: "assistant", content: "checking..." });
        expect(input[1].type).toBe("function_call");
    });

    it("extended flavor: splits assistant text + tool_calls with typed content", () => {
        const input = convertToResponsesInput([{
            role: "assistant",
            content: "checking...",
            tool_calls: [{ id: "call_1", type: "function", function: { name: "exec", arguments: '{}' } }],
        }], "extended");
        expect(input).toHaveLength(2);
        expect(input[0]).toEqual({
            type: "message", role: "assistant",
            content: [{ type: "output_text", text: "checking..." }],
        });
        expect(input[1].type).toBe("function_call");
    });

    it("converts tool role to function_call_output", () => {
        const input = convertToResponsesInput([
            { role: "tool", tool_call_id: "call_1", content: "output here" },
        ]);
        expect(input).toHaveLength(1);
        expect(input[0].type).toBe("function_call_output");
        expect(input[0].call_id).toBe("call_1");
        expect(input[0].output).toBe("output here");
    });
});
