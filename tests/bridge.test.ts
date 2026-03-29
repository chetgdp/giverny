import { describe, it, expect } from "bun:test";
import { buildClaudeArgs } from "../src/bridge";

describe("buildClaudeArgs", () => {
    const minimal = { prompt: "hello" };

    it("always includes -p, stream-json, and verbose", () => {
        const args = buildClaudeArgs(minimal);
        expect(args).toContain("-p");
        expect(args).toContain("--output-format");
        expect(args[args.indexOf("--output-format") + 1]).toBe("stream-json");
        expect(args).toContain("--verbose");
    });

    it("passes --model when model is set", () => {
        const args = buildClaudeArgs({ ...minimal, model: "opus" });
        expect(args[args.indexOf("--model") + 1]).toBe("opus");
    });

    it("passes --effort (defaults to DEFAULT_EFFORT)", () => {
        const args = buildClaudeArgs(minimal);
        expect(args).toContain("--effort");
        // explicit effort via options
        const args2 = buildClaudeArgs({ ...minimal, options: { effort: "low" } });
        expect(args2[args2.indexOf("--effort") + 1]).toBe("low");
    });

    it("passes --permission-mode when perms is set", () => {
        const args = buildClaudeArgs({ ...minimal, options: { perms: "auto" } });
        expect(args).toContain("--permission-mode");
        expect(args[args.indexOf("--permission-mode") + 1]).toBe("bypassPermissions");
    });

    it("maps giverny perms to claude values", () => {
        const ask = buildClaudeArgs({ ...minimal, options: { perms: "ask" } });
        expect(ask[ask.indexOf("--permission-mode") + 1]).toBe("default");

        const auto = buildClaudeArgs({ ...minimal, options: { perms: "auto" } });
        expect(auto[auto.indexOf("--permission-mode") + 1]).toBe("bypassPermissions");

        const plan = buildClaudeArgs({ ...minimal, options: { perms: "plan" } });
        expect(plan[plan.indexOf("--permission-mode") + 1]).toBe("plan");
    });

    it("omits --permission-mode when perms is not set", () => {
        const args = buildClaudeArgs(minimal);
        expect(args).not.toContain("--permission-mode");
    });

    it("passes --resume when sessionId is set", () => {
        const args = buildClaudeArgs({ ...minimal, sessionId: "abc-123" });
        expect(args[args.indexOf("--resume") + 1]).toBe("abc-123");
    });

    it("passes --system-prompt when set", () => {
        const args = buildClaudeArgs({ ...minimal, systemPrompt: "be brief" });
        expect(args[args.indexOf("--system-prompt") + 1]).toBe("be brief");
    });

    it("passes --tools when set in options", () => {
        const args = buildClaudeArgs({ ...minimal, options: { tools: "Read,Bash" } });
        expect(args[args.indexOf("--tools") + 1]).toBe("Read,Bash");
    });

    it("passes --tools empty string to disable tools", () => {
        const args = buildClaudeArgs({ ...minimal, options: { tools: "" } });
        expect(args).toContain("--tools");
        expect(args[args.indexOf("--tools") + 1]).toBe("");
    });

    it("omits optional flags when not provided", () => {
        const args = buildClaudeArgs(minimal);
        expect(args).not.toContain("--model");
        expect(args).not.toContain("--resume");
        expect(args).not.toContain("--system-prompt");
        expect(args).not.toContain("--tools");
        expect(args).not.toContain("--permission-mode");
    });

    it("combines all options together", () => {
        const args = buildClaudeArgs({
            prompt: "do stuff",
            model: "sonnet",
            sessionId: "sess-1",
            systemPrompt: "you are helpful",
            options: {
                effort: "high",
                perms: "ask",
                tools: "Read,Edit",
            },
        });
        expect(args[args.indexOf("--model") + 1]).toBe("sonnet");
        expect(args[args.indexOf("--effort") + 1]).toBe("high");
        expect(args[args.indexOf("--permission-mode") + 1]).toBe("default");
        expect(args[args.indexOf("--resume") + 1]).toBe("sess-1");
        expect(args[args.indexOf("--system-prompt") + 1]).toBe("you are helpful");
        expect(args[args.indexOf("--tools") + 1]).toBe("Read,Edit");
    });
});
