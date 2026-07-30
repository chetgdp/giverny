import { describe, it, expect } from "bun:test";
import { buildPiArgs, createPiParser } from "../src/pi";
import { getBackend } from "../src/backend";

// Fixtures match pi 0.82 NDJSON shapes (see plans/pi-backend.md)

const HEADER = JSON.stringify({
    type: "session",
    version: 3,
    id: "0198a5c0-1111-7222-8333-444455556666",
    timestamp: "2026-07-29T10:00:00.000Z",
    cwd: "/tmp",
});

function assistantMsg(overrides: Record<string, any> = {}) {
    return JSON.stringify({
        type: "message_end",
        message: {
            role: "assistant",
            content: [{ type: "text", text: "hello" }],
            usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: 0 },
            stopReason: "stop",
            ...overrides,
        },
    });
}

describe("buildPiArgs", () => {
    it("base args select json print mode", () => {
        const args = buildPiArgs({ prompt: "hi" });
        expect(args.slice(0, 2)).toEqual(["--mode", "json"]);
        // -p greedily captures the next argv as the prompt — must not be passed
        expect(args).not.toContain("-p");
        // prompt travels via stdin, never argv
        expect(args).not.toContain("hi");
    });

    it("passes model through verbatim, skips 'default'", () => {
        expect(buildPiArgs({ prompt: "x", model: "openrouter/kimi-k2" }))
            .toContain("openrouter/kimi-k2");
        expect(buildPiArgs({ prompt: "x", model: "default" })).not.toContain("--model");
        expect(buildPiArgs({ prompt: "x" })).not.toContain("--model");
    });

    it("maps effort to --thinking", () => {
        const args = buildPiArgs({ prompt: "x", options: { effort: "xhigh" } });
        expect(args[args.indexOf("--thinking") + 1]).toBe("xhigh");
    });

    it("passes valid session ids, drops invalid ones", () => {
        const uuid = "0198a5c0-1111-7222-8333-444455556666";
        const ok = buildPiArgs({ prompt: "x", sessionId: uuid });
        expect(ok[ok.indexOf("--session-id") + 1]).toBe(uuid);
        // leading/trailing separators violate pi's id rules
        expect(buildPiArgs({ prompt: "x", sessionId: "-bad" })).not.toContain("--session-id");
        expect(buildPiArgs({ prompt: "x", sessionId: "has spaces" })).not.toContain("--session-id");
    });

    it("passes system prompt and tools filter", () => {
        const args = buildPiArgs({
            prompt: "x",
            systemPrompt: "be brief",
            options: { tools: "read,bash" },
        });
        expect(args[args.indexOf("--system-prompt") + 1]).toBe("be brief");
        expect(args[args.indexOf("--tools") + 1]).toBe("read,bash");
        expect(buildPiArgs({ prompt: "x", options: { tools: "all" } })).not.toContain("--tools");
    });

    it("never passes a permission flag", () => {
        const args = buildPiArgs({ prompt: "x", options: { perms: "auto" } });
        expect(args.join(" ")).not.toContain("permission");
    });

    it("plan perms forces the read-only tool set", () => {
        const args = buildPiArgs({ prompt: "x", options: { perms: "plan", tools: "bash,write" } });
        expect(args[args.indexOf("--tools") + 1]).toBe("read,grep,find,ls");
    });

    it("lowercases a saved claude-code tools filter", () => {
        const args = buildPiArgs({ prompt: "x", options: { tools: "Read,Bash" } });
        expect(args[args.indexOf("--tools") + 1]).toBe("read,bash");
    });
});

