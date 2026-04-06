// shell-utils.ts
/*
* Pure utility functions for shell mode.
* Permission classifiers, output routing, ANSI constants, display width,
* tool summaries, token formatting.
*/

// Permission mode aliases -------------------------------------------------- /
export function normalizePerms(mode: string): string {
    if (mode === "auto" || mode === "bypass" || mode === "bypassPermissions") return "auto";
    if (mode === "confirm" || mode === "strict") return "confirm";
    if (mode === "ask" || mode === "safe" || mode === "default") return "ask";
    if (mode === "plan" || mode === "readonly") return "plan";
    return mode;
}

// UUID helper
export function isUUID(id: string) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
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
    if ((toolName === "Bash" || toolName === "exec") && input?.command && isSafeBashCommand(input.command)) return false;
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

// Terminal display width ---------------------------------------------------- /
// Approximates wcwidth for column-aware rendering (kaomoji contain CJK/fullwidth chars).
export function displayWidth(s: string): number {
    let w = 0;
    for (const ch of s) {
        const cp = ch.codePointAt(0)!;
        // Zero-width: control chars, combining marks
        if (cp < 32 || (cp >= 0x7F && cp < 0xA0) || (cp >= 0x0300 && cp <= 0x036F)) continue;
        // Fullwidth / wide: CJK, Hangul, fullwidth forms, katakana (not halfwidth)
        if (
            (cp >= 0x1100 && cp <= 0x115F) ||  // Hangul Jamo
            (cp >= 0x2E80 && cp <= 0xA4CF && cp !== 0x303F) ||  // CJK .. Yi
            (cp >= 0xAC00 && cp <= 0xD7A3) ||  // Hangul Syllables
            (cp >= 0xF900 && cp <= 0xFAFF) ||  // CJK Compat Ideographs
            (cp >= 0xFE10 && cp <= 0xFE19) ||  // Vertical forms
            (cp >= 0xFE30 && cp <= 0xFE6F) ||  // CJK Compat Forms
            (cp >= 0xFF01 && cp <= 0xFF60) ||  // Fullwidth Forms
            (cp >= 0xFFE0 && cp <= 0xFFE6) ||  // Fullwidth Signs
            (cp >= 0x20000 && cp <= 0x2FFFD) ||
            (cp >= 0x30000 && cp <= 0x3FFFD)
        ) { w += 2; continue; }
        w += 1;
    }
    return w;
}

// Token formatting --------------------------------------------------------- /
export function formatTokens(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return String(n);
}

// Tool summary ------------------------------------------------------------- /
export const TOOL_SUMMARIES: Record<string, (input: any) => string> = {
    Bash: (i) => i.command || "",
    exec: (i) => i.command || "",
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

// Output routing ----------------------------------------------------------- /
// When stdout is piped (e.g. `? explain | wl-copy`), decoration goes to
// stderr so the pipe gets clean text only.
// DUMB = neither stdout nor stderr is a TTY (e.g. nvim :! mode).
// In dumb mode, all ANSI formatting is suppressed.
export const PIPED = !process.stdout.isTTY;
export const DUMB = !process.stdout.isTTY && !process.stderr.isTTY;
export const ui = PIPED ? process.stderr : process.stdout;

// ANSI constants ----------------------------------------------------------- /
// Suppressed in dumb mode (nvim :!) — truecolor/256 escapes render as raw text.
// The color you see in :! is nvim's stderr highlighting, not ours.
export const DIM = DUMB ? "" : "\x1b[2m";
export const RED = DUMB ? "" : "\x1b[31m";
export const GREEN = DUMB ? "" : "\x1b[32m";
export const YELLOW = DUMB ? "" : "\x1b[33m";
export const BOLD = DUMB ? "" : "\x1b[1m";
export const ORANGE = DUMB ? "" : "\x1b[38;2;255;175;135m";
export const SEA_GREEN = DUMB ? "" : "\x1b[38;5;43m";
export const BLUE = DUMB ? "" : "\x1b[38;5;75m";
export const RESET = DUMB ? "" : "\x1b[0m";
export const INV = DUMB ? "" : "\x1b[7m";
