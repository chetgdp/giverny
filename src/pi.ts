// pi.ts
/*
* pi Backend
*
* Implements the Backend interface for `pi --mode json` (pi-mono coding agent).
* Spawns the CLI, parses NDJSON output, and exposes a single generate() method.
*
* Unlike claude -p there is no terminal "result" event — pi exits when the
* prompt completes, so we synthesize the ResultEvent at stream end from
* accumulated state (last assistant message, summed usage, turn count).
*
* Used via Bridge (bridge-loop.ts) by shell.ts.
*/

import { DEFAULT_EFFORT, DEFAULT_TIMEOUT } from "./config";
import type {
    Backend,
    BackendInfo,
    GenerateOptions,
    GenerateResult,
    BridgeEvent,
    AbortControl,
    ProcessControl,
    ContentBlock,
    ResultEvent,
} from "./backend";

// pi session ids: alphanumeric with inner . _ - (core/session-manager.ts).
// Ids from other backends (conv-*) happen to pass too; resolveSession in
// shell.ts prevents cross-backend ids from reaching us.
const PI_SESSION_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

// Arg builder ------------------------------------------------------------- //

export function buildPiArgs(opts: GenerateOptions): string[] {
    const extra = opts.options || {};
    // --mode json alone selects single-shot print mode; -p is deliberately
    // omitted because pi's -p greedily captures the next argv as the prompt.
    const args = ["--mode", "json"];

    // "default" = leave model choice to pi's own config (provider-agnostic)
    if (opts.model && opts.model !== "default") {
        args.push("--model", opts.model);
    }

    // giverny efforts map 1:1 to pi thinking levels
    args.push("--thinking", extra.effort || DEFAULT_EFFORT);

    if (opts.sessionId && PI_SESSION_ID.test(opts.sessionId)) {
        args.push("--session-id", opts.sessionId);
    }

    if (opts.systemPrompt) {
        args.push("--system-prompt", opts.systemPrompt);
    }

    // Plan mode has no shell-side prompt (only ask/confirm do) and pi has no
    // permission flag, so enforce read-only at the tool level instead.
    if (extra.perms === "plan") {
        args.push("--tools", "read,grep,find,ls");
    } else if (extra.tools !== undefined && extra.tools !== "all") {
        // lowercase so a tools filter saved under claude-code (Read,Bash)
        // still matches pi's lowercase tool names
        args.push("--tools", extra.tools.toLowerCase());
    }

    // No other permission mapping: ask/confirm are handled shell-side via
    // pause/prompt (checkPermissions); proper gating comes via a pi
    // extension later.
    return args;
}

// NDJSON stream parser ------------------------------------------------------ //
// Stateful (unlike bridge.ts's pure line parser): the ResultEvent is
// synthesized at stream end from accumulated messages/usage/turns.

export interface PiParser {
    handleLine(line: string): BridgeEvent | null;
    finish(durationMs: number): ResultEvent | null;
    sessionId(): string | undefined;
    // true once agent_end without willRetry was seen — the run is complete
    // even if the stdout pipe is still held open by an orphaned child
    settled(): boolean;
}

