#!/usr/bin/env bun
// run.ts
/*
* Givernyentry point.
* Routes --server, --setup, --help to the appropriate module.
* Bare `giverny` launches the interactive shell program.
*/

// onlt the first arg is a command flag for now, until we add command chains
const args = process.argv.slice(2);
const cmd = args[0]; 

switch (cmd) {
    case "--server":
    case "-s":
        await import("./src/server.ts");
        break;
    case "--setup":
        await import("./src/setup.ts");
        break;
    case "--use": {
        // giverny --use llama-server http://192.168.2.16:8080
        // giverny --use claude-code
        const { existsSync, mkdirSync, readFileSync, writeFileSync } = await import("fs");
        const { join } = await import("path");
        const GLOBAL_DIR = join(process.env.HOME || "~", ".giverny");
        const GLOBAL_CONFIG = join(GLOBAL_DIR, "config.json");
        const backend = args[1];
        const url = args[2] || "";
        const valid = ["claude-code", "llama-server"];
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
    case "--uninstall":
        await import("./src/uninstall.ts");
        break;
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
    default: {
        const { main } = await import("./src/shell.ts");
        await main();
    }
}
