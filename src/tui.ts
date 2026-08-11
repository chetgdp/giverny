// tui.ts
// Raw-terminal interactive prompts: arrow-key selectors, permission prompt.
// Extracted from setup.ts and shell-utils.ts so TTY I/O lives in one place.

import { openSync, readSync, closeSync } from "fs";
import { BOLD, DIM, RED, INV, RESET, ui } from "./shell-utils";

export interface SelectOption {
    value: string;
    desc: string;
}

export type Key =
    | { kind: "enter" }
    | { kind: "escape" }
    | { kind: "up" }
    | { kind: "down" }
    | { kind: "left" }
    | { kind: "right" }
    | { kind: "digit"; digit: number }
    | { kind: "vim-up" }
    | { kind: "vim-down" }
    | { kind: "other" };

export function decodeKey(bytes: Buffer, n: number): Key {
    const length = Math.min(Math.max(n, 0), bytes.length);
    if (length === 0) return { kind: "other" };

    let end = length;
    while (end > 0 && (bytes[end - 1] === 0x0d || bytes[end - 1] === 0x0a)) {
        end--;
    }
    if (end === 0) return { kind: "enter" };

    if (end === 1) {
        const byte = bytes[0];
        if (byte === 0x03 || byte === 0x1b) return { kind: "escape" };
        if (byte >= 0x31 && byte <= 0x39) {
            return { kind: "digit", digit: byte - 0x30 };
        }
        if (byte === 0x6b) return { kind: "vim-up" };
        if (byte === 0x6a) return { kind: "vim-down" };
        return { kind: "other" };
    }

    if (end === 3 && bytes[0] === 0x1b && bytes[1] === 0x5b) {
        if (bytes[2] === 0x41) return { kind: "up" };
        if (bytes[2] === 0x42) return { kind: "down" };
        if (bytes[2] === 0x43) return { kind: "right" };
        if (bytes[2] === 0x44) return { kind: "left" };
    }
    return { kind: "other" };
}

type RawTTYResult<T> = { ok: true; value: T } | { ok: false };

function withRawTTY<T>(callback: (fd: number) => T): RawTTYResult<T> {
    let fd: number | undefined;
    let saved: string | undefined;

    try {
        try {
            fd = openSync("/dev/tty", "r");

            const savedResult = Bun.spawnSync(["stty", "-g"], {
                stdin: fd,
                stdout: "pipe",
                stderr: "ignore",
            });
            if (savedResult.exitCode !== 0) return { ok: false };
            saved = savedResult.stdout.toString().trim();
            if (!saved) return { ok: false };

            const rawResult = Bun.spawnSync(["stty", "raw", "-echo"], {
                stdin: fd,
                stdout: "ignore",
                stderr: "ignore",
            });
            if (rawResult.exitCode !== 0) return { ok: false };
        } catch {
            return { ok: false };
        }

        if (fd === undefined) return { ok: false };
        return { ok: true, value: callback(fd) };
    } finally {
        if (fd !== undefined) {
            try {
                if (saved) {
                    Bun.spawnSync(["stty", saved], {
                        stdin: fd,
                        stdout: "ignore",
                        stderr: "ignore",
                    });
                }
            } finally {
                closeSync(fd);
            }
        }
    }
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

    const buf = Buffer.alloc(5);
    const tty = withRawTTY(fd => {
        process.stdout.write("\x1b[?25l");
        try {
            while (true) {
                const key = decodeKey(buf, readSync(fd, buf, 0, buf.length));

                if (key.kind === "escape") return { kind: "cancelled" as const };
                if (key.kind === "enter") break;

                if (key.kind === "up" || key.kind === "vim-up") {
                    selected = (selected - 1 + options.length) % options.length;
                    render();
                } else if (key.kind === "down" || key.kind === "vim-down") {
                    selected = (selected + 1) % options.length;
                    render();
                } else if (key.kind === "digit" && key.digit <= options.length) {
                    selected = key.digit - 1;
                    render();
                    break;
                }
            }

            return { kind: "selected" as const, value: options[selected].value };
        } finally {
            process.stdout.write("\x1b[?25h");
        }
    });

    if (!tty.ok) return options[selected].value;

    if (tty.value.kind === "cancelled") {
        process.stdout.write("\n");
        process.exit(130);
    }
    return tty.value.value;

}

// Permission prompt -------------------------------------------------------- /
// Compact horizontal selector with arrow key navigation.
// Enter = confirm (default: allow), 1/2/3 direct select, Esc/Ctrl+C = deny.

export function promptPermission(toolName: string, defaultDeny = false): "allow" | "tool" | "deny" {
    const options = ["allow", `allow all ${toolName}`, "deny"];
    let sel = defaultDeny ? 2 : 0;

    const render = () => {
        let line = "  ";
        for (let i = 0; i < options.length; i++) {
            line += i === sel
                ? `${INV} ${i + 1}. ${options[i]} ${RESET} `
                : `${DIM} ${i + 1}. ${options[i]} ${RESET} `;
        }
        ui.write(`\r\x1b[K${line}`);
    };

    const buf = Buffer.alloc(5);
    const tty = withRawTTY(fd => {
        render();

        while (true) {
            const key = decodeKey(buf, readSync(fd, buf, 0, buf.length));

            if (key.kind === "enter") break;
            if (key.kind === "digit" && key.digit <= 3) {
                sel = key.digit - 1;
                break;
            }
            if (key.kind === "right" || key.kind === "down" || key.kind === "vim-down") {
                sel = Math.min(sel + 1, 2);
                render();
            } else if (key.kind === "left" || key.kind === "up" || key.kind === "vim-up") {
                sel = Math.max(sel - 1, 0);
                render();
            } else if (key.kind === "escape") {
                sel = 2;
                break;
            }
        }

        return sel;
    });

    if (!tty.ok) sel = 2;

    // Replace prompt line with the chosen option
    const color = sel === 2 ? RED : DIM;
    ui.write(`\r\x1b[K  ${color}${options[sel]}${RESET}\n`);
    return (["allow", "tool", "deny"] as const)[sel];
}

