// uninstall.ts
/*
* giverny --uninstall         Remove .giverny config folders (global + per-project)
* giverny --uninstall --purge Also remove shell aliases, fish functions, and binary symlink
*/

import { existsSync, readFileSync, unlinkSync, openSync, readSync, closeSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { rm } from "fs/promises";
import { VALID_PREFIXES, HOME, GLOBAL_DIR, FISH_FN_DIR, BASHRC, ZSHRC, NUSHELL_CONFIG } from "./config";
import { DIM, BOLD, GREEN, RED, RESET } from "./shell-utils";
import { MARKER_START, removeRcBlock } from "./rc-block";

const ok = (msg: string) => console.log(`  ${GREEN}[ok]${RESET} ${msg}`);
const skip = (msg: string) => console.log(`  ${DIM}[--] ${msg}${RESET}`);

const purge = process.argv.includes("--purge");

// ── Discover what exists ─────────────────────────────────────────────────── //

console.log(`\n${BOLD}giverny ${purge ? "purge" : "uninstall"}${RESET}\n`);

const PROJECTS_FILE = join(GLOBAL_DIR, "projects.json");

// Collect all .giverny directories: global + registered projects
// If the global dir is missing (no projects.json), fall back to scanning home
let givernyDirs: string[] = [];
if (existsSync(GLOBAL_DIR)) givernyDirs.push(GLOBAL_DIR);

if (existsSync(PROJECTS_FILE)) {
    try {
        const projects: string[] = JSON.parse(readFileSync(PROJECTS_FILE, "utf-8"));
        for (const project of projects) {
            const dir = join(project, ".giverny");
            if (existsSync(dir) && !givernyDirs.includes(dir)) {
                givernyDirs.push(dir);
            }
        }
    } catch {}
} else {
    // No registryscan home as fallback
    console.log(`  ${DIM}no project registry found, scanning home...${RESET}`);
    try {
        const result = execSync(
            `find ${HOME} -maxdepth 5 -name ".giverny" -type d -not -path "*/node_modules/*" -not -path "*/.git/*" 2>/dev/null`,
            { stdio: ["pipe", "pipe", "pipe"], timeout: 15000 },
        ).toString().trim();
        if (result) {
            for (const dir of result.split("\n").filter(Boolean)) {
                if (!givernyDirs.includes(dir)) givernyDirs.push(dir);
            }
        }
    } catch {}
}

// Shell alias + binary locations (purge only)
const fishFiles = VALID_PREFIXES
    .map(ch => join(FISH_FN_DIR, `${ch}.fish`))
    .filter(f => existsSync(f));
const hasFish = fishFiles.length > 0;

const hasBashrc = existsSync(BASHRC) && readFileSync(BASHRC, "utf-8").includes(MARKER_START);
const hasZshrc = existsSync(ZSHRC) && readFileSync(ZSHRC, "utf-8").includes(MARKER_START);
const hasNushell = existsSync(NUSHELL_CONFIG) && readFileSync(NUSHELL_CONFIG, "utf-8").includes(MARKER_START);

const BIN_LINK = join(HOME, ".local/bin/giverny");
const hasBin = existsSync(BIN_LINK);

// ── Show what will be removed ────────────────────────────────────────────── //

console.log("  will remove:\n");

if (givernyDirs.length > 0) {
    for (const dir of givernyDirs) {
        console.log(`  ${RED}x${RESET} ${dir.replace(HOME, "~")}`);
    }
} else {
    console.log(`  ${DIM}  no .giverny directories found${RESET}`);
}

if (purge) {
    if (hasFish) {
        const names = fishFiles.map(f => f.split("/").pop()!.replace(".fish", "")).join(", ");
        console.log(`  ${RED}x${RESET} fish functions (${names})`);
    }
    if (hasBashrc) console.log(`  ${RED}x${RESET} bash alias block in ~/.bashrc`);
    if (hasZshrc) console.log(`  ${RED}x${RESET} zsh alias block in ~/.zshrc`);
    if (hasNushell) console.log(`  ${RED}x${RESET} nushell alias block in ~/.config/nushell/config.nu`);
    if (hasBin) console.log(`  ${RED}x${RESET} ~/.local/bin/giverny symlink`);
}

const hasConfigs = givernyDirs.length > 0;
const hasShell = hasFish || hasBashrc || hasZshrc || hasNushell || hasBin;
const nothingToDo = !hasConfigs && (!purge || !hasShell);

if (nothingToDo) {
    console.log(`\n${DIM}  nothing to remove${RESET}\n`);
    process.exit(0);
}

// ── Confirm ──────────────────────────────────────────────────────────────── //

process.stdout.write(`\n  proceed? ${DIM}(y/N)${RESET} `);

const buf = Buffer.alloc(1);
const fd = openSync("/dev/tty", "r");
execSync("stty raw -echo", { stdio: "inherit" });

let confirmed = false;
try {
    readSync(fd, buf, 0, 1);
    confirmed = buf[0] === 0x79 || buf[0] === 0x59; // y or Y
} finally {
    closeSync(fd);
    execSync("stty sane", { stdio: "inherit" });
}

console.log(confirmed ? "y" : "n");

if (!confirmed) {
    console.log(`\n${DIM}  aborted${RESET}\n`);
    process.exit(0);
}

console.log("");

// ── Remove .giverny directories ──────────────────────────────────────────── //

for (const dir of givernyDirs) {
    try {
        await rm(dir, { recursive: true });
        ok(`removed ${dir.replace(HOME, "~")}`);
    } catch {
        skip(`could not remove ${dir.replace(HOME, "~")}`);
    }
}

// ── Purge: remove shell aliases + binary ─────────────────────────────────── //

if (purge) {
    if (hasFish) {
        for (const f of fishFiles) {
            try { unlinkSync(f); } catch {}
        }
        ok("removed fish functions");
        console.log(`  ${DIM}     open a new terminal to unload from this session${RESET}`);
    }

    if (hasBashrc) { removeRcBlock(BASHRC); ok("removed bash alias block"); }
    if (hasZshrc) { removeRcBlock(ZSHRC); ok("removed zsh alias block"); }
    if (hasNushell) { removeRcBlock(NUSHELL_CONFIG); ok("removed nushell alias block"); }

    if (hasBin) {
        try {
            unlinkSync(BIN_LINK);
            ok("removed ~/.local/bin/giverny");
        } catch {
            skip("could not remove ~/.local/bin/giverny");
        }
    }

    console.log(`\n${DIM}  giverny purged. source code remains in ${process.cwd()}${RESET}\n`);
} else {
    console.log(`\n${DIM}  config removed. run giverny --setup to reconfigure${RESET}`);
    console.log(`${DIM}  use --uninstall --purge to also remove aliases and binary${RESET}\n`);
}
