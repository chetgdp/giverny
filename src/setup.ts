// setup.ts
/*
* Giverny setup — shell aliases, claude check, global config.
* Run with `giverny --setup [backend|prefs]`.
*   --setup          full config (both flows)
*   --setup backend  backend, model, effort
*   --setup prefs    prefix, session, perms, output
*/

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { VALID_PREFIXES, CONFIG_DEFAULTS, type ShellConfig, HOME, GLOBAL_DIR, FISH_FN_DIR, BASHRC, ZSHRC, NUSHELL_CONFIG, readClaudeAuth } from "./config";
import { DIM, BOLD, GREEN, RED, YELLOW, RESET } from "./shell-utils";
import { installRcBlock } from "./rc-block";
import { selectPrompt } from "./tui";

const auto = process.argv.includes("auto");
const isLocal = process.argv.includes("--local") || process.argv.includes("-l");
const setupIdx = process.argv.indexOf("--setup");
const setupArgs = process.argv.slice(setupIdx + 1).filter(a => a !== "--local" && a !== "-l" && a !== "auto");
const setupArg = setupArgs[0];

if (setupArg && setupArg !== "backend" && setupArg !== "prefs") {
    console.log(`  ${RED}[!!]${RESET} unknown setup mode: ${setupArg}`);
    console.log(`  ${DIM}usage: giverny --setup [backend|prefs] [--local]${RESET}`);
    process.exit(1);
}

const mode = (setupArg === "backend" || setupArg === "prefs") ? setupArg : "full";
const runBackend = mode === "full" || mode === "backend";
const runPrefs = mode === "full" || mode === "prefs";

const ok = (msg: string) => console.log(`  ${GREEN}[ok]${RESET} ${msg}`);
const warn = (msg: string) => console.log(`  ${YELLOW}[--]${RESET} ${msg}`);
const fail = (msg: string) => console.log(`  ${RED}[!!]${RESET} ${msg}`);

// ── Shell alias utilities ─────────────────────────────────────────────────── //


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

    // Nushell — alias is clean passthrough, no noglob needed
    let hasNu = false;
    try { execSync("nu --version", { stdio: ["pipe", "pipe", "pipe"] }); hasNu = true; } catch {}
    if (hasNu) {
        const nuDir = join(HOME, ".config/nushell");
        if (!existsSync(nuDir)) mkdirSync(nuDir, { recursive: true });
        const aliasLine = `alias "${prefix}" = giverny`;
        installRcBlock(NUSHELL_CONFIG, aliasLine);
        ok(`nushell (${prefix})`);
    }
}

// ── Config ───────────────────────────────────────────────────────────────── //

const GLOBAL_CONFIG = join(GLOBAL_DIR, "config.json");
const LOCAL_DIR = join(process.cwd(), ".giverny");
const LOCAL_CONFIG = join(LOCAL_DIR, "config.json");
const CONFIG_PATH = isLocal ? LOCAL_CONFIG : GLOBAL_CONFIG;
const CONFIG_DIR = isLocal ? LOCAL_DIR : GLOBAL_DIR;
const configLabel = isLocal ? ".giverny/config.json" : "~/.giverny/config.json";

// Defaults from the single source of truth in config.ts
const DEFAULTS = CONFIG_DEFAULTS as Record<string, any>;

let config: ShellConfig = {};

if (existsSync(CONFIG_PATH)) {
    try {
        config = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
    } catch {}
}

// ── Claude CLI check ─────────────────────────────────────────────────────── //
// Only check if backend flow is running and current config uses claude-code

if (runBackend) {
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
            const { subscription, rateTier } = readClaudeAuth();
            if (subscription) {
                ok(`authenticated: ${subscription}${rateTier ? ` (${rateTier})` : ""}`);
            } else {
                warn("not authenticated (run 'claude' to log in)");
            }
        }

        if (!claudeFound) {
            console.log(`  ${DIM}needed for claude-code backend: https://docs.anthropic.com/en/docs/claude-code${RESET}`);
        }
    }
}

