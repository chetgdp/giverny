import { describe, it, expect } from "bun:test";
import {
    normalizeInput,
    makeResponseObject,
    buildResponsesSSEStream,
} from "../src/responses-protocol";

describe("normalizeInput", () => {
    it("converts string input to user message", () => {
        const msgs = normalizeInput("hello");
        expect(msgs).toEqual([{ role: "user", content: "hello" }]);
    });

    it("passes array input through", () => {
        const input = [{ role: "user", content: "hi" }];
        const msgs = normalizeInput(input);
        expect(msgs).toEqual(input);
    });

    it("prepends instructions as system message", () => {
        const msgs = normalizeInput("hello", "be helpful");
        expect(msgs).toEqual([
            { role: "system", content: "be helpful" },
            { role: "user", content: "hello" },
        ]);
    });

    it("prepends instructions before array input", () => {
        const msgs = normalizeInput(
            [{ role: "user", content: "hi" }, { role: "assistant", content: "hey" }],
            "be brief",
        );
        expect(msgs[0]).toEqual({ role: "system", content: "be brief" });
        expect(msgs).toHaveLength(3);
    });

    it("omits system message when instructions is undefined", () => {
        const msgs = normalizeInput("hello", undefined);
        expect(msgs).toEqual([{ role: "user", content: "hello" }]);
    });
});

describe("makeResponseObject", () => {
    it("has correct structure for text response", () => {
        const parsed = { content: "hello", finish_reason: "stop" as const };
        const resp = makeResponseObject(parsed, "opus");
        expect(resp.object).toBe("response");
        expect(resp.id).toMatch(/^resp_/);
        expect(resp.status).toBe("completed");
        expect(resp.output).toHaveLength(1);
        expect(resp.output[0].type).toBe("message");
        if (resp.output[0].type === "message") {
            expect(resp.output[0].role).toBe("assistant");
            expect(resp.output[0].status).toBe("completed");
            expect(resp.output[0].content[0].type).toBe("output_text");
            expect(resp.output[0].content[0].text).toBe("hello");
        }
    });

    it("includes function calls in output", () => {
        const parsed = {
            content: null,
            tool_calls: [{ id: "call_1", type: "function" as const, function: { name: "Bash", arguments: '{"cmd":"ls"}' } }],
            finish_reason: "tool_calls" as const,
        };
        const resp = makeResponseObject(parsed, "opus");
        expect(resp.output).toHaveLength(1);
        expect(resp.output[0].type).toBe("function_call");
        if (resp.output[0].type === "function_call") {
            expect(resp.output[0].name).toBe("Bash");
            expect(resp.output[0].arguments).toBe('{"cmd":"ls"}');
            expect(resp.output[0].call_id).toBe("call_1");
        }
    });

    it("includes both text and tool calls", () => {
        const parsed = {
            content: "checking...",
            tool_calls: [{ id: "call_1", type: "function" as const, function: { name: "Read", arguments: '{}' } }],
            finish_reason: "tool_calls" as const,
        };
        const resp = makeResponseObject(parsed, "opus");
        expect(resp.output).toHaveLength(2);
        expect(resp.output[0].type).toBe("message");
        expect(resp.output[1].type).toBe("function_call");
    });

    it("maps usage correctly", () => {
        const parsed = { content: "hi", finish_reason: "stop" as const };
        const resp = makeResponseObject(parsed, "opus", { input_tokens: 100, output_tokens: 50 });
        expect(resp.usage.input_tokens).toBe(100);
        expect(resp.usage.output_tokens).toBe(50);
        expect(resp.usage.total_tokens).toBe(150);
    });

    it("defaults usage to zeros", () => {
        const parsed = { content: "hi", finish_reason: "stop" as const };
        const resp = makeResponseObject(parsed, "opus");
        expect(resp.usage.total_tokens).toBe(0);
    });

    it("uses provided responseId", () => {
        const parsed = { content: "hi", finish_reason: "stop" as const };
        const resp = makeResponseObject(parsed, "opus", undefined, "resp_custom123");
        expect(resp.id).toBe("resp_custom123");
    });

    it("uses fallback model when empty", () => {
        const parsed = { content: "hi", finish_reason: "stop" as const };
        const resp = makeResponseObject(parsed, "");
        expect(resp.model).toBe("claude-opus-4-6-20250514");
    });

    it("returns empty output for null content and no tool calls", () => {
        const parsed = { content: null, finish_reason: "stop" as const };
        const resp = makeResponseObject(parsed, "opus");
        expect(resp.output).toHaveLength(0);
    });
});

