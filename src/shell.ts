// shell.ts
/*
* Giverny Shell Mode
*
* Wraps `claude -p` with native Claude Code tools enabled and persistent
* per-directory sessions. Streams output to the terminal with compact
* tool usage summaries.
*
* Usage: giverny <prompt>
*        giverny --tools "Read,Bash" <prompt>
*/

import { join } from "path";
import { openSync, readSync, closeSync, mkdirSync } from "fs";
import { CONFIG_DEFAULTS, type ShellConfig } from "./config";
import { getBackend } from "./backend";
import type { BridgeEvent, RunControl } from "./backend";
import { Bridge } from "./bridge-loop";
import { loadJSON, saveJSON, normalizePerms, needsPermission, isDangerousCommand, summarizeTool, getKaomojiSet, KAOMOJI } from "./shell-utils";

const GLOBAL_DIR = join(process.env.HOME || "~", ".giverny");
const GLOBAL_CONFIG_FILE = join(GLOBAL_DIR, "config.json");
const GIVERNY_DIR = join(process.cwd(), ".giverny");
const APPROVED_FILE = join(GIVERNY_DIR, "approved");
const CONFIG_FILE = join(GIVERNY_DIR, "config.json");
const USAGE_FILE = join(GIVERNY_DIR, "usage.json");
const SESSIONS_FILE = join(GIVERNY_DIR, "sessions.json");
const TRANSCRIPT_FILE = join(GIVERNY_DIR, "transcript.md");
const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const BOLD = "\x1b[1m";
const ORANGE = "\x1b[38;2;255;175;135m";
const SEA_GREEN = "\x1b[38;5;43m";
const BLUE = "\x1b[38;5;75m";
const RESET = "\x1b[0m";
const INV = "\x1b[7m";
const MAX_RESULT_LINES = 10;


function timeAgo(date: Date): string {
    const secs = Math.floor((Date.now() - date.getTime()) / 1000);
    if (secs < 60) return "just now";
    if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
    if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
    return `${Math.floor(secs / 86400)}d ago`;
}

// Slash commands ----------------------------------------------------------- /
// Intercepted locally — never sent to Claude.

const VALID_VERBOSE = ["quiet", "normal", "verbose"];

