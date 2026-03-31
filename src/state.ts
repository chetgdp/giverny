// state.ts
// Config cascade, session persistence, usage tracking, and approved tools.
// All .giverny/ file I/O lives here.

import { join } from "path";
import { mkdirSync, readdirSync, statSync } from "fs";
import { CONFIG_DEFAULTS, type ShellConfig } from "./config";
import { loadJSON, saveJSON } from "./shell-utils";

// File paths ---------------------------------------------------------------- /

const GLOBAL_DIR = join(process.env.HOME || "~", ".giverny");
export const GLOBAL_CONFIG_FILE = join(GLOBAL_DIR, "config.json");
export const GIVERNY_DIR = join(process.cwd(), ".giverny");
const APPROVED_FILE = join(GIVERNY_DIR, "approved");
const CONFIG_FILE = join(GIVERNY_DIR, "config.json");
export const USAGE_FILE = join(GIVERNY_DIR, "usage.json");
const SESSIONS_FILE = join(GIVERNY_DIR, "sessions.json");
export const TRANSCRIPT_FILE = join(GIVERNY_DIR, "transcript.md");

// Config persistence -------------------------------------------------------- /
// Cascade: hardcoded defaults → ~/.giverny/config.json → .giverny/config.json
// /model, /effort, etc. write to global by default. Use --local to override per-directory.

type ConfigKey = keyof ShellConfig;

// Track where each effective value comes from
export type ConfigSource = "default" | "global" | "local";
export type ConfigWithSources = { config: ShellConfig; sources: Record<ConfigKey, ConfigSource> };

export const loadConfig = async (): Promise<ShellConfig> => {
    const global = await loadJSON<ShellConfig>(GLOBAL_CONFIG_FILE, {});
    const local = await loadJSON<ShellConfig>(CONFIG_FILE, {});
    return { ...global, ...local };
};

