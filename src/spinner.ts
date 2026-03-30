// spinner.ts
// Kaomoji spinner for shell mode.
// Uses combobulation animations instead of braille dots.

import { getKaomojiSet, KAOMOJI, ui, ORANGE, DIM, RESET } from "./shell-utils";

export interface SpinnerCtx {
    effort: string;
}

export function createSpinner(ctx: SpinnerCtx) {
    let i = 0;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    // Total elapsed time never resets — tracks wall time across all phases
    let startTime = Date.now();

    // Kaomoji and flip state persists across phase changes (thinking → tool → thinking)
    // so animations don't jank on quick tool calls. Shuffles every 20s wall time.
    let current = getKaomojiSet("thinking");
    let lastChangeAt = Date.now();
    let swapAfter = 10 + Math.random() * 10;
    const { frames: flipFrames, interval: flipInterval } = KAOMOJI.tableflip;
    let flipping = false;
    let flipFrame = 0;
    let nextFlipAt = 42;

    return {
        ctx,
        start(label: string) {
            this.stop();
            i = 0;
            // "thinking" is conveyed by the kaomoji — no need for the word
            const showLabel = label !== "thinking";

            const render = () => {
                const totalElapsed = Math.floor((Date.now() - startTime) / 1000);
                const sinceShuffle = Math.floor((Date.now() - lastChangeAt) / 1000);
                // Shuffle to a new random animation every 10-20s (wall time)
                if (!flipping && sinceShuffle >= swapAfter) {
                    current = getKaomojiSet(label);
                    i = 0;
                    lastChangeAt = Date.now();
                    swapAfter = 10 + Math.random() * 10;
                    clearInterval(intervalId!);
                    intervalId = setInterval(render, current.interval);
                }

                // Trigger a tableflip tantrum every 42s (wall time)
                if (!flipping && totalElapsed >= nextFlipAt) {
                    flipping = true;
                    flipFrame = 0;
                    clearInterval(intervalId!);
                    intervalId = setInterval(render, flipInterval);
                }

                // After cycling all flip frames, calm down and go back
                if (flipping && flipFrame >= flipFrames.length) {
                    flipping = false;
                    current = getKaomojiSet(label);
                    i = 0;
                    lastChangeAt = Date.now();
                    swapAfter = 10 + Math.random() * 10;
                    nextFlipAt = totalElapsed + 42;
                    clearInterval(intervalId!);
                    intervalId = setInterval(render, current.interval);
                }

                let face: string;
                if (flipping) {
                    face = flipFrames[flipFrame++];
                } else {
                    face = current.frames[i++ % current.frames.length];
                }

                // \x1b[33G anchors time so kaomoji width changes don't jitter
                const mins = Math.floor(totalElapsed / 60);
                const secs = totalElapsed % 60;
                const time = mins > 0 ? `${mins}m${secs.toString().padStart(2, "0")}s` : `${secs}s`;
                const toolCol = showLabel ? label.padEnd(12) : "".padEnd(12);
                ui.write(`\r\x1b[K${ORANGE}${face}${RESET}\x1b[33G${DIM}${time} · ${this.ctx.effort} · ${toolCol}${RESET}`);
            };

            render(); // first frame immediately
            intervalId = setInterval(render, current.interval);
        },
        stop() {
            if (intervalId) {
                clearInterval(intervalId);
                intervalId = null;
                ui.write("\r\x1b[K");
            }
        },
    };
}
