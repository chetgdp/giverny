import { describe, it, expect, beforeAll, afterAll } from "bun:test";

let baseUrl: string;
let server: any;

beforeAll(async () => {
    // Use a test port to avoid colliding with dev instance
    process.env.PORT = "18741";
    const mod = await import("../src/server.ts");
    server = mod.server;
    baseUrl = `http://localhost:${server.port}`;
});

afterAll(() => {
    server?.stop();
});

describe("GET /", () => {
    it("returns 200 with server info", async () => {
        const res = await fetch(`${baseUrl}/`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.name).toBe("giverny");
        expect(body.status).toBe("ok");
        expect(body.endpoints).toContain("/v1/chat/completions");
        expect(body.endpoints).toContain("/v1/models");
    });
});

describe("GET /v1/models", () => {
    it("returns model list", async () => {
        const res = await fetch(`${baseUrl}/v1/models`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.object).toBe("list");
        expect(body.data.length).toBeGreaterThanOrEqual(2);

        const ids = body.data.map((m: any) => m.id);
        expect(ids).toContain("opus");
        expect(ids).toContain("sonnet");
    });

    it("has correct model object shape", async () => {
        const res = await fetch(`${baseUrl}/v1/models`);
        const body = await res.json();
        for (const model of body.data) {
            expect(model.object).toBe("model");
            expect(model.owned_by).toBe("claude-code");
        }
    });
});

describe("OPTIONS (CORS)", () => {
    it("returns 204 with CORS headers", async () => {
        const res = await fetch(`${baseUrl}/v1/chat/completions`, { method: "OPTIONS" });
        expect(res.status).toBe(204);
        expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
        expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
        expect(res.headers.get("Access-Control-Allow-Headers")).toContain("Authorization");
    });
});

describe("404 handling", () => {
    it("returns 404 for unknown paths", async () => {
        const res = await fetch(`${baseUrl}/nonexistent`);
        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.error.message).toBe("Not found");
    });
});

describe("POST /v1/chat/completions validation", () => {
    it("returns 400 for missing messages", async () => {
        const res = await fetch(`${baseUrl}/v1/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
        });
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error.message).toBe("messages is required");
    });

    it("returns 400 for empty messages array", async () => {
        const res = await fetch(`${baseUrl}/v1/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ messages: [] }),
        });
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error.message).toBe("messages is required");
    });

    it("returns 500 for invalid JSON body", async () => {
        const res = await fetch(`${baseUrl}/v1/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "not json",
        });
        expect(res.status).toBe(500);
        const body = await res.json();
        expect(body.error.type).toBe("server_error");
    });
});
