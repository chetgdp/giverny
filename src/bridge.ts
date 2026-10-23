// bridge.ts
/*
* Claude Code Backend
*
* Implements the Backend interface for `claude -p`. Spawns the CLI,
* parses NDJSON output, and exposes a single generate() method.
*
* Used via Bridge (bridge-loop.ts) by server.ts and shell.ts.
*/

import { DEFAULT_EFFORT, DEFAULT_INACTIVITY_TIMEOUT_MS, log, readClaudeAuth } from "./config";
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


// Claude-specific: model normalization ------------------------------------ //

export function normalizeModel(model: string): string {
    // "default" is the config sentinel for backend-default; opus was the
    // claude-code default before it existed, keep that behavior
    if (model === "default") return "opus";
    const cliModel = model
        .replace(/^(anthropic|openai)\//i, "")
        .replace(/\./g, "-");
    if (/opus/i.test(cliModel)) return "opus";
    if (/sonnet/i.test(cliModel)) return "sonnet";
    if (/haiku/i.test(cliModel)) return "haiku";
    return "sonnet";
}

// Claude-specific: permission mapping ------------------------------------- //
// Maps giverny perms names to claude --permission-mode values.

const PERMS_TO_CLAUDE: Record<string, string> = {
    ask:  "default",
    auto: "bypassPermissions",
    plan: "plan",
};

function mapPermissions(perms: string): string {
    return PERMS_TO_CLAUDE[perms] || perms;
}

// Arg builder ------------------------------------------------------------- //

export function buildClaudeArgs(opts: GenerateOptions): string[] {
    const extra = opts.options || {};
    const args = [
        "-p",
        "--output-format", "stream-json",
        "--verbose",
    ];

    if (opts.model) {
        args.push("--model", normalizeModel(opts.model));
    }

    args.push("--effort", extra.effort || DEFAULT_EFFORT);

    // Only pass UUID session IDs — claude -p --resume requires UUID format.
    // Non-UUID IDs (e.g. conv-* from completions backend) are silently dropped.
    if (opts.sessionId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(opts.sessionId)) {
        args.push("--resume", opts.sessionId);
    }

    // Name the session with prompt preview so it's discoverable in `claude --resume`
    if (!opts.sessionId) {
        const name = opts.prompt.replace(/\n.*/s, "").slice(0, 40).trim();
        if (name) args.push("--name", name);
    }

    if (opts.systemPrompt) {
        args.push("--system-prompt", opts.systemPrompt);
    }

    if (extra.tools !== undefined && extra.tools !== "all") {
        args.push("--tools", extra.tools);
    }

    if (extra.perms) {
        args.push("--permission-mode", mapPermissions(extra.perms));
    }

    return args;
}

// NDJSON event parser ----------------------------------------------------- //

function parseNdjsonLine(line: string): BridgeEvent | null {
    if (!line.trim()) return null;

    try {
        const event = JSON.parse(line);

        if (event.type === "assistant") {
            const blocks: ContentBlock[] = [];
            for (const block of event.message?.content || []) {
                if (block.type === "text" && block.text) {
                    blocks.push({ type: "text", text: block.text });
                }
                if (block.type === "tool_use") {
                    blocks.push({
                        type: "tool_use",
                        id: block.id,
                        name: block.name,
                        input: block.input || {},
                    });
                }
            }
            return { type: "assistant", blocks };
        }

        if (event.type === "user") {
            const content = event.message?.content;
            if (Array.isArray(content)) {
                for (const block of content) {
                    if (block.type === "tool_result") {
                        const tr = event.tool_use_result as {
                            stdout?: string;
                            stderr?: string;
                        } | undefined;
                        const content = typeof block.content === "string"
                            ? block.content
                            : Array.isArray(block.content)
                                ? block.content.map((c: any) => c.text || "").join("")
                                : "";
                        return {
                            type: "tool_result" as const,
                            toolUseId: block.tool_use_id || "",
                            content,
                            stdout: tr?.stdout || "",
                            stderr: tr?.stderr || "",
                            isError: !!block.is_error,
                        };
                    }
                }
            }
        }

        if (event.type === "result") {
            const usage = event.usage
                ? {
                        input_tokens: event.usage.input_tokens || 0,
                        output_tokens: event.usage.output_tokens || 0,
                    }
                : null;

            return {
                type: "result",
                sessionId: event.session_id || null,
                isError: !!event.is_error,
                result: event.result || (event.errors?.length ? event.errors.join("; ") : ""),
                numTurns: event.num_turns || 1,
                durationMs: event.duration_api_ms || null,
                usage,
                permissionDenials: (event.permission_denials || []).map((d: any) => ({
                    toolName: d.tool_name,
                    toolInput: d.tool_input || {},
                })),
            };
        }
    } catch {}

    return null;
}

function parseClaudeObject(line: string): { event: BridgeEvent | null; valid: boolean; label: string } {
    if (!line.trim()) return { event: null, valid: false, label: "no event" };
    try {
        const parsed = JSON.parse(line);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            return { event: null, valid: false, label: "invalid JSON event" };
        }
        return {
            event: parseNdjsonLine(line),
            valid: typeof parsed.type === "string",
            label: parsed.type || "unknown event",
        };
    } catch {
        return { event: null, valid: false, label: "invalid JSON event" };
    }
}

