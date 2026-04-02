// rc-block.ts
// Shared RC file block management for setup and uninstall.
// Handles marker-delimited blocks in .bashrc, .zshrc, config.nu, etc.

import { existsSync, readFileSync, writeFileSync } from "fs";

export const MARKER_START = `# ><(((*> giverny start`;
export const MARKER_END = `# <*)))>< giverny end`;
const MARKER_NOTE = `# auto-managed by giverny --setup, do not edit between markers`;

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const markerRe = () => new RegExp(`\\n?${esc(MARKER_START)}[\\s\\S]*?${esc(MARKER_END)}\\n?`, "g");

// Replace existing giverny block (between markers) or strip legacy lines, then append fresh block
export function installRcBlock(rcFile: string, block: string) {
    let content = existsSync(rcFile) ? readFileSync(rcFile, "utf-8") : "";

    // Remove marker-based block if present
    content = content.replace(markerRe(), "");

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

// Remove giverny block from an RC file
export function removeRcBlock(rcFile: string) {
    const content = readFileSync(rcFile, "utf-8");
    const cleaned = content.replace(markerRe(), "").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
    writeFileSync(rcFile, cleaned);
}
