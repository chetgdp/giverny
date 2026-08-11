import { describe, it, expect } from "bun:test";
import { decodeKey } from "../src/tui";

describe("decodeKey", () => {
    it("decodes raw digits with their numeric payload", () => {
        const cases = [
            ["1", 1],
            ["2", 2],
            ["3", 3],
            ["4", 4],
            ["5", 5],
            ["6", 6],
            ["7", 7],
            ["8", 8],
            ["9", 9],
        ] as const;

        for (const [input, digit] of cases) {
            expect(decodeKey(Buffer.from(input), input.length)).toEqual({
                kind: "digit",
                digit,
            });
        }
    });

    it("decodes raw arrows in every direction", () => {
        const cases = [
            ["\x1b[A", "up"],
            ["\x1b[B", "down"],
            ["\x1b[C", "right"],
            ["\x1b[D", "left"],
        ] as const;

        for (const [input, kind] of cases) {
            expect(decodeKey(Buffer.from(input), input.length)).toEqual({ kind });
        }
    });

    it("decodes canonical digits and arrows with a trailing newline", () => {
        const cases = [
            ["1\n", "digit", 1],
            ["\x1b[A\n", "up"],
            ["\x1b[B\n", "down"],
            ["\x1b[C\n", "right"],
            ["\x1b[D\n", "left"],
        ] as const;

        for (const [input, kind, digit] of cases) {
            const expected = kind === "digit" ? { kind, digit } : { kind };
            expect(decodeKey(Buffer.from(input), input.length)).toEqual(expected);
        }
    });

    it("decodes both raw line endings and CRLF Enter", () => {
        expect(decodeKey(Buffer.from("\r"), 1)).toEqual({ kind: "enter" });
        expect(decodeKey(Buffer.from("\n"), 1)).toEqual({ kind: "enter" });
        expect(decodeKey(Buffer.from("\r\n"), 2)).toEqual({ kind: "enter" });
    });

    it("decodes vim navigation keys", () => {
        expect(decodeKey(Buffer.from("j"), 1)).toEqual({ kind: "vim-down" });
        expect(decodeKey(Buffer.from("k"), 1)).toEqual({ kind: "vim-up" });
    });

    it("decodes Ctrl+C and a lone Escape as escape", () => {
        expect(decodeKey(Buffer.from([0x03]), 1)).toEqual({ kind: "escape" });
        expect(decodeKey(Buffer.from([0x1b]), 1)).toEqual({ kind: "escape" });
    });

    it("returns other for garbage and empty reads", () => {
        expect(decodeKey(Buffer.from("x"), 1)).toEqual({ kind: "other" });
        expect(decodeKey(Buffer.from([0xff]), 1)).toEqual({ kind: "other" });
        expect(decodeKey(Buffer.from("\x1b[Z"), 4)).toEqual({ kind: "other" });
        expect(decodeKey(Buffer.alloc(0), 0)).toEqual({ kind: "other" });
    });

    it("honors n instead of decoding stale bytes beyond it", () => {
        const arrowWithStaleBytes = Buffer.from("\x1b[A");
        expect(decodeKey(arrowWithStaleBytes, 1)).toEqual({ kind: "escape" });

        const digitWithStaleBytes = Buffer.from("1x");
        expect(decodeKey(digitWithStaleBytes, 1)).toEqual({ kind: "digit", digit: 1 });

        const staleArrow = Buffer.from("\x1b[A");
        expect(decodeKey(staleArrow, 0)).toEqual({ kind: "other" });
    });
});
