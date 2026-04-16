export type AgentStatus = "idle" | "running" | "tool-running" | "done" | "error" | "waiting" | "interrupted" | "stale";

/** Whether the agent process is alive (pane exists) or has exited.
 *  "unknown" = watcher-only, no pane info available. */
export type AgentLiveness = "alive" | "exited" | "unknown";

export interface AgentEvent {
  agent: string;
  session: string;
  status: AgentStatus;
  ts: number;
  threadId?: string;
  threadName?: string;
  /** Best-known cwd for this agent instance, preferably from the live pane */
  cwd?: string;
  /** Git branch resolved for cwd when available */
  branch?: string;
  /** True when the row was synthesized from live pane presence rather than a watcher event */
  isSynthetic?: boolean;
  /** Set by tracker when serializing for the TUI — true if user hasn't seen this terminal state */
  unseen?: boolean;
  /** Set by pane scanner — the tmux pane ID where this agent was detected */
  paneId?: string;
  /** Whether the agent process is alive, exited, or unknown (no pane info) */
  liveness?: AgentLiveness;
}

export const TERMINAL_STATUSES = new Set<AgentStatus>(["done", "error", "interrupted", "stale"]);

/** Input from the pane scanner to applyPanePresence().
 *  The scanner reports "is there a live agent process in this pane?" and may
 *  optionally resolve that process to a watcher threadId using agent-specific
 *  runtime metadata. Status and threadName still come exclusively from watchers. */
export interface PanePresenceInput {
  agent: string;
  paneId: string;
  threadId?: string;
  cwd?: string;
}
