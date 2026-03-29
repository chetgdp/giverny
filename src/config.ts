// config.ts
// Shared config for bridge, server, and shell modes.

// Bridge-layer env overrides (used by bridge.ts when opts don't specify)
export const DEFAULT_TIMEOUT = parseInt(process.env.CLAUDE_TIMEOUT || "300000");
export const DEFAULT_EFFORT = process.env.CLAUDE_EFFORT || "high";

export const TAG = "giverny";

// Valid prefix characters for shell aliases (noglob-protected in bash/zsh, fish is safe as-is)
export const VALID_PREFIXES = [",", "?", "@", "+", "_"] as const;
export type PrefixChar = typeof VALID_PREFIXES[number];

// Shell config: the single source of truth for defaults
export interface ShellConfig {
    prefix?: string;
    backend?: string;
    url?: string;
    model?: string;
    effort?: string;
    perms?: string;
    tools?: string;
    output?: string;
    session?: string;
}

export const CONFIG_DEFAULTS: Required<ShellConfig> = {
    prefix: "@",
    backend: "claude-code",
    url: "",
    model: "opus",
    effort: "high",
    perms: "ask",
    tools: "all",
    output: "normal",
    session: "keep",
};


export function log(...args: any[]) {
    const ts = new Date().toLocaleTimeString("en-GB", { hour12: false });
    console.log(`[${ts}] [${TAG}]`, ...args);
}