export async function handleSlashCommand(cmd: string, bridge: Bridge): Promise<string | true> {
    const parts = cmd.slice(1).split(/\s+/);
    const name = parts[0];
    const isLocal = parts.includes("--local") || parts.includes("-l");
    const argParts = parts.slice(1).filter(p => p !== "--local" && p !== "-l");
    const arg = argParts.join(" ");
    const { config: cfg, sources } = await loadConfigWithSources();

    switch (name) {
        case "status": {
            const status = await bridge.backend.checkStatus?.() || {};
            const sessionId = await loadSession();
            const caps = bridge.info.capabilities;

            console.log(`${BOLD}status${RESET}`);
            console.log(`  giverny:      0.1.0`);
            console.log(`  backend:      ${bridge.info.name}`);
            console.log(`  cwd:          ${process.cwd()}`);

            // Backend-specific status fields
            if (status.version) console.log(`  version:      ${status.version}`);
            if (status.url) console.log(`  url:          ${status.url}`);
            if (status.subscription) console.log(`  subscription: ${status.subscription}${status.rateTier ? ` (${status.rateTier})` : ""}`);
            if (status.model) console.log(`  server model: ${status.model}`);
            if (status.status) console.log(`  server:       ${status.status}`);

            console.log(`  model:        ${cfg.model}${sourceTag(sources.model)}`);
            console.log(`  effort:       ${cfg.effort}${sourceTag(sources.effort)}`);

            // Session state — make it clear what's available
            if (caps.sessions) {
                console.log(`  session:      ${cfg.session}${sourceTag(sources.session)}`);
                console.log(`  resume:       ${sessionId || "none"}`);
            } else {
                console.log(`  session:      ${DIM}not supported by ${bridge.info.name}${RESET}`);
            }

            return true;
        }
        case "config": {
            const approvedTools = await loadApproved();

            console.log(`${BOLD}giverny config${RESET}`);
            console.log(`  prefix:  ${cfg.prefix}${sourceTag(sources.prefix)}`);
            console.log(`  model:   ${cfg.model}${sourceTag(sources.model)}`);
            console.log(`  effort:  ${cfg.effort}${sourceTag(sources.effort)}`);
            console.log(`  perms:   ${cfg.perms}${sourceTag(sources.perms)}`);
            console.log(`  tools:   ${cfg.tools}${sourceTag(sources.tools)}`);
            console.log(`  output:  ${cfg.output}${sourceTag(sources.output)}`);
            console.log(`  session: ${cfg.session}${sourceTag(sources.session)}`);
            if (approvedTools.size > 0) {
                console.log(`  approved: ${[...approvedTools].join(", ")}`);
            }

            // Backend-specific settings display
            if (bridge.info.name === "claude-code") {
                let ccSettings: Record<string, any> = {};
                try {
                    ccSettings = JSON.parse(await Bun.file(join(process.env.HOME || "~", ".claude/settings.json")).text());
                } catch {}

                if (Object.keys(ccSettings).length > 0) {
                    console.log(`\n${BOLD}claude code settings${RESET} ${DIM}(~/.claude/settings.json)${RESET}`);
                    for (const [key, value] of Object.entries(ccSettings)) {
                        const display = typeof value === "object" ? JSON.stringify(value) : String(value);
                        console.log(`  ${key.padEnd(20)} ${DIM}${display}${RESET}`);
                    }
                }
            }
            return true;
        }
        case "backend": {
            console.log(`backend: ${bridge.info.name}`);
            console.log(`  models:  ${bridge.info.models.map(m => m.id).join(", ")}`);
            console.log(`  efforts: ${(bridge.info.efforts || []).join(", ")}`);
            return true;
        }
        case "context": {
            const usage = await loadUsage();
            const sessionId = await loadSession();
            const m = cfg.model;
            const window = bridge.info.models.find(x => x.id === m)?.contextWindow || 200_000;
            const input = usage.input_tokens || 0;
            const output = usage.output_tokens || 0;
            const used = input + output;
            const pct = window > 0 ? Math.min((used / window) * 100, 100) : 0;

            // Visual bar (clamped so repeat() never gets a negative)
            const barWidth = 40;
            const filled = Math.min(Math.round((pct / 100) * barWidth), barWidth);
            const bar = "█".repeat(filled) + "░".repeat(barWidth - filled);
            const barColor = pct > 80 ? RED : pct > 50 ? "\x1b[33m" : DIM;

            console.log(`${BOLD}context${RESET} ${DIM}(${m}, ${(window / 1000).toFixed(0)}k window)${RESET}`);
            console.log(`  ${barColor}${bar}${RESET} ${pct.toFixed(1)}%`);
            console.log(`  ${used.toLocaleString()} / ${window.toLocaleString()} tokens`);
            if (usage.turns > 0) {
                const secs = (usage.duration_ms / 1000).toFixed(1);
                console.log(`  input: ${input.toLocaleString()} · output: ${output.toLocaleString()}`);
                console.log(`  ${usage.turns} turns · ${secs}s`);
            }
            if (sessionId) {
                console.log(`  ${DIM}${sessionId}${RESET}`);
            }
            return true;
        }
        case "opus":
        case "sonnet":
        case "haiku":
            return handleSlashCommand(`/model ${name}`, bridge);
        case "model": {
            if (!arg) {
                console.log(`model: ${cfg.model}${sourceTag(sources.model)}`);
                for (const mi of bridge.info.models) {
                    console.log(`  ${mi.id.padEnd(8)} ${mi.description}`);
                }
                console.log(`  /model <name> [--local]${RESET}`);
                return true;
            }
            const m = arg.toLowerCase();
            const validModels = bridge.info.models.map(x => x.id);
            if (!validModels.includes(m)) {
                console.log(`${RED}unknown model: ${arg}${RESET} (${validModels.join(", ")})`);
                return true;
            }
            const save: ShellConfig = { model: m };
            const newModelInfo = bridge.info.models.find(x => x.id === m);
            const newModelEfforts = newModelInfo?.efforts || bridge.info.efforts || [];
            if (cfg.effort && !newModelEfforts.includes(cfg.effort)) {
                const fallback = newModelEfforts[newModelEfforts.length - 1] || "high";
                save.effort = fallback;
                console.log(`model: ${m} ${DIM}(effort: ${cfg.effort} → ${fallback}, not supported on ${m})${RESET}`);
            } else {
                const where = isLocal ? "local" : "global";
                console.log(`model: ${m} ${DIM}(${where})${RESET}`);
            }
            await saveConfig(save, isLocal);
            return true;
        }
        case "effort": {
            const allEfforts = bridge.info.efforts || [];
            const modelInfo = bridge.info.models.find(x => x.id === cfg.model);
            const modelEfforts = modelInfo?.efforts || allEfforts;
            if (!arg) {
                const effortDescs: Record<string, string> = {
                    low: "minimal thinking, fastest responses",
                    medium: "balanced speed and quality",
                    high: "thorough, considers edge cases",
                    max: "maximum thinking",
                };
                console.log(`effort: ${cfg.effort}${sourceTag(sources.effort)}`);
                for (const e of allEfforts) {
                    const desc = effortDescs[e] || "";
                    const supported = bridge.info.models.filter(m => (m.efforts || allEfforts).includes(e));
                    const note = supported.length < bridge.info.models.length
                        ? ` (${supported.map(m => m.id).join(", ")} only)`
                        : "";
                    console.log(`  ${e.padEnd(9)}${desc}${note}`);
                }
                console.log(`  /effort <level> [--local]${RESET}`);
                return true;
            }
            const e = arg.toLowerCase();
            if (!allEfforts.includes(e)) {
                console.log(`${RED}unknown effort: ${arg}${RESET} (${allEfforts.join(", ")})`);
                return true;
            }
            if (!modelEfforts.includes(e)) {
                console.log(`${RED}${e} not supported on ${cfg.model}${RESET} (${modelEfforts.join(", ")})`);
                return true;
            }
            await saveConfig({ effort: e }, isLocal);
            const where = isLocal ? "local" : "global";
            console.log(`effort: ${e} ${DIM}(${where})${RESET}`);
            return true;
        }
        case "low":
        case "medium":
        case "high":
        case "max":
            return handleSlashCommand(`/effort ${name}`, bridge);
        case "ask":
        case "auto":
        case "plan":
            return handleSlashCommand(`/perms ${name}`, bridge);
        case "perms": {
            if (!arg) {
                console.log(`perms: ${cfg.perms}${sourceTag(sources.perms)}`);
                console.log(`  ask      prompt before tool use`);
                console.log(`  auto     skip all permission prompts`);
                console.log(`  plan     read-only, no writes or execution`);
                console.log(`  /perms <mode> [--local]${RESET}`);
                return true;
            }
            const p = normalizePerms(arg);
            await saveConfig({ perms: p }, isLocal);
            const display = p;
            const where = isLocal ? "local" : "global";
            console.log(`perms: ${display} ${DIM}(${where})${RESET}`);
            return true;
        }
        case "tools": {
            if (!arg) {
                const active = cfg.tools;
                console.log(`${BOLD}tools${RESET} ${DIM}(${active})${RESET}${sourceTag(sources.tools)}`);
                const tools = [
                    ["Read",      "Read file contents"],
                    ["Write",     "Create or overwrite files"],
                    ["Edit",      "Edit files with string replacement"],
                    ["Bash",      "Execute shell commands"],
                    ["Glob",      "Find files by pattern"],
                    ["Grep",      "Search file contents"],
                    ["WebSearch", "Search the web"],
                    ["WebFetch",  "Fetch a URL"],
                    ["Agent",     "Spawn sub-agents"],
                    ["LSP",       "Language server queries"],
                ];
                const activeSet = active === "all" ? null : new Set(active.split(",").map(s => s.trim()));
                for (const [name, desc] of tools) {
                    const on = !activeSet || activeSet.has(name);
                    const mark = on ? "+" : "-";
                    const color = on ? "" : DIM;
                    console.log(`  ${color}${mark} ${name.padEnd(12)} ${desc}${RESET}`);
                }
                return true;
            }
            const toolsVal = arg === "all" ? undefined : arg;
            await saveConfig({ tools: toolsVal }, isLocal);
            const where = isLocal ? "local" : "global";
            console.log(`tools: ${arg} ${DIM}(${where})${RESET}`);
            return true;
        }
        case "quiet":
        case "normal":
        case "verbose":
            return handleSlashCommand(`/output ${name}`, bridge);
        case "output": {
            if (!arg) {
                console.log(`output: ${cfg.output}${sourceTag(sources.output)}`);
                console.log(`  quiet    spinner only, no tool output`);
                console.log(`  normal   tool names + truncated output`);
                console.log(`  verbose  full tool output`);
                console.log(`  /output <level> [--local]${RESET}`);
                return true;
            }
            const v = arg.toLowerCase();
            if (!VALID_VERBOSE.includes(v)) {
                console.log(`${RED}unknown level: ${arg}${RESET} (${VALID_VERBOSE.join(", ")})`);
                return true;
            }
            await saveConfig({ output: v }, isLocal);
            const where = isLocal ? "local" : "global";
            console.log(`output: ${v} ${DIM}(${where})${RESET}`);
            return true;
        }
        case "fresh":
        case "keep":
            return handleSlashCommand(`/session ${name}`, bridge);
        case "session": {
            if (!arg) {
                console.log(`session: ${cfg.session}${sourceTag(sources.session)}`);
                console.log(`  keep     resume conversation across queries`);
                console.log(`  fresh    each query starts with empty context`);
                console.log(`  /session <mode> [--local]${RESET}`);
                return true;
            }
            const s = arg.toLowerCase();
            if (s !== "keep" && s !== "fresh") {
                console.log(`${RED}unknown mode: ${arg}${RESET} (keep, fresh)`);
                return true;
            }
            await saveConfig({ session: s }, isLocal);
            const where = isLocal ? "local" : "global";
            console.log(`session: ${s} ${DIM}(${where})${RESET}`);
            return true;
        }
        case "new":
        case "clear": {
            await clearSession();
            const { unlink } = await import("fs/promises");
            try { await unlink(USAGE_FILE); } catch {}
            try { await unlink(TRANSCRIPT_FILE); } catch {}
            if (arg) {
                // `/new explain this`clear session then run the prompt
                return arg;
            }
            console.log("session cleared");
            return true;
        }
        case "compact": {
            const sessionId = await loadSession();
            if (!sessionId) {
                console.log(`${DIM}no session to compact${RESET}`);
                return true;
            }
            const instructions = arg
                ? `Summarize our conversation so far, focusing on: ${arg}. Be very concisekey context, decisions, and current state only.`
                : "Summarize our conversation so far. Be very concisekey context, decisions, and current state only.";
            // Run as a regular turn so it streams to terminal
            return instructions;
        }
        case "diff": {
            const diff = Bun.spawnSync(["git", "diff", "--staged"], { cwd: process.cwd() }).stdout.toString()
                       + Bun.spawnSync(["git", "diff"], { cwd: process.cwd() }).stdout.toString();
            if (!diff.trim()) {
                console.log(`${DIM}no changes${RESET}`);
                return true;
            }
            const instruction = arg || "summarize";
            return `${instruction}\n\n${diff}`;
        }
        case "resume":
        case "continue": {
            const sessions = await loadSessions();
            if (!arg) {
                if (sessions.length === 0) {
                    console.log(`${DIM}no sessions${RESET}`);
                    return true;
                }
                console.log(`${BOLD}sessions${RESET}`);
                for (let i = 0; i < sessions.length; i++) {
                    const s = sessions[i];
                    const ago = timeAgo(new Date(s.ts));
                    const mark = s.active ? " (active)" : "";
                    const idx = `${i + 1}.`;
                    console.log(`  ${DIM}${idx.padEnd(4)}${RESET}${s.id} ${DIM}${ago}${mark}${RESET}`);
                }
                console.log(`\n${DIM}/resume <number> or /resume <id>${RESET}`);
                return true;
            }
            // Resume by index or ID prefix
            let target: string | null = null;
            const idx = parseInt(arg);
            if (!isNaN(idx) && idx >= 1 && idx <= sessions.length) {
                target = sessions[idx - 1].id;
            } else {
                const match = sessions.find(s => s.id.startsWith(arg));
                target = match?.id || null;
            }
            if (!target) {
                console.log(`${RED}session not found: ${arg}${RESET}`);
                return true;
            }
            await saveSession(target);
            console.log(`resumed: ${target.slice(0, 8)}…`);
            return true;
        }
        case "export": {
            let transcript: string;
            try {
                transcript = await Bun.file(TRANSCRIPT_FILE).text();
            } catch {
                console.log(`${DIM}no transcript yet${RESET}`);
                return true;
            }
            if (arg) {
                await Bun.write(arg, transcript);
                console.log(`exported to ${arg}`);
            } else {
                process.stdout.write(transcript);
            }
            return true;
        }
        case "copy":
        case "last": {
            let transcript: string;
            try {
                transcript = await Bun.file(TRANSCRIPT_FILE).text();
            } catch {
                console.log(`${DIM}no transcript yet${RESET}`);
                return true;
            }
            // Grab last assistant block
            const matches = [...transcript.matchAll(/<\|assistant\|>\n([\s\S]*?)<\|end\|>/g)];
            const match = matches.length ? [null, matches[matches.length - 1][1]] : null;
            if (match) {
                process.stdout.write(match[1].trim() + "\n");
            } else {
                console.log(`${DIM}no response found${RESET}`);
            }
            return true;
        }
        case "tableflip": {
            const { frames, interval } = KAOMOJI.tableflip;
            for (const frame of frames) {
                process.stdout.write(`\r\x1b[K  ${frame}`);
                await new Promise(r => setTimeout(r, interval));
            }
            process.stdout.write("\n");
            return true;
        }
        case "reset": {
            const { rm } = await import("fs/promises");
            try { await rm(GIVERNY_DIR, { recursive: true }); } catch {}
            console.log("config + session reset");
            return true;
        }
        case "help": {
            const { printHelp } = await import("./help.ts");
            printHelp(cfg.prefix || CONFIG_DEFAULTS.prefix);
            return true;
        }
        default:
            return cmd;
    }
}