describe("createPiParser", () => {
    it("captures session id from header", () => {
        const p = createPiParser();
        expect(p.handleLine(HEADER)).toBeNull();
        expect(p.sessionId()).toBe("0198a5c0-1111-7222-8333-444455556666");
    });

    it("maps assistant message_end to assistant event", () => {
        const p = createPiParser();
        const event = p.handleLine(assistantMsg());
        expect(event).toEqual({ type: "assistant", blocks: [{ type: "text", text: "hello" }] });
    });

    it("maps toolCall blocks to tool_use, drops thinking", () => {
        const p = createPiParser();
        const event = p.handleLine(assistantMsg({
            content: [
                { type: "thinking", thinking: "hmm" },
                { type: "toolCall", id: "tc-1", name: "bash", arguments: { command: "ls" } },
            ],
            stopReason: "toolUse",
        }));
        expect(event).toEqual({
            type: "assistant",
            blocks: [{ type: "tool_use", id: "tc-1", name: "bash", input: { command: "ls" } }],
        });
    });

    it("ignores user and toolResult message_end", () => {
        const p = createPiParser();
        expect(p.handleLine(JSON.stringify({
            type: "message_end",
            message: { role: "user", content: [{ type: "text", text: "hi" }] },
        }))).toBeNull();
        expect(p.handleLine(JSON.stringify({
            type: "message_end",
            message: { role: "toolResult", content: [] },
        }))).toBeNull();
    });

    it("maps tool_execution_end to tool_result", () => {
        const p = createPiParser();
        const event = p.handleLine(JSON.stringify({
            type: "tool_execution_end",
            toolCallId: "tc-1",
            toolName: "bash",
            result: { content: [{ type: "text", text: "file.txt" }], details: {} },
            isError: false,
        }));
        expect(event).toEqual({
            type: "tool_result",
            toolUseId: "tc-1",
            content: "file.txt",
            stdout: "file.txt",
            stderr: "",
            isError: false,
        });
    });

    it("skips malformed lines and unknown events", () => {
        const p = createPiParser();
        expect(p.handleLine("{broken")).toBeNull();
        expect(p.handleLine("")).toBeNull();
        expect(p.handleLine(JSON.stringify({ type: "message_update" }))).toBeNull();
        expect(p.handleLine(JSON.stringify({ type: "agent_start" }))).toBeNull();
    });

    it("settles on agent_end without willRetry, not on retry", () => {
        const p = createPiParser();
        p.handleLine(JSON.stringify({ type: "agent_end", messages: [], willRetry: true }));
        expect(p.settled()).toBe(false);
        p.handleLine(JSON.stringify({ type: "agent_end", messages: [] }));
        expect(p.settled()).toBe(true);
    });

    it("counts cacheRead/cacheWrite as input tokens", () => {
        const p = createPiParser();
        p.handleLine(assistantMsg({
            usage: { input: 10, output: 5, cacheRead: 100, cacheWrite: 20 },
        }));
        expect(p.finish(1)!.usage).toEqual({ input_tokens: 130, output_tokens: 5 });
    });

    it("final-turn error prefers errorMessage over stale mid-run text", () => {
        const p = createPiParser();
        p.handleLine(assistantMsg({ content: [{ type: "text", text: "working on it" }], stopReason: "toolUse" }));
        p.handleLine(assistantMsg({ content: [], stopReason: "error", errorMessage: "402 insufficient credits" }));
        const result = p.finish(1)!;
        expect(result.isError).toBe(true);
        expect(result.result).toBe("402 insufficient credits");
    });

    it("synthesizes result: last text, summed usage, turn count", () => {
        const p = createPiParser();
        p.handleLine(HEADER);
        p.handleLine(assistantMsg({ content: [{ type: "text", text: "first" }], stopReason: "toolUse" }));
        p.handleLine(JSON.stringify({ type: "turn_end" }));
        p.handleLine(assistantMsg({ content: [{ type: "text", text: "final answer" }] }));
        p.handleLine(JSON.stringify({ type: "turn_end" }));

        const result = p.finish(1234);
        expect(result).toEqual({
            type: "result",
            sessionId: "0198a5c0-1111-7222-8333-444455556666",
            isError: false,
            result: "final answer",
            numTurns: 2,
            durationMs: 1234,
            usage: { input_tokens: 20, output_tokens: 10 },
            permissionDenials: [],
        });
    });

    it("returns null result when no assistant message was seen", () => {
        const p = createPiParser();
        p.handleLine(HEADER);
        expect(p.finish(10)).toBeNull();
    });

    it("error stopReason yields isError with errorMessage fallback", () => {
        const p = createPiParser();
        // zero-content error message: no assistant event emitted...
        const event = p.handleLine(assistantMsg({
            content: [],
            stopReason: "error",
            errorMessage: "402 insufficient credits",
        }));
        expect(event).toBeNull();
        // ...but the synthesized result carries the error
        const result = p.finish(10)!;
        expect(result.isError).toBe(true);
        expect(result.result).toBe("402 insufficient credits");
    });

    it("retried failure: only the final assistant message decides isError", () => {
        const p = createPiParser();
        p.handleLine(assistantMsg({ content: [], stopReason: "error", errorMessage: "overloaded" }));
        p.handleLine(JSON.stringify({ type: "agent_end", messages: [], willRetry: true }));
        p.handleLine(assistantMsg({ content: [{ type: "text", text: "recovered" }] }));
        const result = p.finish(10)!;
        expect(result.isError).toBe(false);
        expect(result.result).toBe("recovered");
    });
});

describe("pi backend registry", () => {
    it("getBackend returns pi with agentLoop capabilities", () => {
        const backend = getBackend("pi");
        expect(backend.info.name).toBe("pi");
        expect(backend.info.capabilities.agentLoop).toBe(true);
        expect(backend.info.capabilities.sessions).toBe(true);
        expect(backend.info.models).toEqual([]);
        expect(backend.info.efforts).toContain("xhigh");
    });
});