describe("buildResponsesSSEStream", () => {
    // Collect named SSE events from the stream
    async function collectEvents(stream: ReadableStream<Uint8Array>): Promise<Array<{ event: string; data: any }>> {
        const reader = stream.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
        }
        const events: Array<{ event: string; data: any }> = [];
        // SSE blocks are separated by \n\n
        const blocks = buf.split("\n\n").filter(Boolean);
        for (const block of blocks) {
            const lines = block.split("\n");
            let eventName = "";
            let data = "";
            for (const line of lines) {
                if (line.startsWith("event: ")) eventName = line.slice(7);
                if (line.startsWith("data: ")) data = line.slice(6);
            }
            if (eventName && data) {
                events.push({ event: eventName, data: JSON.parse(data) });
            }
        }
        return events;
    }

    it("starts with response.created and response.in_progress", async () => {
        const parsed = { content: "hi", finish_reason: "stop" as const };
        const events = await collectEvents(buildResponsesSSEStream(parsed, "opus"));
        expect(events[0].event).toBe("response.created");
        expect(events[0].data.type).toBe("response.created");
        expect(events[0].data.response.status).toBe("in_progress");
        expect(events[1].event).toBe("response.in_progress");
    });

    it("ends with response.completed", async () => {
        const parsed = { content: "hi", finish_reason: "stop" as const };
        const events = await collectEvents(buildResponsesSSEStream(parsed, "opus"));
        const last = events[events.length - 1];
        expect(last.event).toBe("response.completed");
        expect(last.data.response.status).toBe("completed");
    });

    it("has no data: [DONE] terminator", async () => {
        const parsed = { content: "hi", finish_reason: "stop" as const };
        const stream = buildResponsesSSEStream(parsed, "opus");
        const reader = stream.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
        }
        expect(buf).not.toContain("[DONE]");
    });

    it("emits correct text event sequence", async () => {
        const parsed = { content: "hello world", finish_reason: "stop" as const };
        const events = await collectEvents(buildResponsesSSEStream(parsed, "opus"));
        const types = events.map(e => e.event);

        expect(types[0]).toBe("response.created");
        expect(types[1]).toBe("response.in_progress");
        expect(types[2]).toBe("response.output_item.added");
        expect(types[3]).toBe("response.content_part.added");
        // Then delta(s)
        const deltaIdx = types.indexOf("response.output_text.delta");
        expect(deltaIdx).toBeGreaterThan(3);
        // Then done events
        expect(types).toContain("response.output_text.done");
        expect(types).toContain("response.content_part.done");
        expect(types).toContain("response.output_item.done");
        expect(types[types.length - 1]).toBe("response.completed");
    });

    it("reassembles text from deltas", async () => {
        const text = "The quick brown fox jumps over the lazy dog. This is a longer string to force multiple delta chunks.";
        const parsed = { content: text, finish_reason: "stop" as const };
        const events = await collectEvents(buildResponsesSSEStream(parsed, "opus"));
        const deltas = events
            .filter(e => e.event === "response.output_text.delta")
            .map(e => e.data.delta);
        expect(deltas.join("")).toBe(text);
    });

    it("output_text.done contains full text", async () => {
        const parsed = { content: "hello", finish_reason: "stop" as const };
        const events = await collectEvents(buildResponsesSSEStream(parsed, "opus"));
        const done = events.find(e => e.event === "response.output_text.done");
        expect(done!.data.text).toBe("hello");
    });

    it("sequence numbers are monotonically increasing", async () => {
        const parsed = { content: "hello world", finish_reason: "stop" as const };
        const events = await collectEvents(buildResponsesSSEStream(parsed, "opus"));
        for (let i = 0; i < events.length; i++) {
            expect(events[i].data.sequence_number).toBe(i + 1);
        }
    });

    it("event name matches data type field", async () => {
        const parsed = {
            content: "hi",
            tool_calls: [{ id: "call_1", type: "function" as const, function: { name: "Bash", arguments: '{}' } }],
            finish_reason: "tool_calls" as const,
        };
        const events = await collectEvents(buildResponsesSSEStream(parsed, "opus"));
        for (const e of events) {
            expect(e.event).toBe(e.data.type);
        }
    });

    it("emits function call events", async () => {
        const parsed = {
            content: null,
            tool_calls: [{ id: "call_1", type: "function" as const, function: { name: "Bash", arguments: '{"cmd":"ls"}' } }],
            finish_reason: "tool_calls" as const,
        };
        const events = await collectEvents(buildResponsesSSEStream(parsed, "opus"));
        const types = events.map(e => e.event);

        expect(types).toContain("response.output_item.added");
        expect(types).toContain("response.function_call_arguments.delta");
        expect(types).toContain("response.function_call_arguments.done");
        expect(types).toContain("response.output_item.done");

        // Check the added item
        const added = events.find(e => e.event === "response.output_item.added");
        expect(added!.data.item.type).toBe("function_call");
        expect(added!.data.item.name).toBe("Bash");
        expect(added!.data.item.call_id).toBe("call_1");
    });

    it("reassembles function call arguments from deltas", async () => {
        const args = '{"location":"New York City, NY, USA","unit":"fahrenheit"}';
        const parsed = {
            content: null,
            tool_calls: [{ id: "call_1", type: "function" as const, function: { name: "get_weather", arguments: args } }],
            finish_reason: "tool_calls" as const,
        };
        const events = await collectEvents(buildResponsesSSEStream(parsed, "opus"));
        const deltas = events
            .filter(e => e.event === "response.function_call_arguments.delta")
            .map(e => e.data.delta);
        expect(deltas.join("")).toBe(args);

        const done = events.find(e => e.event === "response.function_call_arguments.done");
        expect(done!.data.arguments).toBe(args);
    });

    it("response.completed includes full output", async () => {
        const parsed = {
            content: "here you go",
            tool_calls: [{ id: "call_1", type: "function" as const, function: { name: "Bash", arguments: '{}' } }],
            finish_reason: "tool_calls" as const,
        };
        const events = await collectEvents(buildResponsesSSEStream(parsed, "opus"));
        const completed = events.find(e => e.event === "response.completed");
        expect(completed!.data.response.output).toHaveLength(2);
        expect(completed!.data.response.output[0].type).toBe("message");
        expect(completed!.data.response.output[1].type).toBe("function_call");
        expect(completed!.data.response.status).toBe("completed");
    });

    it("uses provided responseId", async () => {
        const parsed = { content: "hi", finish_reason: "stop" as const };
        const events = await collectEvents(buildResponsesSSEStream(parsed, "opus", undefined, "resp_test123"));
        expect(events[0].data.response.id).toBe("resp_test123");
    });

    it("includes usage in completed response", async () => {
        const parsed = { content: "hi", finish_reason: "stop" as const };
        const usage = { input_tokens: 10, output_tokens: 5 };
        const events = await collectEvents(buildResponsesSSEStream(parsed, "opus", usage));
        const completed = events.find(e => e.event === "response.completed");
        expect(completed!.data.response.usage.total_tokens).toBe(15);
    });
});
