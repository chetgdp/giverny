# Executor — Tool Catalog Analysis

`executor` by Rhys Sullivan. MIT licensed. Published as `executor` on npm. Beta v1.4.0.
Repo: github.com/RhysSullivan/executor. Marketing tagline: "Your missing execution layer."

Not a harness. **A tool platform that sits between any agent and any API.** Ingests OpenAPI / GraphQL / MCP / Google Discovery and exposes the union as a single MCP endpoint shared across Cursor, Claude Code, OpenCode, etc.

The reason to read this code is **not** the catalog. The reason is the architectural inversion: instead of giving the LLM N MCP tools to pick from, executor gives it **one** tool — `execute(code: string)` — and runs the code in a sandbox where `tools.<source>.<op>(args)` resolves dynamically. The LLM writes TypeScript. The host runs it. Tool dispatch is a property access on a Proxy.

## Stack

| Layer | Tech |
|-------|------|
| Runtime | Bun 1.3.11 (cli also runs as compiled Bun binary) |
| Language | TypeScript strict, no `any` |
| Effect system | Effect.ts 3.21 (Layers, Schema, Context.Tag, fibers) |
| CLI framework | `@effect/cli` |
| HTTP | `@effect/platform` HttpApi (no Hono) |
| MCP SDK | `@modelcontextprotocol/sdk` |
| Sandbox A | quickjs-emscripten (WASM, sync, default) |
| Sandbox B | Deno subprocess + JSON-line IPC (experimental) |
| Storage | `@effect/sql-sqlite-bun` (file) or `@effect/sql-pg` (postgres) |
| Schema | Effect Schema → JSON Schema → TypeScript preview |
| Web UI | React 19 + TanStack Router + Vite + Tailwind 4 |
| Lint | oxlint (not ESLint) |
| Test | vitest + `@effect/vitest` (CLAUDE.md mandates this — never `bun test`) |
| Build | Turbo workspaces, Bun catalog for dep versions |
| Codebase | ~28K LOC TypeScript across 197 files in `packages/`, plus apps |

Three notable absences for this stack: no Hono, no Drizzle ORM (despite catalog entry), no Vercel AI SDK. Effect.ts is load-bearing — it isn't a flavor.

## Workspace Layout

```
apps/
├── cli              # entrypoint, daemonization, compiled binary, embedded WASM
├── local            # HTTP API + MCP-over-HTTP + React SPA, all in one process
├── cloud            # multi-tenant SaaS variant (stub-ish)
├── desktop          # Tauri wrapper (stub)
└── marketing        # executor.sh (Astro)

packages/
├── core/
│   ├── sdk          # Executor type, plugin contract, ToolRegistry, SecretStore, PolicyEngine
│   ├── api          # @effect/platform HttpApi schema; plugins compose endpoint groups in
│   ├── execution    # ExecutionEngine: bridges sdk Executor + kernel CodeExecutor
│   ├── config       # JSONC config loader
│   ├── storage-file # SQLite KV via @effect/sql-sqlite-bun
│   └── storage-postgres # postgres equivalent + AES-256-GCM secret crypto
│
├── kernel/
│   ├── core                      # CodeExecutor + SandboxToolInvoker types only (~70 LOC)
│   ├── ir                        # SerializedCatalog v4.1 (metadata, not runtime)
│   ├── runtime-quickjs           # WASM sandbox, ~430 LOC, the default
│   └── runtime-deno-subprocess   # Deno child process, ~350 LOC, experimental
│
├── hosts/
│   └── mcp          # createExecutorMcpServer — wraps ExecutionEngine as MCP server
│
├── plugins/
│   ├── openapi          # parse + extract + invoke + KV operation store + react editor
│   ├── graphql          # introspection-driven, exposes each query/mutation as a tool
│   ├── mcp              # bridges *upstream* MCP servers as a source kind
│   ├── google-discovery # Google's REST API descriptor format
│   ├── file-secrets     # JSONC file at ~/.local/share/executor/auth.json
│   ├── keychain         # macOS Keychain
│   └── onepassword      # 1Password CLI bridge
│
└── react            # shared UI atoms, components, source-editor plugin slots
```

The package boundaries are honest. `sdk` defines contracts. `execution` is the only place that wires the sandbox to the executor. `kernel/*` knows nothing about tools or HTTP — it knows about JS evaluation and a `SandboxToolInvoker` interface. `hosts/mcp` knows nothing about plugins. Plugins know nothing about the kernel. This is what an Effect-style codebase looks like when the layers stay clean.

