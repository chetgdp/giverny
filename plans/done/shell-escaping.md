# Shell escaping: protect prompt text from shell interpretation

## Context

When a user types `@ what is this?`, zsh interprets `?` as a single-character glob before the function receives it. This makes natural-language prompts (which often end with `?`) fail with "no matches found". Other shell metacharacters have similar problems.

## Problem characters

| Char | Shell | What happens | Frequency in prompts |
|------|-------|-------------|---------------------|
| `?` | zsh, bash | single-char glob | **very high** (questions) |
| `*` | zsh, bash | multi-char glob | medium |
| `[` `]` | zsh, bash | character class glob | low |
| `~` | zsh, bash | home expansion | low |
| `{` `}` | zsh, bash | brace expansion | low |
| `(` `)` | zsh | glob qualifiers | low |
| `$` | zsh, bash, fish | variable expansion | low |
| `` ` `` | zsh, bash | command substitution | rare |
| `!` | bash | history expansion | low (bash already has `set +H`) |
| `#` | zsh, bash | comment after whitespace | rare |
| `()` | fish | command substitution | low |

Fish does not glob with `?` or `*` (unmatched globs pass through literally), so it's mostly fine as-is.

## Fix

Use `noglob` to prevent glob expansion on arguments. This fixes the high-frequency characters (`?`, `*`, `[]`) which are the ones that actually break normal usage.

Characters like `$`, `` ` ``, `{}` are left as-is — they're rare in natural prompts and quoting them is the expected shell behavior. Users who type `$PATH` probably mean to expand it.

### Zsh

```zsh
# before
function @() { giverny "$@"; }

# after
alias @='noglob giverny'
```

`noglob` is a zsh precommand modifier — prevents glob expansion on the command's arguments.

### Bash

Bash has no `noglob` precommand modifier. Use the `set -f` alias trick:

```bash
# before
set +H
function @() { giverny "$@"; }

# after
set +H
function _giverny() { set +f; giverny "$@"; }
alias @='set -f; _giverny'
```

How it works:
1. `@ test?` expands alias to `set -f; _giverny test?`
2. `set -f` disables globbing
3. `_giverny test?` — `test?` is now literal (globbing off)
4. Inside `_giverny`, `set +f` restores globbing, then calls giverny

### Fish

No changes needed. Fish passes unmatched globs literally.

## Changes

### `src/setup.ts` — `installAliases()`

**Zsh block** (line 98-102):
```ts
// before
const fnLine = `function ${prefix}() { giverny "$@"; }`;
installRcBlock(ZSHRC, fnLine);

// after
const aliasLine = `alias ${prefix}='noglob giverny'`;
installRcBlock(ZSHRC, aliasLine);
```

**Bash block** (line 91-95):
```ts
// before
const fnLine = `function ${prefix}() { giverny "$@"; }`;
installRcBlock(BASHRC, `set +H\n${fnLine}`);

// after
const helperFn = `function _giverny() { set +f; giverny "$@"; }`;
const aliasLine = `alias ${prefix}='set -f; _giverny'`;
installRcBlock(BASHRC, `set +H\n${helperFn}\n${aliasLine}`);
```

Fish — no change.

### `src/config.ts` — comment update

Update the comment on line 10 from "all work in bash, zsh, and fish" to note that `?` and `*` need noglob protection.

### `dev-install.sh` — no change

It calls `giverny --setup auto`, which runs the same `installAliases()`.

## Verify

```bash
# reinstall aliases
giverny --setup

# zsh test
source ~/.zshrc
@ what is this?
@ explain * imports
@ test [something]

# bash test (if bashrc exists)
bash -l -c '@ what is this?'
```
