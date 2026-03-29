import { describe, it, expect } from "bun:test";
import { getBackend } from "../src/backend";
import { executeTool, TOOL_SCHEMAS } from "../src/tools";

describe("backend registry", () => {
    it("returns claude-code backend", () => {
        const b = getBackend("claude-code");
        expect(b.info.name).toBe("claude-code");
        expect(b.info.capabilities.agentLoop).toBe(true);
    });

    it("returns llama-server backend", () => {
        const b = getBackend("llama-server");
        expect(b.info.name).toBe("llama-server");
        expect(b.info.capabilities.agentLoop).toBe(false);
        expect(b.info.capabilities.sessions).toBe(false);
    });

    it("throws on unknown backend", () => {
        expect(() => getBackend("nope")).toThrow("Unknown backend: nope");
    });
});

describe("TOOL_SCHEMAS", () => {
    it("has one tool: exec", () => {
        expect(TOOL_SCHEMAS).toHaveLength(1);
        expect(TOOL_SCHEMAS[0].function.name).toBe("exec");
    });

    it("exec schema has command parameter", () => {
        const params = TOOL_SCHEMAS[0].function.parameters;
        expect(params.properties.command).toBeDefined();
        expect(params.required).toContain("command");
    });
});

describe("executeTool", () => {
    it("runs a shell command and returns stdout", async () => {
        const result = await executeTool("exec", { command: "echo hello" });
        expect(result.stdout.trim()).toBe("hello");
        expect(result.isError).toBe(false);
    });

    it("captures stderr", async () => {
        const result = await executeTool("exec", { command: "echo err >&2" });
        expect(result.stderr.trim()).toBe("err");
        expect(result.isError).toBe(false);
    });

    it("reports non-zero exit as error", async () => {
        const result = await executeTool("exec", { command: "exit 1" });
        expect(result.isError).toBe(true);
    });

    it("rejects unknown tools", async () => {
        const result = await executeTool("fake", { command: "echo hi" });
        expect(result.isError).toBe(true);
        expect(result.stderr).toContain("Unknown tool");
    });

    it("rejects exec without command", async () => {
        const result = await executeTool("exec", {});
        expect(result.isError).toBe(true);
    });

    it("respects cwd", async () => {
        const result = await executeTool("exec", { command: "pwd" }, "/tmp");
        expect(result.stdout.trim()).toBe("/tmp");
    });
});