## 1. The Architectural Inversion

This is the only section that matters. Skip it and the rest is just plumbing.

### The MCP host exposes two tools

`packages/hosts/mcp/src/server.ts:156-191`:

```ts
server.registerTool("execute", {
  description,                    // <-- dynamically generated, see below
  inputSchema: { code: z.string().trim().min(1) },
}, async ({ code }) => executeCode(code));

server.registerTool("resume", {
  description: "Resume a paused execution using the executionId returned by execute. ...",
  inputSchema: {
    executionId: z.string(),
    action: z.enum(["accept", "decline", "cancel"]),
    content: z.string().default("{}"),
  },
}, ...);
```

That's it. Two tools. No `github_create_issue`, no `slack_send_message`, no namespacing pollution. The catalog can grow to 10,000 endpoints across 200 sources and the LLM still sees two tools.

### The `execute` description IS the workflow

`packages/core/execution/src/description.ts:24-65` builds the description at server startup by listing the configured source namespaces and prepending a prompt:

```
Execute TypeScript in a sandboxed runtime with access to configured API tools.

## Workflow
1. const matches = await tools.search({ query: "<intent + key nouns>", limit: 12 });
2. const path = matches[0]?.path; if (!path) return "No matching tools found.";
3. const details = await tools.describe.tool({ path });
4. Use details.inputTypeScript / details.outputTypeScript ...
5. Use tools.executor.sources.list() ...
6. Call the tool: const result = await tools.<path>(input);

## Rules
- tools.search() returns ranked matches, best-first.
- The tools object is a lazy proxy — Object.keys(tools) won't work.
- Do not use fetch — all API calls go through tools.*
- ...

## Available namespaces
- github — GitHub REST API
- linear — Linear GraphQL
- ...
```

The MCP description field — the thing every MCP client surfaces verbatim to the LLM — is the entire user manual. This is the cleverest move in the project. The description is the only context the LLM gets about how to use `execute`. Putting the workflow there means the workflow auto-loads with the tool.

### Inside the sandbox, `tools` is a magic Proxy

`packages/kernel/runtime-quickjs/src/index.ts:126-141` builds the source that wraps user code. The interesting part:

```js
const __makeToolsProxy = (path = []) => new Proxy(() => undefined, {
  get(_target, prop) {
    if (prop === 'then' || typeof prop === 'symbol') return undefined;
    return __makeToolsProxy([...path, String(prop)]);
  },
  apply(_target, _thisArg, args) {
    const toolPath = path.join('.');
    if (!toolPath) throw new Error('Tool path missing in invocation');
    return Promise.resolve(__invokeTool(toolPath, args[0]))
      .then((raw) => raw === undefined ? undefined : JSON.parse(raw));
  },
});
const tools = __makeToolsProxy();
```

Property access extends a path array. Function call collapses the array into a dotted string and invokes the host bridge. `tools.github.issues.list({ owner, repo })` becomes one bridge call: `__invokeTool("github.issues.list", { owner, repo })`. Zero schema in the sandbox, zero pre-registration, fully lazy.

The `then` check is critical: without it, `await tools.github.issues.list(...)` would trigger a `.then` access on the proxy chain (because `await` does duck-typing) and route into the wrong path.

The bridge is a QuickJS native function (`createToolBridge`, lines 195-240): it spawns an Effect fiber, awaits `toolInvoker.invoke({ path, args })`, then resolves a QuickJS deferred promise with the JSON-stringified result. The drain loop (`drainAsync`, lines 287-302) interleaves QuickJS job execution with awaiting host promises until either the user code completes or the deadline expires.

### Why this is the right design

- **Token cost is constant in catalog size.** A 10K-tool catalog would blow context budgets if exposed individually. Two meta-tools cost the same regardless.
- **The model already knows how to write TypeScript.** It doesn't need to learn 200 bespoke schemas; it needs two: `tools.search` and `tools.describe.tool`.
- **Composition is free.** `await Promise.all([tools.github.issues.list(...), tools.linear.issues.list(...)])` is one round trip from the host's perspective. Multi-tool MCP can't do this.
- **The model can write loops.** Pagination, fan-out, retry-on-failure — all expressible inline.
- **Auth and secrets stay in the host.** The sandbox never sees a token; it calls a path and the OpenAPI plugin resolves headers from the SecretStore at invocation time.

