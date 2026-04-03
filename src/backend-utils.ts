// backend-utils.ts
// Shared helpers for completions and responses backends.
// Extracts the duplicated plumbing: URL/auth resolution, code block
// extraction, block building, status checks, and model probing.

import type { BackendInfo, ContentBlock } from "./backend";

export const DEFAULT_URL = "http://localhost:8080";

export function getBaseUrl(opts?: Record<string, any>): string {
    return opts?.url || process.env.COMPLETIONS_URL || DEFAULT_URL;
}

export function getApiKey(opts?: Record<string, any>): string {
    return opts?.apiKey || process.env.COMPLETIONS_API_KEY || "";
}

export function getClusterId(opts?: Record<string, any>): string {
    return opts?.clusterId || process.env.COMPLETIONS_CLUSTER_ID || "";
}

// Build Authorization + X-Cluster-ID headers from backend options.
// Callers add Content-Type or other headers as needed.
export function buildAuthHeaders(opts?: Record<string, any>): Record<string, string> {
    const apiKey = getApiKey(opts);
    const clusterId = getClusterId(opts);
    const headers: Record<string, string> = {};
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
    if (clusterId) headers["X-Cluster-ID"] = clusterId;
    return headers;
}

// Extract shell commands from fenced code blocks (```bash / ```sh / ```)
export function extractCodeBlocks(text: string): string[] {
    const re = /```(?:bash|sh|shell)\n([\s\S]*?)```/g;
    const commands: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        const cmd = m[1].trim();
        if (cmd) commands.push(cmd);
    }
    return commands;
}

// Build content blocks from accumulated text and tool calls.
// Handles the code-block-fallback pattern: if the model didn't use
// function calling but wrote fenced code blocks, extract them as
// exec tool calls. Many local models do this.
export function buildBlocksFromAccumulated(
    fullText: string,
    toolCallAccum: Map<any, { id: string; name: string; arguments: string }>,
): ContentBlock[] {
    const blocks: ContentBlock[] = [];

    if (fullText && toolCallAccum.size === 0) {
        const codeBlocks = extractCodeBlocks(fullText);
        if (codeBlocks.length > 0) {
            // Strip code blocks from the text to get surrounding prose
            let prose = fullText;
            for (const cmd of codeBlocks) {
                prose = prose.replace(/```(?:bash|sh|shell)?\n[^`]*```/s, "");
            }
            prose = prose.trim();
            if (prose) blocks.push({ type: "text", text: prose });

            for (let i = 0; i < codeBlocks.length; i++) {
                blocks.push({
                    type: "tool_use",
                    id: `call_fb_${Date.now()}_${i}`,
                    name: "exec",
                    input: { command: codeBlocks[i] },
                });
            }
        } else {
            blocks.push({ type: "text", text: fullText });
        }
    } else {
        if (fullText) {
            blocks.push({ type: "text", text: fullText });
        }

        for (const [, tc] of toolCallAccum) {
            let input: Record<string, any> = {};
            try { input = JSON.parse(tc.arguments); } catch {}
            blocks.push({
                type: "tool_use",
                id: tc.id,
                name: tc.name,
                input,
            });
        }
    }

    return blocks;
}

// Check endpoint status — verify server is running and report model info
export async function checkEndpointStatus(opts?: Record<string, any>): Promise<Record<string, string>> {
    const baseUrl = getBaseUrl(opts);
    try {
        const headers = buildAuthHeaders(opts);
        const res = await fetch(`${baseUrl}/v1/models`, { headers });
        if (!res.ok) return { status: "error", url: baseUrl };
        const data = await res.json() as any;
        const m = data?.data?.[0];
        const model = m?.id || "unknown";
        const ctx = m?.meta?.n_ctx_train || m?.max_model_len || m?.context_length || 0;
        return { status: "running", url: baseUrl, model, context_length: ctx ? String(ctx) : "unknown" };
    } catch {
        return { status: "not running", url: baseUrl };
    }
}

// Probe server for model info — called once on first use.
// descriptionLabel differentiates "completions model" vs "responses model".
export async function probeEndpointModels(baseUrl: string, baseInfo: BackendInfo, descriptionLabel: string): Promise<BackendInfo> {
    try {
        const res = await fetch(`${baseUrl}/v1/models`);
        if (res.ok) {
            const data = await res.json() as any;
            const models = (data?.data || []).map((m: any) => ({
                id: m.id || "local",
                contextWindow: m.meta?.n_ctx_train || m.max_model_len || m.context_length || 0,
                description: m.id || descriptionLabel,
            }));
            if (models.length > 0) return { ...baseInfo, models };
        }
    } catch {}
    return baseInfo;
}

// Create a lazy-probing info getter for backend exports.
// Probes models on first access, returns base info synchronously until probe completes.
export function createCachedInfoGetter(baseInfo: BackendInfo, descriptionLabel: string): () => BackendInfo {
    let cachedInfo: BackendInfo | null = null;
    return () => {
        if (!cachedInfo) {
            const baseUrl = process.env.COMPLETIONS_URL || DEFAULT_URL;
            probeEndpointModels(baseUrl, baseInfo, descriptionLabel).then(i => { cachedInfo = i; });
            return baseInfo;
        }
        return cachedInfo;
    };
}
