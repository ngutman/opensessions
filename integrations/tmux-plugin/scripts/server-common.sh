#!/usr/bin/env sh

server_key() {
  if [ -n "$OPENSESSIONS_SERVER_KEY" ]; then
    printf '%s\n' "$OPENSESSIONS_SERVER_KEY"
    return
  fi

  if [ -z "$TMUX" ]; then
    return
  fi

  socket_path="${TMUX%%,*}"
  [ -n "$socket_path" ] || return

  awk -v input="$socket_path" 'BEGIN {
    hash = 0
    for (i = 1; i <= length(input); i++) {
      hash = (hash + ord(substr(input, i, 1)) * i) % 20000
    }
    printf "%d\n", hash
  }
  function ord(ch,    chars) {
    chars = " !\"#$%&\047()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~"
    return index(chars, ch) + 31
  }'
}

SERVER_KEY="$(server_key)"
if [ -n "$OPENSESSIONS_PORT" ]; then
  PORT="$OPENSESSIONS_PORT"
elif [ -n "$SERVER_KEY" ]; then
  PORT=$((17000 + SERVER_KEY))
else
  PORT="7391"
fi
HOST="${OPENSESSIONS_HOST:-127.0.0.1}"
if [ -n "$OPENSESSIONS_PID_FILE" ]; then
  PID_FILE="$OPENSESSIONS_PID_FILE"
elif [ -n "$SERVER_KEY" ]; then
  PID_FILE="/tmp/opensessions.${SERVER_KEY}.pid"
else
  PID_FILE="/tmp/opensessions.pid"
fi

PLUGIN_DIR="$(tmux show-environment -g OPENSESSIONS_DIR 2>/dev/null | cut -d= -f2)"
PLUGIN_DIR="${PLUGIN_DIR:-$(cd "$SCRIPT_DIR/../../.." && pwd)}"
BUN_PATH="${BUN_PATH:-$(command -v bun 2>/dev/null || echo "$HOME/.bun/bin/bun")}"
SERVER_ENTRY="$PLUGIN_DIR/apps/server/src/main.ts"

server_alive() {
  curl -s -o /dev/null -m 0.2 "http://${HOST}:${PORT}/" 2>/dev/null
}

ensure_server() {
  if server_alive; then
    return 0
  fi

  "$BUN_PATH" run "$SERVER_ENTRY" >/dev/null 2>&1 &

  attempt=0
  while [ "$attempt" -lt 30 ]; do
    sleep 0.1
    if server_alive; then
      return 0
    fi
    attempt=$((attempt + 1))
  done

  return 1
}
