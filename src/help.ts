// help.tssingle source of truth for giverny help output

const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

export function printHelp(prefix = ",") {
    const shell = (process.env.SHELL || "").split("/").pop() || "unknown";

    console.log(`${BOLD}giverny${RESET} ${DIM}v0.1.0${RESET}  ${DIM}(${shell}, prefix: ${prefix})${RESET}\n`);

    console.log(`Usage: ${prefix} <prompt>`);
    console.log(`       cat file | ${prefix} analyze this`);
    console.log(`       ${prefix}              (interactive mode)\n`);

    console.log(`${BOLD}Modes${RESET}`);
    console.log("  giverny [prompt]          Interactive shell (default)");
    console.log("  giverny --server, -s      Start the OpenAI-compatible server");
    console.log("  giverny --setup           Setup shell aliases + config (interactive)");
    console.log("  giverny --setup auto      Setup with defaults (non-interactive)");
    console.log("  giverny --uninstall       Remove giverny config");
    console.log("  giverny --uninstall --purge");
    console.log("                            Remove everything (config, aliases, binary)");

    console.log(`\n${BOLD}Commands${RESET}`);
    console.log("  /help                     Show this help");
    console.log("  /status                   Show version, session, account");
    console.log("  /backend                  Show current backend");
    console.log("  /config                   Show giverny + claude code settings");
    console.log("  /context                  Show context window + token usage");
    console.log("  /model <name>             Set model");
    console.log("  /opus /sonnet /haiku");
    console.log("  /effort <level>           Set effort level");
    console.log("  /low /medium /high /max");
    console.log("  /perms <mode>             Show or set permissions mode");
    console.log("  /ask /auto /plan");
    console.log("  /output <mode>            Set tool output mode");
    console.log("  /quiet /normal /verbose");
    console.log("  /session <mode>           Set session mode");
    console.log("  /fresh /keep");
    console.log("  /tools [list]             Show available tools, or set filter");
    console.log("  /diff [instruction]       Analyze git diff (default: summarize)");
    console.log("  /compact [focus]          Compact context (focus: what to prioritize)");
    console.log("  /resume [id]              List sessions, or resume by number/id");
    console.log("  /export [file]            Export transcript (to file or stdout)");
    console.log("  /last /copy               Print last response (pipe to clipboard)");
    console.log("  /new [prompt]             Clear session (optionally run prompt)");
    console.log("  /reset                    Reset all config to defaults");

    console.log(`\n${BOLD}Config${RESET}  ${DIM}defaults → ~/.giverny/config.json → .giverny/config.json${RESET}`);
    console.log("  Settings save to global (~/.giverny) by default.");
    console.log("  Add --local to override for this directory only.");
    console.log(`    /model haiku            ${DIM}set globally${RESET}`);
    console.log(`    /model haiku --local    ${DIM}override for this directory${RESET}`);

    console.log(`\n${BOLD}Environment${RESET}`);
    console.log("  PORT=8741                 Bridge server port");
    console.log("  CLAUDE_EFFORT=max         Effort level (low/medium/high/max)");
    console.log("  CLAUDE_TIMEOUT=300000     Per-turn timeout in ms");
}