This is the same insight Anthropic published in the [code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp) post — except executor shipped a runnable production implementation in <30K LOC, with multi-source ingestion, before that post was widely circulated. (Or concurrently with it. I don't have a publication date for executor, but the architecture predates the post existing as a recommendation.)

## 2. Source Plugin System

A source plugin implements `ExecutorPlugin<TKey, TExtension>` (`packages/core/sdk/src/plugin.ts:25-47`):

```ts
interface ExecutorPlugin<TKey extends string, TExtension extends object> {
  readonly key: TKey;
  readonly init: (ctx: PluginContext) => Effect.Effect<PluginHandle<TExtension>, Error>;
}

interface PluginContext {
  readonly scope: Scope;
  readonly tools: ToolRegistry;
  readonly sources: SourceRegistry;
  readonly secrets: SecretStore;
  readonly policies: PolicyEngine;
}
```

`createExecutor` (`packages/core/sdk/src/executor.ts:132-228`) iterates plugins, calls `init`, collects each plugin's `extension` object, and `Object.assign`s them onto the executor. The TypeScript wizardry in `PluginExtensions<TPlugins>` makes `executor.openapi.addSpec(...)` typecheck without manual declaration merging.

This is Effect-style dependency injection with type-level extension. No DI container — Layers + Context.Tag give you the same thing with strict types.

### OpenAPI plugin (the canonical source)

`packages/plugins/openapi/src/sdk/plugin.ts` + 18 sibling files. Pipeline:

1. **`parse`** — fetch URL or accept text, JSON or YAML, normalize to OpenAPI 3.x.
2. **`extract`** — walk operations, normalize `#/components/schemas/X` refs to standard `#/$defs/X` (so JSON-schema tooling can resolve them without an OpenAPI-specific resolver).
3. **`compileToolDefinitions`** (`definitions.ts:225-255`) — derive a dotted tool path per operation. Strategy: split `operationId` on camelCase → `group.leaf` (e.g. `zones.listZones`); fallback to `method` + path segments (e.g. `getUser`); collision-resolve by appending version, then method, then a hash. The whole point is to produce paths that read naturally from the LLM's POV.
4. **Store bindings** — `OperationBinding` (path template + method + parameter map) and `InvocationConfig` (headers, baseUrl) go into a KV-backed `OpenApiOperationStore`. The full spec text is also stored on the source record.
5. **Register tools** — call `ctx.tools.register([...registrations])` to make them discoverable.
6. **Invoke** (`invoke.ts`) — at call time, look up the binding, resolve path/query/header parameters from `args`, resolve secret refs in headers via `SecretStore.resolve(secretId)`, fire the HTTP request, return the result.

The header system is the auth model. There's no OAuth2 flow inside the OpenAPI plugin. Auth is "you provide headers, those headers may reference secrets, secrets are resolved per-invocation." Crude but defensible — OAuth complexity gets pushed into the MCP plugin where it actually belongs (because MCP has standardized OAuth flows).

### GraphQL plugin

Different model. `packages/plugins/graphql/src/sdk/plugin.ts:95-170`: introspect schema, walk root query/mutation fields, generate **one tool per field**. Each tool's "implementation" is a templated GraphQL query string with variables. Selection sets are recursively materialized to depth 2 to avoid infinite cycles in self-referential types.

Same shape — `tools.linear.viewer({})` becomes a POST to the GraphQL endpoint with the canned query. The interesting part is that GraphQL's introspected types map cleanly to the JSON-Schema → TypeScript pipeline executor uses everywhere else, so the LLM sees the same tool shape regardless of upstream protocol.

### MCP plugin (executor consuming MCP)

`packages/plugins/mcp/src/sdk/plugin.ts`. Two transports: `stdio` (spawn child process, JSON-RPC over stdin/stdout) and `remote` (streamable-http or sse). Connection lifecycle uses Effect's `ScopedCache` with a 5-minute TTL — connections open lazily on first tool invocation, close automatically when idle. OAuth is supported with stored access/refresh tokens.

This is the Borg move: executor consumes other MCP servers and re-exports their tools through its own typed interface. An LLM connected to executor never sees the upstream MCP servers as separate things — they're just more namespaces in the catalog.

### Google Discovery, secrets backends

Google Discovery: parses Google's REST descriptor format, similar pipeline to OpenAPI. Namespace derived from service+version (`calendar_v3`).

Secrets: not source plugins. They implement a separate `SecretProvider` interface (`packages/core/sdk/src/secrets.ts:10-23`). `file-secrets`, `keychain`, and `onepassword` each provide `get/set/delete/list`. The `SecretStore` delegates resolution to providers in registration order, or pinned by `provider` field on a `SecretRef`.

## 3. Tool Discovery

Lexical, not vector embeddings. `packages/core/execution/src/tool-invoker.ts:63-235`:

- Tokenizer normalizes camelCase, lowercases, splits on `[_./:-]` and `[^a-z0-9]`.
- Per-field weights: `path: 12`, `name: 10`, `sourceId: 8`, `description: 5`.
- Per-field scoring against tokenized query: exact phrase ×14, prefix ×9, substring phrase ×6, token-perfect ×4, prefix overlap ×2, contains ×1.
- Coverage filter: ≥60% of query tokens must match a field (100% for ≤2-token queries) unless an exact phrase matched.
- Bonus for first-token match in path/name.
- Returns top-N (default 12) ranked by score.

The decision not to use embeddings is the right one for a tool catalog: tool names are short, structured, and come from API specs that already use semantically meaningful identifiers. Embeddings would burn an indexing pipeline and a vector store to get marginal recall on data that's already self-describing. The tradeoff: an LLM searching for "send a message" won't find `chat.postMessage` unless its query includes "post" or "chat" — but the LLM is also fine retrying with a better query, and `tools.search()` is cheap.

`tools.describe.tool({ path })` returns a `ToolSchema` with `inputTypeScript` / `outputTypeScript` / `typeScriptDefinitions`. These are generated at registration time by `buildToolTypeScriptPreview` (`packages/core/sdk/src/schema-types.ts`), which walks the JSON Schema and renders compact, depth-bounded TypeScript. JSON-Schema `$ref`s become named definitions hoisted into a shared map. The output reads like a `.d.ts` snippet — the LLM understands TS shapes natively and doesn't need to learn JSON Schema syntax.

There's no `.d.ts` build step shipped to the sandbox. Types live as strings in the registry, retrieved on demand. The Proxy is fully untyped at runtime — typing happens *for the LLM's reading*, not for the runtime.

## 4. Kernel Runtimes

Two implementations of `CodeExecutor` (defined in `packages/kernel/core/src/types.ts`):

```ts
interface CodeExecutor {
  execute(code: string, invoker: SandboxToolInvoker): Effect.Effect<ExecuteResult, ...>;
}

interface SandboxToolInvoker {
  invoke(call: { path: string; args: unknown }): Effect.Effect<unknown, ...>;
}
```

That's the entire surface area between the kernel and the rest of the system. The kernel doesn't know what a "tool" is — only that it has paths and args.

### QuickJS (default)

`runtime-quickjs/src/index.ts`. Synchronous WASM, single-threaded, embedded in the compiled Bun binary at `apps/cli/src/main.ts:1-19`. Memory limit and stack size configurable. Timeout via `runtime.setInterruptHandler(shouldInterruptAfterDeadline(deadline))` plus a parallel JS-side deadline check inside the job drain loop.

The user's code is wrapped in:
- `"use strict";`
- Local references to two host functions, then `delete globalThis.__executor_invokeTool` so the user code can't access them directly
- Lazy `console` shim that pipes to a host log array
- A `fetch` stub that throws — *all I/O must go through tools.\**
- The Proxy chain for `tools`
- An IIFE `(async () => { <user code> })()`

There's a subtlety: the user code can be either a complete program (`return await tools.foo(...)`) or an arrow function (`async () => tools.foo(...)`). `buildExecutionSource` detects the latter and wraps it. This is for editor/copy-paste ergonomics — both shapes work.

The drain loop is what makes this run async tools synchronously from QuickJS's perspective: QuickJS jobs execute, they hit `__invokeTool`, that returns a deferred promise to JS, the JS code awaits, the host fiber resolves the deferred with a string handle, JS resumes. `pendingDeferreds` tracks in-flight calls so the loop knows when to wait vs drain.

### Deno subprocess (experimental)

`runtime-deno-subprocess/src/index.ts`. Spawns `deno run` as a child process, JSON-line IPC over stdin/stdout. Worker script (`deno-subprocess-worker.mjs`) runs the user code with the same `tools` Proxy injected. Tool calls are messages to the host: `{ type: "tool_call", requestId, path, args }`; host responds `{ type: "tool_result", requestId, ok, value/error }`.

Why two? QuickJS is fast and embeddable but has an old JS spec, no networking, no `Promise.all`-like parallelism beyond what the drain loop allows, and adds 2-3MB to binary size as WASM. Deno subprocess is slower per call and has spawn overhead but is real V8 with current ES, Web APIs (minus what's locked down by `--allow-*` flags), and process-level isolation. The current production default is QuickJS; Deno is the future-proofing bet.

## 5. Execution Lifecycle (the Trace)

```
$ executor call 'return await tools.search({ query: "github issues" })'
        │
        ▼
apps/cli/src/main.ts:callCommand
  → readCode() → ensureServer(baseUrl) → makeApiClient(baseUrl)
  → client.executions.execute({ payload: { code } })
        │
        ▼  HTTP POST /v1/executions/execute
apps/local/src/server/main.ts → ExecutionEngineService
  → ExecutionEngine.executeWithPause(code)
        │
        ▼
packages/core/execution/src/engine.ts:executeWithPause
  → makeFullInvoker(executor) wraps base invoker w/ search/describe/sources.list
  → Promise.race(
      codeExecutor.execute(code, invoker),
      pausePromise
    )
        │
        ▼
packages/kernel/runtime-quickjs/src/index.ts:evaluateInQuickJs
  → newRuntime → setInterruptHandler(deadline)
  → newContext → install __executor_log + __executor_invokeTool bridges
  → context.evalCode(buildExecutionSource(code))   // Proxy + IIFE
  → drainAsync():
       repeat:
         drainJobs(context)            // sync JS work
         await pendingDeferreds        // host fiber work
       until done or deadline
  → readResultState → return ExecuteResult { result, error?, logs }
        │
        ▼  on each tool call inside the sandbox:
__executor_invokeTool(path, args)
  → context.newPromise() → push to pendingDeferreds
  → Effect.runPromise(invoker.invoke({ path, args }))
        │
        ▼
packages/core/execution/src/engine.ts:makeFullInvoker
  if path === "search" → searchTools(executor, args.query, limit)
  elif path === "describe.tool" → describeTool(executor, args.path)
  elif path === "executor.sources.list" → listExecutorSources(executor, args)
  else → makeExecutorToolInvoker → executor.tools.invoke(path, args, opts)
        │
        ▼
packages/core/sdk/src/executor.ts:invoke
  → policies.check({ scopeId, toolId })             // PolicyDeniedError if denied
  → tools.resolveAnnotations(toolId)                // dynamic per-plugin annotation
  → if requiresApproval: handler(FormElicitation)   // pauses execution
  → tools.invoke(toolId, args, opts)
        │
        ▼
plugin invoker (e.g. openapi/src/sdk/invoke.ts)
  → resolve path/query/headers from args
  → resolve secret refs in headers via SecretStore
  → fetch(url, opts)
  → return ToolInvocationResult { data, error, status }
        │
        ▼
back through Effect → JSON.stringify → newString handle → deferred.resolve(handle)
        │
        ▼
QuickJS resumes, user code continues, IIFE eventually resolves __executor_result
        │
        ▼
state extracted → ExecuteResult → formatExecuteResult → MCP ToolResult → CLI prints
```

Three things to note in this trace:

- **Approval gate sits in the SDK `tools.invoke`, not the plugin.** Plugins implement raw invocation; the executor wraps them with policy + annotation checks. This means a plugin can't accidentally bypass approval.
- **The pause point is the `requiresApproval` check.** When a tool needs approval, it raises an elicitation, which races against execution completion (see below).
- **The sandbox boundary is one bridge call per tool invocation.** No streaming, no chunking — args in, result out, JSON on both sides.

## 6. Pause / Resume

`packages/core/execution/src/engine.ts:executeWithPause` (lines 297-333):

```ts
let signalPause: ((paused: PausedExecution) => void) | null = null;
const pausePromise = new Promise<PausedExecution>((resolve) => {
  signalPause = resolve;
});

const elicitationHandler: ElicitationHandler = (ctx) =>
  Effect.async<ElicitationResponse>((resume) => {
    const id = `exec_${++nextId}`;
    const paused: PausedExecution = {
      id,
      elicitationContext: ctx,
      resolve: (response) => resume(Effect.succeed(response)),
      completion: undefined as unknown as Promise<ExecuteResult>,
    };
    pausedExecutions.set(id, paused);
    signalPause!(paused);
  });

const completionPromise = runEffect(codeExecutor.execute(code, invoker));

const result = await Promise.race([
  completionPromise.then((r) => ({ kind: "completed" as const, result: r })),
  pausePromise.then((p) => ({ kind: "paused" as const, execution: p })),
]);
```

The flow:

1. Execution starts. The user code calls `tools.github.issues.create(...)`.
2. The OpenAPI plugin (or any plugin) calls the elicitation handler when it needs approval/OAuth.
3. The handler is `Effect.async` — it captures the resumption function, stores a `PausedExecution` record, and signals the outer race.
4. The race resolves with `kind: "paused"`. The HTTP response returns `{ status: "waiting_for_interaction", executionId, interaction: { url | requestedSchema } }`.
5. The user (or the LLM) opens the OAuth URL or fills the form.
6. They call `executor resume --execution-id exec_1` (CLI) or the `resume` MCP tool, which calls `engine.resume(id, response)`.
7. `resume` looks up the paused record, calls `paused.resolve(response)` — this fires the captured `resume` callback inside the Effect fiber, which unblocks the elicitation handler with the response.
8. The fiber resumes, the plugin completes its tool call, the user code keeps executing, and `completion` (the promise that was racing) eventually resolves.

This is **continuation-passing via Effect fibers**, not serialized snapshots. State lives in process memory in a `Map<string, PausedExecution>`. If the daemon restarts, paused executions are lost. That's a deliberate trade — the alternative is durable execution (which would need a checkpointing kernel) and the team picked up-front simplicity.

The MCP host handles this two ways depending on client capability (`packages/hosts/mcp/src/server.ts:127-139`):

- **Client supports `elicitation.form` + `elicitation.url`** → use `engine.execute(code, { onElicitation })` and have the MCP SDK's `elicitInput` round-trip the user inline. The client stays inside one tool call.
- **Client doesn't support elicitation** → use `executeWithPause` and surface the executionId; the LLM has to call the `resume` tool explicitly.

`syncToolAvailability` (lines 195-205) hides the `resume` tool entirely if the client supports inline elicitation, so capable clients aren't tempted to use it. This is the most polite capability negotiation I've seen in any MCP server.

## 7. Storage

Two backends, one interface — a single namespaced KV table.

**File backend** (`packages/core/storage-file`): SQLite via `@effect/sql-sqlite-bun`. Single `kv` table with `(namespace, key, value)`. Namespaces are scoped per cwd: `{cwd}::tools`, `{cwd}::defs`, `{cwd}::secrets`, `{cwd}::policies`, `{cwd}::meta`, `{cwd}::plugins`. Migrations live in `migrations/0001_initial.ts`.

**Postgres backend** (`packages/core/storage-postgres`): same KV abstraction over JSONB columns, plus `crypto.ts` for AES-256-GCM secret encryption at rest and `user-store.ts` for multi-tenant scope isolation.

What's persisted:
- Tool registrations (JSON-Schema input/output, source ID, annotations)
- Source records (spec text, baseUrl, headers, namespace)
- Plugin-specific binding stores (OpenAPI operation bindings, MCP server configs, etc.)
- Secrets and secret refs
- Policies
- Shared schema definitions (`$defs`)

What's **not** persisted:
- Executions. `pausedExecutions` is an in-memory `Map`. No execution log, no audit trail. (The Web UI may show recent executions, but they're not durable.)
- Tool call history.

For a "shared catalog across agents" pitch, the lack of an execution audit log is a notable omission. It's the kind of thing that becomes mandatory the moment a team uses this in a regulated environment, and the architecture would need to grow a durable execution store to support it. The KV abstraction would absorb that change cleanly.

## 8. CLI and Daemon

`apps/cli/src/main.ts`. Effect CLI commands: `web`, `mcp`, `call`, `resume` (and the build scaffolding).

Daemon model is **implicit, not explicit**. There is no `executor up`/`down`/`status` despite the README mentioning them — the actual behavior is:

- `executor web` runs a foreground server (`apps/local`) on port 4788 with HTTP API + MCP-over-HTTP + static React UI.
- `executor mcp` runs an MCP-over-stdio server (no HTTP).
- `executor call '<code>'` checks if `http://localhost:4788/docs` is reachable (`isServerReachable`). If not, `startBackgroundServer` spawns `executor web --port 4788` with `detached: true, stdio: "ignore"` and `child.unref()`. Then it makes an HTTP call to the daemon.

So the first `call` silently spawns a daemon that lives until you kill it or reboot. There's no explicit lifecycle command. This is fine for local-first usage and would be wrong for anything else — production deployments would supervise `executor web` directly.

The CLI ships as a **compiled Bun binary** with the QuickJS WASM and the React web UI both embedded. `apps/cli/src/main.ts:1-19` checks for an `emscripten-module.wasm` next to `process.execPath` and pre-loads it via `setQuickJSModule(mod)` before any imports that would need it. The web UI is embedded via Bun's `with { type: "file" }` import. End result: one binary, no external assets.

## 9. Web UI

`apps/local`. React 19 + TanStack Router + TanStack Start + Tailwind 4. Admin/inspection focused: sources list, tool inventories, secrets management, policies, scopes. The actual server (`apps/local/src/server/main.ts`) layers in plugin-specific HTTP API groups via `@effect/platform`'s `HttpApi.add`, so each source plugin can ship its own React routes (`react/source-plugin.ts`) and its own REST endpoints (`api/group.ts`, `api/handlers.ts`).

This is the slot-based extension pattern — plugins compose into both the backend (Effect Layers) and the frontend (React route groups). It's the same pattern OpenCode uses for its plugin system, but executor's surface is much smaller.

I didn't see a code editor in the web UI for writing/running TypeScript interactively. The web UI is for managing the catalog; the runtime is for executing code from agents. Two distinct surfaces.

## 10. Comparison

The category isn't agent harnesses. It's **tool catalogs** + **MCP aggregators**. The closest comparables:

| Project | What it is | Tool count surface | Storage | Discovery | Sandbox |
|---------|------------|---------------------|---------|-----------|---------|
| **executor** | Tool catalog with TypeScript runtime | 2 meta-tools + N typed paths | SQLite/Postgres KV | Lexical search | QuickJS WASM (or Deno) |
| `mcp-aggregator` (smithery, etc.) | Multi-MCP proxy | All upstream tools, flattened | None or thin | None | None |
| `pipedream/connect` | SaaS tool catalog | One tool per action | Hosted | Hosted | Hosted V8 isolates |
| `langchain` Tools | In-process registry | One tool per Python function | None | Vector embeddings | None |
| Vercel AI SDK Tools | In-process registry | One tool per JS function | None | None | None |

And the harnesses I've previously analyzed, for context on tool surface area:

| Harness | Tools exposed to LLM | Catalog ingestion |
|---------|---------------------|---------------------|
| Claude Code | ~18 builtins | Via MCP |
| OpenCode | 20 builtins | Via MCP |
| pi-mono | 4 (read, write, edit, bash) | None |
| Garry | 16 builtins | None |
| Hermes | 45+ builtins | MCP + skills |
| **executor (consumed via MCP)** | **2** (`execute`, `resume`) | OpenAPI / GraphQL / MCP / Discovery |

The interesting comparison is **executor vs pi**. Both reduce the tool surface as much as possible. Pi reduces to four primitives by trusting the model's bash knowledge. Executor reduces to two meta-tools by trusting the model's TypeScript knowledge plus a typed path catalog. They reach the same insight from different ends:

- **Pi**: the model already knows Unix; build the smallest tool set that gives it Unix.
- **Executor**: the model already knows TypeScript; build the smallest tool set that gives it a typed runtime over your APIs.

Both refuse the maximalist "expose every endpoint as its own tool" approach. Both embed the workflow in the tool description. Pi's approach is smaller (no kernel, no plugins, no catalog). Executor's approach is more capable for cross-API orchestration (because you can `await Promise.all([...different sources...])` in one call).

## 11. What Executor Gets Right

**The 1-tool inversion.** Token cost is constant in catalog size. The LLM never sees an exploding list. This is the most important architectural decision in the project, and the one most other tool platforms haven't made yet.

**Workflow-as-description.** Putting the entire usage manual in the `execute` tool's description means there is exactly one prompt, and it auto-loads with the tool. No separate skills file, no prompt-engineering layer.

**Lazy Proxy + dotted-path bridge.** Zero schema in the sandbox, fully dynamic dispatch, no codegen, no `.d.ts` shipping. The sandbox doesn't even know which tools exist — it just hands paths to the host. The compactness of this is hard to overstate: ~15 lines of injected JS replace the entire tool-registration concept.

**Effect.ts layers as plugin DI.** Plugins type-extend the executor via `PluginExtensions<TPlugins>`, so `executor.openapi.addSpec(...)` typechecks without manual declaration merging. Coupled with `Layer` composition for dependencies, you get strict types and modular plugins for free.

**Capability-aware MCP host.** Hides `resume` from clients that support inline elicitation. This is the only MCP server I've read that does proper tool visibility based on client capability negotiation.

**Two runtimes with one interface.** `CodeExecutor` is 70 LOC of types. QuickJS is the default; Deno is a swap-in for when current ES + process isolation matter more than raw startup speed. The kernel boundary is correct.

**Lexical search over embeddings.** Tool names are short, structured, and self-describing. Embeddings would be a vector store and an indexing pipeline added for marginal recall improvement on data that doesn't need it. The team picked the simpler thing.

**No fetch in the sandbox.** Forces all I/O through `tools.*`, which means policies and secrets are enforced uniformly. The `fetch` stub that throws is a small thing but it's the right small thing.

## 12. What Executor Gets Wrong (or Hasn't Solved Yet)

**No execution durability.** `pausedExecutions: Map<string, PausedExecution>` is in-memory. Daemon restart drops everything. Fine for solo dev; fatal for shared/team usage. The KV layer would absorb a paused-execution table but the kernel would need to support snapshot-and-restore, which QuickJS doesn't natively.

**No execution audit log.** No record of what code ran, what tools were called, what auth scopes were touched. For an "execution layer" pitch this becomes a hard requirement the moment a security team gets involved. The architecture can grow this; the v1.4.0 beta hasn't.

**Daemon lifecycle is implicit.** README mentions `up/down/status`; the code has only the spawn-on-first-call path. It works, but for any non-trivial deployment you'd want explicit supervision. The marketing pitches this as a local tool, so it's not actively wrong — but it's a gap.

**The `tools.search` UX puts work on the LLM.** Each `execute` call has to search → describe → invoke. That's three round trips inside the sandbox before any real work happens, every single call. A caching layer (LLM remembers paths from prior calls in the same conversation) would help, but that's the client's problem, not executor's. A more ambitious move would be to ship the source-namespace inventory in the description (already done) plus a small "starter pack" of common paths so simple cases skip the search.

**No fan-out across sandboxes.** A single `execute` call runs in a single QuickJS context. If you want to run two unrelated bits of TypeScript in parallel, you make two MCP `execute` calls. The kernel could expose a multi-sandbox interface but doesn't.

**Tool count vs usability tradeoff is invisible.** When the catalog grows to 10K tools, `tools.search` quality matters more — but there's no analytics in the loop telling you which queries failed to find a tool. A future version probably needs telemetry for catalog-quality tuning.

**Effect.ts learning curve.** Effect is load-bearing throughout. Anyone trying to read this codebase without Effect background will struggle. The codebase is tiny (~28K LOC) but dense.

## 13. Where Executor Converges with Giverny's Thesis

Giverny's thesis (from MEMORY): *models know Unix, harnesses are overhead. Augmentation not automation.*

Executor agrees on the harness side: the LLM doesn't need 50 special-purpose tools. It needs a small surface that gets out of the way. Two meta-tools (`execute` + `resume`) is even smaller than giverny's exec tool — but the philosophical move is the same: trust the model to write code, give it a runtime.

Where executor diverges: it solves the *integration* problem rather than the *interface* problem. Giverny is about wrapping `claude -p` into a composable shell. Executor is about wrapping APIs into a typed catalog. They're orthogonal — you could plausibly use executor as a tool source from inside giverny (giverny → MCP client → executor MCP server → typed catalog → APIs) and the layering would be clean.

The deeper convergence: both projects pick **dynamic dispatch over static registration**. Giverny's exec tool runs whatever the LLM types into a shell. Executor's `execute` tool runs whatever the LLM types into a JS sandbox. Neither pre-registers operations. Both treat the LLM as a code-writing agent rather than a tool-picking agent. This is the same insight, applied to different surfaces.

If giverny ever wants a tool catalog (rather than only Claude Code's native tools), the executor architecture is the one to copy: lazy Proxy, lexical discovery, workflow-in-description, two meta-tools.

## 14. The One-Sentence Summary

Executor is the cleanest production implementation of "give the LLM a sandboxed TypeScript runtime instead of a list of tools," and the lazy Proxy + dotted-path bridge in `runtime-quickjs/index.ts:126-141` is worth reading by anyone building a tool platform.
