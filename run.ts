#!/usr/bin/env bun
// run.ts
/*
* Giverny entry point.
* Routes --server, --setup, --help to the appropriate module.
* Bare `giverny` launches the interactive shell program.
*/

// only the first arg is a command flag
// but we did add command chaining so idk
const args = process.argv.slice(2);
const cmd = args[0]; 


// ok switch case, what does that compile to? lookup table if yes, good idk
switch (cmd) {

// this
    case "--server":
    case "-s":
        await import("./src/server.ts");
        break;
    case "--setup":
        await import("./src/setup.ts");
        break;

// this could be somehwere
// or do we even need it, running setup is way better
// AFUERA
    case "--use": {
        // giverny --use completions http://192.168.2.16:8080
        // giverny --use claude-code
        const { existsSync, mkdirSync, readFileSync, writeFileSync } = await import("fs");
        const { join } = await import("path");
        const GLOBAL_DIR = join(process.env.HOME || "~", ".giverny");
        const GLOBAL_CONFIG = join(GLOBAL_DIR, "config.json");
        const backend = args[1];
        const url = args[2] || "";
        // more are valid than this?
        const valid = ["claude-code", "completions"];
        if (!backend || !valid.includes(backend)) {
            console.log(`Usage: giverny --use <${valid.join("|")}> [url]`);
            if (existsSync(GLOBAL_CONFIG)) {
                try {
                    const cfg = JSON.parse(readFileSync(GLOBAL_CONFIG, "utf-8"));
                    console.log(`  current: ${cfg.backend || "claude-code"}${cfg.url ? ` (${cfg.url})` : ""}`);
                } catch {}
            }
            break;
        }
        let cfg: Record<string, any> = {};
        mkdirSync(GLOBAL_DIR, { recursive: true });
        if (existsSync(GLOBAL_CONFIG)) {
            try { cfg = JSON.parse(readFileSync(GLOBAL_CONFIG, "utf-8")); } catch {}
        }
        cfg.backend = backend;
        if (url) cfg.url = url;
        else if (backend === "claude-code") delete cfg.url;
        writeFileSync(GLOBAL_CONFIG, JSON.stringify(cfg, null, 2) + "\n");
        console.log(`backend → ${backend}${url ? ` (${url})` : ""}`);
        break;
    }

// useful actually, for a one liner to disappear itself as well
    case "--uninstall":
        await import("./src/uninstall.ts");
        break;

// this could be its own function
    case "--help":
    case "-h":
        const { readFileSync, existsSync } = await import("fs");
        const { join } = await import("path");
        const cfgPath = join(process.env.HOME || "~", ".giverny/config.json");
        let pfx = ",";
        if (existsSync(cfgPath)) {
            try { 
                pfx = JSON.parse(readFileSync(cfgPath, "utf-8")).prefix || ","; 
            } catch {}
        }
        const { printHelp } = await import("./src/help.ts");
        printHelp(pfx);
        break;

// if pipe is the glue between everything in the shell
// then giverny is what?
    default: {
        const { main } = await import("./src/shell.ts");
        await main();
    }
}
