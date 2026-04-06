// backend.ts
/*
* Backend interface — the contract any LLM backend must implement.
* Claude Code is the first backend. Adding another = one new file + one switch case.
*
* v2: Backend is a single-turn completion primitive. The agent loop
* lives in Bridge (bridge-loop.ts). Claude-specific options (effort,
* perms, tools filter) go in GenerateOptions.options, not the interface.
*/

// Types -------------------------------------------------------------------- /
export interface BackendInfo {
    name:           string;
    models:         ModelInfo[];
    efforts?:       string[];   // all effort levels the backend supports, ordered low→high
    capabilities: {
        agentLoop:  boolean;    // true = backend runs tool execution internally (claude -p)
        sessions:   boolean;    // true = backend can resume conversations
        streaming:  boolean;    // true = events stream during generation
    };
    meta?:          Record<string, any>;
}

export interface ModelInfo {
    id:             string;
    contextWindow:  number;
    description:    string;
    // effort levels the model supports (defaults to BackendInfo.efforts)
    efforts?:       string[];   
}

export interface GenerateOptions {
    prompt:         string;
    model?:         string;
    systemPrompt?:  string;
    sessionId?:     string;
    timeout?:       number;
    cwd?:           string;
    // Backend-specific options. Claude puts effort, perms, tools filter here.
    // Completions backend puts temperature, top_p, tool schemas here.
    options?:       Record<string, any>;
}

// Events: generic names, same shapes as the Claude originals
// the model can generate text or use a tool
export interface TextBlock {
    type:   "text";
    text:   string;
}

export interface ToolUseBlock {
    type:   "tool_use";
    id?:    string;
    name:   string;
    input:  Record<string, any>;
}

export type ContentBlock = TextBlock | ToolUseBlock;

// Types of Bridge events
// the model doing something?
export interface AssistantEvent {
    type:   "assistant";
    blocks: ContentBlock[];
}

// what is a result?
export interface ResultEvent {
    type:       "result";
    sessionId:  string | null;
    isError:    boolean;
    result:     string;
    numTurns:   number;
    durationMs: number | null;
    usage:      { input_tokens: number; output_tokens: number } | null;
    permissionDenials: PermissionDenial[];
}

// a process returned after executing a computation
export interface ToolResultEvent {
    type:       "tool_result";
    toolUseId:  string;
    content:    string;
    stdout:     string;
    stderr:     string;
    isError:    boolean;
}

// wild goose chase fake enum?
export type BridgeEvent = AssistantEvent | ResultEvent | ToolResultEvent;

export interface PermissionDenial {
    toolName:   string;
    toolInput:  Record<string, any>;
}

// Generate control: abort the backend process
export interface AbortControl {
    abort():    void;
}

// Extended control for backends that run subprocesses (agentLoop: true).
// Backends return this from generate(); Bridge detects it and exposes
// pause/resume through RunControl.
export interface ProcessControl extends AbortControl {
    pause():    void;
    resume():   void;
}

export function isProcessControl(control: AbortControl): control is ProcessControl {
    return 'pause' in control && 'resume' in control;
}

// Generate result: whether the generation completed successfully
export interface GenerateResult {
    ok:         boolean;
    error?:     string;
    sessionId?: string; // captured from init event, available even on abort
}

// Collected result from a full invocation (Bridge layer)
export interface BridgeResult {
    text:           string;
    toolUseBlocks:  ToolUseBlock[];
    sessionId:      string | null;
    durationMs:     number | null;
    numTurns:       number;
    usage:          { input_tokens: number; output_tokens: number } | null;
    isError:        boolean;
    errorText:      string | null;
}

// Run control: consumer-facing control (Bridge layer)
export interface RunControl {
    abort():        void;
    // Only meaningful when backend has agentLoop capability.
    // When giverny owns the loop, the loop itself handles the pause
    // (it just waits before executing the tool — no signal needed).
    pause?():       void;
    resume?():      void;
}

// Backend interface -------------------------------------------------------- /

export interface Backend {
    info:           BackendInfo;
    generate(
        opts: GenerateOptions,
        onEvent: (event: BridgeEvent, control: AbortControl) => void,
    ): Promise<GenerateResult>;
    checkStatus?(): Promise<Record<string, string>>;
}

// Backend registry --------------------------------------------------------- /
export function getBackend(
    name: string, 
    opts?: { protocol?: string }
): Backend {
    switch (name) {
        case "claude-code": {
            const { claudeCodeBackend } = require("./bridge");
            return claudeCodeBackend;
        }
        case "responses": {
            const { responsesBackend } = require("./responses");
            return responsesBackend;
        }
        case "completions":
        case "actual.inc": {
            if (opts?.protocol === "responses") {
                const { responsesBackend } = require("./responses");
                return responsesBackend;
            }
            const { completionsBackend } = require("./completions");
            return completionsBackend;
        }
        default:
            throw new Error(`Unknown backend: ${name}. Available: claude-code, completions, actual.inc, responses`);
    }
}
