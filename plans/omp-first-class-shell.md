# Plan: First-class shell client for persistent OMP sessions

## Goal

Add the persistent process and attach protocol directly to OMP. Giverny becomes
its first shell-native client rather than wrapping `omp` as another one-shot
backend.

OMP remains authoritative for the agent loop, sessions, tools, approvals,
models, queues, subagents, background jobs, compaction, and retries. Giverny
owns shell aliases, terminal input, compact rendering, and client-side command
selection.

The required user flow is:

```text
shell invocation
    -> discover or start the OMP project agent
    -> attach over a local socket
    -> send prompt, steer, follow-up, abort, or state command
    -> render live OMP events
    -> detach without stopping OMP
```

## Evidence

Verified against installed OMP 17.2.15:

- `omp --mode rpc` is bidirectional NDJSON over stdin and stdout.
- Startup emits a versioned `ready` frame with protocol versions 1 and 2.
- Commands and responses correlate by `id`.
- Malformed JSON and unknown commands return recoverable error responses.
- RPC exposes prompts, steering, follow-ups, abort, sessions, model and thinking
  controls, queues, host tools, host URIs, extension UI, subagents, and state.
- Closing stdin disposes the session and exits. Current RPC cannot detach.

Relevant OMP implementation:

- `packages/coding-agent/src/modes/rpc/rpc-mode.ts`: one session, one stdin,
  one stdout, command dispatch, event forwarding, UI and host-tool bridges.
- `packages/coding-agent/src/modes/rpc/rpc-types.ts`: canonical commands,
  responses, events, extension UI, host-tool, and host-URI frames.
- `packages/coding-agent/src/modes/rpc/rpc-client.ts`: child-process client,
  request correlation, event listeners, and RPC v2 framing.
- `packages/coding-agent/src/modes/acp/acp-agent.ts`: existing multi-session
  lifecycle, prompt queue, cancellation, and permission-routing reference.
- `packages/coding-agent/src/session/session-manager.ts`: canonical project
  session directories, durable session identity, discovery, and flushing.
- `packages/ai/src/auth-broker/server.ts` and `remote-store.ts`: existing OMP
  patterns for long-lived service lifecycle, generation streams, reconnect,
  keepalive, and cleanup. This broker remains auth-only.

Relevant Giverny implementation:

- `run.ts` and `src/shell.ts`: each shell command starts, runs once, persists
  local state, and exits.
- `src/backend.ts` and `src/bridge-loop.ts`: lossy one-shot backend contract.
  Persistent OMP must bypass it.
- `src/tui.ts` and `src/shell-utils.ts`: current local approval classification.
  OMP must remain the approval authority.
- `src/state.ts`: Giverny session pointers and conversation storage. These must
  not become a second source of truth for OMP sessions.

## Decision

Add a dedicated project-agent service to `packages/coding-agent`. Do not extend
the auth broker and do not make ACP the ownership layer.

The service owns one live OMP `AgentSession` per canonical project and exposes a
local Unix-domain socket. The existing RPC protocol becomes transport-neutral:
stdio RPC and attached clients share the same command dispatcher and frame
schemas.

A Unix socket is the first transport. It is local, has filesystem ownership and
permissions, needs no port allocation, and matches the shell-client use case.
Windows transport is a named pipe behind the same transport interface.

## Non-goals

- Do not add an OMP backend to Giverny's `Backend` registry.
- Do not translate OMP into Giverny's reduced `BridgeEvent` union.
- Do not duplicate OMP tools, approvals, sessions, queues, or agent loop.
- Do not keep the OMP process alive merely by orphaning stdio.
- Do not put agent lifecycle into the existing auth broker.
- Do not require a TUI or terminal multiplexer.
- Do not add remote network attachment in the first change. Collab already owns
  remote encrypted session sharing.

## Upstream architecture

### 1. Extract the RPC session host

Refactor `runRpcMode()` into two layers:

1. A transport-neutral session host that accepts typed inbound frames and emits
   typed outbound frames.
2. The existing stdio adapter, preserving `omp --mode rpc` behavior exactly.

The host owns:

- command dispatch and request correlation;
- `AgentSession` event subscription;
- extension UI request tracking;
- host-tool and host-URI request tracking;
- protocol negotiation and chunk framing;
- shutdown and pending-request rejection.

The transport owns only framing, connection lifecycle, and backpressure.

Acceptance:

- Existing RPC clients observe no wire changes.
- Stdio EOF still disposes and exits in normal RPC mode.
- Dispatcher tests run without spawning a process.

### 2. Add project identity and service discovery

Derive a project key from the canonical real path using the same cwd semantics
as `SessionManager`. Symlink aliases must resolve to one service.

Store service metadata in the OMP runtime/state directory, not the project:

```text
<runtime>/project-agents/<project-key>/
    agent.sock
    agent.lock
    agent.json
```

`agent.json` contains protocol version, PID, canonical cwd, socket path, start
time, and current session ID/path. It contains no credentials.

Startup rules:

