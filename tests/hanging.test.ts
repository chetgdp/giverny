import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { writeFileSync, chmodSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { BridgeEvent } from "../src/backend";

// We test the generate() lifecycle by swapping `claude` for a shell script
// that simulates various stdout/stderr/exit behaviors.
// GIVERNY_CLAUDE_BIN lets us inject the fake without PATH games.

const tmpDir = mkdtempSync(join(tmpdir(), "giverny-hang-test-"));
const fakeClaude = join(tmpDir, "claude");

// Valid NDJSON that claude -p would emit
const INIT_LINE = JSON.stringify({ type: "system", session_id: "test-session-id" });
const ASSISTANT_LINE = JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "text", text: "hello" }] },
});
const RESULT_LINE = JSON.stringify({
    type: "result",
    session_id: "test-session-id",
    result: "done",
    num_turns: 1,
    duration_api_ms: 100,
    usage: { input_tokens: 10, output_tokens: 5 },
});
const TOOL_USE_LINE = JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "tool_use", id: "tool-1", name: "Bash", input: { command: "echo hi" } }] },
});
const TOOL_RESULT_LINE = JSON.stringify({
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: "tool-1", content: "hi" }] },
    tool_use_result: { stdout: "hi", stderr: "" },
});

function writeFakeClaude(script: string) {
    // The fake ignores all args — it just emits controlled output
    writeFileSync(fakeClaude, `#!/bin/sh\n${script}\n`, "utf-8");
    chmodSync(fakeClaude, 0o755);
}

beforeAll(() => {
    process.env.GIVERNY_CLAUDE_BIN = fakeClaude;
});

afterAll(() => {
    delete process.env.GIVERNY_CLAUDE_BIN;
    rmSync(tmpDir, { recursive: true, force: true });
});

// Helper: run generate() with a race timeout so tests don't hang forever
async function runGenerate(timeoutMs = 5000): Promise<{
    events: BridgeEvent[];
    ok: boolean;
    sessionId?: string;
    error?: string;
}> {
    const { claudeCodeBackend } = await import("../src/bridge");

    const events: BridgeEvent[] = [];
    const result = await Promise.race([
        claudeCodeBackend.generate(
            { prompt: "test", timeout: timeoutMs },
            (event) => { events.push(event); },
        ),
        new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("TEST HUNG — generate() did not resolve")), timeoutMs + 2000)
        ),
    ]);

    return { events, ...result };
}


