- Extract spinner to shell-utils.ts (~75 lines)complex state machine, would
benefit from unit testing the frame computation logic separately
- Extract permission prompt (~50 lines)input state machine + render could be
pure functions
- Extract slash commands to shell-commands.ts (~366 lines)the switch is large
but readable; splitting needs careful thought about shared state (cfg, prompt)
- Extract event handler logic (~99 lines)the onEvent closure has many captured
 variables; extracting pure formatting helpers is feasible but the handler itself
 is tightly coupled to runShell state

- Duplicated ANSI constants — DIM, BOLD, RED, RESET defined independently in
  shell.ts, setup.ts, uninstall.ts, help.ts. Centralize in config.ts or a
  shared `ansi.ts` (trivial, ~10 lines)
- Duplicated path constants — GLOBAL_DIR, BASHRC, ZSHRC, FISH_FN_DIR defined
  in setup.ts, uninstall.ts, shell.ts, shell-utils.ts. Centralize in config.ts
- Duplicated RC block logic — MARKER_START/END, escape+regex, installRcBlock
  and removeRcBlock in setup.ts vs uninstall.ts are near-identical. Extract to
  a shared `rc-block.ts` or into shell-utils.ts
- Duplicated credential reading — `~/.claude/.credentials.json` parsing for
  subscriptionType/rateLimitTier appears in both setup.ts and shell.ts /status.
  Extract a `readClaudeAuth()` helper
- Server sessions unbounded — sessions Map in server.ts grows forever with no
  eviction. Add a TTL or LRU cap
- setup.ts interactive prompt TUI (~90 lines) — the raw-terminal arrow-key
  selector is reusable and testable, but trapped in a top-level script. Extract
  to a module so it could be tested or reused by other interactive flows
- shell.ts top-level side effects — argv parsing, stdin reading, slash dispatch
  all run at import time, making individual pieces unimportable for testing.
  Wrapping in an async main() would let tests import helpers without triggering
  the shell
- Config persistence helpers in shell.ts — loadConfig, loadConfigWithSources,
  saveConfig (~30 lines) sit in shell.ts but are pure config logic that belongs
  alongside loadJSON/saveJSON in shell-utils.ts

