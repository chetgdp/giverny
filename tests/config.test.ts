import { describe, it, expect } from "bun:test";
import { normalizeModel } from "../src/bridge";

describe("normalizeModel", () => {
    it("returns opus for opus variants", () => {
        expect(normalizeModel("opus")).toBe("opus");
        expect(normalizeModel("OPUS")).toBe("opus");
        expect(normalizeModel("claude-opus-4-6")).toBe("opus");
    });

    it("returns sonnet for sonnet variants", () => {
        expect(normalizeModel("sonnet")).toBe("sonnet");
        expect(normalizeModel("claude-3-5-sonnet")).toBe("sonnet");
    });

    it("returns haiku for haiku variants", () => {
        expect(normalizeModel("haiku")).toBe("haiku");
        expect(normalizeModel("claude-3-haiku")).toBe("haiku");
    });

    it("strips anthropic/ and openai/ prefixes", () => {
        expect(normalizeModel("anthropic/claude-opus")).toBe("opus");
        expect(normalizeModel("openai/claude-sonnet")).toBe("sonnet");
        expect(normalizeModel("Anthropic/Claude-Haiku")).toBe("haiku");
    });

    it("converts dots to dashes", () => {
        expect(normalizeModel("anthropic/claude-3.5-sonnet")).toBe("sonnet");
    });

    it("defaults to sonnet for unknown models", () => {
        expect(normalizeModel("gpt-4")).toBe("sonnet");
        expect(normalizeModel("some-random-model")).toBe("sonnet");
        expect(normalizeModel("")).toBe("sonnet");
    });
});