// Config persistence ------------------------------------------------------- /
// Cascade: hardcoded defaults → ~/.giverny/config.json → .giverny/config.json
// /model, /effort, etc. write to global by default. Use --local to override per-directory.

type ConfigKey = keyof ShellConfig;

// Track where each effective value comes from
type ConfigSource = "default" | "global" | "local";
type ConfigWithSources = { config: ShellConfig; sources: Record<ConfigKey, ConfigSource> };

const loadConfig = async (): Promise<ShellConfig> => {
    const global = await loadJSON<ShellConfig>(GLOBAL_CONFIG_FILE, {});
    const local = await loadJSON<ShellConfig>(CONFIG_FILE, {});
    return { ...global, ...local };
};

const loadConfigWithSources = async (): Promise<ConfigWithSources> => {
    const global = await loadJSON<ShellConfig>(GLOBAL_CONFIG_FILE, {});
    const local = await loadJSON<ShellConfig>(CONFIG_FILE, {});
    const config = { ...CONFIG_DEFAULTS, ...global, ...local };
    const sources: Record<ConfigKey, ConfigSource> = {} as any;
    for (const key of Object.keys(CONFIG_DEFAULTS) as ConfigKey[]) {
        if (local[key] !== undefined) sources[key] = "local";
        else if (global[key] !== undefined) sources[key] = "global";
        else sources[key] = "default";
    }
    return { config, sources };
};

