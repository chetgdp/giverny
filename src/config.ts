// config.ts
// Shared config for bridge, server, and shell modes.

// Bridge-layer env overrides (used by bridge.ts when opts don't specify)
export const DEFAULT_TIMEOUT = parseInt(process.env.CLAUDE_TIMEOUT || "300000");
export const DEFAULT_EFFORT = process.env.CLAUDE_EFFORT || "high";

export const TAG = "giverny";

// Valid prefix characters for shell aliases (noglob-protected in bash/zsh, fish is safe as-is)
export const VALID_PREFIXES = [",", "?", "@", "+", "_"] as const;
export type PrefixChar = typeof VALID_PREFIXES[number];

// Per-backend connection settings (nested under backend name in config JSON)
export interface BackendConfig {
    url?: string;
    apiKey?: string;
    clusterId?: string;
    port?: string;
    protocol?: string;  // "completions" or "responses"
}

// Shell config: the single source of truth for defaults
export interface ShellConfig {
    prefix?: string;
    backend?: string;
    model?: string;
    effort?: string;
    perms?: string;
    tools?: string;
    output?: string;
    session?: string;
    systemPrompt?: string;  // "default" | "none" | custom string (non-agentLoop backends only)
    // Backend-specific (resolved at load time from sub-objects)
    url?: string;
    apiKey?: string;
    clusterId?: string;
    port?: string;
    protocol?: string;
    // Per-backend storage
    backends?: Record<string, BackendConfig>;
}

export const CONFIG_DEFAULTS: Required<Omit<ShellConfig, "backends" | "url" | "apiKey" | "clusterId" | "port">> = {
    prefix: "@",
    backend: "claude-code",
    model: "opus",
    effort: "high",
    perms: "ask",
    tools: "all",
    output: "normal",
    session: "keep",
    systemPrompt: "default",
};


export function log(...args: any[]) {
    const ts = new Date().toLocaleTimeString("en-GB", { hour12: false });
    console.log(`[${ts}] [${TAG}]`, ...args);
}
