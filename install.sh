#!/bin/bash
set -euo pipefail

REPO="https://github.com/chetgdp/giverny.git"
INSTALL_DIR="$HOME/.giverny"
BIN_DIR="$HOME/.local/bin"

START_MS=$(($(date +%s%N) / 1000000))

echo "=== Giverny Installer ==="
echo ""

# 1. Check for bun
if command -v bun &>/dev/null; then
  echo "[ok] bun $(bun --version)"
else
  echo "[..] bun not foundinstalling..."
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"
  echo "[ok] bun installed"
fi

# 2. Check for claude CLI
if command -v claude &>/dev/null; then
  echo "[ok] claude CLI found"
else
  echo "[!!] claude CLI not found"
  echo "     Install it: https://docs.anthropic.com/en/docs/claude-code/overview"
  echo "     Then re-run this script."
  exit 1
fi

# 3. Check claude is authenticated
if claude --version &>/dev/null; then
  echo "[ok] claude is responsive"
else
  echo "[!!] claude CLI is not working (auth issue?)"
  echo "     Run 'claude' once to authenticate, then re-run this script."
  exit 1
fi

# 4. Clone or update repo
if [ -d "$INSTALL_DIR/.git" ]; then
  echo "[..] updating existing install..."
  git -C "$INSTALL_DIR" pull --ff-only
  echo "[ok] updated"
else
  if [ -d "$INSTALL_DIR" ]; then
    echo "[!!] $INSTALL_DIR exists but is not a git reporemove it first"
    exit 1
  fi
  echo "[..] cloning to $INSTALL_DIR..."
  git clone "$REPO" "$INSTALL_DIR"
  echo "[ok] cloned"
fi

# 5. Symlink the binary
mkdir -p "$BIN_DIR"
ln -sf "$INSTALL_DIR/run.ts" "$BIN_DIR/giverny"
chmod +x "$INSTALL_DIR/run.ts"
echo "[ok] linked giverny -> $BIN_DIR/giverny"

# 6. Install shell aliases + default config
echo "[..] setting up..."
bun run "$INSTALL_DIR/run.ts" --setup auto

# 8. Check PATH
if ! echo "$PATH" | tr ':' '\n' | grep -qx "$BIN_DIR"; then
  echo ""
  echo "[!!] $BIN_DIR is not in your PATH"
  echo "     Add it to your shell config:"
  echo "       bash/zsh: export PATH=\"\$HOME/.local/bin:\$PATH\""
  echo "       fish:     fish_add_path ~/.local/bin"
fi

echo ""
ELAPSED_MS=$(( $(date +%s%N) / 1000000 - START_MS ))
echo "Done in $((ELAPSED_MS / 1000)).$((ELAPSED_MS % 1000))s. Default config written to ~/.giverny/config.json"
echo "Run 'giverny --setup' to customize, or 'giverny --help' for usage."
