#!/usr/bin/env bash
# Start the opensessions TUI.
# Works in both tmux and zellij — detects the mux from environment.

# Resolve plugin dir — try tmux env first, fallback to script location
if [ -n "${TMUX:-}" ]; then
    PLUGIN_DIR="$(tmux show-environment -g OPENSESSIONS_DIR 2>/dev/null | cut -d= -f2)"
fi
PLUGIN_DIR="${PLUGIN_DIR:-${OPENSESSIONS_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}}"
TUI_DIR="$PLUGIN_DIR/packages/tui"

# Find bun
BUN_PATH="${BUN_PATH:-$(command -v bun 2>/dev/null || echo "$HOME/.bun/bin/bun")}"

cd "$TUI_DIR"
export REFOCUS_WINDOW
export OPENSESSIONS_DIR="$PLUGIN_DIR"
exec "$BUN_PATH" run src/index.tsx 2>/tmp/opensessions-err.log