const saveGlobalConfig = async (cfg: ShellConfig) => saveJSON(GLOBAL_CONFIG_FILE, cfg, GLOBAL_DIR, true);
const saveLocalConfig = async (cfg: ShellConfig) => saveJSON(CONFIG_FILE, cfg, GIVERNY_DIR, true);

// Save to global by default, local if --local flag is present
const saveConfig = async (cfg: ShellConfig, local: boolean) => {
    if (local) {
        const existing = await loadJSON<ShellConfig>(CONFIG_FILE, {});
        await saveLocalConfig({ ...existing, ...cfg });
    } else {
        const existing = await loadJSON<ShellConfig>(GLOBAL_CONFIG_FILE, {});
        await saveGlobalConfig({ ...existing, ...cfg });
    }
};

// Format a value with its source annotation
const sourceTag = (source: ConfigSource) =>
    source === "default" ? "" : ` ${DIM}(${source})${RESET}`;

// Usage tracking ----------------------------------------------------------- /
// Session-scoped token usage. Resets on /new or /clear.

interface UsageStats {
    input_tokens: number;
    output_tokens: number;
    turns: number;
    duration_ms: number;
}

const EMPTY_USAGE: UsageStats = { input_tokens: 0, output_tokens: 0, turns: 0, duration_ms: 0 };

