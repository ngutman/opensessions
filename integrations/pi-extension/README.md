# opensessions Pi runtime extension

Pi extension that registers the live `pi` process with opensessions so tmux pane scans can map Pi session IDs to exact panes.

## Usage

Run Pi with the extension:

```bash
pi --extension /path/to/opensessions/integrations/pi-extension/opensessions-runtime.ts
```

Or copy/symlink the file into one of Pi's extension locations:

- `~/.pi/agent/extensions/`
- `.pi/extensions/`

## What it does

The extension POSTs the current Pi runtime identity to opensessions on localhost:

- `POST /api/runtime/pi/upsert` on `session_start`
- heartbeat every 5 seconds while Pi is alive
- `POST /api/runtime/pi/delete` on `session_shutdown`

By default it talks to `http://127.0.0.1:7391`.
Override with:

```bash
export OPENSESSIONS_URL=http://127.0.0.1:7391
```
