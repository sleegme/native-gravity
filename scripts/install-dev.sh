#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN_DIR="${OMA_PLUGIN_DIR:-$HOME/.gemini/antigravity-cli/plugins/oh-my-agy}"
BIN_DIR="${OMA_BIN_DIR:-$HOME/.local/bin}"

mkdir -p "$(dirname "$PLUGIN_DIR")" "$BIN_DIR"

if [[ -e "$PLUGIN_DIR" && ! -L "$PLUGIN_DIR" ]]; then
  echo "Refusing to replace non-symlink plugin path: $PLUGIN_DIR" >&2
  echo "Move/remove it manually or set OMA_PLUGIN_DIR." >&2
  exit 1
fi

ln -sfn "$ROOT" "$PLUGIN_DIR"
ln -sfn "$ROOT/bin/oma" "$BIN_DIR/oma"

echo "Installed development links:"
echo "  plugin: $PLUGIN_DIR -> $ROOT"
echo "  command: $BIN_DIR/oma -> $ROOT/bin/oma"
echo
if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
  echo "Warning: $BIN_DIR is not currently on PATH." >&2
fi
echo "Next: oma smoke"
