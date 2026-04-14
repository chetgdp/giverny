// Visual demo of the shell spinner across a simulated agent turn.
// Exercises the real `createSpinner` from src/spinner.ts — no fake stream,
// no claude. Drives it with the same start/stop pattern shell.ts uses.
//
// Usage: bun tests/spinner-demo.ts
//
// What to watch for:
//   1. Fast tool calls (~50–80ms) should NOT flash a spinner between the
//      [Tool] summary line and the result lines. First frame is deferred
//      by FIRST_FRAME_DELAY_MS in src/spinner.ts.
//   2. Slow tool calls (>180ms) should render the spinner with the tool
//      name in the metadata.
//   3. The timer pads to 6 columns ("XXmXXs") — the separators and label
//      to the right of the number stay anchored as seconds roll 9→10,
//      59→1m00s, etc.

import { createSpinner } from "../src/spinner";
import { DIM, BOLD, RESET, ui } from "../src/shell-utils";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function note(msg: string) {
    ui.write(`\n${BOLD}${msg}${RESET}\n`);
}

function summary(tool: string, args: string) {
    ui.write(`${DIM}[${tool}] ${args}${RESET}\n`);
}

function output(line: string) {
    ui.write(`${DIM}  ${line}${RESET}\n`);
}

async function run() {
    ui.write(
`Spinner demo — drives src/spinner.ts through a simulated agent turn.

Watch for:
  - No spinner flash between summary and output for fast tools
  - Spinner appears with tool label for slow tools
  - Timer number grows leftward (stays right-aligned) — no column shift

`);

    const spinner = createSpinner({ effort: "high" });

    note("[1] thinking 3s — timer ticks 0s → 3s");
    spinner.start("thinking");
    await sleep(3000);

    spinner.stop();
    summary("Read", "/path/to/file.ts");
    note("[2] Read takes 50ms — spinner should NOT appear");
    spinner.start("Read");
    await sleep(50);
    spinner.stop();
    output("file contents line 1");
    output("file contents line 2");

    note("[3] thinking 2s");
    spinner.start("thinking");
    await sleep(2000);

    spinner.stop();
    summary("Bash", "npm install");
    note("[4] Bash takes 3s — spinner SHOULD appear with 'Bash' label");
    spinner.start("Bash");
    await sleep(3000);
    spinner.stop();
    output("installed 1234 packages in 2.8s");

    note("[5] thinking briefly");
    spinner.start("thinking");
    await sleep(700);

    spinner.stop();
    summary("Grep", "TODO src/");
    note("[6] Grep takes 80ms — spinner should NOT appear");
    spinner.start("Grep");
    await sleep(80);
    spinner.stop();
    output("src/spinner.ts:211: // TODO");

    note("[7] thinking 1s");
    spinner.start("thinking");
    await sleep(1000);

    spinner.stop();
    summary("WebFetch", "https://example.com/docs/really-slow-endpoint");
    note("[8] WebFetch takes 8s — watch spinner animate + timer tick");
    spinner.start("WebFetch");
    await sleep(8000);
    spinner.stop();
    output("fetched 14kb of markdown");

    note("[9] thinking 1s");
    spinner.start("thinking");
    await sleep(1000);

    spinner.stop();
    summary("Bash", "cargo build --release");
    note("[10] long Bash takes 12s — timer rolls 9s → 10s → 11s with no column shift");
    spinner.start("Bash");
    await sleep(12000);
    spinner.stop();
    output("Compiling giverny v0.1.0");
    output("Finished release [optimized] target(s) in 11.8s");

    note("[11] final thinking 20s — watch the minute boundary (timer crosses 1m)");
    spinner.start("thinking");
    await sleep(20000);
    spinner.stop();

    ui.write(`\n${BOLD}Done.${RESET}\n`);
}

run();