const loadUsage = () => loadJSON<UsageStats>(USAGE_FILE, { ...EMPTY_USAGE });
const saveUsage = (stats: UsageStats) => saveJSON(USAGE_FILE, stats, GIVERNY_DIR);

// Sessions ----------------------------------------------------------------- /
// Single file tracks all sessions. The one with `active: true` is current.

interface SessionEntry {
    id: string;
    ts: string;
    active?: boolean;
}

const loadSessions = () => loadJSON<SessionEntry[]>(SESSIONS_FILE, []);
const saveSessions = (entries: SessionEntry[]) => saveJSON(SESSIONS_FILE, entries, GIVERNY_DIR, true);

async function loadSession(): Promise<string | null> {
    const sessions = await loadSessions();
    return sessions.find(s => s.active)?.id || null;
}

async function saveSession(id: string) {
    const sessions = await loadSessions();
    // Deactivate all, then activate/add this one
    for (const s of sessions) s.active = false;
    const existing = sessions.find(s => s.id === id);
    if (existing) {
        existing.active = true;
        existing.ts = new Date().toISOString();
    } else {
        sessions.unshift({ id, ts: new Date().toISOString(), active: true });
    }
    await saveSessions(sessions);
}

async function clearSession() {
    const sessions = await loadSessions();
    for (const s of sessions) s.active = false;
    await saveSessions(sessions);
    const { unlink } = await import("fs/promises");
    try { await unlink(APPROVED_FILE); } catch {}
}

async function loadApproved(): Promise<Set<string>> {
    try {
        const text = await Bun.file(APPROVED_FILE).text();
        return new Set(text.trim().split("\n").filter(Boolean));
    } catch {
        return new Set();
    }
}

async function saveApproved(tools: Set<string>) {
    if (tools.size === 0) return;
    mkdirSync(GIVERNY_DIR, { recursive: true });
    await Bun.write(APPROVED_FILE, [...tools].join("\n") + "\n");
}

// Output routing ----------------------------------------------------------- /
// When stdout is piped (e.g. `? explain | wl-copy`), decoration goes to
// stderr so the pipe gets clean text only.

const PIPED = !process.stdout.isTTY;
const ui = PIPED ? process.stderr : process.stdout;

// Spinner ------------------------------------------------------------------ /
// Uses kaomoji (combobulation) instead of braille dots.
// Different kaomoji sets for thinking vs tool-specific states.
// Shows elapsed time, phase indicator, and effort level.

interface SpinnerCtx {
    effort: string;
}

