// responses-protocol.ts
/*
* OpenAI Responses API protocol helpers — pure functions for converting
* between the v1/responses format and Claude's native format.
*
* The responses API uses a different shape from chat/completions:
* - `input` + `instructions` instead of `messages`
* - `output[]` array with typed items instead of `choices[].message`
* - Named SSE events (event: response.output_text.delta) instead of bare data: lines
* - Sequence numbers on every event
* - No `data: [DONE]` terminator — stream ends with `response.completed`
*/

import {
    randomId,
    type ParsedResponse,
} from "./protocol";

// Types ------------------------------------------------------------------- /

export interface ResponseObject {
    id: string;
    object: "response";
    created_at: number;
    model: string;
    status: "completed" | "failed" | "in_progress";
    output: ResponseOutputItem[];
    usage: { input_tokens: number; output_tokens: number; total_tokens: number };
}

export interface ResponseMessageItem {
    type: "message";
    id: string;
    role: "assistant";
    status: "completed" | "in_progress";
    content: Array<{ type: "output_text"; text: string }>;
}

export interface ResponseFunctionCallItem {
    type: "function_call";
    id: string;
    call_id: string;
    name: string;
    arguments: string;
    status: "completed" | "in_progress";
}

export type ResponseOutputItem = ResponseMessageItem | ResponseFunctionCallItem;

// Input normalization ----------------------------------------------------- /
// Converts responses-format input + instructions into messages[]
// so existing buildPrompt / buildSystemPrompt work unchanged.

export function normalizeInput(
    input: string | any[],
    instructions?: string,
): any[] {
    const msgs: any[] = [];
    if (instructions) msgs.push({ role: "system", content: instructions });
    if (typeof input === "string") {
        msgs.push({ role: "user", content: input });
    } else {
        msgs.push(...input);
    }
    return msgs;
}

// Non-streaming response builder ------------------------------------------ /

export function makeResponseObject(
    parsed: ParsedResponse,
    model: string,
    usage?: { input_tokens: number; output_tokens: number },
    responseId?: string,
): ResponseObject {
    const id = responseId || randomId("resp_", 8);
    const output: ResponseOutputItem[] = [];

    if (parsed.content) {
        output.push({
            type: "message",
            id: randomId("msg_", 8),
            role: "assistant",
            status: "completed",
            content: [{ type: "output_text", text: parsed.content }],
        });
    }

    if (parsed.tool_calls) {
        for (const tc of parsed.tool_calls) {
            output.push({
                type: "function_call",
                id: randomId("fc_", 8),
                call_id: tc.id,
                name: tc.function.name,
                arguments: tc.function.arguments,
                status: "completed",
            });
        }
    }

    return {
        id,
        object: "response",
        created_at: Math.floor(Date.now() / 1000),
        model: model || "claude-opus-4-6-20250514",
        status: "completed",
        output,
        usage: {
            input_tokens: usage?.input_tokens || 0,
            output_tokens: usage?.output_tokens || 0,
            total_tokens: (usage?.input_tokens || 0) + (usage?.output_tokens || 0),
        },
    };
}

// SSE streaming builder --------------------------------------------------- /
// Emits the full responses-format event sequence as named SSE events.

