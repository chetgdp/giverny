// bridge.ts
/*
* Claude Code Backend
*
* Implements the Backend interface for `claude -p`. Spawns the CLI,
* parses NDJSON output, and exposes a single generate() method.
*
* Used via Bridge (bridge-loop.ts) by server.ts and shell.ts.
*/

import { DEFAULT_EFFORT, DEFAULT_TIMEOUT, log } from "./config";
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

    if (opts.sessionId) {
        args.push("--resume", opts.sessionId);
    }

    if (opts.systemPrompt) {
        args.push("--system-prompt", opts.systemPrompt);
    }

    if (extra.tools !== undefined) {
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
                        const tr = event.tool_use_result;
                        return {
                            type: "tool_result" as const,
                            toolUseId: block.tool_use_id || "",
                            content: typeof block.content === "string" ? block.content : "",
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
                result: event.result || "",
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

// Generate ---------------------------------------------------------------- //
// Spawns claude, streams NDJSON events via callback. Returns ok/error.

async function generate(
    opts: GenerateOptions,
    onEvent: (event: BridgeEvent, control: AbortControl) => void,
): Promise<GenerateResult> {
    const args = buildClaudeArgs(opts);
    const timeout = opts.timeout ?? DEFAULT_TIMEOUT;

    const proc = Bun.spawn(["claude", ...args], {
        cwd: opts.cwd || process.cwd(),
        stdin: new Response(opts.prompt),
        stdout: "pipe",
        stderr: "pipe",
    });

    // ProcessControl: abort + pause/resume for agentLoop support.
    // Bridge (bridge-loop.ts) detects ProcessControl via type guard
    // and exposes pause/resume through RunControl.
    const control: ProcessControl = {
        abort:  () => { try { process.kill(proc.pid, "SIGCONT"); } catch {} proc.kill(9); },
        pause:  () => { try { process.kill(proc.pid, "SIGSTOP"); } catch {} },
        resume: () => { try { process.kill(proc.pid, "SIGCONT"); } catch {} },
    };

    const timer = setTimeout(() => proc.kill(), timeout);

    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
                const event = parseNdjsonLine(line);
                if (event) onEvent(event, control);
            }
        }

        // Flush remaining buffer
        if (buffer.trim()) {
            const event = parseNdjsonLine(buffer);
            if (event) onEvent(event, control);
        }
    } finally {
        reader.releaseLock();
        clearTimeout(timer);
    }

    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
        return { ok: false, error: stderr || `claude exited with code ${exitCode}` };
    }

    return { ok: true };
}

// Status check ------------------------------------------------------------ //

async function checkStatus(): Promise<Record<string, string>> {
    let version = "unknown";
    try {
        version = Bun.spawnSync(["claude", "--version"]).stdout.toString().trim();
    } catch {}

    let subscription = "unknown";
    let rateTier = "";
    try {
        const { join } = await import("path");
        const creds = JSON.parse(await Bun.file(join(process.env.HOME || "~", ".claude/.credentials.json")).text());
        const oauth = creds.claudeAiOauth || {};
        subscription = oauth.subscriptionType || "unknown";
        rateTier = oauth.rateLimitTier || "";
    } catch {}

    return { version, subscription, rateTier };
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