export function createSpinner(ctx: SpinnerCtx) {
    let i = 0;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    // Total elapsed time never resets — tracks wall time across all phases
    let startTime = Date.now();

    // Kaomoji and flip state persists across phase changes (thinking → tool → thinking)
    // so animations don't jank on quick tool calls. Shuffles every 20s wall time.
    let current = getKaomojiSet("thinking");
    let lastChangeAt = Date.now();
    let swapAfter = 10 + Math.random() * 10;
    const { frames: flipFrames, interval: flipInterval } = KAOMOJI.tableflip;
    let flipping = false;
    let flipFrame = 0;
    let nextFlipAt = 42;

    return {
        ctx,
        start(label: string) {
            this.stop();
            i = 0;
            // "thinking" is conveyed by the kaomoji — no need for the word
            const showLabel = label !== "thinking";

            const render = () => {
                const totalElapsed = Math.floor((Date.now() - startTime) / 1000);
                const sinceShuffle = Math.floor((Date.now() - lastChangeAt) / 1000);
                // Shuffle to a new random animation every 10-20s (wall time)
                if (!flipping && sinceShuffle >= swapAfter) {
                    current = getKaomojiSet(label);
                    i = 0;
                    lastChangeAt = Date.now();
                    swapAfter = 10 + Math.random() * 10;
                    clearInterval(intervalId!);
                    intervalId = setInterval(render, current.interval);
                }

                // Trigger a tableflip tantrum every 42s (wall time)
                if (!flipping && totalElapsed >= nextFlipAt) {
                    flipping = true;
                    flipFrame = 0;
                    clearInterval(intervalId!);
                    intervalId = setInterval(render, flipInterval);
                }

                // After cycling all flip frames, calm down and go back
                if (flipping && flipFrame >= flipFrames.length) {
                    flipping = false;
                    current = getKaomojiSet(label);
                    i = 0;
                    lastChangeAt = Date.now();
                    swapAfter = 10 + Math.random() * 10;
                    nextFlipAt = totalElapsed + 42;
                    clearInterval(intervalId!);
                    intervalId = setInterval(render, current.interval);
                }

                let face: string;
                if (flipping) {
                    face = flipFrames[flipFrame++];
                } else {
                    face = current.frames[i++ % current.frames.length];
                }

                // \x1b[33G anchors time so kaomoji width changes don't jitter
                const mins = Math.floor(totalElapsed / 60);
                const secs = totalElapsed % 60;
                const time = mins > 0 ? `${mins}m${secs.toString().padStart(2, "0")}s` : `${secs}s`;
                const toolCol = showLabel ? label.padEnd(12) : "".padEnd(12);
                ui.write(`\r\x1b[K${ORANGE}${face}${RESET}\x1b[33G${DIM}${time} · ${this.ctx.effort} · ${toolCol}${RESET}`);
            };

            render(); // first frame immediately
            intervalId = setInterval(render, current.interval);
        },
        stop() {
            if (intervalId) {
                clearInterval(intervalId);
                intervalId = null;
                ui.write("\r\x1b[K");
            }
        },
    };
}

// Permission prompt -------------------------------------------------------- /
// Compact horizontal selector with arrow key navigation.
// Enter = confirm (default: allow), 1/2/3 direct select, Esc/Ctrl+C = deny.

export function promptPermission(toolName: string, defaultDeny = false): "allow" | "tool" | "deny" {
    const options = ["allow", `allow all ${toolName}`, "deny"];
    let sel = defaultDeny ? 2 : 0;

    // Save terminal settings, switch to raw mode for key-by-key input
    const saved = Bun.spawnSync(["stty", "-F", "/dev/tty", "-g"]).stdout.toString().trim();
    Bun.spawnSync(["stty", "-F", "/dev/tty", "raw", "-echo"]);

    const fd = openSync("/dev/tty", "r");

    const render = () => {
        let line = "  ";
        for (let i = 0; i < options.length; i++) {
            line += i === sel
                ? `${INV} ${i + 1}. ${options[i]} ${RESET} `
                : `${DIM} ${i + 1}. ${options[i]} ${RESET} `;
        }
        ui.write(`\r\x1b[K${line}`);
    };

    render();

    try {
        while (true) {
            const buf = Buffer.alloc(8);
            const n = readSync(fd, buf);
            const key = buf.toString("utf8", 0, n);

            if (key === "\r" || key === "\n") break;          // Enter → confirm
            if (key === "1") { sel = 0; break; }              // direct select
            if (key === "2") { sel = 1; break; }
            if (key === "3") { sel = 2; break; }
            if (key === "\x1b[C" || key === "\x1b[B") {       // right / down
                sel = Math.min(sel + 1, 2); render();
            }
            if (key === "\x1b[D" || key === "\x1b[A") {       // left / up
                sel = Math.max(sel - 1, 0); render();
            }
            if (key === "\x03" || key === "\x1b") {            // Ctrl+C / Esc → deny
                sel = 2; break;
            }
        }
    } finally {
        closeSync(fd);
        Bun.spawnSync(["stty", "-F", "/dev/tty", saved]);
    }

    // Replace prompt line with the chosen option
    const color = sel === 2 ? RED : DIM;
    ui.write(`\r\x1b[K  ${color}${options[sel]}${RESET}\n`);
    return (["allow", "tool", "deny"] as const)[sel];
}