export function buildResponsesSSEStream(
    parsed: ParsedResponse,
    model: string,
    usage?: { input_tokens: number; output_tokens: number },
    responseId?: string,
): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    let seq = 0;
    const nextSeq = () => ++seq;

    // Named SSE: `event: <type>\ndata: <json>\n\n`
    const sse = (eventType: string, data: any) =>
        encoder.encode(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`);

    return new ReadableStream({
        start(controller) {
            const respId = responseId || randomId("resp_", 8);
            const m = model || "claude-opus-4-6-20250514";
            const usageObj = {
                input_tokens: usage?.input_tokens || 0,
                output_tokens: usage?.output_tokens || 0,
                total_tokens: (usage?.input_tokens || 0) + (usage?.output_tokens || 0),
            };

            // Skeleton response for bookend events
            const baseResponse = {
                id: respId,
                object: "response" as const,
                created_at: Math.floor(Date.now() / 1000),
                model: m,
                status: "in_progress" as const,
                output: [] as any[],
                usage: usageObj,
            };

            // response.created + response.in_progress
            controller.enqueue(sse("response.created", {
                type: "response.created",
                response: { ...baseResponse },
                sequence_number: nextSeq(),
            }));
            controller.enqueue(sse("response.in_progress", {
                type: "response.in_progress",
                response: { ...baseResponse },
                sequence_number: nextSeq(),
            }));

            const completedOutput: ResponseOutputItem[] = [];
            let outputIndex = 0;

            // Text content
            if (parsed.content) {
                const msgId = randomId("msg_", 8);

                // output_item.added
                controller.enqueue(sse("response.output_item.added", {
                    type: "response.output_item.added",
                    output_index: outputIndex,
                    item: { type: "message", id: msgId, role: "assistant", status: "in_progress", content: [] },
                    sequence_number: nextSeq(),
                }));

                // content_part.added
                controller.enqueue(sse("response.content_part.added", {
                    type: "response.content_part.added",
                    item_id: msgId,
                    output_index: outputIndex,
                    content_index: 0,
                    part: { type: "output_text", text: "" },
                    sequence_number: nextSeq(),
                }));

                // output_text.delta (chunked by word boundaries, ~80 chars)
                const words = parsed.content.split(/(\s+)/);
                let buf = "";
                for (const word of words) {
                    buf += word;
                    if (buf.length >= 80 || buf.includes("\n")) {
                        controller.enqueue(sse("response.output_text.delta", {
                            type: "response.output_text.delta",
                            item_id: msgId,
                            output_index: outputIndex,
                            content_index: 0,
                            delta: buf,
                            sequence_number: nextSeq(),
                        }));
                        buf = "";
                    }
                }
                if (buf) {
                    controller.enqueue(sse("response.output_text.delta", {
                        type: "response.output_text.delta",
                        item_id: msgId,
                        output_index: outputIndex,
                        content_index: 0,
                        delta: buf,
                        sequence_number: nextSeq(),
                    }));
                }

                // output_text.done
                controller.enqueue(sse("response.output_text.done", {
                    type: "response.output_text.done",
                    item_id: msgId,
                    output_index: outputIndex,
                    content_index: 0,
                    text: parsed.content,
                    sequence_number: nextSeq(),
                }));

                // content_part.done
                controller.enqueue(sse("response.content_part.done", {
                    type: "response.content_part.done",
                    item_id: msgId,
                    output_index: outputIndex,
                    content_index: 0,
                    part: { type: "output_text", text: parsed.content },
                    sequence_number: nextSeq(),
                }));

                // output_item.done
                const completedMsg: ResponseMessageItem = {
                    type: "message",
                    id: msgId,
                    role: "assistant",
                    status: "completed",
                    content: [{ type: "output_text", text: parsed.content }],
                };
                controller.enqueue(sse("response.output_item.done", {
                    type: "response.output_item.done",
                    output_index: outputIndex,
                    item: completedMsg,
                    sequence_number: nextSeq(),
                }));

                completedOutput.push(completedMsg);
                outputIndex++;
            }

            // Function calls
            if (parsed.tool_calls) {
                for (const tc of parsed.tool_calls) {
                    const fcId = randomId("fc_", 8);

                    // output_item.added
                    controller.enqueue(sse("response.output_item.added", {
                        type: "response.output_item.added",
                        output_index: outputIndex,
                        item: {
                            type: "function_call", id: fcId,
                            call_id: tc.id, name: tc.function.name,
                            arguments: "", status: "in_progress",
                        },
                        sequence_number: nextSeq(),
                    }));

                    // function_call_arguments.delta (chunked ~100 chars)
                    const args = tc.function.arguments;
                    for (let j = 0; j < args.length; j += 100) {
                        controller.enqueue(sse("response.function_call_arguments.delta", {
                            type: "response.function_call_arguments.delta",
                            item_id: fcId,
                            output_index: outputIndex,
                            delta: args.slice(j, j + 100),
                            sequence_number: nextSeq(),
                        }));
                    }

                    // function_call_arguments.done
                    controller.enqueue(sse("response.function_call_arguments.done", {
                        type: "response.function_call_arguments.done",
                        item_id: fcId,
                        output_index: outputIndex,
                        arguments: args,
                        sequence_number: nextSeq(),
                    }));

                    // output_item.done
                    const completedFc: ResponseFunctionCallItem = {
                        type: "function_call",
                        id: fcId,
                        call_id: tc.id,
                        name: tc.function.name,
                        arguments: args,
                        status: "completed",
                    };
                    controller.enqueue(sse("response.output_item.done", {
                        type: "response.output_item.done",
                        output_index: outputIndex,
                        item: completedFc,
                        sequence_number: nextSeq(),
                    }));

                    completedOutput.push(completedFc);
                    outputIndex++;
                }
            }

            // response.completed
            controller.enqueue(sse("response.completed", {
                type: "response.completed",
                response: {
                    ...baseResponse,
                    status: "completed",
                    output: completedOutput,
                },
                sequence_number: nextSeq(),
            }));

            controller.close();
        },
    });
}