// --auto: write defaults (if no config exists), skip interactive prompts
if (auto) {
    if (!existsSync(CONFIG_PATH)) {
        const defaults = { prefix: DEFAULTS.prefix, model: DEFAULTS.model, effort: DEFAULTS.effort, perms: DEFAULTS.perms, output: DEFAULTS.output, session: DEFAULTS.session, backend: DEFAULTS.backend };
        mkdirSync(CONFIG_DIR, { recursive: true });
        writeFileSync(CONFIG_PATH, JSON.stringify(defaults, null, 2) + "\n");
        ok(`wrote defaults to ${configLabel}`);
    } else {
        ok(`config exists (${configLabel})`);
    }
    installAliases(config.prefix || DEFAULTS.prefix);
} else {

const headerLabel = mode === "backend" ? "backend config" : mode === "prefs" ? "preferences" : isLocal ? "local config" : "global config";
console.log(`\n${BOLD}${headerLabel}${RESET} ${DIM}(${configLabel})${RESET}`);

// Wrapper: resolve hard default from CONFIG_DEFAULTS by label name
function prompt(label: string, options: { value: string; desc: string }[], current?: string): string {
    return selectPrompt(label, options, { current, defaultValue: DEFAULTS[label] || options[0].value });
}

// Read backend sub-configs from existing config
const backends = config.backends || {};
const actualCfg = backends["actual.inc"] || {};
const compCfg = backends["completions"] || {};
const respCfg = backends["responses"] || {};

// All config variables — initialized from existing config, overridden by active flow
let backend = config.backend || DEFAULTS.backend;
let url = "";
let apiKey = "";
let clusterId = "";
let port = "";
let model = config.model || DEFAULTS.model;
let prefix = config.prefix || DEFAULTS.prefix;
let effort = config.effort || DEFAULTS.effort;
let session = config.session || DEFAULTS.session;
let perms = config.perms || DEFAULTS.perms;
let output = config.output || DEFAULTS.output;

// ── Backend flow ──────────────────────────────────────────────────────────── //

if (runBackend) {

backend = prompt("backend", [
    { value: "claude-code", desc: "claude CLI (requires claude -p)" },
    { value: "completions", desc: "/v1/chat/completions (llama.cpp, ollama, vllm, etc.)" },
    { value: "responses", desc: "/v1/responses streaming (OpenAI, OpenRouter, etc.)" },
    { value: "actual.inc", desc: "Actual Computer Distributed Inference Network" },
], config.backend);

if (backend === "actual.inc") {
    // Protocol choice — completions or responses
    const currentProtocol = actualCfg.protocol || "completions";
    const actualProtocol = prompt("protocol", [
        { value: "completions", desc: "/v1/chat/completions" },
        { value: "responses", desc: "/v1/responses streaming" },
    ], currentProtocol);
    (actualCfg as any)._protocol = actualProtocol;

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
} else if (backend === "responses") {
    url = respCfg.url || config.url || "";
    apiKey = respCfg.apiKey || config.apiKey || "";
    const defaultUrl = url || "http://localhost:8080";
    process.stdout.write(`\n  ${BOLD}url${RESET} ${DIM}(enter to accept)${RESET}\n`);
    process.stdout.write(`  > ${defaultUrl}`);
    execSync("stty sane", { stdio: "inherit" });

    const rl = await import("readline");
    const iface = rl.createInterface({ input: process.stdin, output: process.stdout });
    url = await new Promise<string>((resolve) => {
        process.stdout.write(`\r\x1b[2K`);
        iface.question(`  > `, (answer: string) => {
            iface.close();
            resolve(answer.trim() || defaultUrl);
        });
        iface.write(defaultUrl);
    });

    // API key — optional (keep existing if saved)
    const hasRespKey = !!apiKey;
    const respKeyHint = hasRespKey ? "(saved, enter to keep)" : "(enter to skip)";
    process.stdout.write(`\n  ${BOLD}api key${RESET} ${DIM}${respKeyHint}${RESET}\n`);
    execSync("stty sane", { stdio: "inherit" });
    const rl2 = await import("readline");
    const iface2 = rl2.createInterface({ input: process.stdin, output: process.stdout });
    const respKeyInput = await new Promise<string>((resolve) => {
        iface2.question(`  > `, (answer: string) => {
            iface2.close();
            resolve(answer.trim());
        });
    });
    if (respKeyInput) apiKey = respKeyInput;
} else if (backend === "claude-code") {
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
}

} // end backend flow

// ── Preferences flow ──────────────────────────────────────────────────────── //

if (runPrefs) {

prefix = prompt("prefix", [
    { value: ",", desc: "comma" },
    { value: "?", desc: "question mark" },
    { value: "@", desc: "at sign" },
    { value: "+", desc: "plus" },
    { value: "_", desc: "underscore" },
], config.prefix);

session = prompt("session", [
    { value: "keep", desc: "resume conversation across queries" },
    { value: "fresh", desc: "each query starts with empty context" },
], config.session);

perms = prompt("perms", [
    { value: "ask", desc: "prompt before dangerous tools" },
    { value: "confirm", desc: "prompt before every tool call" },
    { value: "auto", desc: "skip all permission prompts" },
    { value: "plan", desc: "read-only, no writes or execution" },
], config.perms);

output = prompt("output", [
    { value: "quiet", desc: "spinner only, no tool output" },
    { value: "normal", desc: "tool names + truncated output" },
    { value: "verbose", desc: "full tool output" },
], config.output);

} // end prefs flow

// ── Save ──────────────────────────────────────────────────────────────────── //

// Merge backend-specific fields into sub-objects, preserving other backends' settings
const updatedBackends = { ...backends };
if (runBackend) {
    if (backend === "actual.inc") {
        updatedBackends["actual.inc"] = { url, apiKey, clusterId, port: port || undefined, protocol: (actualCfg as any)._protocol || "completions" };
    } else if (backend === "completions") {
        updatedBackends["completions"] = { url, apiKey: apiKey || undefined };
    } else if (backend === "responses") {
        updatedBackends["responses"] = { url, apiKey: apiKey || undefined };
    }
}

config = { prefix, backend, model, effort, perms, output, session, backends: updatedBackends };

mkdirSync(CONFIG_DIR, { recursive: true });
writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");

if (runPrefs) {
    installAliases(prefix);
}

console.log("");
ok(`saved to ${configLabel}`);
console.log(`${DIM}${JSON.stringify(config, null, 2)}${RESET}`);

if (mode === "backend") {
    console.log(`\n${DIM}change anytime with /model, /effort, /backend${RESET}\n`);
} else if (mode === "prefs") {
    console.log(`\n${DIM}change anytime with /session, /perms, /output${RESET}\n`);
} else {
    console.log(`\n${DIM}change anytime with /model, /effort, /perms, /output, /session${RESET}`);
    console.log(`${DIM}override per-directory with --local${RESET}\n`);
}

} // end interactive
