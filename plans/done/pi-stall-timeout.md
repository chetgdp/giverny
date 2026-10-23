# Plan: replace the agent wall timeout with stall detection

## Diagnosis (verified)

Giverny currently applies `timeout` as one absolute timer around the complete
Claude or Pi subprocess invocation. The timer starts after spawn, never resets,
and kills the process even if it is still emitting model, tool, retry, or
compaction events.

The 120-second value predates the Pi backend:

- `c50bddc` introduced a 300-second Claude invocation timer.
- `5c10ea6` separately introduced a 120-second non-agent tool timeout for
  commands waiting on stdin or running forever.
- `b00b32b` changed the whole Claude invocation from 300 to 120 seconds and
  exposed `/timeout`; the commit does not give an active-loop rationale.
- `b77ee75`, `e1d209e`, `d53aee0`, and `423c95e` fixed concrete stderr
  backpressure, reader cancellation, inherited pipe descriptor, and process
  exit hangs.
- `3edc46d` copied those Claude lifecycle invariants and the shared 120-second
  default into Pi as a backstop.

The committed hanging fixtures reproduce transport or process stalls. Pi's
only pre-completion stall fixture emits an assistant event and then sleeps with
no `agent_end`; no fixture runs useful work beyond the timeout. A controlled
fake-Pi experiment emitted valid `message_update` events every 100ms and was
still killed when total runtime crossed its configured timeout.

Active Pi 0.84.1 emits every `AgentSessionEvent` in JSON mode. Useful progress
includes `message_update`, `message_end`, `tool_execution_start`,
`tool_execution_update`, `tool_execution_end`, turn events, retry events, and
compaction events. Pi also emits `agent_settled` only after retries, compaction,
and queued continuations. Giverny currently ignores these events and treats
`agent_end` with `willRetry:false` as final.

Event silence is not proof of a dead process. A provider can compute before its
first token, and a tool can run without output. This plan implements the
observable contract Giverny can enforce: valid protocol activity keeps the run
alive; configurable protocol inactivity is treated as a stall. Users can turn
the watchdog off for legitimate silent workloads.

## Behavioral contract

1. `/timeout N` means maximum protocol inactivity, in seconds. It is not a
   maximum turn duration.
2. A run can exceed `N` indefinitely while valid NDJSON events continue.
3. The inactivity clock starts at process spawn and advances only while the
   backend is expected to make progress.
4. Every complete, valid backend JSON event counts as activity, including
   recognized events that are not rendered. Raw stderr, malformed JSON, and
   arbitrary stdout noise do not count.
5. `/timeout 0` disables the inactivity watchdog. Values from 1 through 9 stay
   invalid; enabled values must be at least 10 seconds.
6. A shell permission prompt suspends the watchdog. Resume gives the process a
   fresh inactivity interval; time spent waiting for the user never kills the
   backend.
7. A declared retry delay extends the deadline through that delay plus one full
   inactivity interval.
8. Pi completes on `agent_settled`, not `agent_end`. `agent_end` remains useful
   retry metadata but is not a terminal signal.
9. Claude completes on its existing `result` event.
10. Once logically settled, stop the watchdog before the bounded exit grace and
    reader cancellation. Output from an orphan child cannot revive a settled
    run.
11. A stall error names the backend, inactivity duration, and last valid event
    or phase. It does not report a generic total-duration timeout.

A process that emits an endless but semantically useless event loop is live
under this contract. Semantic loop detection is a separate policy and must not
be smuggled into the stall watchdog.

## Implementation

### 1. Make timeout semantics explicit in shared interfaces and configuration

Update `src/backend.ts`, `src/bridge-loop.ts`, `src/config.ts`, and `src/shell.ts`:

- rename internal millisecond fields from `timeout` to `inactivityTimeoutMs`
  across `GenerateOptions`, bridge run options, and every caller
- rename `DEFAULT_TIMEOUT` to `DEFAULT_INACTIVITY_TIMEOUT_MS`
- replace the Claude-specific `CLAUDE_TIMEOUT` environment override with
  `GIVERNY_INACTIVITY_TIMEOUT`; no compatibility alias
- keep persisted `ShellConfig.timeout` and `/timeout` as the user-facing seconds
  setting, but change their documentation from wall time to inactivity
- pass an explicit configured zero through the stack instead of converting it
  to `undefined`; zero must disable the watchdog rather than fall back to 120
- fix `src/help.ts`, which currently advertises a stale 300000ms value

Before renaming exported fields, use LSP references and migrate every caller in
one cutover. Do not leave deprecated names or dual semantics.

### 2. Add one process inactivity watchdog

Create `src/process-watchdog.ts` for the Pi and Claude subprocess backends. Its
small API should be:

```ts
interface ProcessWatchdog {
    activity(label: string): void;
    defer(delayMs: number, label: string): void;
    suspend(): void;
    resume(): void;
    stop(): void;
}
```

Required behavior:

- zero disables scheduling but keeps methods safe and idempotent
- use one pending timer and a `lastActivityAt`/deadline calculation; do not
  clear and allocate a new timer for every streamed token
- when the timer wakes, compare current time with the current deadline and
  reschedule only for the remaining duration
- `activity` records the last event label and moves the inactivity deadline
- `defer` sets a deadline floor of `now + delayMs + inactivityTimeoutMs`
- `suspend` clears the pending timer; `resume` starts a fresh interval
- `stop` is idempotent and prevents a late callback from killing a settled run
- the stall callback owns backend-specific kill and reader cancellation, with
  every cleanup operation isolated in `try/catch` as it is today

