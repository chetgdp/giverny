#!/usr/bin/env bun
// run.ts
/*
* Giverny entry point.
* Routes --server, --setup, --uninstall, --help, or default to the appropriate module.
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

// useful actually, for a one liner to disappear itself as well
    case "--uninstall":
        await import("./src/uninstall.ts");
        break;

    case "--help":
    case "-h":
        const { printHelp } = await import("./src/help.ts");
        printHelp();
        break;

// if pipe is the glue between everything in the shell
// then giverny is what?
    default:
        const { main } = await import("./src/shell.ts");
        await main();
}