- Take an exclusive lock before creating the socket.
- Probe existing metadata and socket before launching another service.
- Remove stale socket and metadata only after proving the owner is gone.
- Create the directory and socket with user-only permissions.
- Never trust a client-supplied cwd without canonicalizing it server-side.

Acceptance:

- Concurrent launch requests produce one service.
- Symlinked paths attach to the same service.
- Stale PID/socket recovery cannot kill an unrelated process.
- Other users cannot connect to the socket.

### 3. Add attach protocol and client lifecycle

Reuse RPC commands and events. Add connection-level frames only where RPC lacks
attach semantics:

```ts
interface AttachRequest {
    type: "attach";
    id: string;
    protocolVersion: 2;
    projectKey: string;
    clientId?: string;
    lastEventSeq?: number;
    interactive: boolean;
}

interface AttachedResponse {
    type: "attached";
    id: string;
    clientId: string;
    projectKey: string;
    sessionId: string;
    sessionFile: string | null;
    currentEventSeq: number;
    replayFromSeq: number | null;
}
```

Each outbound session event gains an envelope at this transport boundary:

```ts
interface AttachedEvent {
    type: "session_event";
    seq: number;
    event: AgentSessionEvent;
}
```

RPC payloads inside the envelope remain unchanged. Command responses retain
their normal request IDs.

Connection behavior:

- Disconnecting a client detaches it. It does not abort or dispose the session.
- Multiple clients may observe events.
- Commands that are safe concurrently remain correlated by request ID.
- Normal prompts follow OMP's existing queue rules.
- Steering, follow-up, abort, and state commands remain available during a turn.
- A client can request an explicit service shutdown; socket closure alone is not
  shutdown.

Acceptance:

- Killing one client leaves the session running.
- A second client attaches and receives current state.
- Concurrent commands return to the correct clients regardless of completion
  order.
- Slow clients cannot block the agent or other clients.

### 4. Add bounded replay and resynchronization

Maintain a bounded in-memory ring of sequenced outbound session events. The ring
is for reconnect continuity, not durable session storage.

On attach:

- If `lastEventSeq` is available, replay subsequent events in order.
- If the cursor predates the ring, return an explicit replay gap.
- On a gap, the client requests `get_state` and paged messages, then resumes from
  the current sequence.
- Durable history remains in `SessionManager`; do not duplicate full transcripts
  in the broker.

Define limits by bytes and event count. Disconnect a client whose outbound queue
exceeds its limit, with an explicit backpressure error.

Acceptance:

- Reconnect produces no duplicates or omissions within the retained window.
- Gap recovery yields the same message/state view as a continuously attached
  client.
- Oversized or stalled clients have bounded memory impact.
- RPC v2 chunk validation remains active for large logical frames.

### 5. Route interactive UI and approvals

OMP remains the sole approval-policy engine. Clients only present and answer
OMP-generated UI requests.

Use an interactive-client lease:

- At most one attached client owns interactive requests.
- An interactive attach may acquire the vacant lease.
- The owner can release it explicitly.
- A disconnected owner loses the lease after a short grace period so it can
  reconnect without dropping a pending prompt.
- Other clients receive request status but cannot race answers.
- If no interactive client is available, follow the request's timeout/default
  behavior or fail closed. Never auto-approve because no terminal is attached.

Keep notification-only UI frames broadcastable. Route select, confirm, input,
editor, and approval responses only through the lease owner.

Acceptance:

- Exactly one response settles each UI request.
- Owner disconnect/reconnect does not double-submit.
- No-client approval fails closed.
- Read-only observers cannot answer approvals.

### 6. Define idle and shutdown policy

A detached session may continue while it is streaming, has queued prompts,
running tools, subagents, background jobs, pending UI, retries, or compaction.

Start the idle timer only when all are false and no clients are attached. Make
the timeout configurable. On expiry:

1. Stop accepting commands.
2. Flush the session.
3. Dispose the `AgentSession` and owned managers.
4. Close clients and socket.
5. Remove metadata and lock.

Handle SIGINT, SIGTERM, fatal errors, and normal process exit through the same
idempotent shutdown path. Preserve OMP's session-exit diagnostics.

Acceptance:

- Detaching during active work does not stop it.
- An idle service exits and leaves no live socket.
- Shutdown flushes resumable session state.
- Restart attaches to the durable session without presenting an interrupted turn
  as live.

### 7. Add OMP CLI entry points

Add commands with names selected by OMP maintainers, covering these operations:

```text
omp agent serve [--cwd PATH] [--idle-timeout DURATION]
omp agent start [--cwd PATH]
omp agent status [--cwd PATH]
omp agent stop [--cwd PATH]
omp agent attach [--cwd PATH]
```

`start` discovers or starts the service and returns machine-readable metadata.
`attach` is a reference terminal client and protocol exerciser, not the final
Giverny UI. Support JSON output for Giverny discovery without parsing prose.

Do not overload `omp --mode rpc`: stdio RPC remains useful for embedded
processes and must keep its EOF semantics.

Acceptance:

- The CLI can start, discover, inspect, attach, detach, and stop a service.
- Commands work from nested and symlinked project paths.
- Machine-readable output has a versioned schema.

