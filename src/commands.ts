// commands.ts
// Slash command handler — intercepted locally, never sent to Claude.

import { join } from "path";
import { CONFIG_DEFAULTS, type ShellConfig } from "./config";
import { normalizePerms, DIM, RED, BOLD, RESET } from "./shell-utils";
import { KAOMOJI } from "./spinner";
import {
    loadConfigWithSources, saveConfig, deleteConfigKeys, loadSession, loadUsage,
    loadSessions, saveSession, clearSession, loadApproved,
    discoverSessions, discoverConversations,
    resolvePromptFile, listPromptFiles, PROMPTS_DIR,
    GIVERNY_DIR, USAGE_FILE, TRANSCRIPT_FILE,
    type ConfigSource,
} from "./state";
import type { Bridge } from "./bridge-loop";

function timeAgo(date: Date): string {
    const secs = Math.floor((Date.now() - date.getTime()) / 1000);
    if (secs < 60) return "just now";
    if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
    if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
    return `${Math.floor(secs / 86400)}d ago`;
}

// Format a value with its source annotation
const sourceTag = (source: ConfigSource) =>
    source === "default" ? "" : ` ${DIM}(${source})${RESET}`;

const VALID_VERBOSE = ["quiet", "normal", "verbose"];

// Command chaining: `/opus /high write a haiku` → set model, set effort, run prompt.
// Each command consumes only its args and passes the rest along.

// Commands that consume the rest of the line (no chaining after)
const REST_COMMANDS = new Set(["prompt", "compact", "diff"]);

// Commands that consume exactly one argument
const ONE_ARG_COMMANDS = new Set(["model", "effort", "perms", "tools", "output", "session", "timeout", "export"]);

// Commands that consume exactly two arguments
const TWO_ARG_COMMANDS = new Set(["resume", "continue"]);

interface ParsedCommand {
    name: string;
    arg: string;
    remainder: string;
    isLocal: boolean;
}

function parseCommand(cmd: string): ParsedCommand {
    const parts = cmd.slice(1).split(/\s+/).filter(Boolean);
    const name = parts[0] || "";

    if (REST_COMMANDS.has(name)) {
        const isLocal = parts.includes("--local") || parts.includes("-l");
        const argParts = parts.slice(1).filter(p => p !== "--local" && p !== "-l");
        return { name, arg: argParts.join(" "), remainder: "", isLocal };
    }

    const arity = TWO_ARG_COMMANDS.has(name) ? 2 : ONE_ARG_COMMANDS.has(name) ? 1 : 0;
    let isLocal = false;
    let consumed = 1; // command name
    let argsConsumed = 0;
    const argValues: string[] = [];

    for (let i = 1; i < parts.length; i++) {
        if (parts[i] === "--local" || parts[i] === "-l") {
            isLocal = true;
            consumed++;
            continue;
        }
        if (argsConsumed >= arity) break;
        if (parts[i].startsWith("/")) break; // next command boundary
        argValues.push(parts[i]);
        argsConsumed++;
        consumed++;
    }

    return { name, arg: argValues.join(" "), remainder: parts.slice(consumed).join(" "), isLocal };
}

// Chain to remainder: recurse if more commands, return as prompt if text, or done
async function chainRemainder(remainder: string, bridge: Bridge): Promise<string | true> {
    if (!remainder) return true;
    if (remainder.startsWith("/")) return handleSlashCommand(remainder, bridge);
    return remainder;
}

// Build delegated command string for shortcuts (e.g. /opus → /model opus)
function delegateCmd(canonical: string, name: string, isLocal: boolean, remainder: string): string {
    return `/${canonical} ${name}${isLocal ? " --local" : ""}${remainder ? " " + remainder : ""}`;
}

