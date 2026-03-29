import { describe, it, expect, afterAll, spyOn } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Temp dir for config so tests don't touch real ~/.giverny
const tmpDir = mkdtempSync(join(tmpdir(), "giverny-shell-test-"));
const origHome = process.env.HOME;
const origCwd = process.cwd();
process.env.HOME = tmpDir;
process.chdir(tmpDir);

// Dynamic import after env setup so module constants use tmpDir
const shell = await import("../src/shell");
const { getBackend } = await import("../src/backend");
const { Bridge } = await import("../src/bridge-loop");
const bridge = new Bridge(getBackend("claude-code"));
const handleSlashCommand = (cmd: string) => shell.handleSlashCommand(cmd, bridge);

// Suppress console.log noise from slash commands
const logSpy = spyOn(console, "log").mockImplementation(() => {});

afterAll(() => {
    logSpy.mockRestore();
    process.env.HOME = origHome;
    process.chdir(origCwd);
    rmSync(tmpDir, { recursive: true, force: true });
});

// Helper: last console.log call text
const lastLog = () => {
    const calls = logSpy.mock.calls;
    return calls.length > 0 ? calls[calls.length - 1].join(" ") : "";
};

const clearLog = () => logSpy.mockClear();

describe("handleSlashCommand", () => {
    // -- display commands return true ----------------------------------------

    describe("display commands", () => {
        it("/status returns true", async () => {
            expect(await handleSlashCommand("/status")).toBe(true);
        });

        it("/config returns true", async () => {
            expect(await handleSlashCommand("/config")).toBe(true);
        });

        it("/context returns true", async () => {
            expect(await handleSlashCommand("/context")).toBe(true);
        });

        it("/help returns true", async () => {
            expect(await handleSlashCommand("/help")).toBe(true);
        });

        it("/tools returns true", async () => {
            expect(await handleSlashCommand("/tools")).toBe(true);
        });
    });

    // -- unrecognized commands pass through ----------------------------------

    describe("unrecognized commands", () => {
        it("returns original cmd string", async () => {
            expect(await handleSlashCommand("/unknown")).toBe("/unknown");
            expect(await handleSlashCommand("/foo bar baz")).toBe("/foo bar baz");
        });
    });

    // -- model ---------------------------------------------------------------

    describe("/model", () => {
        it("no args displays current", async () => {
            expect(await handleSlashCommand("/model")).toBe(true);
        });

        it("sets valid models", async () => {
            expect(await handleSlashCommand("/model opus")).toBe(true);
            expect(await handleSlashCommand("/model sonnet")).toBe(true);
            expect(await handleSlashCommand("/model haiku")).toBe(true);
        });

        it("rejects invalid model", async () => {
            clearLog();
            expect(await handleSlashCommand("/model gpt4")).toBe(true);
            expect(lastLog()).toContain("unknown model");
        });

        it("shortcuts delegate correctly", async () => {
            expect(await handleSlashCommand("/opus")).toBe(true);
            expect(await handleSlashCommand("/sonnet")).toBe(true);
            expect(await handleSlashCommand("/haiku")).toBe(true);
        });

        it("downgrades effort when switching to model that doesn't support it", async () => {
            await handleSlashCommand("/model opus");
            await handleSlashCommand("/effort max");
            clearLog();
            await handleSlashCommand("/model sonnet");
            expect(lastLog()).toContain("max → high");
            expect(lastLog()).toContain("not supported on sonnet");
        });
    });

    // -- effort --------------------------------------------------------------

    describe("/effort", () => {
        it("no args displays current", async () => {
            expect(await handleSlashCommand("/effort")).toBe(true);
        });

        it("sets valid efforts", async () => {
            expect(await handleSlashCommand("/effort low")).toBe(true);
            expect(await handleSlashCommand("/effort medium")).toBe(true);
            expect(await handleSlashCommand("/effort high")).toBe(true);
        });

        it("allows max on opus", async () => {
            await handleSlashCommand("/model opus");
            expect(await handleSlashCommand("/effort max")).toBe(true);
        });

        it("rejects max on non-opus", async () => {
            await handleSlashCommand("/model sonnet");
            clearLog();
            expect(await handleSlashCommand("/effort max")).toBe(true);
            expect(lastLog()).toContain("not supported on sonnet");
        });

        it("rejects invalid effort", async () => {
            clearLog();
            expect(await handleSlashCommand("/effort turbo")).toBe(true);
            expect(lastLog()).toContain("unknown effort");
        });

        it("shortcuts delegate correctly", async () => {
            expect(await handleSlashCommand("/low")).toBe(true);
            expect(await handleSlashCommand("/medium")).toBe(true);
            expect(await handleSlashCommand("/high")).toBe(true);
        });
    });

    // -- perms ---------------------------------------------------------------

    describe("/perms", () => {
        it("no args displays current", async () => {
            expect(await handleSlashCommand("/perms")).toBe(true);
        });

        it("sets valid modes", async () => {
            expect(await handleSlashCommand("/perms auto")).toBe(true);
            expect(await handleSlashCommand("/perms ask")).toBe(true);
            expect(await handleSlashCommand("/perms plan")).toBe(true);
        });

        it("shortcuts delegate correctly", async () => {
            expect(await handleSlashCommand("/auto")).toBe(true);
            expect(await handleSlashCommand("/ask")).toBe(true);
            expect(await handleSlashCommand("/plan")).toBe(true);
        });
    });

    // -- output --------------------------------------------------------------

    describe("/output", () => {
        it("no args displays current", async () => {
            expect(await handleSlashCommand("/output")).toBe(true);
        });

        it("sets valid levels", async () => {
            expect(await handleSlashCommand("/output quiet")).toBe(true);
            expect(await handleSlashCommand("/output normal")).toBe(true);
            expect(await handleSlashCommand("/output verbose")).toBe(true);
        });

        it("rejects invalid level", async () => {
            clearLog();
            expect(await handleSlashCommand("/output debug")).toBe(true);
            expect(lastLog()).toContain("unknown level");
        });

        it("shortcuts delegate correctly", async () => {
            expect(await handleSlashCommand("/quiet")).toBe(true);
            expect(await handleSlashCommand("/normal")).toBe(true);
            expect(await handleSlashCommand("/verbose")).toBe(true);
        });
    });

    // -- session -------------------------------------------------------------

    describe("/session", () => {
        it("no args displays current", async () => {
            expect(await handleSlashCommand("/session")).toBe(true);
        });

        it("sets valid modes", async () => {
            expect(await handleSlashCommand("/session keep")).toBe(true);
            expect(await handleSlashCommand("/session fresh")).toBe(true);
        });

        it("rejects invalid mode", async () => {
            clearLog();
            expect(await handleSlashCommand("/session yolo")).toBe(true);
            expect(lastLog()).toContain("unknown mode");
        });

        it("shortcuts delegate correctly", async () => {
            expect(await handleSlashCommand("/keep")).toBe(true);
            expect(await handleSlashCommand("/fresh")).toBe(true);
        });
    });

    // -- prompt chaining (return string) -------------------------------------

    describe("prompt chaining", () => {
        it("/new with arg returns the arg as prompt", async () => {
            expect(await handleSlashCommand("/new explain this")).toBe("explain this");
        });

        it("/new without arg clears and returns true", async () => {
            expect(await handleSlashCommand("/new")).toBe(true);
        });

        it("/clear returns true", async () => {
            expect(await handleSlashCommand("/clear")).toBe(true);
        });

        it("/diff with no changes returns true", async () => {
            // tmpDir is not a git repo, so diff is empty
            expect(await handleSlashCommand("/diff")).toBe(true);
        });

        it("/compact with no session returns true", async () => {
            expect(await handleSlashCommand("/compact")).toBe(true);
        });
    });

    // -- session management --------------------------------------------------

    describe("session management", () => {
        it("/resume with no sessions returns true", async () => {
            expect(await handleSlashCommand("/resume")).toBe(true);
        });

        it("/export with no transcript returns true", async () => {
            expect(await handleSlashCommand("/export")).toBe(true);
        });

        it("/last with no transcript returns true", async () => {
            expect(await handleSlashCommand("/last")).toBe(true);
        });

        it("/copy aliases to /last", async () => {
            expect(await handleSlashCommand("/copy")).toBe(true);
        });
    });

    // -- reset ---------------------------------------------------------------

    describe("/reset", () => {
        it("returns true", async () => {
            expect(await handleSlashCommand("/reset")).toBe(true);
        });
    });

    // -- local flag ----------------------------------------------------------

    describe("--local flag", () => {
        it("/model with --local returns true", async () => {
            expect(await handleSlashCommand("/model opus --local")).toBe(true);
        });

        it("/effort with -l returns true", async () => {
            expect(await handleSlashCommand("/effort high -l")).toBe(true);
        });
    });
});
