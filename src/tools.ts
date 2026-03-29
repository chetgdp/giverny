// tools.ts
/*
* Tool definitions and executor for non-agentLoop backends.
* The entire tool harness is one tool: exec. The model uses sh to do everything else.
*/

// OpenAI function calling format — sent to the model in the API request
export const TOOL_SCHEMAS = [
    {
        type: "function" as const,
        function: {
            name: "exec",
            description: "Execute a shell command. Use this for all file operations (cat, ls, mkdir, etc.), search (grep, find, rg), text processing (sed, awk, perl), networking (curl), version control (git), and anything else available in the shell.",
            parameters: {
                type: "object",
                properties: {
                    command: {
                        type: "string",
                        description: "The shell command to execute",
                    },
                },
                required: ["command"],
            },
        },
    },
];

// Execute a tool call. Returns stdout, stderr, and whether it errored.
export async function executeTool(
    name: string,
    input: Record<string, any>,
    cwd?: string,
): Promise<{ stdout: string; stderr: string; isError: boolean }> {
    if (name !== "exec" || !input.command) {
        return { stdout: "", stderr: `Unknown tool: ${name}`, isError: true };
    }

    const proc = Bun.spawn(["sh", "-c", input.command], {
        cwd: cwd || process.cwd(),
        stdout: "pipe",
        stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
    ]);

    return { stdout, stderr, isError: exitCode !== 0 };
}