// Claude invocation via bridge --------------------------------------------- /

export interface RunShellOpts {
    prompt: string;
    model: string;
    effort: string;
    perms: string;
    tools: string;
    output: string;
    url?: string;
    bridge: Bridge;
}

interface ShellResult {
    sessionId: string | null;
    approvedTools: Set<string>;
    killed: boolean;
    usage: { input_tokens: number; output_tokens: number } | null;
    durationMs: number | null;
    numTurns: number;
    responseText: string;
}

export async function runShell(opts: RunShellOpts, sessionId: string | null, approvedTools: Set<string>, overridePerms?: string): Promise<ShellResult> {
    const { prompt, model, effort, perms, tools, output, url, bridge } = opts;
    const effectivePerms = overridePerms || perms;
    const isAskMode = effectivePerms === "ask";
    let killed = false;

    const spinner = createSpinner({ effort });
    spinner.start("thinking");
    let streamedText = false;
    let responseText = "";

    const onEvent = (event: BridgeEvent, control: RunControl) => {
        if (killed) return;

        if (event.type === "assistant") {
            for (const block of event.blocks) {
                if (killed) return;
                if (block.type === "tool_use") {
                    spinner.stop();

                    // Ensure tool summary starts on its own line
                    if (streamedText && !responseText.endsWith("\n")) {
                        ui.write("\n");
                    }

                    if (output !== "quiet") {
                        const summary = summarizeTool(block.name, block.input);
                        ui.write(`${DIM}[${block.name}] ${summary}${RESET}\n`);

                        // Show diff preview for write operations
                        if (block.name === "Edit" && block.input.old_string != null) {
                            const oldLines = block.input.old_string.split("\n");
                            const newLines = (block.input.new_string || "").split("\n");
                            const maxLines = output === "verbose" ? Infinity : MAX_RESULT_LINES;
                            let count = 0;
                            for (const line of oldLines) {
                                if (count++ >= maxLines) break;
                                ui.write(`${RED}  - ${line}${RESET}\n`);
                            }
                            for (const line of newLines) {
                                if (count++ >= maxLines) break;
                                ui.write(`${SEA_GREEN}  + ${line}${RESET}\n`);
                            }
                            const total = oldLines.length + newLines.length;
                            if (total > maxLines) {
                                ui.write(`${DIM}  ... ${total - count} more lines${RESET}\n`);
                            }
                        } else if (block.name === "Write" && block.input.content != null) {
                            const lines = block.input.content.split("\n");
                            const maxLines = output === "verbose" ? Infinity : MAX_RESULT_LINES;
                            const shown = lines.slice(0, maxLines);
                            for (const line of shown) {
                                ui.write(`${SEA_GREEN}  + ${line}${RESET}\n`);
                            }
                            if (lines.length > maxLines) {
                                ui.write(`${DIM}  ... ${lines.length - maxLines} more lines${RESET}\n`);
                            }
                        }
                    }

                    // Ask mode: pause before dangerous tools, prompt user
                    if (isAskMode && !approvedTools.has(block.name) && needsPermission(block.name, block.input)) {
                        control.pause?.();

                        // Extra warning for catastrophic commands — flips default to deny
                        const danger = block.name === "Bash"
                            ? isDangerousCommand(block.input?.command || "")
                            : null;
                        if (danger) {
                            ui.write(`  ${RED}⚠ ${danger}${RESET}\n`);
                        }

                        const choice = promptPermission(block.name, !!danger);
                        if (choice === "tool") {
                            approvedTools.add(block.name);
                            control.resume?.();
                        } else if (choice === "allow") {
                            control.resume?.();
                        } else {
                            killed = true;
                            control.abort();
                            return;
                        }
                    }

                    // Show tool execution in spinner
                    if (!killed) {
                        const label = block.name;
                        spinner.start(label);
                    }
                }

                if (block.type === "text") {
                    spinner.stop();
                    const text = streamedText ? block.text : block.text.replace(/^\n+/, "");
                    process.stdout.write(text);
                    responseText += text;
                    streamedText = true;
                }
            }
        }

        if (event.type === "tool_result") {
            if (killed) return;
            spinner.stop();

            if (output === "normal" || output === "verbose") {
                const toolOutput = event.stdout || event.content;
                if (toolOutput) {
                    const color = event.isError ? RED : DIM;
                    const lines = toolOutput.split("\n");
                    const maxLines = output === "verbose" ? Infinity : MAX_RESULT_LINES;
                    const shown = lines.slice(0, maxLines);
                    for (const line of shown) {
                        ui.write(`${color}  ${line}${RESET}\n`);
                    }
                    if (lines.length > maxLines) {
                        ui.write(`${color}  ... ${lines.length - maxLines} more lines${RESET}\n`);
                    }
                }
            }
            if (event.stderr) {
                ui.write(`${RED}  ${event.stderr.trim()}${RESET}\n`);
            }

            // Claude processes the result next
            spinner.start("thinking");
        }

        if (event.type === "result") {
            spinner.stop();
            if (event.isError && !killed) {
                process.stderr.write(`Error: ${event.result || "unknown"}\n`);
                process.exit(1);
            }
            // Print result text if we haven't streamed content yet
            if (!streamedText && event.result && !killed) {
                process.stdout.write(event.result);
                responseText = event.result;
            }
        }
    };

    // In ask mode, we bypass the backend's permission system (which can only
    // deny in -p mode) and handle permissions ourselves via pause/resume.
    const bridgeResult = await bridge.run(
        {
            prompt,
            model,
            sessionId: sessionId || undefined,
            options: {
                effort,
                perms: isAskMode ? "auto" : effectivePerms,
                tools,
                url: url || undefined,
            },
        },
        onEvent,
    );

    spinner.stop();

    // Don't error on intentional kill
    if (!killed && bridgeResult.isError && !streamedText) {
        process.stderr.write(bridgeResult.errorText || "Backend error\n");
        process.exit(1);
    }

    process.stdout.write("\n");

    return {
        sessionId: bridgeResult.sessionId,
        approvedTools,
        killed,
        usage: bridgeResult.usage,
        durationMs: bridgeResult.durationMs,
        numTurns: bridgeResult.numTurns,
        responseText,
    };
}

