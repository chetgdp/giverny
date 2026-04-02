// config.ts
// Shared config for bridge, server, and shell modes.

import { join } from "path";
import { readFileSync } from "fs";

// Bridge-layer env overrides (used by bridge.ts when opts don't specify)
export const DEFAULT_TIMEOUT = parseInt(process.env.CLAUDE_TIMEOUT || "120000");
export const DEFAULT_EFFORT = process.env.CLAUDE_EFFORT || "high";

// Shared paths -------------------------------------------------------------- /

export const HOME = process.env.HOME || "~";
export const GLOBAL_DIR = join(HOME, ".giverny");

// Shell RC file paths (setup + uninstall)
export const FISH_FN_DIR = join(HOME, ".config/fish/functions");
export const BASHRC = join(HOME, ".bashrc");
export const ZSHRC = join(HOME, ".zshrc");
export const NUSHELL_CONFIG = join(HOME, ".config/nushell/config.nu");

// Claude auth --------------------------------------------------------------- /

export function readClaudeAuth(): { subscription: string; rateTier: string } {
    try {
        const creds = JSON.parse(readFileSync(join(HOME, ".claude/.credentials.json"), "utf-8"));
        const oauth = creds.claudeAiOauth || {};
        return {
            subscription: oauth.subscriptionType || "unknown",
            rateTier: oauth.rateLimitTier || "",
        };
    } catch {
        return { subscription: "", rateTier: "" };
    }
}

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
    timeout?: number;       // seconds — max wall time per invocation (default 120)
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

export const CONFIG_DEFAULTS: Required<Omit<ShellConfig, "backends" | "url" | "apiKey" | "clusterId" | "port" | "protocol">> = {
    prefix: "@",
    backend: "claude-code",
    model: "opus",
    effort: "high",
    perms: "ask",
    tools: "all",
    output: "normal",
    session: "keep",
    timeout: 120,
    systemPrompt: "none",
};


export function log(...args: any[]) {
    const ts = new Date().toLocaleTimeString("en-GB", { hour12: false });
    console.log(`[${ts}] [${TAG}]`, ...args);
}