export const loadConfigWithSources = async (): Promise<ConfigWithSources> => {
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
export const saveConfig = async (cfg: ShellConfig, local: boolean) => {
    if (local) {
        const existing = await loadJSON<ShellConfig>(CONFIG_FILE, {});
        await saveLocalConfig({ ...existing, ...cfg });
    } else {
        const existing = await loadJSON<ShellConfig>(GLOBAL_CONFIG_FILE, {});
        await saveGlobalConfig({ ...existing, ...cfg });
    }
};

// Usage tracking ----------------------------------------------------------- /
// Session-scoped token usage. Resets on /new or /clear.

export interface UsageStats {
    input_tokens: number;
    output_tokens: number;
    turns: number;
    duration_ms: number;
}

const EMPTY_USAGE: UsageStats = { input_tokens: 0, output_tokens: 0, turns: 0, duration_ms: 0 };

export const loadUsage = () => loadJSON<UsageStats>(USAGE_FILE, { ...EMPTY_USAGE });
export const saveUsage = (stats: UsageStats) => saveJSON(USAGE_FILE, stats, GIVERNY_DIR);

// Sessions ----------------------------------------------------------------- /
// Single file tracks all sessions. The one with `active: true` is current.

interface SessionEntry {
    id: string;
    ts: string;
    active?: boolean;
}

export const loadSessions = () => loadJSON<SessionEntry[]>(SESSIONS_FILE, []);
const saveSessions = (entries: SessionEntry[]) => saveJSON(SESSIONS_FILE, entries, GIVERNY_DIR, true);

export async function loadSession(): Promise<string | null> {
    const sessions = await loadSessions();
    return sessions.find(s => s.active)?.id || null;
}

export async function saveSession(id: string) {
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

export async function clearSession() {
    const sessions = await loadSessions();
    for (const s of sessions) s.active = false;
    await saveSessions(sessions);
    const { unlink } = await import("fs/promises");
    try { await unlink(APPROVED_FILE); } catch {}
}

export async function loadApproved(): Promise<Set<string>> {
    try {
        const text = await Bun.file(APPROVED_FILE).text();
        return new Set(text.trim().split("\n").filter(Boolean));
    } catch {
        return new Set();
    }
}

export async function saveApproved(tools: Set<string>) {
    if (tools.size === 0) return;
    mkdirSync(GIVERNY_DIR, { recursive: true });
    await Bun.write(APPROVED_FILE, [...tools].join("\n") + "\n");
}

// Session discovery -------------------------------------------------------- /
// Reads directly from Claude Code's session storage (~/.claude/projects/)
// so giverny and claude code share the same session pool.

const HOME = process.env.HOME || "~";
const CLAUDE_PROJECTS_DIR = join(HOME, ".claude", "projects");

// Claude Code encodes cwd by replacing / with -
// /home/user/code/project → -home-user-code-project
function claudeProjectDir(): string {
    const encoded = process.cwd().replace(/\//g, "-");
    return join(CLAUDE_PROJECTS_DIR, encoded);
}

export interface DiscoveredSession {
    id: string;
    ts: string;
    active: boolean;
    prompt?: string;
    slug?: string;
    origin?: "claude" | "giverny";
}

// Read first ~4KB of a JSONL to extract session metadata.
// Prioritizes user message (has entrypoint, slug) over queue-operation fallback.
async function readSessionHeader(path: string): Promise<{
    ts?: string;
    prompt?: string;
    slug?: string;
    entrypoint?: string;
}> {
    try {
        const chunk = await Bun.file(path).slice(0, 4096).text();
        const lines = chunk.split("\n").filter(Boolean);

        // First pass: look for user message (richest metadata)
        let fallbackTs: string | undefined;
        let fallbackPrompt: string | undefined;
        for (const line of lines.slice(0, 8)) {
            try {
                const data = JSON.parse(line);
                if (data.type === "user" && data.message?.role === "user") {
                    const content = typeof data.message.content === "string"
                        ? data.message.content : "";
                    // Strip XML blocks entirely (command wrappers, caveats, etc.)
                    const clean = content.replace(/<[^>]*>[^<]*<\/[^>]*>/g, "")
                                         .replace(/<[^>]+>/g, "")
                                         .trim();
                    return {
                        ts: data.timestamp,
                        prompt: clean.slice(0, 80) || undefined,
                        slug: data.slug || undefined,
                        entrypoint: data.entrypoint,
                    };
                }
                // Stash queue-operation as fallback
                if (!fallbackTs && data.type === "queue-operation" && data.operation === "enqueue") {
                    fallbackTs = data.timestamp;
                    fallbackPrompt = typeof data.content === "string"
                        ? data.content.slice(0, 80) : undefined;
                }
            } catch {}
        }
        // No user message found — use queue-operation data
        if (fallbackTs) return { ts: fallbackTs, prompt: fallbackPrompt };
    } catch {}
    return {};
}

// Discover all sessions from Claude Code's storage, merged with giverny's active pointer.
// Uses file mtime for sorting (free from readdir), only reads JSONL headers for
// the N sessions actually displayed — avoids touching 100+ files.
export async function discoverSessions(limit = 20): Promise<{ sessions: DiscoveredSession[]; total: number }> {
    const projectDir = claudeProjectDir();
    const activeId = await loadSession();

    let entries: { id: string; mtime: number }[];
    try {
        entries = readdirSync(projectDir)
            .filter(f => f.endsWith(".jsonl"))
            .map(f => ({
                id: f.replace(".jsonl", ""),
                mtime: statSync(join(projectDir, f)).mtimeMs,
            }));
    } catch {
        return [];
    }

    // Sort by mtime descending — most recent first, no JSONL reads needed
    entries.sort((a, b) => b.mtime - a.mtime);

    // Only read headers for the slice we'll display
    const top = entries.slice(0, limit);
    const sessions = await Promise.all(
        top.map(async (entry): Promise<DiscoveredSession> => {
            const meta = await readSessionHeader(join(projectDir, entry.id + ".jsonl"));
            return {
                id: entry.id,
                ts: meta.ts || new Date(entry.mtime).toISOString(),
                active: entry.id === activeId,
                prompt: meta.prompt,
                slug: meta.slug,
                origin: meta.entrypoint === "sdk-cli" ? "giverny" : "claude",
            };
        })
    );

    return { sessions, total: entries.length };
}

export { claudeProjectDir };
