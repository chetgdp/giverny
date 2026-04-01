// setup.ts
/*
* Giverny setupshell aliases, claude check, global config.
* Run with `giverny --setup`.
*/

import { existsSync, mkdirSync, readFileSync, writeFileSync, openSync, readSync, closeSync, unlinkSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { VALID_PREFIXES, CONFIG_DEFAULTS, type ShellConfig } from "./config";

const auto = process.argv.includes("auto");
const HOME = process.env.HOME || "~";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

const ok = (msg: string) => console.log(`  ${GREEN}[ok]${RESET} ${msg}`);
const warn = (msg: string) => console.log(`  ${YELLOW}[--]${RESET} ${msg}`);
const fail = (msg: string) => console.log(`  ${RED}[!!]${RESET} ${msg}`);

// ── Shell alias utilities ─────────────────────────────────────────────────── //

const MARKER_START = `# ><(((*> giverny start`;
const MARKER_END = `# <*)))>< giverny end`;
const MARKER_NOTE = `# auto-managed by giverny --setup, do not edit between markers`;

// Replace existing giverny block (between markers) or strip legacy lines, then append fresh block
function installRcBlock(rcFile: string, block: string) {
    let content = readFileSync(rcFile, "utf-8");

    // Remove marker-based block if present
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const markerRe = new RegExp(`\\n?${esc(MARKER_START)}[\\s\\S]*?${esc(MARKER_END)}`, "g");
    content = content.replace(markerRe, "");

    // Also strip legacy lines (pre-marker installs)
    const lines = content.split("\n");
    const filtered: string[] = [];
    for (let i = 0; i < lines.length; i++) {
        if (lines[i] === "# giverny shell mode") {
            while (i + 1 < lines.length && (/^set \+H$/.test(lines[i + 1]) || /^function [,?@+_]\(\).*giverny/.test(lines[i + 1]))) i++;
            continue;
        }
        filtered.push(lines[i]);
    }
    content = filtered.join("\n");

    content = content.replace(/\n{3,}/g, "\n\n").trimEnd();
    const wrapped = `${MARKER_START}\n${MARKER_NOTE}\n${block}\n${MARKER_END}`;
    writeFileSync(rcFile, content + `\n\n${wrapped}\n`);
}

const FISH_FN_DIR = join(HOME, ".config/fish/functions");
const BASHRC = join(HOME, ".bashrc");
const ZSHRC = join(HOME, ".zshrc");

function installFishFn(name: string, fnBody: string) {
    if (!existsSync(FISH_FN_DIR)) {
        mkdirSync(FISH_FN_DIR, { recursive: true });
    }
    const file = join(FISH_FN_DIR, `${name}.fish`);
    Bun.write(file, fnBody);
}

// Install shell aliases for the chosen prefix character
function installAliases(prefix: string) {
    console.log(`\n${BOLD}shell aliases${RESET}`);

    // Fish: install chosen prefix, remove all others
    if (existsSync(join(HOME, ".config/fish"))) {
        // Remove all candidate fish function files first
        for (const ch of VALID_PREFIXES) {
            try { unlinkSync(join(FISH_FN_DIR, `${ch}.fish`)); } catch {}
        }
        // Clean up old ! attempts
        try { unlinkSync(join(FISH_FN_DIR, "!.fish")); } catch {}
        try { execSync("fish -c \"abbr -e '!'\"", { stdio: "ignore" }); } catch {}

        installFishFn(prefix, `function ${prefix}
    giverny $argv
end
`);
        ok(`fish (${prefix})`);
    }

    // Bash — noglob via set -f alias trick (alias runs set -f before args are expanded)
    if (existsSync(BASHRC)) {
        const helperFn = `function _giverny() { set +f; giverny "$@"; }`;
        const aliasLine = `alias ${prefix}='set -f; _giverny'`;
        installRcBlock(BASHRC, `set +H\n${helperFn}\n${aliasLine}`);
        ok(`bash (${prefix})`);
    }

    // Zsh — noglob prevents shell from expanding ?, *, [] in prompt text
    if (existsSync(ZSHRC)) {
        const aliasLine = `alias ${prefix}='noglob giverny'`;
        installRcBlock(ZSHRC, aliasLine);
        ok(`zsh (${prefix})`);
    }
}

// ── Global config ────────────────────────────────────────────────────────── //

const GLOBAL_DIR = join(HOME, ".giverny");
const GLOBAL_CONFIG = join(GLOBAL_DIR, "config.json");

// Defaults from the single source of truth in config.ts
const DEFAULTS = CONFIG_DEFAULTS as Record<string, any>;

let config: ShellConfig = {};

if (existsSync(GLOBAL_CONFIG)) {
    try {
        config = JSON.parse(readFileSync(GLOBAL_CONFIG, "utf-8"));
    } catch {}
}

// ── Claude CLI check ─────────────────────────────────────────────────────── //
// Only check if current config uses claude-code (or no config yet)

const currentBackend = config.backend || "claude-code";
if (currentBackend === "claude-code") {
    console.log(`\n${BOLD}claude${RESET}`);

    let claudeFound = false;
    try {
        const version = execSync("claude --version", { stdio: ["pipe", "pipe", "pipe"] }).toString().trim();
        ok(`claude ${version}`);
        claudeFound = true;
    } catch {
        warn("claude CLI not found");
    }

    if (claudeFound) {
        try {
            const creds = JSON.parse(readFileSync(join(HOME, ".claude/.credentials.json"), "utf-8"));
            const oauth = creds.claudeAiOauth || {};
            const sub = oauth.subscriptionType || "unknown";
            const tier = oauth.rateLimitTier || "";
            ok(`authenticated: ${sub}${tier ? ` (${tier})` : ""}`);
        } catch {
            warn("not authenticated (run 'claude' to log in)");
        }
    }

    if (!claudeFound) {
        console.log(`  ${DIM}needed for claude-code backend: https://docs.anthropic.com/en/docs/claude-code${RESET}`);
    }
}

// --auto: write defaults (if no config exists), skip interactive prompts
if (auto) {
    if (!existsSync(GLOBAL_CONFIG)) {
        const defaults = { prefix: DEFAULTS.prefix, model: DEFAULTS.model, effort: DEFAULTS.effort, perms: DEFAULTS.perms, output: DEFAULTS.output, session: DEFAULTS.session, backend: DEFAULTS.backend };
        mkdirSync(GLOBAL_DIR, { recursive: true });
        writeFileSync(GLOBAL_CONFIG, JSON.stringify(defaults, null, 2) + "\n");
        ok(`wrote defaults to ~/.giverny/config.json`);
    } else {
        ok(`config exists (~/.giverny/config.json)`);
    }
    installAliases(config.prefix || DEFAULTS.prefix);
} else {

console.log(`\n${BOLD}global config${RESET} ${DIM}(~/.giverny/config.json)${RESET}`);

// Interactive promptsarrow key / j/k select, number to jump, enter to confirm
function prompt(label: string, options: { value: string; desc: string }[], current?: string): string {
    const hardDefault = DEFAULTS[label] || options[0].value;
    const defaultVal = current || hardDefault;
    let selected = options.findIndex(o => o.value === defaultVal);
    if (selected < 0) selected = 0;

    function line(i: number): string {
        const marker = i === selected ? ">" : " ";
        const highlight = i === selected ? BOLD : DIM;
        const tag = options[i].value === hardDefault ? ` ${DIM}(default)${RESET}` : "";
        const full = `  ${marker} ${i + 1}) ${highlight}${options[i].value}${RESET}  ${DIM}${options[i].desc}${RESET}${tag}`;
        // Truncate to terminal width to prevent line wrap (which breaks re-render)
        const cols = process.stdout.columns || 80;
        const visible = full.replace(/\x1b\[[0-9;]*m/g, "");
        if (visible.length <= cols) return full;
        // Cut the description short, keeping ANSI reset at the end
        const overflow = visible.length - cols;
        const descTrunc = options[i].desc.slice(0, -(overflow + 1));
        return `  ${marker} ${i + 1}) ${highlight}${options[i].value}${RESET}  ${DIM}${descTrunc}${RESET}`;
    }

    function render() {
        // Move cursor up to first option line, clear and rewrite
        process.stdout.write(`\x1b[${options.length}A`);
        for (let i = 0; i < options.length; i++) {
            process.stdout.write(`\r\x1b[2K${line(i)}\r\n`);
        }
    }

    // Initial render (before raw mode, so console.log is fine)
    console.log(`\n  ${BOLD}${label}${RESET} ${DIM}(arrows + enter)${RESET}`);
    for (let i = 0; i < options.length; i++) {
        console.log(line(i));
    }

    // Raw mode for arrow keys
    process.stdout.write("\x1b[?25l"); // hide cursor
    execSync("stty raw -echo", { stdio: "inherit" });

    const fd = openSync("/dev/tty", "r");
    const buf = Buffer.alloc(3);

    try {
        while (true) {
            const n = readSync(fd, buf, 0, 3);

            // Ctrl+C or Escapeabort
            if (buf[0] === 0x03 || (n === 1 && buf[0] === 0x1b)) {
                closeSync(fd);
                execSync("stty sane", { stdio: "inherit" });
                process.stdout.write("\x1b[?25h\n");
                process.exit(130);
            }

            // Enter
            if (buf[0] === 0x0d || buf[0] === 0x0a) break;

            // Arrow keys: \x1b [ A/B
            if (n === 3 && buf[0] === 0x1b && buf[1] === 0x5b) {
                if (buf[2] === 0x41) { // Up
                    selected = (selected - 1 + options.length) % options.length;
                    render();
                } else if (buf[2] === 0x42) { // Down
                    selected = (selected + 1) % options.length;
                    render();
                }
            }

            // Number keysselect and confirm immediately
            if (n === 1 && buf[0] >= 0x31 && buf[0] <= 0x39) {
                const num = buf[0] - 0x30; // 1-9
                if (num >= 1 && num <= options.length) {
                    selected = num - 1;
                    render();
                    break;
                }
            }

            // j/k vim keys
            if (n === 1 && buf[0] === 0x6b) { // k = up
                selected = (selected - 1 + options.length) % options.length;
                render();
            } else if (n === 1 && buf[0] === 0x6a) { // j = down
                selected = (selected + 1) % options.length;
                render();
            }
        }
    } finally {
        closeSync(fd);
        execSync("stty sane", { stdio: "inherit" });
        process.stdout.write("\x1b[?25h"); // show cursor
    }

    return options[selected].value;
}

const backend = prompt("backend", [
    { value: "claude-code", desc: "claude CLI (requires claude -p)" },
    { value: "actual.inc", desc: "Actual Computer Distributed Inference Network" },
    { value: "completions", desc: "/v1/chat/completions API (llama.cpp, ollama, vllm, etc.)" },
], config.backend);

// Read backend-specific settings from sub-objects (fall back to legacy flat fields)
const backends = config.backends || {};
const actualCfg = backends["actual.inc"] || {};
const compCfg = backends["completions"] || {};

let url = "";
let apiKey = "";
let clusterId = "";
let port = "";
let model = config.model || DEFAULTS.model;

if (backend === "actual.inc") {
    url = "https://api.actual.inc";
    apiKey = actualCfg.apiKey || config.apiKey || "";
    clusterId = actualCfg.clusterId || config.clusterId || "";
    port = actualCfg.port || config.port || "";

    // API key — required (but keep existing if saved)
    const hasActualKey = !!apiKey;
    const actualKeyHint = hasActualKey ? "(saved, enter to keep)" : "(from Console > API at actual.inc)";
    process.stdout.write(`\n  ${BOLD}api key${RESET} ${DIM}${actualKeyHint}${RESET}\n`);
    execSync("stty sane", { stdio: "inherit" });
    const rl = await import("readline");
    const iface = rl.createInterface({ input: process.stdin, output: process.stdout });
    const actualKeyInput = await new Promise<string>((resolve) => {
        iface.question(`  > `, (answer: string) => {
            iface.close();
            resolve(answer.trim());
        });
    });
    if (actualKeyInput) apiKey = actualKeyInput;

    if (!apiKey) {
        fail("API key required for actual.inc — create one at Console > API");
        process.exit(1);
    }

    // Port — for local actual API
    const defaultPort = port || "8080";
    process.stdout.write(`\n  ${BOLD}port${RESET} ${DIM}(enter to accept)${RESET}\n`);
    execSync("stty sane", { stdio: "inherit" });
    const rlPort = await import("readline");
    const ifacePort = rlPort.createInterface({ input: process.stdin, output: process.stdout });
    port = await new Promise<string>((resolve) => {
        process.stdout.write(`\r\x1b[2K`);
        ifacePort.question(`  > `, (answer: string) => {
            ifacePort.close();
            resolve(answer.trim() || defaultPort);
        });
        ifacePort.write(defaultPort);
    });

    // Auto-fetch cluster ID
    process.stdout.write(`\n  ${DIM}fetching clusters...${RESET}`);
    try {
        const res = await fetch(`${url}/v1/clusters`, {
            headers: { "Authorization": `Bearer ${apiKey}` },
        });
        if (!res.ok) {
            const body = await res.text().catch(() => "");
            process.stdout.write(`\r\x1b[2K`);
            fail(`cluster fetch failed (${res.status}): ${body}`);
            process.exit(1);
        }
        const data = await res.json() as any;
        const clusters = data?.data || [];
        process.stdout.write(`\r\x1b[2K`);

        if (clusters.length === 0) {
            fail("no clusters found — install the actual client first");
            process.exit(1);
        } else if (clusters.length === 1) {
            clusterId = clusters[0].id;
            const name = clusters[0].name || "unnamed";
            const online = clusters[0].online_device_count || 0;
            const total = clusters[0].device_count || 0;
            ok(`cluster: ${name} (${online}/${total} online)`);
        } else {
            // Multiple clusters — let user pick
            const clusterOptions = clusters.map((c: any) => ({
                value: c.id,
                desc: `${c.name || "unnamed"} (${c.online_device_count || 0}/${c.device_count || 0} online)`,
            }));
            clusterId = prompt("cluster", clusterOptions, clusterId);
        }
    } catch (e: any) {
        process.stdout.write(`\r\x1b[2K`);
        fail(`cluster fetch failed: ${e.message}`);
        process.exit(1);
    }

    // Auto-fetch models and let user pick
    process.stdout.write(`\n  ${DIM}fetching models...${RESET}`);
    try {
        const res = await fetch(`${url}/v1/models`, {
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "X-Cluster-ID": clusterId,
            },
        });
        if (!res.ok) {
            process.stdout.write(`\r\x1b[2K`);
            warn("could not fetch models — you can set the model later");
            model = "auto";
        } else {
            const data = await res.json() as any;
            const models = (data?.data || []).map((m: any) => m.id).filter(Boolean);
            process.stdout.write(`\r\x1b[2K`);

            if (models.length === 0) {
                warn("no models available — load one in the actual TUI first");
                model = "auto";
            } else if (models.length === 1) {
                model = models[0];
                ok(`model: ${model}`);
            } else {
                const modelOptions = models.map((id: string) => ({ value: id, desc: "" }));
                model = prompt("model", modelOptions, config.model);
            }
        }
    } catch {
        process.stdout.write(`\r\x1b[2K`);
        warn("could not fetch models — you can set the model later");
        model = "auto";
    }
} else if (backend === "completions") {
    url = compCfg.url || config.url || "";
    apiKey = compCfg.apiKey || config.apiKey || "";
    const defaultUrl = url || "http://localhost:8080";
    process.stdout.write(`\n  ${BOLD}url${RESET} ${DIM}(enter to accept)${RESET}\n`);
    process.stdout.write(`  > ${defaultUrl}`);
    execSync("stty sane", { stdio: "inherit" });

    const rl = await import("readline");
    const iface = rl.createInterface({ input: process.stdin, output: process.stdout });
    url = await new Promise<string>((resolve) => {
        // Clear the line and re-prompt for readline
        process.stdout.write(`\r\x1b[2K`);
        iface.question(`  > `, (answer: string) => {
            iface.close();
            resolve(answer.trim() || defaultUrl);
        });
        // Pre-fill with default
        iface.write(defaultUrl);
    });

    // API key — optional (keep existing if saved)
    const hasCompKey = !!apiKey;
    const compKeyHint = hasCompKey ? "(saved, enter to keep)" : "(enter to skip)";
    process.stdout.write(`\n  ${BOLD}api key${RESET} ${DIM}${compKeyHint}${RESET}\n`);
    execSync("stty sane", { stdio: "inherit" });
    const rl2 = await import("readline");
    const iface2 = rl2.createInterface({ input: process.stdin, output: process.stdout });
    const compKeyInput = await new Promise<string>((resolve) => {
        iface2.question(`  > `, (answer: string) => {
            iface2.close();
            resolve(answer.trim());
        });
    });
    if (compKeyInput) apiKey = compKeyInput;
}

const prefix = prompt("prefix", [
    { value: ",", desc: "comma" },
    { value: "?", desc: "question mark" },
    { value: "@", desc: "at sign" },
    { value: "+", desc: "plus" },
    { value: "_", desc: "underscore" },
], config.prefix);

// Claude-specific options
let effort = config.effort || DEFAULTS.effort;
let session = config.session || DEFAULTS.session;

if (backend !== "actual.inc") {
    model = config.model || DEFAULTS.model;
}

if (backend === "claude-code") {
    model = prompt("model", [
        { value: "opus", desc: "1M context, supports max effort" },
        { value: "sonnet", desc: "fast + capable, 200k context" },
        { value: "haiku", desc: "fastest, 200k context" },
    ], config.model);

    effort = prompt("effort", [
        { value: "low", desc: "minimal thinking, fastest" },
        { value: "medium", desc: "balanced speed and quality" },
        { value: "high", desc: "thorough, considers edge cases" },
        ...(model === "opus" ? [{ value: "max", desc: "maximum thinking (opus only)" }] : []),
    ], config.effort);

    session = prompt("session", [
        { value: "keep", desc: "resume conversation across queries" },
        { value: "fresh", desc: "each query starts with empty context" },
    ], config.session);
}

const perms = prompt("perms", [
    { value: "ask", desc: "prompt before dangerous tools" },
    { value: "confirm", desc: "prompt before every tool call" },
    { value: "auto", desc: "skip all permission prompts" },
    { value: "plan", desc: "read-only, no writes or execution" },
], config.perms);

const output = prompt("output", [
    { value: "quiet", desc: "spinner only, no tool output" },
    { value: "normal", desc: "tool names + truncated output" },
    { value: "verbose", desc: "full tool output" },
], config.output);

// Merge backend-specific fields into sub-objects, preserving other backends' settings
const updatedBackends = { ...backends };
if (backend === "actual.inc") {
    updatedBackends["actual.inc"] = { url, apiKey, clusterId, port: port || undefined };
} else if (backend === "completions") {
    updatedBackends["completions"] = { url, apiKey: apiKey || undefined };
}

config = { prefix, backend, model, effort, perms, output, session, backends: updatedBackends };

mkdirSync(GLOBAL_DIR, { recursive: true });
writeFileSync(GLOBAL_CONFIG, JSON.stringify(config, null, 2) + "\n");

installAliases(prefix);

console.log("");
ok(`saved to ~/.giverny/config.json`);
console.log(`${DIM}${JSON.stringify(config, null, 2)}${RESET}`);
console.log(`\n${DIM}change anytime with /model, /effort, /perms, /output, /session${RESET}`);
console.log(`${DIM}override per-directory with --local${RESET}\n`);

} // end interactive
