import type { MuxProvider, MuxSessionInfo } from "@opensessions/core";
import { appendFileSync } from "fs";

const SIDEBAR_PANE_NAME = "opensessions";

function plog(msg: string, data?: Record<string, unknown>) {
  const ts = new Date().toISOString().slice(11, 23);
  const extra = data ? " " + JSON.stringify(data) : "";
  try { appendFileSync("/tmp/opensessions-debug.log", `[${ts}] [zellij] ${msg}${extra}\n`); } catch {}
}

function run(cmd: string[]): string {
  try {
    const result = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe" });
    return result.stdout.toString().trim();
  } catch {
    return "";
  }
}

function runInSession(session: string, args: string[]): string {
  return run(["zellij", "--session", session, "action", ...args]);
}

function runInSessionJSON<T>(session: string, args: string[]): T | null {
  const raw = runInSession(session, args);
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

function runJSON<T>(cmd: string[]): T | null {
  const raw = run(cmd);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

interface ZellijPaneInfo {
  id: number;
  is_plugin: boolean;
  is_focused: boolean;
  title: string;
  is_floating: boolean;
  tab_id: number;
  tab_name: string;
  pane_cwd?: string;
}

interface ZellijTabInfo {
  position: number;
  name: string;
  active: boolean;
  selectable_tiled_panes_count: number;
  selectable_floating_panes_count: number;
  tab_id: number;
}

/**
 * ZellijProvider — MuxProvider implementation for Zellij.
 *
 * Key differences from tmux:
 * - Zellij "sessions" are top-level, "tabs" are like tmux "windows"
 * - No session creation timestamps from CLI — we approximate with Date.now()
 * - No native CLI hooks — we use polling (the server already does periodic broadcasts)
 * - $ZELLIJ_SESSION_NAME gives the current session name
 * - `zellij action list-panes --json` gives pane info for the current session
 * - `zellij ls` lists all running session names
 */
export class ZellijProvider implements MuxProvider {
  readonly name = "zellij";

  private sessionCreatedAt = new Map<string, number>();

  listSessions(): MuxSessionInfo[] {
    const raw = run(["zellij", "ls", "-s"]);
    if (!raw) return [];

    const names = raw.split("\n").map((l) => l.trim()).filter(Boolean);

    const sessions: MuxSessionInfo[] = [];
    for (const name of names) {
      if (!this.sessionCreatedAt.has(name)) {
        this.sessionCreatedAt.set(name, Math.floor(Date.now() / 1000));
      }

      // Get tab count for this session by querying it
      // We can only get detailed info for the current session via `zellij action`
      // For other sessions, we default to 1 tab
      let tabs = 1;
      let dir = "";
      const currentSession = this.getCurrentSession();
      if (name === currentSession) {
        const tabInfo = runJSON<ZellijTabInfo[]>(["zellij", "action", "list-tabs", "--json"]);
        if (tabInfo) tabs = tabInfo.length;

        const panes = runJSON<ZellijPaneInfo[]>(["zellij", "action", "list-panes", "--json"]);
        if (panes) {
          const focused = panes.find((p) => p.is_focused && !p.is_plugin);
          if (focused?.pane_cwd) dir = focused.pane_cwd;
        }
      }

      sessions.push({
        name,
        createdAt: this.sessionCreatedAt.get(name)!,
        dir,
        windows: tabs,
      });
    }

    return sessions;
  }

  switchSession(name: string, _clientTty?: string): void {
    if (process.env.ZELLIJ_SESSION_NAME) {
      // Inside zellij — use action to switch
      Bun.spawnSync(["zellij", "action", "switch-session", name], {
        stdout: "pipe",
        stderr: "pipe",
      });
    } else if (process.env.TMUX) {
      // Inside tmux — detach the client and replace it with zellij attach
      // -E runs a shell command to replace the tmux client process
      const zellijBin = "/opt/homebrew/bin/zellij";
      const tty = _clientTty;
      const args = ["detach-client"];
      if (tty) args.push("-t", tty);
      args.push("-E", `${zellijBin} attach ${name}`);
      Bun.spawnSync(["tmux", ...args], {
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH ?? ""}` },
      });
    } else {
      // Outside any mux — just attach directly
      Bun.spawnSync(["zellij", "attach", name], {
        stdout: "pipe",
        stderr: "pipe",
      });
    }
  }

  getCurrentSession(): string | null {
    return process.env.ZELLIJ_SESSION_NAME ?? null;
  }

  getSessionDir(name: string): string {
    const currentSession = this.getCurrentSession();
    if (name !== currentSession) return "";

    const panes = runJSON<ZellijPaneInfo[]>(["zellij", "action", "list-panes", "--json"]);
    if (!panes) return "";
    const focused = panes.find((p) => p.is_focused && !p.is_plugin);
    return focused?.pane_cwd ?? "";
  }

  getPaneCount(name: string): number {
    const currentSession = this.getCurrentSession();
    if (name !== currentSession) return 1;

    const panes = runJSON<ZellijPaneInfo[]>(["zellij", "action", "list-panes", "--json"]);
    if (!panes) return 1;
    return panes.filter((p) => !p.is_plugin && p.is_focused !== undefined).length;
  }

  getClientTty(): string {
    // Zellij doesn't expose client TTY — not needed for switch-session
    return "";
  }

  createSession(name?: string, _dir?: string): void {
    const sessionName = name ?? `session-${Date.now()}`;
    // Create a background session using attach --create-background
    Bun.spawnSync(["zellij", "attach", "--create-background", sessionName], {
      stdout: "pipe",
      stderr: "pipe",
    });
  }

  killSession(name: string): void {
    Bun.spawnSync(["zellij", "kill-session", name], {
      stdout: "pipe",
      stderr: "pipe",
    });
  }

  setupHooks(_serverHost: string, _serverPort: number): void {
    // Zellij doesn't have CLI hooks like tmux's set-hook.
    // The server relies on polling (broadcastState on interval/websocket reconnect)
    // and the /event endpoint for agent status updates.
    // Future: could use a Zellij WASM plugin to emit events.
  }

  cleanupHooks(): void {
    // No-op — no hooks to clean up
  }

  /**
   * Batch pane count retrieval for all sessions.
   * Only the current session can be queried via `zellij action`.
   */
  getAllPaneCounts(): Map<string, number> {
    const counts = new Map<string, number>();
    const currentSession = this.getCurrentSession();
    if (!currentSession) return counts;

    const panes = runJSON<ZellijPaneInfo[]>(["zellij", "action", "list-panes", "--json"]);
    if (panes) {
      counts.set(currentSession, panes.filter((p) => !p.is_plugin).length);
    }

    return counts;
  }
}
