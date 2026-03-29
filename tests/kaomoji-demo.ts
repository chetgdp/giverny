// Quick visual demorun each kaomoji animation for 2s in sequence.
// Usage: bun tests/kaomoji-demo.ts

import { KAOMOJI, type KaomojiSet } from "../src/shell-utils";

const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const MAX_TIME = 10000;

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function demo(name: string, set: KaomojiSet) {
    let i = 0;
    const start = Date.now();

    while (Date.now() - start < MAX_TIME) {
        const elapsed = Math.floor((Date.now() - start) / 1000);
        process.stdout.write(`\r\x1b[K${DIM}${set.frames[i++ % set.frames.length]}\x1b[30G${elapsed}s · ${name}${RESET}`);
        await sleep(set.interval);
    }
    process.stdout.write(`\r\x1b[K`);
    console.log(`  ${name} (${set.frames.length} frames @ ${set.interval}ms)`);
}

for (const [name, set] of Object.entries(KAOMOJI)) {
    await demo(name, set);
}
