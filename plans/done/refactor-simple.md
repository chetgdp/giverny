# Refactor Plan

## Done
- ~~Extract spinner to shell-utils.ts~~ → `spinner.ts` (137 lines, imports ANSI from shell-utils)
- ~~Extract permission prompt~~ → `promptPermission()` in `shell-utils.ts` (lines 341-392)
- ~~Extract slash commands~~ → `commands.ts` (572 lines)
- ~~Extract event handler logic~~ → handled within shell.ts's `main()` guard
- ~~shell.ts top-level side effects~~ → wrapped in `async main()` with `import.meta.main` guard
- ~~Config persistence helpers in shell.ts~~ → moved to `state.ts` (loadConfig, saveConfig, etc.)
- ~~ANSI constants~~ → help.ts, setup.ts, uninstall.ts now import from shell-utils.ts; added GREEN, YELLOW exports
- ~~Path constants~~ → HOME, GLOBAL_DIR, FISH_FN_DIR, BASHRC, ZSHRC, NUSHELL_CONFIG centralized in config.ts
- ~~Credential reading~~ → `readClaudeAuth()` in config.ts, used by setup.ts and bridge.ts
- ~~RC block logic~~ → `rc-block.ts` exports installRcBlock, removeRcBlock, MARKER_START/END
- ~~Server sessions unbounded~~ → TTL (30min) + cap (100) eviction in server.ts
- ~~setup.ts interactive prompt TUI~~ → `tui.ts` exports `selectPrompt()`, setup.ts wraps with defaults