// Generate ---------------------------------------------------------------- //
// Spawns claude, streams NDJSON events via callback. Returns ok/error.
// 100 line function lol
async function generate(
    opts: GenerateOptions,
    onEvent: (event: BridgeEvent, control: AbortControl) => void,
): Promise<GenerateResult> {
    const timeout = opts.inactivityTimeoutMs ?? DEFAULT_INACTIVITY_TIMEOUT_MS;
    const args = buildClaudeArgs(opts);

    const bin = process.env.GIVERNY_CLAUDE_BIN || "claude";
    const proc = Bun.spawn([bin, ...args], {
        cwd: opts.cwd || process.cwd(),
        stdin: new Response(opts.prompt),
        stdout: "pipe",
        stderr: "pipe",
    });

    let stopped = false;
    let paused = false;
    let watchdog: ProcessWatchdog;
    const stopWatchdog = () => {
        if (!stopped) {
            stopped = true;
            watchdog.stop();
        }
    };
    const control: ProcessControl = {
        abort:  () => {
            stopWatchdog();
            try { process.kill(proc.pid, "SIGCONT"); } catch {}
            try { proc.kill(9); } catch {}
        },
        pause:  () => {
            if (!paused) {
                paused = true;
                watchdog.suspend();
                try { process.kill(proc.pid, "SIGSTOP"); } catch {}
            }
        },
        resume: () => {
            if (paused) {
                paused = false;
                watchdog.resume();
                try { process.kill(proc.pid, "SIGCONT"); } catch {}
            }
        },
    };

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
    let timedOut = false;
    let lastEvent = "no valid event";
    watchdog = new ProcessWatchdog(timeout, (label, inactivityMs) => {
        timedOut = true;
        stopWatchdog();
        try { proc.kill(9); } catch {}
        try { reader.cancel(); } catch {}
        try { stderrReader.cancel(); } catch {}
        lastEvent = `${label} (${inactivityMs}ms)`;
    });
    watchdog.activity("spawn");
    const decoder = new TextDecoder();
    let buffer = "";
    let sessionId: string | undefined;
    let gotResult = false;

    const handleLine = (line: string) => {
        const parsed = parseClaudeObject(line);
        if (!parsed.valid) return;
        lastEvent = parsed.label;
        watchdog.activity(parsed.label);
        if (!sessionId && line.includes('"session_id"')) {
            try { sessionId = JSON.parse(line).session_id; } catch {}
        }
        if (parsed.event) {
            onEvent(parsed.event, control);
            if (parsed.event.type === "result") gotResult = true;
        }
    };

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";
            for (const line of lines) {
                handleLine(line);
                if (gotResult) break;
            }
            if (gotResult) break;
        }
        if (buffer && !gotResult) handleLine(buffer);
    } finally {
        // Keep the reader locked until cleanup cancellation; cancel releases it.
    }

    if (gotResult) {
        stopWatchdog();
        const exited = await Promise.race([
            proc.exited,
            new Promise<null>(r => setTimeout(() => r(null), 500)),
        ]);
        if (exited === null) { try { proc.kill(9); } catch {} }
        try { reader.cancel(); } catch {}
        try { stderrReader.cancel(); } catch {}
        return { ok: true, sessionId };
    }

    const exitCode = await proc.exited;
    stopWatchdog();
    await Promise.race([stderrDrain, new Promise(r => setTimeout(r, 500))]);
    try { reader.cancel(); } catch {}
    try { stderrReader.cancel(); } catch {}

    if (timedOut) {
        return {
            ok: false,
            sessionId,
            error: `claude stalled after ${timeout}ms of inactivity (last valid event: ${lastEvent})`,
        };
    }
    if (exitCode !== 0) {
        return { ok: false, sessionId, error: stderrText || `claude exited with code ${exitCode}` };
    }
    return { ok: true, sessionId };
}

// Status check ------------------------------------------------------------ //

async function checkStatus(): Promise<Record<string, string>> {
    let version = "unknown";
    try {
        version = Bun.spawnSync(["claude", "--version"]).stdout.toString().trim();
    } catch {}

    const { subscription, rateTier } = readClaudeAuth();

    return { version, subscription: subscription || "unknown", rateTier };
}

// Backend export ---------------------------------------------------------- //

const info: BackendInfo = {
    name: "claude-code",
    models: [
        { id: "opus",   contextWindow: 1_000_000, description: "1M context, supports max effort", efforts: ["low", "medium", "high", "max"] },
        { id: "sonnet", contextWindow: 200_000,   description: "fast + capable, 200k context",    efforts: ["low", "medium", "high"] },
        { id: "haiku",  contextWindow: 200_000,   description: "fastest, 200k context",           efforts: ["low", "medium", "high"] },
    ],
    efforts: ["low", "medium", "high", "max"],
    capabilities: {
        agentLoop: true,
        sessions: true,
        streaming: true,
    },
};

export const claudeCodeBackend: Backend = {
    info,
    generate,
    checkStatus,
};

// Exported for testing
export { parseNdjsonLine };
