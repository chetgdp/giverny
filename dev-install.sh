#!/bin/bash
# dev.shdeveloper workflow, not user-facing
# ./dev.sh         symlink this checkout to PATH, run setup
# ./dev.sh clean   nuclear teardown (test install.sh on a fresh system)
set -euo pipefail

DEV_DIR="$(cd "$(dirname "$0")" && pwd)"
BIN_DIR="$HOME/.local/bin"
INSTALL_DIR="$HOME/.giverny"
FISH_FN_DIR="$HOME/.config/fish/functions"
MARKER_START="# ><(((*> giverny start"
MARKER_END="# <*)))>< giverny end"

if [ "${1:-}" = "clean" ]; then
  echo "=== clean ==="
  echo ""

  rm -f "$BIN_DIR/giverny" && echo "[ok] removed $BIN_DIR/giverny" || true
  rm -f "$FISH_FN_DIR/,.fish" "$FISH_FN_DIR/?.fish" "$FISH_FN_DIR/@.fish" "$FISH_FN_DIR/+.fish" "$FISH_FN_DIR/_.fish" 2>/dev/null && echo "[ok] removed fish functions" || true
  echo "     open a new terminal to unload from this session"

  for rc in "$HOME/.bashrc" "$HOME/.zshrc"; do
    if [ -f "$rc" ] && grep -q "$MARKER_START" "$rc"; then
      sed -i "/$MARKER_START/,/$MARKER_END/d" "$rc"
      echo "[ok] removed alias block from $(basename "$rc")"
    fi
  done

  if [ -d "$INSTALL_DIR" ]; then
    rm -rf "$INSTALL_DIR"
    echo "[ok] removed $INSTALL_DIR"
  fi
  exit 0
fi

echo "=== dev ==="
echo ""

if ! command -v bun &>/dev/null; then
  echo "[!!] bun not found"
  exit 1
fi
echo "[ok] bun $(bun --version)"

if ! command -v claude &>/dev/null; then
  echo "[!!] claude CLI not found"
  exit 1
fi
echo "[ok] claude CLI found"

mkdir -p "$BIN_DIR"
ln -sf "$DEV_DIR/run.ts" "$BIN_DIR/giverny"
chmod +x "$DEV_DIR/run.ts"
echo "[ok] linked $BIN_DIR/giverny -> $DEV_DIR/run.ts"

# Shell aliases + default config (no interactive prompts)
bun run "$DEV_DIR/run.ts" --setup auto

if ! echo "$PATH" | tr ':' '\n' | grep -qx "$BIN_DIR"; then
  echo ""
  echo "[!!] $BIN_DIR is not in your PATH"
  echo "     fish: fish_add_path ~/.local/bin"
fi

echo ""
echo "Dev mode active. Edits to $DEV_DIR are live."
echo "Run './dev-install.sh clean' to tear down."
