import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { writeFileSync, chmodSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { BridgeEvent } from "../src/backend";

// Mirror of hanging.test.ts for the pi backend: generate() lifecycle with a
// fake pi script injected via GIVERNY_PI_BIN. pi has no terminal result
// event — the run ends at agent_end (or stream end for a dying process).

const tmpDir = mkdtempSync(join(tmpdir(), "giverny-pi-hang-test-"));
const fakePi = join(tmpDir, "pi");

const SESSION_ID = "0198a5c0-1111-7222-8333-444455556666";
const HEADER = JSON.stringify({ type: "session", version: 3, id: SESSION_ID, timestamp: "t", cwd: "/tmp" });
const ASSISTANT_LINE = JSON.stringify({
    type: "message_end",
    message: {
        role: "assistant",
        content: [{ type: "text", text: "hello" }],
        usage: { input: 10, output: 5 },
        stopReason: "stop",
    },
});
const TOOL_USE_LINE = JSON.stringify({
    type: "message_end",
    message: {
        role: "assistant",
        content: [{ type: "toolCall", id: "tc-1", name: "bash", arguments: { command: "echo hi" } }],
        usage: { input: 5, output: 2 },
        stopReason: "toolUse",
    },
});
const TOOL_RESULT_LINE = JSON.stringify({
    type: "tool_execution_end",
    toolCallId: "tc-1",
    toolName: "bash",
    result: { content: [{ type: "text", text: "hi" }] },
    isError: false,
});
const TURN_END = JSON.stringify({ type: "turn_end" });
const AGENT_END = JSON.stringify({ type: "agent_end", messages: [] });
const AGENT_SETTLED = JSON.stringify({ type: "agent_settled" });
const ERROR_LINE = JSON.stringify({
    type: "message_end",
    message: { role: "assistant", content: [], stopReason: "error", errorMessage: "provider blew up" },
});

function writeFakePi(script: string) {
    writeFileSync(fakePi, `#!/bin/sh\n${script}\n`, "utf-8");
    chmodSync(fakePi, 0o755);
}

beforeAll(() => {
    process.env.GIVERNY_PI_BIN = fakePi;
});

afterAll(() => {
    delete process.env.GIVERNY_PI_BIN;
    rmSync(tmpDir, { recursive: true, force: true });
});

async function runGenerate(timeoutMs = 5000): Promise<{
    events: BridgeEvent[];
    ok: boolean;
    sessionId?: string;
    error?: string;
}> {
    const { piBackend } = await import("../src/pi");

    const events: BridgeEvent[] = [];
    const result = await Promise.race([
        piBackend.generate(
            { prompt: "test", inactivityTimeoutMs: timeoutMs },
            (event) => { events.push(event); },
        ),
        new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("TEST HUNG — generate() did not resolve")), timeoutMs + 2000)
        ),
    ]);

    return { events, ...result };
}