export function createPiParser(): PiParser {
    let sessionId: string | undefined;
    let turns = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let sawAssistant = false;
    let settled = false;
    let lastText = "";
    let lastStopReason = "";
    let lastErrorMessage = "";

    function handleLine(line: string): BridgeEvent | null {
        if (!line.trim()) return null;

        let event: any;
        try {
            event = JSON.parse(line);
        } catch {
            return null;
        }

        if (event.type === "session" && event.id) {
            sessionId = event.id;
            return null;
        }

        if (event.type === "turn_end") {
            turns++;
            return null;
        }

        if (event.type === "agent_end" && !event.willRetry) {
            settled = true;
            return null;
        }

        if (event.type === "message_end" && event.message?.role === "assistant") {
            const msg = event.message;
            sawAssistant = true;
            lastStopReason = msg.stopReason || "";
            lastErrorMessage = msg.errorMessage || "";
            if (msg.usage) {
                // cache reads/writes occupy context, count them as input
                inputTokens += (msg.usage.input || 0)
                    + (msg.usage.cacheRead || 0)
                    + (msg.usage.cacheWrite || 0);
                outputTokens += msg.usage.output || 0;
            }

            const blocks: ContentBlock[] = [];
            let text = "";
            for (const block of msg.content || []) {
                if (block.type === "text" && block.text) {
                    blocks.push({ type: "text", text: block.text });
                    text += block.text;
                }
                if (block.type === "toolCall") {
                    blocks.push({
                        type: "tool_use",
                        id: block.id,
                        name: block.name,
                        input: block.arguments || {},
                    });
                }
                // thinking blocks dropped
            }
            // Track text only from content-bearing messages so a trailing
            // zero-content retry/error message doesn't wipe the answer.
            if (text) lastText = text;

            // pi's auto-retry produces zero-content error messages before
            // retrying; don't surface those as assistant turns.
            if (blocks.length === 0) return null;
            return { type: "assistant", blocks };
        }

        if (event.type === "tool_execution_end") {
            const content = (event.result?.content || [])
                .filter((c: any) => c.type === "text")
                .map((c: any) => c.text || "")
                .join("\n");
            return {
                type: "tool_result",
                toolUseId: event.toolCallId || "",
                content,
                stdout: content,   // pi has no stdout/stderr split
                stderr: "",
                isError: !!event.isError,
            };
        }

        // message_update deltas, turn/agent lifecycle, retries: ignored
        return null;
    }

    function finish(durationMs: number): ResultEvent | null {
        if (!sawAssistant) return null;
        const isError = lastStopReason === "error" || lastStopReason === "aborted";
        return {
            type: "result",
            sessionId: sessionId || null,
            isError,
            // on error, the reason beats stale mid-run text
            result: isError ? (lastErrorMessage || lastText) : lastText,
            numTurns: turns || 1,
            durationMs,
            usage: { input_tokens: inputTokens, output_tokens: outputTokens },
            permissionDenials: [],
        };
    }

    return { handleLine, finish, sessionId: () => sessionId, settled: () => settled };
}

// Generate ---------------------------------------------------------------- //
// Spawns pi, streams NDJSON events via callback. Returns ok/error.
// Same four lifecycle invariants as bridge.ts (see CLAUDE.md), except there
// is no early-exit event: pi exits on its own, so the loop runs to stream
// end, then both readers are cancelled anyway.