Do not count spinner frames or elapsed UI time as activity.

### 3. Parse Pi protocol activity once and settle correctly

Update `src/pi.ts`:

- parse each complete NDJSON line once in `generate`
- pass the parsed object to the Pi event mapper instead of parsing the same line
  again inside `handleLine`
- mark watchdog activity for every valid JSON object with a string `type`, even
  when the event has no generic `BridgeEvent` representation
- label tool activity with the tool name when available
- on `auto_retry_start`, call `defer(event.delayMs, "auto_retry")`
- continue ignoring malformed lines for rendering and for liveness
- change parser settlement from `agent_end && !willRetry` to `agent_settled`
- retain `agent_end` handling only for retry/error state needed by result
  synthesis; it must not break the read loop
- stop the watchdog before the existing post-settlement exit grace
- preserve stderr background draining, no-trailing-newline handling, exit-code
  reporting, reader cancellation while locks are held, and orphan-FD cleanup
- change the error to identify inactivity and the last protocol event

Wrap `ProcessControl.pause` and `resume` so they suspend/resume the watchdog as
well as send `SIGSTOP`/`SIGCONT`. `abort` stops the watchdog before killing.

Target the verified Pi 0.84.1 `agent_settled` contract. Do not retain an
`agent_end` fallback that can truncate compaction or queued continuations.

### 4. Give the Claude process backend the same timeout meaning

Update `src/bridge.ts` so the shared `/timeout` setting cannot mean wall time for
Claude and inactivity for Pi:

- parse each complete Claude NDJSON object once
- mark activity for valid JSON events, including system/session events that do
  not become generic bridge events
- keep `result` as Claude's terminal signal
- use the shared watchdog for stall cleanup
- suspend/resume it around shell permission pauses through `ProcessControl`
- preserve all four documented process-lifecycle invariants

Do not change `src/tools.ts`'s separate per-command timeout or the Responses and
Completions transport read timeouts. They protect different execution layers.

### 5. Update the shell command and diagnostics

Update `src/commands.ts` and shell-facing output:

- `/timeout` with no argument prints `inactivity timeout: 120s` or `off`
- `/timeout 0` persists the disabled value
- `/timeout 1` through `/timeout 9`, negative values, and non-numbers fail
- `/timeout N` for `N >= 10` keeps the existing global/local persistence rules
- backend stall errors include the last valid event label, for example:
  `pi stalled after 120s of inactivity after tool_execution_start:bash`

Do not add telemetry or persist raw prompts/tool arguments in diagnostics.

### 6. Tests

Update `tests/pi.test.ts`, `tests/pi-hanging.test.ts`,
`tests/hanging.test.ts`, and configuration/command tests that cover `/timeout`.
Add only observable behavior cases:

- Pi emits valid `message_update` events more frequently than the inactivity
  interval for a total duration greater than that interval, then
  `agent_settled`: succeeds
- Pi emits tool start/update/end activity across a total duration greater than
  the interval: succeeds
- Pi becomes silent before settlement: fails after one inactivity interval and
  reports the last valid event
- malformed stdout noise does not reset the watchdog
- `auto_retry_start.delayMs` longer than the configured interval does not cause
  a premature stall, but silence after the deferred deadline does
- permission pause held longer than the interval, followed by resume and
  settlement: succeeds
- `/timeout 0` permits a silent fake process to survive beyond the former
  interval until the test explicitly completes it
- `agent_end {willRetry:false}` followed by compaction/continued assistant
  events does not settle; the final `agent_settled` result wins
- `agent_end {willRetry:true}` remains nonterminal
- post-`agent_settled` lingering and orphan-child fixtures still return promptly
  and release the subprocess event loop
- Claude's slow valid NDJSON stream can exceed the configured interval in total
  while a silent Claude fixture still stalls

Use short intervals with generous outer test deadlines. Assert ordering and
outcomes, not exact millisecond equality.

### 7. Documentation and smoke verification

Update `CLAUDE.md` process lifecycle notes:

- distinguish inactivity watchdog, logical settlement, exit grace, and forced
  cleanup
- document Pi `agent_settled` and why `agent_end` is not final
- retain the stderr/reader/orphan-FD invariants
- document `GIVERNY_INACTIVITY_TIMEOUT` and `/timeout 0`

Verification sequence:

1. Run the focused Pi parser and hanging suites.
2. Run the focused Claude hanging suite.
3. Run config/command tests for `/timeout`.
4. Run the existing unit suite once.
5. Smoke Giverny against a controlled fake Pi that streams longer than its
   inactivity interval and verify it completes.
6. Smoke a silent fake Pi and verify the diagnostic names the last event.
7. Run one real `pi --mode json` Giverny turn when credentials are available and
   observe `agent_settled` before Giverny returns.

## Acceptance criteria

- Useful protocol activity can continue beyond 120 seconds without termination.
- Total wall time is no longer a kill condition for Pi or Claude.
- A process with no valid protocol activity is still bounded when the watchdog
  is enabled.
- User permission wait time is excluded.
- Pi does not return before retry, compaction, or queued continuation work is
  settled.
- Existing post-completion orphan-pipe protections remain effective.
- The timeout can be disabled explicitly.
- Help, config, environment names, error text, tests, and lifecycle docs all
  describe the same inactivity semantics.

## Out of scope

- detecting repetitive but active tool/model loops
- changing Pi's provider HTTP idle timeout, retry policy, or optional Bash
  timeout
- changing the non-agent `executeTool` 120-second command timeout
- adding a Pi extension heartbeat or OS CPU/network liveness probe
- changing the 500ms post-settlement grace without separate evidence