describe("pi backend hanging scenarios", () => {

    it("normal completion — synthesized result, session id from header", async () => {
        writeFakePi(`
            echo '${HEADER}'
            echo '${ASSISTANT_LINE}'
            echo '${TURN_END}'
            echo '${AGENT_SETTLED}'
            exit 0
        `);

        const { events, ok, sessionId } = await runGenerate();
        expect(ok).toBe(true);
        expect(sessionId).toBe(SESSION_ID);
        expect(events.some(e => e.type === "assistant")).toBe(true);
        const result = events.find(e => e.type === "result");
        expect(result).toBeDefined();
        if (result?.type === "result") {
            expect(result.result).toBe("hello");
            expect(result.isError).toBe(false);
            expect(result.usage).toEqual({ input_tokens: 10, output_tokens: 5 });
            expect(result.numTurns).toBe(1);
            expect(result.sessionId).toBe(SESSION_ID);
        }
    });

    it("tool call cycle completes", async () => {
        writeFakePi(`
            echo '${HEADER}'
            echo '${TOOL_USE_LINE}'
            echo '${TOOL_RESULT_LINE}'
            echo '${TURN_END}'
            echo '${ASSISTANT_LINE}'
            echo '${TURN_END}'
            echo '${AGENT_SETTLED}'
            exit 0
        `);

        const { events, ok } = await runGenerate();
        expect(ok).toBe(true);
        expect(events.some(e => e.type === "tool_result")).toBe(true);
        const result = events.find(e => e.type === "result");
        if (result?.type === "result") {
            expect(result.numTurns).toBe(2);
            expect(result.usage).toEqual({ input_tokens: 15, output_tokens: 7 });
        }
    });

    it("large stderr output does not hang", async () => {
        writeFakePi(`
            echo '${HEADER}'
            dd if=/dev/zero bs=1024 count=100 2>/dev/null | tr '\\0' 'x' >&2
            echo '${ASSISTANT_LINE}'
            echo '${AGENT_SETTLED}'
            exit 0
        `);

        const { events, ok } = await runGenerate();
        expect(ok).toBe(true);
        expect(events.some(e => e.type === "result")).toBe(true);
    });

    it("model error surfaces as isError result, exit code 0", async () => {
        // pi's json mode exits 0 even when the model errored
        writeFakePi(`
            echo '${HEADER}'
            echo '${ERROR_LINE}'
            echo '${AGENT_SETTLED}'
            exit 0
        `);

        const { events, ok } = await runGenerate();
        expect(ok).toBe(true);
        const result = events.find(e => e.type === "result");
        expect(result).toBeDefined();
        if (result?.type === "result") {
            expect(result.isError).toBe(true);
            expect(result.result).toBe("provider blew up");
        }
    });

    it("process exit without any events does not hang", async () => {
        writeFakePi(`exit 0`);

        const { events, ok } = await runGenerate();
        expect(ok).toBe(true);
        expect(events.length).toBe(0);
    });

    it("nonzero exit surfaces stderr as error", async () => {
        writeFakePi(`
            echo "pi config is broken" >&2
            exit 1
        `);

        const { ok, error } = await runGenerate();
        expect(ok).toBe(false);
        expect(error).toContain("pi config is broken");
    });

    it("lingering process after agent_end does not hang", async () => {
        writeFakePi(`
            echo '${HEADER}'
            echo '${ASSISTANT_LINE}'
            echo '${AGENT_SETTLED}'
            sleep 30
        `);

        const start = Date.now();
        const { events, ok } = await runGenerate();
        const elapsed = Date.now() - start;

        expect(ok).toBe(true);
        expect(events.some(e => e.type === "result")).toBe(true);
        // grace period is 500ms; well under the 30s sleep
        expect(elapsed).toBeLessThan(3000);
    });

    it("stuck process is killed by timeout", async () => {
        writeFakePi(`
            echo '${HEADER}'
            echo '${ASSISTANT_LINE}'
            sleep 60
        `);

        const { ok, error } = await runGenerate(2000);
        expect(ok).toBe(false);
        expect(error).toContain("stalled");
    });

    it("no trailing newline on last line", async () => {
        writeFakePi(`
            echo '${HEADER}'
            printf '${ASSISTANT_LINE}'
            exit 0
        `);

        const { events, ok } = await runGenerate();
        expect(ok).toBe(true);
        expect(events.some(e => e.type === "assistant")).toBe(true);
        expect(events.some(e => e.type === "result")).toBe(true);
    });

    it("malformed NDJSON lines are skipped", async () => {
        writeFakePi(`
            echo '${HEADER}'
            echo '{broken json'
            echo 'not json at all'
            echo '${ASSISTANT_LINE}'
            echo '{"type":"queue_update","data":"ignored"}'
            echo '${AGENT_SETTLED}'
            exit 0
        `);

        const { events, ok } = await runGenerate();
        expect(ok).toBe(true);
        expect(events.some(e => e.type === "assistant")).toBe(true);
        expect(events.some(e => e.type === "result")).toBe(true);
    });
    it("disabled timeout permits silent process until settlement", async () => {
        writeFakePi(`
            echo '${HEADER}'
            echo '${ASSISTANT_LINE}'
            sleep 0.25
            echo '${AGENT_SETTLED}'
            exit 0
        `);
        const { ok } = await runGenerate(0);
        expect(ok).toBe(true);
    });

    it("silent process stalls when permission control is not paused", async () => {
        writeFakePi(`
            echo '${HEADER}'
            echo '${ASSISTANT_LINE}'
            sleep 0.25
            echo '${AGENT_SETTLED}'
            exit 0
        `);
        const { ok, error } = await runGenerate(100);
        expect(ok).toBe(false);
        expect(error).toContain("stalled");
    });
    it("valid activity can exceed the inactivity interval", async () => {
        writeFakePi(`
            echo '${HEADER}'
            echo '${ASSISTANT_LINE}'
            sleep 0.03
            echo '{"type":"message_update","delta":"x"}'
            sleep 0.03
            echo '{"type":"message_update","delta":"y"}'
            echo '${AGENT_SETTLED}'
            exit 0
        `);
        const { ok } = await runGenerate(100);
        expect(ok).toBe(true);
    });

    it("malformed noise does not reset inactivity", async () => {
        writeFakePi(`
            echo '${HEADER}'
            echo '${ASSISTANT_LINE}'
            sleep 0.2
            echo '{not valid}'
            sleep 0.2
        `);
        const { ok, error } = await runGenerate(100);
        expect(ok).toBe(false);
        expect(error).toContain("message_end");
    });

    it("retry delay defers the inactivity deadline", async () => {
        writeFakePi(`
            echo '${HEADER}'
            echo '{"type":"auto_retry_start","delayMs":250}'
            sleep 0.15
            echo '${ASSISTANT_LINE}'
            echo '${AGENT_SETTLED}'
            exit 0
        `);
        const { ok } = await runGenerate(100);
        expect(ok).toBe(true);
    });

    it("agent_end is nonterminal before continuation and settlement", async () => {
        writeFakePi(`
            echo '${HEADER}'
            echo '${ASSISTANT_LINE}'
            echo '{"type":"agent_end","willRetry":false}'
            sleep 0.05
            echo '${ASSISTANT_LINE}'
            echo '${AGENT_SETTLED}'
            exit 0
        `);
        const { ok, events } = await runGenerate(100);
        expect(ok).toBe(true);
        expect(events.some(event => event.type === "result")).toBe(true);
    });

    it("orphan children holding pipes do not delay generate()", async () => {
        writeFakePi(`
            echo '${HEADER}'
            echo '${ASSISTANT_LINE}'
            (
                for i in $(seq 1 60); do
                    echo "noise $i"
                    echo "noise $i" >&2
                    sleep 0.5
                done
            ) &
            echo '${AGENT_SETTLED}'
            exit 0
        `);

        const start = Date.now();
        const { ok, events } = await runGenerate();
        const elapsed = Date.now() - start;

        expect(ok).toBe(true);
        expect(events.some(e => e.type === "result")).toBe(true);
        expect(elapsed).toBeLessThan(2000);
    });

    // Guards the settled-path reader cancels: without them the orphan's
    // inherited pipe fds + pending reads keep the event loop alive for ~30s.
    // Unobservable from inside this test process (generate() resolves fine
    // either way), so run generate() in a subprocess and assert the process
    // itself exits promptly without an explicit process.exit.
    it("settled-path cancels release the event loop (subprocess exits)", async () => {
        writeFakePi(`
            echo '${HEADER}'
            echo '${ASSISTANT_LINE}'
            (
                for i in $(seq 1 60); do
                    echo "noise $i"
                    echo "noise $i" >&2
                    sleep 0.5
                done
            ) &
            echo '${AGENT_SETTLED}'
            exit 0
        `);

        const driver = join(tmpDir, "driver.ts");
        const piSrc = join(import.meta.dir, "..", "src", "pi.ts");
        writeFileSync(driver, `
            import { piBackend } from ${JSON.stringify(piSrc)};
            const result = await piBackend.generate({ prompt: "test", inactivityTimeoutMs: 5000 }, () => {});
            console.log("DRIVER_DONE " + result.ok);
            // no process.exit — a leaked fd/read would hang the event loop
        `);

        const proc = Bun.spawn(["bun", driver], {
            env: { ...process.env, GIVERNY_PI_BIN: fakePi },
            stdout: "pipe",
            stderr: "pipe",
        });
        const start = Date.now();
        const exitCode = await Promise.race([
            proc.exited,
            new Promise<never>((_, reject) =>
                setTimeout(() => { proc.kill(9); reject(new Error("DRIVER HUNG — event loop held alive")); }, 5000)
            ),
        ]);
        const elapsed = Date.now() - start;
        const out = await new Response(proc.stdout).text();

        expect(exitCode).toBe(0);
        expect(out).toContain("DRIVER_DONE true");
        expect(elapsed).toBeLessThan(5000);
    }, 10000);

    it("auto-retry: willRetry agent_end does not end the run", async () => {
        writeFakePi(`
            echo '${HEADER}'
            echo '${ERROR_LINE}'
            echo '${JSON.stringify({ type: "agent_end", messages: [], willRetry: true })}'
            echo '${ASSISTANT_LINE}'
            echo '${TURN_END}'
            echo '${AGENT_SETTLED}'
            exit 0
        `);

        const { events, ok } = await runGenerate();
        expect(ok).toBe(true);
        const result = events.find(e => e.type === "result");
        expect(result).toBeDefined();
        if (result?.type === "result") {
            expect(result.isError).toBe(false);
            expect(result.result).toBe("hello");
        }
    });
});