describe("bridge hanging scenarios", () => {

    // Baseline: normal completion. Result event, clean exit.
    it("normal completion — result event then exit", async () => {
        writeFakeClaude(`
            echo '${INIT_LINE}'
            echo '${ASSISTANT_LINE}'
            echo '${RESULT_LINE}'
            exit 0
        `);

        const { events, ok, sessionId } = await runGenerate();
        expect(ok).toBe(true);
        expect(sessionId).toBe("test-session-id");
        expect(events.some(e => e.type === "assistant")).toBe(true);
        expect(events.some(e => e.type === "result")).toBe(true);
    });

    // The fixed bug: stderr fills the 64KB pipe buffer, blocking stdout.
    it("large stderr output does not hang", async () => {
        writeFakeClaude(`
            echo '${INIT_LINE}'
            echo '${ASSISTANT_LINE}'
            # Write 100KB of stderr to exceed 64KB pipe buffer
            dd if=/dev/zero bs=1024 count=100 2>/dev/null | tr '\\0' 'x' >&2
            echo '${RESULT_LINE}'
            exit 0
        `);

        const { events, ok } = await runGenerate();
        expect(ok).toBe(true);
        expect(events.some(e => e.type === "result")).toBe(true);
    });

    // Tool call cycle: assistant emits tool_use, then tool_result, then result.
    it("tool call cycle completes without hanging", async () => {
        writeFakeClaude(`
            echo '${INIT_LINE}'
            echo '${TOOL_USE_LINE}'
            echo '${TOOL_RESULT_LINE}'
            echo '${ASSISTANT_LINE}'
            echo '${RESULT_LINE}'
            exit 0
        `);

        const { events, ok } = await runGenerate();
        expect(ok).toBe(true);
        expect(events.some(e => e.type === "tool_result")).toBe(true);
        expect(events.some(e => e.type === "result")).toBe(true);
    });

    // Stderr during tool calls — the original hanging scenario.
    it("stderr interleaved with tool calls does not hang", async () => {
        writeFakeClaude(`
            echo '${INIT_LINE}'
            echo '${TOOL_USE_LINE}'
            echo "Tool executing..." >&2
            echo "Running bash command..." >&2
            dd if=/dev/zero bs=1024 count=80 2>/dev/null | tr '\\0' 'e' >&2
            echo '${TOOL_RESULT_LINE}'
            echo '${ASSISTANT_LINE}'
            echo '${RESULT_LINE}'
            exit 0
        `);

        const { events, ok } = await runGenerate();
        expect(ok).toBe(true);
        expect(events.some(e => e.type === "result")).toBe(true);
    });

    // Process exits without sending a result event.
    it("process exit without result event does not hang", async () => {
        writeFakeClaude(`
            echo '${INIT_LINE}'
            echo '${ASSISTANT_LINE}'
            exit 0
        `);

        const { ok } = await runGenerate();
        expect(ok).toBe(true);
    });

    // Process exits with error code, no result event.
    it("process error exit does not hang", async () => {
        writeFakeClaude(`
            echo '${INIT_LINE}'
            echo "something went wrong" >&2
            exit 1
        `);

        const { ok, error } = await runGenerate();
        expect(ok).toBe(false);
        expect(error).toContain("something went wrong");
    });

    // Process lingers after result event.
    // generate() should return on result event, not wait for exit.
    it("lingering process after result does not hang", async () => {
        writeFakeClaude(`
            echo '${INIT_LINE}'
            echo '${ASSISTANT_LINE}'
            echo '${RESULT_LINE}'
            # Linger for 30 seconds — test should NOT wait for this
            sleep 30
        `);

        const start = Date.now();
        const { ok } = await runGenerate();
        const elapsed = Date.now() - start;

        expect(ok).toBe(true);
        // Should resolve well before the 30s sleep
        expect(elapsed).toBeLessThan(5000);
    });

    // Slow drip of output — lines arrive one at a time with delays.
    it("slow output does not hang", async () => {
        writeFakeClaude(`
            echo '${INIT_LINE}'
            sleep 0.1
            echo '${ASSISTANT_LINE}'
            sleep 0.1
            echo '${RESULT_LINE}'
            exit 0
        `);

        const { events, ok } = await runGenerate();
        expect(ok).toBe(true);
        expect(events.some(e => e.type === "result")).toBe(true);
    });

    // No trailing newline on last line — tests the buffer flush path.
    it("no trailing newline on result line", async () => {
        writeFakeClaude(`
            echo '${INIT_LINE}'
            echo '${ASSISTANT_LINE}'
            printf '${RESULT_LINE}'
            exit 0
        `);

        const { events, ok } = await runGenerate();
        expect(ok).toBe(true);
        expect(events.some(e => e.type === "result")).toBe(true);
    });

    // Empty output — process exits immediately with nothing.
    it("empty output does not hang", async () => {
        writeFakeClaude(`exit 0`);

        const { ok } = await runGenerate();
        expect(ok).toBe(true);
    });

    // Timeout fires for a truly stuck process.
    it("stuck process is killed by timeout", async () => {
        writeFakeClaude(`
            echo '${INIT_LINE}'
            echo '${ASSISTANT_LINE}'
            # Never send result, never exit
            sleep 60
        `);

        const { ok } = await runGenerate(2000);
        // Should return (not hang) after timeout kills the process.
        // ok=false is correct — the process was killed, not completed.
        expect(ok).toBe(false);
    });

    // Malformed NDJSON mixed with valid lines.
    it("malformed NDJSON lines are skipped", async () => {
        writeFakeClaude(`
            echo '${INIT_LINE}'
            echo '{broken json'
            echo 'not json at all'
            echo '${ASSISTANT_LINE}'
            echo '{"type":"unknown","data":"ignored"}'
            echo '${RESULT_LINE}'
            exit 0
        `);

        const { events, ok } = await runGenerate();
        expect(ok).toBe(true);
        expect(events.some(e => e.type === "assistant")).toBe(true);
        expect(events.some(e => e.type === "result")).toBe(true);
    });

    // Orphan children holding stdio pipes: generate() must still return fast.
    // This is the "agent finished, terminal never returns" scenario that
    // motivates the process.exit(0) in shell main — generate() itself is fine,
    // but Bun keeps the event loop alive afterward because of the orphan fds.
    it("orphan children holding pipes do not delay generate()", async () => {
        writeFakeClaude(`
            echo '${INIT_LINE}'
            echo '${ASSISTANT_LINE}'
            # Spawn orphan that keeps BOTH pipe fds open and writes continuously
            (
                for i in $(seq 1 60); do
                    echo "noise $i"
                    echo "noise $i" >&2
                    sleep 0.5
                done
            ) &
            echo '${RESULT_LINE}'
            # Parent exits but orphan keeps pipes alive
            exit 0
        `);

        const start = Date.now();
        const { ok } = await runGenerate();
        const elapsed = Date.now() - start;

        expect(ok).toBe(true);
        // Should return promptly despite orphan holding pipes open
        expect(elapsed).toBeLessThan(2000);
    });
});