// Main --------------------------------------------------------------------- /

export async function main() {
    // Argument parsing
    const argv = process.argv.slice(2);
    let prompt = argv.join(" ");

    // Piped stdin: `cat file | ? analyze this` or `echo data | ,`
    if (!process.stdin.isTTY) {
        const piped = (await new Response(process.stdin).text()).trim();
        if (piped) {
            prompt = prompt ? `${prompt}\n\n${piped}` : piped;
        }
    } else if (!prompt) {
        // Interactive mode (no pipe, no args) — safe from shell expansion
        process.stdout.write(`${DIM}interactive mode: ctrl+d to send${RESET}\n> `);
        prompt = (await new Response(process.stdin).text()).trim();
    }

    if (!prompt) {
        const pfx = (await loadJSON<{ prefix?: string }>(GLOBAL_CONFIG_FILE, {})).prefix || CONFIG_DEFAULTS.prefix;
        console.log(`Usage: ${pfx} <prompt>    (or /help for commands)`);
        process.exit(0);
    }

    // Load config and backend
    const cfg = await loadConfig();
    const bridge = new Bridge(getBackend(cfg.backend || "claude-code"));

    // Slash command dispatch
    if (prompt.startsWith("/")) {
        const result = await handleSlashCommand(prompt, bridge);
        if (result === true) process.exit(0);
        prompt = result;
    }

    const model = cfg.model;
    const effort = cfg.effort;
    const perms = cfg.perms;
    const tools = cfg.tools;
    const output = cfg.output;
    const shellOpts: RunShellOpts = { prompt, model, effort, perms, tools, output, url: cfg.url, bridge };

    // Session init
    const isFresh = cfg.session === "fresh";
    let sessionId = isFresh ? null : await loadSession();
    let approvedTools = await loadApproved();

    let result: ShellResult;
    try {
        result = await runShell(shellOpts, sessionId, approvedTools);
    } catch (e: any) {
        // If resume failed, retry without session
        if (sessionId && e.message?.includes("error")) {
            await clearSession();
            result = await runShell(shellOpts, null, new Set());
        } else {
            process.stderr.write(`Error: ${e.message}\n`);
            process.exit(1);
        }
    }

    // Always preserve session and approved tools — denying one tool call
    // shouldn't destroy context. Null checks protect against partial state.
    if (!isFresh && result.sessionId) {
        await saveSession(result.sessionId);
    }
    if (result.approvedTools.size > 0) await saveApproved(result.approvedTools);

    if (!result.killed) {
        // Append to transcript (skip on kill — response may be mid-sentence)
        if (result.responseText) {
            const { appendFileSync } = await import("fs");
            mkdirSync(GIVERNY_DIR, { recursive: true });
            appendFileSync(TRANSCRIPT_FILE, `<|user|>\n${prompt}\n<|end|>\n<|assistant|>\n${result.responseText.trim()}\n<|end|>\n`);
        }

        // Accumulate session usage
        if (result.usage) {
            const prev = await loadUsage();
            await saveUsage({
                input_tokens: prev.input_tokens + result.usage.input_tokens,
                output_tokens: prev.output_tokens + result.usage.output_tokens,
                turns: prev.turns + result.numTurns,
                duration_ms: prev.duration_ms + (result.durationMs || 0),
            });
        }
    }

    process.stdout.write("\n");
}

if (import.meta.main) main();
