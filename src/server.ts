// server.ts
/*
* Giverny Bridge Server
*
* OpenAI-compatible /v1/chat/completions endpoint that forwards to `claude -p`.
* Uses the bridge engine to invoke Claude and intercept structured tool_use.
* Converts to OpenAI tool_calls format. Supports non-streaming and SSE streaming.
*/

import { getBackend } from "./backend";
import { Bridge } from "./bridge-loop";
import { log } from "./config";

const bridge = new Bridge(getBackend("claude-code"));
import {
    sessionKey,
    buildSystemPrompt,
    buildPrompt,
    buildDeltaPrompt,
    parseTextToolCalls,
    convertToolUseBlocks,
    makeOpenAIResponse,
    buildSSEStream,
    type ParsedResponse,
} from "./protocol";

// let's pick a better port?
// make it easy to config?
// 42069 Xd 6767 :--------D lelelelel
const PORT = parseInt(process.env.PORT || "8741");

// Session management ------------------------------------------------------- /
// reuse Claude Code sessions across turns

interface Session {
    backendSessionId: string;
    sentMsgCount: number;
}

const sessions = new Map<string, Session>();

// Request handler --------------------------------------------------------- /

async function handleChatCompletions(body: any): Promise<Response> {
    const { messages, tools, model, stream } = body;

    if (!messages?.length) {
        return Response.json(
            {
                error: {
                    message: "messages is required",
                    type: "invalid_request_error",
                },
            },
            { status: 400 },
        );
    }

    const nonSystem = messages.filter((m: any) => m.role !== "system");
    const key = sessionKey(messages, tools);
    const session = sessions.get(key);

    let prompt: string;
    let resumeSessionId: string | undefined;
    let isResume = false;

    if (
        session &&
        session.sentMsgCount > 0 &&
        nonSystem.length > session.sentMsgCount
    ) {
        const newMsgs = nonSystem.slice(session.sentMsgCount);
        const delta = buildDeltaPrompt(newMsgs);

        if (delta) {
            prompt = delta;
            resumeSessionId = session.backendSessionId;
            isResume = true;
        } else {
            prompt = buildPrompt(messages);
        }
    } else {
        prompt = buildPrompt(messages);
    }

    const systemPrompt = buildSystemPrompt(messages, tools);
    const msgCount = messages.length;
    const toolCount = tools?.length || 0;

    let sessionTag = " [NEW SESSION]";
    if (isResume) sessionTag = ` [RESUME ${resumeSessionId!.slice(0, 8)}… delta=${nonSystem.length - (session?.sentMsgCount || 0)} msgs]`;
    log(`→ claude -p | ${msgCount} msgs, ${toolCount} tools, model=${model || "default"}, stream=${!!stream}${sessionTag}`);

    const start = Date.now();

    let result;
    try {
        result = await bridge.collect({
            prompt,
            systemPrompt,
            model,
            sessionId: resumeSessionId,
            options: { tools: "" },
        });
    } catch (e: any) {
        if (isResume) {
            log(`⚠ Resume failed, falling back to new session`);
            sessions.delete(key);
            result = await bridge.collect({
                prompt: buildPrompt(messages),
                systemPrompt,
                model,
                options: { tools: "" },
            });
        } else {
            throw e;
        }
    }

    const elapsed = Date.now() - start;

    // Build parsed response: prefer structured tool_use, fall back to text parsing
    let parsed: ParsedResponse;

    if (result.toolUseBlocks.length > 0) {
        parsed = {
            content: result.text || null,
            tool_calls: convertToolUseBlocks(result.toolUseBlocks),
            finish_reason: "tool_calls",
        };
        // Tool call turns corrupt the session (Claude Code logs an error internally)
        // so delete the session to force a fresh one next turn
        sessions.delete(key);
    } else {
        parsed = parseTextToolCalls(result.text);
        // Update session for text-only responses
        if (result.sessionId) {
            sessions.set(key, {
                backendSessionId: result.sessionId,
                sentMsgCount: nonSystem.length,
            });
        }
    }

    const textLen = parsed.content?.length || 0;
    const toolLen = parsed.tool_calls?.length || 0;
    const source = result.toolUseBlocks.length > 0 ? "structured" : "text";
    let msg = `← ${elapsed}ms | ${textLen} chars text, ${toolLen} tool calls (${source})`;
    if (result.durationMs) msg += ` (api: ${result.durationMs}ms)`;
    if (result.sessionId) msg += ` [session: ${result.sessionId.slice(0, 8)}…]`;
    log(msg);

    if (stream) {
        return new Response(buildSSEStream(parsed, model, result.usage), {
            headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                Connection: "keep-alive",
                "Access-Control-Allow-Origin": "*",
            },
        });
    }

    return Response.json(makeOpenAIResponse(parsed, model, result.usage));
}

// HTTP server ------------------------------------------------------------- /

export const server = Bun.serve({
    port: PORT,
    async fetch(req) {
        const url = new URL(req.url);

        if (req.method === "OPTIONS") {
            return new Response(null, {
                status: 204,
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                    "Access-Control-Allow-Headers": "Content-Type, Authorization",
                },
            });
        }

        if (req.method === "GET" && url.pathname === "/v1/models") {
            return Response.json({
                object: "list",
                data: bridge.info.models.map(m => ({
                    id: m.id, object: "model", created: 0, owned_by: bridge.info.name,
                })),
            });
        }

        if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
            try {
                const body = await req.json();
                log(`↓ incoming request (model=${body.model || "default"}, ${body.messages?.length || 0} msgs, ${body.tools?.length || 0} tools, stream=${!!body.stream})`);
                return await handleChatCompletions(body);
            } catch (err: any) {
                log(`error:`, err.message);
                return Response.json(
                    { error: { message: err.message, type: "server_error", code: 500 } },
                    { status: 500 },
                );
            }
        }

        if (req.method === "GET" && url.pathname === "/") {
            return Response.json({
                name: "giverny",
                version: "0.1.0",
                status: "ok",
                activeSessions: sessions.size,
                endpoints: ["/v1/chat/completions", "/v1/models"],
            });
        }

        return Response.json(
            { error: { message: "Not found", type: "invalid_request_error" } },
            { status: 404 },
        );
    },
});

log(`Giverny bridge server on http://localhost:${server.port}`);
log(`Usage: OPENAI_BASE_URL=http://localhost:${server.port}/v1 OPENAI_API_KEY=sk-giverny`);