export async function handleSlashCommand(cmd: string, bridge: Bridge): Promise<string | true> {
    const { name, arg, remainder, isLocal } = parseCommand(cmd);
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
            if (status.context_length) {
                const ctx = status.context_length === "unknown" ? "unknown" : `${Number(status.context_length).toLocaleString()} tokens`;
                console.log(`  context:      ${ctx}`);
            }
            if (status.status) console.log(`  server:       ${status.status}`);

            // model/effort are Claude-specific — show server model instead for completions
            if (bridge.info.name !== "completions") {
                console.log(`  model:        ${cfg.model}${sourceTag(sources.model)}`);
                console.log(`  effort:       ${cfg.effort}${sourceTag(sources.effort)}`);
            }

            // Session state — make it clear what's available
            if (caps.sessions) {
                console.log(`  session:      ${cfg.session}${sourceTag(sources.session)}`);
                console.log(`  resume:       ${sessionId || "none"}`);
            } else {
                console.log(`  session:      ${DIM}not supported by ${bridge.info.name}${RESET}`);
            }

            return chainRemainder(remainder, bridge);
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
            if (cfg.systemPrompt && cfg.systemPrompt !== "default") {
                const display = cfg.systemPrompt.length > 40 ? cfg.systemPrompt.slice(0, 40) + "…" : cfg.systemPrompt;
                console.log(`  prompt:  ${display}${sourceTag(sources.systemPrompt)}`);
            }
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
            return chainRemainder(remainder, bridge);
        }
        case "backend": {
            console.log(`backend: ${bridge.info.name}`);
            console.log(`  models:  ${bridge.info.models.map(m => m.id).join(", ")}`);
            console.log(`  efforts: ${(bridge.info.efforts || []).join(", ")}`);
            return chainRemainder(remainder, bridge);
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
            return chainRemainder(remainder, bridge);
        }
        case "opus":
        case "sonnet":
        case "haiku":
            return handleSlashCommand(delegateCmd("model", name, isLocal, remainder), bridge);
        case "model": {
            if (!arg) {
                console.log(`model: ${cfg.model}${sourceTag(sources.model)}`);
                for (const mi of bridge.info.models) {
                    console.log(`  ${mi.id.padEnd(8)} ${mi.description}`);
                }
                console.log(`  /model <name> [--local]${RESET}`);
                return chainRemainder(remainder, bridge);
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
            return chainRemainder(remainder, bridge);
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
                return chainRemainder(remainder, bridge);
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
            return chainRemainder(remainder, bridge);
        }
        case "low":
        case "medium":
        case "high":
        case "max":
            return handleSlashCommand(delegateCmd("effort", name, isLocal, remainder), bridge);
        case "ask":
        case "confirm":
        case "auto":
        case "plan":
            return handleSlashCommand(delegateCmd("perms", name, isLocal, remainder), bridge);
        case "perms": {
            if (!arg) {
                console.log(`perms: ${cfg.perms}${sourceTag(sources.perms)}`);
                console.log(`  ask      prompt before dangerous tools`);
                console.log(`  confirm  prompt before every tool call`);
                console.log(`  auto     skip all permission prompts`);
                console.log(`  plan     read-only, no writes or execution`);
                console.log(`  /perms <mode> [--local]${RESET}`);
                return chainRemainder(remainder, bridge);
            }
            const p = normalizePerms(arg);
            await saveConfig({ perms: p }, isLocal);
            const display = p;
            const where = isLocal ? "local" : "global";
            console.log(`perms: ${display} ${DIM}(${where})${RESET}`);
            return chainRemainder(remainder, bridge);
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
                return chainRemainder(remainder, bridge);
            }
            const toolsVal = arg === "all" ? undefined : arg;
            await saveConfig({ tools: toolsVal }, isLocal);
            const where = isLocal ? "local" : "global";
            console.log(`tools: ${arg} ${DIM}(${where})${RESET}`);
            return chainRemainder(remainder, bridge);
        }
        case "quiet":
        case "normal":
        case "verbose":
            return handleSlashCommand(delegateCmd("output", name, isLocal, remainder), bridge);
        case "output": {
            if (!arg) {
                console.log(`output: ${cfg.output}${sourceTag(sources.output)}`);
                console.log(`  quiet    spinner only, no tool output`);
                console.log(`  normal   tool names + truncated output`);
                console.log(`  verbose  full tool output`);
                console.log(`  /output <level> [--local]${RESET}`);
                return chainRemainder(remainder, bridge);
            }
            const v = arg.toLowerCase();
            if (!VALID_VERBOSE.includes(v)) {
                console.log(`${RED}unknown level: ${arg}${RESET} (${VALID_VERBOSE.join(", ")})`);
                return true;
            }
            await saveConfig({ output: v }, isLocal);
            const where = isLocal ? "local" : "global";
            console.log(`output: ${v} ${DIM}(${where})${RESET}`);
            return chainRemainder(remainder, bridge);
        }
        case "fresh":
        case "keep":
            return handleSlashCommand(delegateCmd("session", name, isLocal, remainder), bridge);
        case "session": {
            if (!arg) {
                console.log(`session: ${cfg.session}${sourceTag(sources.session)}`);
                console.log(`  keep     resume conversation across queries`);
                console.log(`  fresh    each query starts with empty context`);
                console.log(`  /session <mode> [--local]${RESET}`);
                return chainRemainder(remainder, bridge);
            }
            const s = arg.toLowerCase();
            if (s !== "keep" && s !== "fresh") {
                console.log(`${RED}unknown mode: ${arg}${RESET} (keep, fresh)`);
                return true;
            }
            await saveConfig({ session: s }, isLocal);
            const where = isLocal ? "local" : "global";
            console.log(`session: ${s} ${DIM}(${where})${RESET}`);
            return chainRemainder(remainder, bridge);
        }
        case "timeout": {
            if (!arg) {
                console.log(`timeout: ${cfg.timeout || CONFIG_DEFAULTS.timeout}s${sourceTag(sources.timeout)}`);
                console.log(`  /timeout <seconds> [--local]`);
                return chainRemainder(remainder, bridge);
            }
            const secs = parseInt(arg);
            if (isNaN(secs) || secs < 10) {
                console.log(`${RED}timeout must be >= 10 seconds${RESET}`);
                return true;
            }
            await saveConfig({ timeout: secs }, isLocal);
            const where = isLocal ? "local" : "global";
            console.log(`timeout: ${secs}s ${DIM}(${where})${RESET}`);
            return chainRemainder(remainder, bridge);
        }
        case "prompt": {
            if (!arg) {
                const val = cfg.systemPrompt || CONFIG_DEFAULTS.systemPrompt;
                console.log(`prompt: ${val}${sourceTag(sources.systemPrompt)}`);
                // Show resolved content if it's a file reference
                const resolved = await resolvePromptFile(val);
                if (resolved) {
                    const preview = resolved.content.length > 60 ? resolved.content.slice(0, 60) + "…" : resolved.content;
                    console.log(`  ${DIM}→ ${preview}${RESET}`);
                }
                console.log(`  default  built-in tool agent prompt`);
                console.log(`  none     no system prompt`);
                console.log(`  <file>   prompt file ${DIM}(~/.giverny/prompts/ or path)${RESET}`);
                console.log(`  <text>   inline system prompt`);
                // List available prompt files
                const files = listPromptFiles();
                if (files.length > 0) {
                    console.log(`\n${BOLD}prompts${RESET} ${DIM}(${PROMPTS_DIR})${RESET}`);
                    for (const f of files) {
                        const active = f === val ? ` ${BOLD}(active)${RESET}` : "";
                        console.log(`  ${f}${active}`);
                    }
                }
                console.log(`  ${DIM}/prompt <value> [--local]${RESET}`);
                return true;
            }
            // Known single-word values can chain: `/prompt none /new hello`
            // Custom free-text consumes the rest (no way to delimit it)
            const words = arg.split(/\s+/);
            const firstWord = words[0].toLowerCase();
            const promptRest = words.slice(1).join(" ");
            if (firstWord === "default" || firstWord === "reset") {
                await saveConfig({ systemPrompt: "default" }, isLocal);
                const where = isLocal ? "local" : "global";
                console.log(`prompt: default ${DIM}(${where})${RESET}`);
                if (promptRest) return chainRemainder(promptRest, bridge);
                return true;
            }
            if (firstWord === "none") {
                await saveConfig({ systemPrompt: "" }, isLocal);
                const where = isLocal ? "local" : "global";
                console.log(`prompt: none ${DIM}(${where})${RESET}`);
                if (promptRest) return chainRemainder(promptRest, bridge);
                return true;
            }
            // Try to resolve as a file — store the canonical name, not the content
            const resolved = await resolvePromptFile(arg);
            if (resolved) {
                await saveConfig({ systemPrompt: resolved.canonicalName }, isLocal);
                const where = isLocal ? "local" : "global";
                const preview = resolved.content.length > 60 ? resolved.content.slice(0, 60) + "…" : resolved.content;
                console.log(`prompt: ${resolved.canonicalName} ${DIM}(${where})${RESET}`);
                console.log(`  ${DIM}→ ${preview}${RESET}`);
                return true;
            }
            // Inline text fallback
            await saveConfig({ systemPrompt: arg }, isLocal);
            const where = isLocal ? "local" : "global";
            const display = arg.length > 60 ? arg.slice(0, 60) + "…" : arg;
            console.log(`prompt: ${display} ${DIM}(${where})${RESET}`);
            return true;
        }
        case "new":
        case "clear": {
            await clearSession();
            const { unlink } = await import("fs/promises");
            try { await unlink(USAGE_FILE); } catch {}
            try { await unlink(TRANSCRIPT_FILE); } catch {}
            if (remainder) {
                // `/new explain this` or `/new /opus write a haiku` — clear session then chain
                return chainRemainder(remainder, bridge);
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
                ? `Summarize our conversation so far, focusing on: ${arg}. Be very concise — key context, decisions, and current state only.`
                : "Summarize our conversation so far. Be very concise — key context, decisions, and current state only.";
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
            // Backend-aware session discovery
            const isClaude = bridge.info.name === "claude-code";
            const { sessions, total } = isClaude
                ? await discoverSessions()
                : await discoverConversations();

            if (!arg) {
                if (sessions.length === 0) {
                    console.log(`${DIM}no sessions${RESET}`);
                    return true;
                }
                console.log(`${BOLD}sessions${RESET}`);
                for (let i = 0; i < sessions.length; i++) {
                    const s = sessions[i];
                    const ago = timeAgo(new Date(s.ts));
                    const mark = s.active ? ` ${BOLD}(active)${RESET}` : "";
                    const idx = `${i + 1}.`;
                    const preview = s.prompt ? `  ${s.prompt.slice(0, 60)}` : "";
                    const origin = isClaude && s.origin ? ` ${DIM}(${s.origin})${RESET}` : "";
                    const model = !isClaude && s.slug ? ` ${DIM}(${s.slug})${RESET}` : "";
                    console.log(`  ${DIM}${idx.padEnd(4)}${RESET}${s.id.slice(0, 8)}… ${DIM}${ago}${mark}${RESET}${origin}${model}`);
                    if (preview) console.log(`       ${DIM}${preview}${RESET}`);
                }
                if (total > sessions.length) {
                    console.log(`  ${DIM}... ${total - sessions.length} more${RESET}`);
                }
                if (isClaude) {
                    console.log(`\n${DIM}${join(process.env.HOME || "~", ".claude", "projects", process.cwd().replace(/[\/_.]/g, "-"))}/${RESET}`);
                } else {
                    console.log(`\n${DIM}.giverny/conversations/${RESET}`);
                }
                console.log(`${DIM}/resume <n>  ·  /resume <n> claude${RESET}`);
                return chainRemainder(remainder, bridge);
            }
            // Parse: /resume <id> [mode]
            const [selector, mode] = arg.split(/\s+/);
            let target: string | null = null;
            const idx = parseInt(selector);
            if (!isNaN(idx) && idx >= 1 && idx <= sessions.length) {
                target = sessions[idx - 1].id;
            } else {
                const match = sessions.find(s => s.id.startsWith(selector));
                target = match?.id || null;
            }
            if (!target) {
                console.log(`${RED}session not found: ${selector}${RESET}`);
                return true;
            }

            // Claude mode: hand off to claude interactive
            if (mode === "claude" || mode === "c") {
                console.log(`claude -r ${target}`);
                if (process.stdin.isTTY) {
                    process.stderr.write(`${DIM}open in claude? [Y/n] ${RESET}`);
                    const buf = Buffer.alloc(1);
                    const { openSync, readSync, closeSync } = await import("fs");
                    const fd = openSync("/dev/tty", "r");
                    readSync(fd, buf, 0, 1, null);
                    closeSync(fd);
                    const ch = buf[0];
                    process.stderr.write("\n");
                    if (ch === 0x59 || ch === 0x79 || ch === 0x0a || ch === 0x0d) {
                        Bun.spawnSync(["claude", "-r", target], { stdio: ["inherit", "inherit", "inherit"] });
                        process.exit(0);
                    }
                }
                return true;
            }

            // Default: resume in giverny
            await saveSession(target);
            console.log(`resumed: ${target.slice(0, 8)}…`);
            return chainRemainder(remainder, bridge);
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
            return chainRemainder(remainder, bridge);
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
            return chainRemainder(remainder, bridge);
        }
        case "tableflip": {
            const { frames, interval } = KAOMOJI.tableflip;
            for (const frame of frames) {
                process.stdout.write(`\r\x1b[K  ${frame}`);
                await new Promise(r => setTimeout(r, interval));
            }
            process.stdout.write("\n");
            return chainRemainder(remainder, bridge);
        }
        case "reset": {
            const { rm } = await import("fs/promises");
            try { await rm(GIVERNY_DIR, { recursive: true }); } catch {}
            console.log("config + session reset");
            return chainRemainder(remainder, bridge);
        }
        case "help": {
            const { printHelp } = await import("./help.ts");
            printHelp(cfg.prefix || CONFIG_DEFAULTS.prefix);
            return chainRemainder(remainder, bridge);
        }
        default:
            return cmd;
    }
}
