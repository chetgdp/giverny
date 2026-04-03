// tui.ts
// Raw-terminal interactive prompts: arrow-key selectors, permission prompt.
// Extracted from setup.ts and shell-utils.ts so TTY I/O lives in one place.

import { openSync, readSync, closeSync } from "fs";
import { execSync } from "child_process";
import { BOLD, DIM, RED, INV, RESET, ui } from "./shell-utils";

export interface SelectOption {
    value: string;
    desc: string;
}

// Interactive arrow key / j/k / number select, enter to confirm.
// Returns the selected option's value.
export function selectPrompt(
    label: string,
    options: SelectOption[],
    opts?: { current?: string; defaultValue?: string },
): string {
    const defaultVal = opts?.current || opts?.defaultValue || options[0].value;
    let selected = options.findIndex(o => o.value === defaultVal);
    if (selected < 0) selected = 0;

    function line(i: number): string {
        const marker = i === selected ? ">" : " ";
        const highlight = i === selected ? BOLD : DIM;
        const tag = opts?.defaultValue && options[i].value === opts.defaultValue ? ` ${DIM}(default)${RESET}` : "";
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

            // Ctrl+C or Escape — abort
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

            // Number keys — select and confirm immediately
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
