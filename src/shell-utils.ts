// shell-utils.ts
/*
* Pure utility functions for shell mode.
* Extracted from shell.ts so they can be tested without triggering shell execution.
*/

// JSON persistence helpers ------------------------------------------------- /
// Generic load/save for the repeated pattern across config, usage, sessions.

import { mkdirSync, existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const HOME = process.env.HOME || "~";
const GLOBAL_DIR = join(HOME, ".giverny");
const PROJECTS_FILE = join(GLOBAL_DIR, "projects.json");

export async function loadJSON<T>(filePath: string, defaultValue: T): Promise<T> {
    try {
        return JSON.parse(await Bun.file(filePath).text());
    } catch {
        return defaultValue;
    }
}

export async function saveJSON(filePath: string, data: unknown, dir: string, pretty = false) {
    mkdirSync(dir, { recursive: true });
    await Bun.write(filePath, JSON.stringify(data, null, pretty ? 2 : 0) + "\n");
    // Register project directory when writing to a local .giverny/ (not global)
    if (dir.endsWith("/.giverny") && dir !== GLOBAL_DIR) {
        registerProject(dir.replace(/\/\.giverny$/, ""));
    }
}

// Track project directories that have .giverny/ folders
function registerProject(projectDir: string) {
    let projects: string[] = [];
    try {
        projects = JSON.parse(readFileSync(PROJECTS_FILE, "utf-8"));
    } catch {}
    if (!projects.includes(projectDir)) {
        projects.push(projectDir);
        mkdirSync(GLOBAL_DIR, { recursive: true });
        writeFileSync(PROJECTS_FILE, JSON.stringify(projects, null, 2) + "\n");
    }
}

// Permission mode aliases -------------------------------------------------- /

export function normalizePerms(mode: string): string {
    if (mode === "auto" || mode === "bypass" || mode === "bypassPermissions") return "auto";
    if (mode === "ask" || mode === "safe" || mode === "default") return "ask";
    if (mode === "plan" || mode === "readonly") return "plan";
    return mode;
}

// Permission check --------------------------------------------------------- /
// Safe tools auto-approve in ask mode; everything else prompts.
// Bash gets heuristic checkingread-only commands pass through.

const SAFE_TOOLS = new Set(["Read", "Glob", "Grep", "WebSearch", "WebFetch", "LSP"]);

// Read-only command binariesno side effects, no writes
const SAFE_BASH = new Set([
    // filesystem read
    "ls", "cat", "head", "tail", "less", "more", "wc", "file", "stat",
    "find", "tree", "du", "df", "realpath", "readlink", "basename", "dirname",
    // text processing (stdout only, no in-place)
    "grep", "egrep", "fgrep", "rg", "ag", "ack",
    "awk", "sort", "uniq", "tr", "cut", "jq", "yq",
    "diff", "comm", "fmt", "fold", "nl", "tac", "rev", "column",
    // system info
    "echo", "printf", "pwd", "whoami", "which", "type", "where",
    "env", "printenv", "date", "uname", "hostname", "id", "uptime",
    "free", "lscpu", "nproc",
    // misc safe
    "true", "false", "test", "[", "seq",
]);

// Git subcommands that are strictly read-only
const SAFE_GIT = new Set([
    "status", "log", "diff", "show", "blame", "branch",
    "rev-parse", "ls-files", "ls-tree", "shortlog", "describe",
    "reflog", "name-rev", "cat-file", "remote", "tag",
]);

export function isSafeBashCommand(command: string): boolean {
    // Subshells / command substitution can embed anything
    if (/\$\(|`/.test(command)) return false;

    // Strip safe stderr patterns (2>/dev/null, 2>&1), then check for stdout redirects
    const noStderr = command.replace(/2>(?:\/dev\/null|&1)/g, "");
    if (/>{1,2}/.test(noStderr)) return false;

    // Split compound commands (||, &&, ;, |)all parts must be safe
    const parts = command.split(/\s*(?:\|\||&&|;|\|)\s*/);

    return parts.every(part => {
        const tokens = part.trim().split(/\s+/);
        // Skip env var prefixes (FOO=bar cmd)
        let i = 0;
        while (i < tokens.length && /^[A-Za-z_]\w*=/.test(tokens[i])) i++;

        const cmd = tokens[i];
        if (!cmd) return false;

        // Handle path-qualified commands: /usr/bin/ls → ls
        const bin = cmd.split("/").pop() || cmd;

        // git: check subcommand
        if (bin === "git") return SAFE_GIT.has(tokens[i + 1] || "");

        // sed: safe without -i (in-place)
        if (bin === "sed") return !tokens.some(t => t === "-i" || (t.startsWith("-") && t.includes("i")));

        return SAFE_BASH.has(bin);
    });
}

export function needsPermission(toolName: string, input?: Record<string, any>): boolean {
    if (SAFE_TOOLS.has(toolName)) return false;
    if (toolName === "Bash" && input?.command && isSafeBashCommand(input.command)) return false;
    return true;
}

// Danger detection --------------------------------------------------------- /
// Extra confirmation for catastrophically destructive commands.
// Returns a warning string or null.

export function isDangerousCommand(command: string): string | null {
    // rm with recursive flag (-r, -rf, -fr, --recursive) on dangerous paths
    if (/\brm\b/.test(command) && (/\s-\w*r|--recursive/.test(command))) {
        if (/\s\/(\s|$|\*)/.test(command)) return "recursive delete on /";
        if (/\s(~|\$HOME)(\/|\s|$)/.test(command)) return "recursive delete on home";
    }

    // sudo anything
    if (/\bsudo\b/.test(command)) return "elevated privileges (sudo)";

    // disk destruction
    if (/\bmkfs\b/.test(command)) return "filesystem format";
    if (/\bdd\b.*\bof=\/dev\//.test(command)) return "raw disk write";

    // system control
    if (/\b(shutdown|reboot|halt|poweroff)\b/.test(command)) return "system shutdown/reboot";

    // fork bomb
    if (/:\(\)\s*\{/.test(command)) return "fork bomb";

    // pipe to shell (arbitrary remote code execution)
    if (/\b(curl|wget)\b.*\|\s*\b(bash|sh|zsh|fish)\b/.test(command)) return "pipe to shell";

    // recursive chmod/chown on root
    if (/\b(chmod|chown)\b.*-R.*\s+\/(\s|$)/.test(command)) return "recursive permission change on /";

    return null;
}

// Kaomoji (combobulation) -------------------------------------------------- /
// Subtle 2-3 frame flipbook animations for different shell states.
// Each set is a tight loop of the SAME character with small variations.

export interface KaomojiSet {
    frames: string[];
    interval: number; // ms per frame
}

export const KAOMOJI: Record<string, KaomojiSet> = {
    // calm ↔ concentrating (sweat drop appears)
    thinking: {
        frames: [
            " ლ(ಠ_ಠ ლ)", 
            "ლ (ಠ_ಠლ )"
        ],
        interval: 500,
    },
    // peeking from behind wall, waves when spotting something
    reading: {
        frames: [
            "|･ω･)ノ", 
            "|･ω･)ﾉ",
        ],
        interval: 400,
    },
    // pen scribbles back and forth across the page
    writing: {
        frames: [
            "____φ(．．)",
            "___φ-(．．)",
        ],
        interval: 500,
    },
    // speed trail grows as runner picks up pace
    running: {
        frames: [
            "┌( >_<)┘",
            "ε=└( >_<)┐",
            "ε=ε=┌( >_<)┘",
            "ε=ε=ε=└( >_<)┐",
            "ε=ε=ε=ε=┌( >_<)┘",
            "ε=ε=ε=ε=ε=└( >_<)┐",
            "ε=ε=ε=ε=ε=ε=┌( >_<)┘",
            "ε=ε=ε=ε=ε=ε=ε=└( >_<)┐",
            "              ┌(>_< )┘",
            "            └(>_< )┐=3",
            "          ┌(>_< )┘=3=3",
            "        └(>_< )┐=3=3=3",
            "      ┌(>_< )┘=3=3=3=3",
            "    └(>_< )┐=3=3=3=3=3",
            "  ┌(>_< )┘=3=3=3=3=3=3",
            "└(>_< )┐=3=3=3=3=3=3=3",
        ],
        interval: 250,
    },
    // eyes scan left and right
    searching: {
        frames: [
            "( °_°)     ", 
            "  ( °_°)   ", 
            "    ( °_°) ", 
            "     ( °_°)", 
            "     (°_° )", 
            "   (°_° )  ",
            " (°_° )    ",
            "(°_° )     ",
        ],
        interval: 500,
    },
    // two characters high-fiving (hand symbol alternates)
    agent: {
        frames: [
            "(・ω・)人(・ω・)", 
            "(・ω・)八(・ω・)"
        ],
        interval: 500,
    },
    tableflip: {
        frames: [
            "(╮°ー° )╮   ┳━━┳",
            " (╮°ー° )╮  ┳━━┳",
            "  (╮°ー° )╮ ┳━━┳",
            "   (╮°ー° )╮┳━━┳",
            "   ( ╮°ー°)╮┳━━┳",
            "   ( ╯°益°)╯彡┻━━┻",
            "           ┳━━┳ノ(°ー°ノ)",
        ],
        interval: 1000,
    },
};

// All sets except tableflip (that one's triggered by long waits)
const RANDOM_POOL = Object.entries(KAOMOJI)
    .filter(([name]) => name !== "tableflip")
    .map(([, set]) => set);

// Returns a random kaomoji set from the pool.
export function getKaomojiSet(_label: string): KaomojiSet {
    return RANDOM_POOL[Math.floor(Math.random() * RANDOM_POOL.length)];
}

// Token formatting --------------------------------------------------------- /

export function formatTokens(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return String(n);
}

// Tool summary ------------------------------------------------------------- /

export const TOOL_SUMMARIES: Record<string, (input: any) => string> = {
    Bash: (i) => i.command?.slice(0, 80) || "",
    Read: (i) => i.file_path || "",
    Write: (i) => i.file_path || "",
    Edit: (i) => i.file_path || "",
    Grep: (i) => `${i.pattern || ""} ${i.path || ""}`.trim(),
    Glob: (i) => i.pattern || "",
    WebSearch: (i) => i.query?.slice(0, 80) || "",
    WebFetch: (i) => i.url?.slice(0, 80) || "",
};

export function summarizeTool(name: string, input: any): string {
    return (TOOL_SUMMARIES[name] || ((i: any) => JSON.stringify(i).slice(0, 80)))(input);
}
