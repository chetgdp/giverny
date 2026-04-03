// spinner.ts
// Kaomoji spinner for shell mode.
// Uses combobulation animations instead of braille dots.

import { displayWidth, ui, DUMB, ORANGE, DIM, RESET } from "./shell-utils";

// Kaomoji (combobulation) -------------------------------------------------- /
// Subtle 2-3 frame flipbook animations for different shell states.
// Each set is a tight loop of the SAME character with small variations.

export interface KaomojiSet {
    frames: string[];
    interval: number; // ms per frame
}

export const KAOMOJI: Record<string, KaomojiSet> = {
    // calm ↔ concentrating (sweat drop appears)
    thinking: {
        frames: [
            " ლ(ಠ_ಠ ლ)",
            "ლ (ಠ_ಠლ )"
        ],
        interval: 500,
    },
    // peeking from behind wall, waves when spotting something
    reading: {
        frames: [
            "|･ω･)ノ",
            "|･ω･)ﾉ",
        ],
        interval: 400,
    },
    // pen scribbles back and forth across the page
    writing: {
        frames: [
            "____φ(．．)",
            "___φ-(．．)",
        ],
        interval: 500,
    },
    // speed trail grows as runner picks up pace
    running: {
        frames: [
            "┌( >_<)┘",
            "ε=└( >_<)┐",
            "ε=ε=┌( >_<)┘",
            "ε=ε=ε=└( >_<)┐",
            "ε=ε=ε=ε=┌( >_<)┘",
            "ε=ε=ε=ε=ε=└( >_<)┐",
            "ε=ε=ε=ε=ε=ε=┌( >_<)┘",
            "ε=ε=ε=ε=ε=ε=ε=└( >_<)┐",
            "              ┌(>_< )┘",
            "            └(>_< )┐=3",
            "          ┌(>_< )┘=3=3",
            "        └(>_< )┐=3=3=3",
            "      ┌(>_< )┘=3=3=3=3",
            "    └(>_< )┐=3=3=3=3=3",
            "  ┌(>_< )┘=3=3=3=3=3=3",
            "└(>_< )┐=3=3=3=3=3=3=3",
        ],
        interval: 250,
    },
    // eyes scan left and right
    searching: {
        frames: [
            "( °_°)     ",
            "  ( °_°)   ",
            "    ( °_°) ",
            "     ( °_°)",
            "     (°_° )",
            "   (°_° )  ",
            " (°_° )    ",
            "(°_° )     ",
        ],
        interval: 500,
    },

    // two characters high-fiving (hand symbol alternates)
    agent: {
        frames: [
            "(・ω・)人(・ω・)",
            "(・ω・)八(・ω・)"
        ],
        interval: 500,
    },
    blinking: {
        frames: [
            "( - _ - )",
            "( 。_ 。)",
            "( 0 _ 0 )",
            "( 。_ 。)",
        ],
        interval: 500,
    },
    tableflip: {
        frames: [
            "(╮°ー° )╮   ┳━━┳",
            " (╮°ー° )╮  ┳━━┳",
            "  (╮°ー° )╮ ┳━━┳",
            "   (╮°ー° )╮┳━━┳",
            "   ( ╮°ー°)╮┳━━┳",
            "   ( ╯°益°)╯彡┻━━┻",
            "           ┳━━┳ノ(°ー°ノ)",
        ],
        interval: 1000,
    },
};

// All sets except tableflip (that one's triggered by long waits)
const RANDOM_POOL = Object.entries(KAOMOJI)
    .filter(([name]) => name !== "tableflip")
    .map(([, set]) => set);

// Returns a random kaomoji set from the pool.
export function getKaomojiSet(_label: string): KaomojiSet {
    return RANDOM_POOL[Math.floor(Math.random() * RANDOM_POOL.length)];
}

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

    // Dumb mode (nvim :!, no TTY): kaomoji face + slow dots, no escape codes
    if (DUMB) {
        let dumbInterval: ReturnType<typeof setInterval> | null = null;
        return {
            ctx,
            start(label: string) {
                if (dumbInterval) { clearInterval(dumbInterval); dumbInterval = null; }
                const face = getKaomojiSet(label).frames[0];
                ui.write(`${ORANGE}${face}`);
                dumbInterval = setInterval(() => ui.write(" ."), 2000);
            },
            stop() {
                if (dumbInterval) { clearInterval(dumbInterval); dumbInterval = null; }
                ui.write(`${RESET}\n`);
            },
        };
    }

    return {
        ctx,
        start(label: string) {
            // Clear interval without clearing the line — render() overwrites in place
            if (intervalId) { clearInterval(intervalId); intervalId = null; }
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

                // Face always renders. Metadata is progressive: only shown if terminal is wide enough.
                const cols = ui.columns || 80;
                const metaCol = 27; // column where metadata starts (after max 25-col kaomoji + gap)
                const mins = Math.floor(totalElapsed / 60);
                const secs = totalElapsed % 60;
                const time = mins > 0 ? `${mins}m${secs.toString().padStart(2, "0")}s` : `${secs}s`;
                const toolLabel = showLabel ? label : "";

                // Build metadata string progressively based on available space
                let meta = "";
                const remaining = cols - metaCol;
                if (remaining >= time.length) {
                    meta = time;
                    if (remaining >= meta.length + 3 + this.ctx.effort.length) {
                        meta += ` · ${this.ctx.effort}`;
                        if (toolLabel && remaining >= meta.length + 3 + toolLabel.length) {
                            meta += ` · ${toolLabel}`;
                        }
                    }
                }

                // Overwrite in place: face → pad to metaCol → metadata → clear remainder.
                // No \x1b[K before content — avoids blank-frame flicker.
                const faceW = displayWidth(face);
                const pad = Math.max(1, metaCol - 1 - faceW);
                if (meta) {
                    ui.write(`\r${ORANGE}${face}${RESET}${' '.repeat(pad)}${DIM}${meta}${RESET}\x1b[K`);
                } else {
                    ui.write(`\r${ORANGE}${face}${RESET}\x1b[K`);
                }
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