## Giverny client after the OMP change

Giverny should use the upstream discovery and attach protocol directly. It
should not instantiate `Bridge` for OMP.

Command mapping:

| Shell action | OMP command |
|---|---|
| normal prompt | `prompt` |
| steer active turn | `steer` |
| queue next instruction | `follow_up` |
| replace current work | `abort_and_prompt` |
| stop current work | `abort` |
| status | `get_state` |
| new conversation | `new_session` |
| choose session | list sessions, then `switch_session` |
| model | `set_model` |
| effort | `set_thinking_level` |
| compact | `compact` |
| detach | close client connection |
| stop agent | explicit service shutdown |

Giverny retains:

- shell alias installation and prefix UX;
- terminal input and compact event rendering;
- clean stdout when piped and decoration on stderr;
- client help and output preferences.

Giverny bypasses or removes for OMP mode:

- `Backend`, `Bridge`, and `BridgeEvent` normalization;
- local tool execution and tool metadata;
- local permission classification and `pause`/`resume` signals;
- `.giverny` conversation history and backend session heuristics;
- duplicated model, thinking, queue, and session state.

The Giverny renderer consumes native OMP `AgentSessionEvent` frames. Extension UI
requests are rendered in the terminal and answered with
`extension_ui_response`. Giverny never decides whether a tool needed approval.

## Session listing prerequisite

Current RPC can switch by session path but the observed command schema does not
provide complete project session listing. Add a paged project-session listing
command to the shared host before implementing Giverny `/attach` or `/resume`.
Return stable identifiers, path, name, timestamp, active state, model, and cwd.
Do not make clients scan OMP's storage layout.

## Verification matrix

### Protocol

- Existing stdio RPC ready, negotiation, commands, events, errors, and EOF.
- Socket attach negotiation and incompatible-version rejection.
- Request correlation under out-of-order completion.
- Malformed, unknown, oversized, truncated, and interleaved frames.
- RPC v2 chunk reassembly and limits.

### Lifecycle

- First start, concurrent start, attach, detach, reattach, explicit stop.
- Client crash, service crash, stale metadata, stale socket, PID reuse.
- SIGINT/SIGTERM and fatal-error cleanup.
- Idle shutdown with every activity guard.
- Session flush and restart recovery.

### Multi-client

- Two observers receive ordered events.
- Prompt and steering commands from separate authorized clients.
- Slow-client isolation and bounded queues.
- Event replay, cursor edge, replay gap, and state/message resync.

### UI and safety

- Interactive lease acquisition, release, reconnect grace, and transfer.
- Approval answer, cancel, timeout, and no-client fail-closed behavior.
- Read-only observers cannot mutate or answer UI.
- Socket ownership and permissions.

### Project and sessions

- Canonical cwd, nested cwd, symlink alias, home, and temp projects.
- Create, list, switch, rename, resume, and new session.
- Background tools, retries, compaction, subagents, and queued prompts survive
  client detachment.

### Giverny end-to-end

- A prompt starts the service and streams output.
- A second invocation steers an active turn.
- Follow-up queues and runs after the current turn.
- Abort returns control without killing the service.
- Detach, later reattach, replay missed output, and continue the session.
- Approval appears in one terminal and its response reaches OMP.
- Piped output remains clean.

## Delivery sequence

Keep upstream commits small:

1. Extract transport-neutral RPC dispatcher with no behavior change.
2. Add project identity, runtime metadata, and exclusive ownership.
3. Add socket service and attach handshake.
4. Add multi-client event sequencing, replay, and backpressure.
5. Add interactive-client lease and UI routing.
6. Add idle shutdown and recovery.
7. Add service CLI and paged session listing.
8. Add Giverny client transport and native event renderer.
9. Add shell steering, follow-up, abort, attach, detach, and status commands.
10. Remove OMP-mode dependence on Giverny's backend, permission, and session
    layers.

Each upstream commit must include focused tests for its observable contract.
After the socket service is usable, verify it with the reference OMP attach
client before changing Giverny.

## Open design questions for the OMP PR

These require maintainer decisions before implementation:

1. CLI namespace and public name for the project-agent service.
2. Default idle timeout and whether users can request indefinite lifetime.
3. Whether one service owns exactly one active session or a project session map.
   Start with one active session unless existing ACP lifecycle code makes the
   map materially simpler.
4. Whether mutating commands require the interactive lease or a separate writer
   capability. Recommended: separate observer, writer, and interactive-UI roles.
5. Runtime directory selection and Windows named-pipe naming.
6. Event ring byte/count defaults and reconnect grace duration.
7. Whether local clients need an additional random bearer token. Unix ownership
   and mode checks are sufficient for the first local-only version if peer
   credentials are verified where available.

## Completion criteria

The work is complete when a user can run a normal Giverny shell command, leave
OMP active after the client exits, steer or abort it from another invocation,
reattach without losing observable events, answer OMP approvals from one
terminal, and stop or idle-shutdown the agent with a resumable OMP session.
OMP remains the only owner of agent behavior and durable conversation state.
