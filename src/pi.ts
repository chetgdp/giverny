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

import { DEFAULT_EFFORT, DEFAULT_INACTIVITY_TIMEOUT_MS } from "./config";
import { ProcessWatchdog } from "./process-watchdog";
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
    handleEvent(event: any): BridgeEvent | null;
    finish(durationMs: number): ResultEvent | null;
    sessionId(): string | undefined;
    settled(): boolean;
    lastEvent(): string;
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
    let lastEvent = "spawn";

    function handleEvent(event: unknown): BridgeEvent | null {
        if (!event || typeof event !== "object") return null;
        const record = event as Record<string, unknown>;
        if (typeof record.type !== "string") return null;
        lastEvent = record.type;

        if (record.type === "session" && typeof record.id === "string") {
            sessionId = record.id;
            return null;
        }
        if (record.type === "turn_end") {
            turns++;
            return null;
        }
        if (record.type === "agent_settled") {
            settled = true;
            return null;
        }
        if (record.type === "message_end") {
            const message = record.message;
            if (!message || typeof message !== "object") return null;
            const msg = message as Record<string, unknown>;
            if (msg.role !== "assistant") return null;
            sawAssistant = true;
            lastStopReason = typeof msg.stopReason === "string" ? msg.stopReason : "";
            lastErrorMessage = typeof msg.errorMessage === "string" ? msg.errorMessage : "";
            const usage = msg.usage;
            if (usage && typeof usage === "object") {
                const u = usage as Record<string, unknown>;
                inputTokens += (typeof u.input === "number" ? u.input : 0)
                    + (typeof u.cacheRead === "number" ? u.cacheRead : 0)
                    + (typeof u.cacheWrite === "number" ? u.cacheWrite : 0);
                outputTokens += typeof u.output === "number" ? u.output : 0;
            }
            const content = Array.isArray(msg.content) ? msg.content : [];
            const blocks: ContentBlock[] = [];
            let text = "";
            for (const item of content) {
                if (!item || typeof item !== "object") continue;
                const block = item as Record<string, unknown>;
                if (block.type === "text" && typeof block.text === "string" && block.text) {
                    blocks.push({ type: "text", text: block.text });
                    text += block.text;
                } else if (block.type === "toolCall" && typeof block.name === "string") {
                    blocks.push({
                        type: "tool_use",
                        id: typeof block.id === "string" ? block.id : undefined,
                        name: block.name,
                        input: block.arguments && typeof block.arguments === "object"
                            ? block.arguments as Record<string, unknown> : {},
                    });
                }
            }
            if (text) lastText = text;
            return blocks.length ? { type: "assistant", blocks } : null;
        }
        if (record.type === "tool_execution_end") {
            const result = record.result;
            const resultRecord = result && typeof result === "object"
                ? result as Record<string, unknown> : {};
            const content = Array.isArray(resultRecord.content)
                ? resultRecord.content.filter((item): item is Record<string, unknown> =>
                    !!item && typeof item === "object" && (item as Record<string, unknown>).type === "text")
                    .map(item => typeof item.text === "string" ? item.text : "").join("\n")
                : "";
            return {
                type: "tool_result",
                toolUseId: typeof record.toolCallId === "string" ? record.toolCallId : "",
                content, stdout: content, stderr: "", isError: record.isError === true,
            };
        }
        return null;
    }

    function handleLine(line: string): BridgeEvent | null {
        if (!line.trim()) return null;
        try {
            return handleEvent(JSON.parse(line) as unknown);
        } catch {
            return null;
        }
    }

    function finish(durationMs: number): ResultEvent | null {
        if (!sawAssistant) return null;
        const isError = lastStopReason === "error" || lastStopReason === "aborted";
        return {
            type: "result", sessionId: sessionId || null, isError,
            result: isError ? (lastErrorMessage || lastText) : lastText,
            numTurns: turns || 1, durationMs,
            usage: { input_tokens: inputTokens, output_tokens: outputTokens },
            permissionDenials: [],
        };
    }

    return {
        handleLine, handleEvent, finish,
        sessionId: () => sessionId,
        settled: () => settled,
        lastEvent: () => lastEvent,
    };
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
    const timeout = opts.inactivityTimeoutMs ?? DEFAULT_INACTIVITY_TIMEOUT_MS;
    const startedAt = Date.now();

    const bin = process.env.GIVERNY_PI_BIN || "pi";
    const proc = Bun.spawn([bin, ...args], {
        cwd: opts.cwd || process.cwd(),
        stdin: new Response(opts.prompt),
        stdout: "pipe",
        stderr: "pipe",
    });
    const reader = proc.stdout.getReader();
    let timedOut = false;
    let watchdog: ProcessWatchdog;
    const control: ProcessControl = {
        abort: () => {
            watchdog.stop();
            try { process.kill(proc.pid, "SIGCONT"); } catch {}
            try { proc.kill(9); } catch {}
        },
        pause: () => {
            watchdog.suspend();
            try { process.kill(proc.pid, "SIGSTOP"); } catch {}
        },
        resume: () => {
            try { process.kill(proc.pid, "SIGCONT"); } catch {}
            watchdog.resume();
        },
    };
    // Drain stderr in background to prevent pipe buffer saturation (64KB).
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
    watchdog = new ProcessWatchdog(timeout, (label, inactivityMs) => {
        timedOut = true;
        try { proc.kill(9); } catch {}
        try { reader.cancel(); } catch {}
        try { stderrReader.cancel(); } catch {}
        watchdog.stop();
        stallLabel = `${label}:${inactivityMs}`;
    });
    watchdog.activity("spawn");
    let stallLabel = "spawn";

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
            let parsed: unknown;
            try { parsed = JSON.parse(line) as unknown; } catch { continue; }
            if (parsed && typeof parsed === "object"
                && typeof (parsed as Record<string, unknown>).type === "string") {
                const record = parsed as Record<string, unknown>;
                const type = record.type as string;
                if (type === "auto_retry_start" && typeof record.delayMs === "number") {
                    watchdog.defer(record.delayMs, "auto_retry");
                } else {
                    const tool = typeof record.toolName === "string"
                        ? `:${record.toolName}` : "";
                    watchdog.activity(`${type}${tool}`);
                }
            }
            const event = parser.handleEvent(parsed);
            if (event) onEvent(event, control);
            if (parser.settled()) break;
        }
        if (parser.settled()) break;
    }
    if (buffer && !parser.settled()) {
        let parsed: unknown;
        try { parsed = JSON.parse(buffer) as unknown; } catch { parsed = null; }
        if (parsed && typeof parsed === "object"
            && typeof (parsed as Record<string, unknown>).type === "string") {
            watchdog.activity((parsed as Record<string, unknown>).type as string);
        }
        const event = parser.handleEvent(parsed);
        if (event) onEvent(event, control);
    }
    const sessionId = parser.sessionId();
    if (parser.settled()) {
        watchdog.stop();
        const exited = await Promise.race([
            proc.exited,
            new Promise<null>(resolve => setTimeout(() => resolve(null), 500)),
        ]);
        if (exited === null) { try { proc.kill(9); } catch {} }
        try { reader.cancel(); } catch {}
        try { stderrReader.cancel(); } catch {}
        const result = parser.finish(Date.now() - startedAt);
        if (result) onEvent(result, control);
        return { ok: true, sessionId };
    }
    const exitCode = await proc.exited;
    watchdog.stop();
    await Promise.race([stderrDrain, new Promise(resolve => setTimeout(resolve, 500))]);
    try { reader.cancel(); } catch {}
    try { stderrReader.cancel(); } catch {}
    if (timedOut) {
        return {
            ok: false,
            sessionId,
            error: `pi stalled after ${timeout}ms of inactivity after ${stallLabel}`,
        };
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