async function generate(
    opts: GenerateOptions,
    onEvent: (event: BridgeEvent, control: AbortControl) => void,
): Promise<GenerateResult> {
    // pi silently no-ops on a whitespace-only prompt (exits 0 with just the
    // session header) — fail clearly instead
    if (!opts.prompt.trim()) {
        return { ok: false, error: "empty prompt" };
    }

    const args = buildPiArgs(opts);
    const timeout = opts.timeout ?? DEFAULT_TIMEOUT;
    const startedAt = Date.now();

    const bin = process.env.GIVERNY_PI_BIN || "pi";
    const proc = Bun.spawn([bin, ...args], {
        cwd: opts.cwd || process.cwd(),
        stdin: new Response(opts.prompt),
        stdout: "pipe",
        stderr: "pipe",
    });

    const control: ProcessControl = {
        abort:  () => { try { process.kill(proc.pid, "SIGCONT"); } catch {} proc.kill(9); },
        pause:  () => { try { process.kill(proc.pid, "SIGSTOP"); } catch {} },
        resume: () => { try { process.kill(proc.pid, "SIGCONT"); } catch {} },
    };

    // Drain stderr in background to prevent pipe buffer saturation (64KB).
    // Uses a reader (not Response) so it can be cancelled — orphaned child
    // processes inherit pipe fds and keep them open after pi exits.
    let stderrText = "";
    const stderrReader = proc.stderr.getReader();
    const stderrDrain = (async () => {
        const dec = new TextDecoder();
        const chunks: string[] = [];
        try {
            while (true) {
                const { done, value } = await stderrReader.read();
                if (done) break;
                if (value) chunks.push(dec.decode(value, { stream: true }));
            }
        } catch {}
        stderrText = chunks.join("");
    })();

    const reader = proc.stdout.getReader();

    // Timeout backstop: kill the process AND cancel both readers.
    // Each op is wrapped so one failing doesn't skip the others.
    let timedOut = false;
    const timer = setTimeout(() => {
        timedOut = true;
        try { proc.kill(9); } catch {}
        try { reader.cancel(); } catch {}
        try { stderrReader.cancel(); } catch {}
    }, timeout);

    const decoder = new TextDecoder();
    const parser = createPiParser();
    let buffer = "";

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
            const event = parser.handleLine(line);
            if (event) onEvent(event, control);
        }
        // agent_end = run complete; don't wait for stream end — an orphaned
        // child holding the stdout pipe would stall it until the timeout
        if (parser.settled()) break;
    }

    // Flush remaining buffer — if the last line had no trailing \n,
    // it's still sitting in buffer and was never parsed.
    if (buffer && !parser.settled()) {
        const event = parser.handleLine(buffer);
        if (event) onEvent(event, control);
    }

    const sessionId = parser.sessionId();

    if (parser.settled()) {
        // Disarm the timeout first — if it fired inside the grace window it
        // would kill(9) pi mid shutdown, defeating the grace period.
        clearTimeout(timer);
        // Grace period so pi can finish session writes and exit on its own,
        // then kill — a lingering process must not hold generate() hostage.
        const exited = await Promise.race([
            proc.exited,
            new Promise<null>(r => setTimeout(() => r(null), 500)),
        ]);
        if (exited === null) { try { proc.kill(9); } catch {} }
        try { reader.cancel(); } catch {}       // close stdout pipe fd — orphaned children keep it open
        try { stderrReader.cancel(); } catch {}

        // pi's json mode exits 0 even when the model errored — the synthesized
        // result carries isError from the last assistant stopReason.
        const result = parser.finish(Date.now() - startedAt);
        if (result) onEvent(result, control);
        return { ok: true, sessionId };
    }

    // No agent_end seen: stream ended on its own (pi died, fake test binary,
    // or timeout cancelled the readers). Exit code decides.
    const exitCode = await proc.exited;
    clearTimeout(timer);
    // Give stderr a moment to flush, then bail
    await Promise.race([stderrDrain, new Promise(r => setTimeout(r, 500))]);
    try { reader.cancel(); } catch {}
    try { stderrReader.cancel(); } catch {}

    if (timedOut) {
        return { ok: false, sessionId, error: `pi timed out after ${timeout}ms` };
    }
    if (exitCode !== 0) {
        return { ok: false, sessionId, error: stderrText || `pi exited with code ${exitCode}` };
    }

    const result = parser.finish(Date.now() - startedAt);
    if (result) onEvent(result, control);

    return { ok: true, sessionId };
}

// Status check ------------------------------------------------------------ //

async function checkStatus(): Promise<Record<string, string>> {
    let version = "unknown";
    try {
        const bin = process.env.GIVERNY_PI_BIN || "pi";
        version = Bun.spawnSync([bin, "--version"]).stdout.toString().trim();
    } catch {}
    return { version };
}

// Backend export ---------------------------------------------------------- //

const info: BackendInfo = {
    // models is empty on purpose: pi is provider-agnostic and the user
    // configures models in pi itself. /model passes any id through verbatim.
    name: "pi",
    models: [],
    efforts: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
    capabilities: {
        agentLoop: true,
        sessions: true,
        streaming: true,
    },
};

export const piBackend: Backend = {
    info,
    generate,
    checkStatus,
};
