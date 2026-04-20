import type { AgentEvent, PanePresenceInput } from "../contracts/agent";
import { TERMINAL_STATUSES } from "../contracts/agent";

const MAX_EVENT_TIMESTAMPS = 30;
const TERMINAL_PRUNE_MS = 5 * 60 * 1000;
const SYNTHETIC_PANE_MARKER = ":pane:";

const STATUS_PRIORITY: Record<string, number> = {
  "tool-running": 7,
  running: 6,
  error: 5,
  stale: 4,
  interrupted: 3,
  waiting: 2,
  done: 1,
  idle: 0,
};

export function instanceKey(agent: string, threadId?: string): string {
  return threadId ? `${agent}:${threadId}` : agent;
}

function syntheticPaneKey(agent: string, paneId: string, threadId?: string): string {
  return threadId
    ? `${agent}:${threadId}${SYNTHETIC_PANE_MARKER}${paneId}`
    : `${agent}${SYNTHETIC_PANE_MARKER}${paneId}`;
}

function isSyntheticPaneKey(key: string): boolean {
  return key.includes(SYNTHETIC_PANE_MARKER);
}

export class AgentTracker {
  // Outer key: session name, inner key: instance key (agent or agent:threadId)
  private instances = new Map<string, Map<string, AgentEvent>>();
  private eventTimestamps = new Map<string, number[]>();
  // Per-instance unseen tracking: "session\0instanceKey"
  private unseenInstances = new Set<string>();
  private active = new Set<string>();

  private unseenKey(session: string, key: string): string {
    return `${session}\0${key}`;
  }

  applyEvent(event: AgentEvent, options?: { seed?: boolean }): void {
    const key = instanceKey(event.agent, event.threadId);

    // Store instance
    let sessionInstances = this.instances.get(event.session);
    if (!sessionInstances) {
      sessionInstances = new Map();
      this.instances.set(event.session, sessionInstances);
    }
    // Preserve pane info from prior enrichment by applyPanePresence, and
    // preserve a previously-known threadName if the incoming event omits it
    // (e.g. plugin-driven events that don't carry a title on every POST).
    const prev = sessionInstances.get(key);
    if (prev?.paneId) {
      event.paneId = event.paneId ?? prev.paneId;
      event.liveness = event.liveness ?? prev.liveness;
      event.cwd = event.cwd ?? prev.cwd;
    }
    if (prev?.threadName && !event.threadName) {
      event.threadName = prev.threadName;
    }
    sessionInstances.set(key, event);

    // Clean up a matching synthetic pane-keyed entry for this agent.
    // Prefer exact thread matches. Fall back to a single generic synthetic
    // only when there is no ambiguity.
    const exactSyntheticMatches: Array<{ key: string; event: AgentEvent }> = [];
    const genericSyntheticMatches: Array<{ key: string; event: AgentEvent }> = [];
    for (const [k, ev] of sessionInstances) {
      if (k === key || ev.agent !== event.agent || !isSyntheticPaneKey(k)) continue;
      if (ev.threadId && event.threadId && ev.threadId === event.threadId) {
        exactSyntheticMatches.push({ key: k, event: ev });
      } else if (!ev.threadId) {
        genericSyntheticMatches.push({ key: k, event: ev });
      }
    }

    const matchToMerge = exactSyntheticMatches.length === 1
      ? exactSyntheticMatches[0]
      : exactSyntheticMatches.length === 0 && genericSyntheticMatches.length === 1
        ? genericSyntheticMatches[0]
        : undefined;

    if (matchToMerge) {
      if (matchToMerge.event.paneId) {
        event.paneId = event.paneId ?? matchToMerge.event.paneId;
        event.liveness = event.liveness ?? matchToMerge.event.liveness;
        event.cwd = event.cwd ?? matchToMerge.event.cwd;
      }
      sessionInstances.delete(matchToMerge.key);
      this.unseenInstances.delete(this.unseenKey(event.session, matchToMerge.key));
    }

    // Track event timestamps
    let timestamps = this.eventTimestamps.get(event.session);
    if (!timestamps) {
      timestamps = [];
      this.eventTimestamps.set(event.session, timestamps);
    }
    timestamps.push(event.ts);
    if (timestamps.length > MAX_EVENT_TIMESTAMPS) {
      timestamps.splice(0, timestamps.length - MAX_EVENT_TIMESTAMPS);
    }

    // Per-instance unseen tracking
    // Seeded events always mark as unseen (they represent state from before the user connected)
    const ukey = this.unseenKey(event.session, key);
    if (TERMINAL_STATUSES.has(event.status)) {
      if (options?.seed || !this.active.has(event.session)) {
        this.unseenInstances.add(ukey);
      }
    } else {
      // Non-terminal status for this instance = user is interacting, mark seen
      this.unseenInstances.delete(ukey);
    }
  }

  /** Returns the most important agent state for backward compat */
  getState(session: string): AgentEvent | null {
    const sessionInstances = this.instances.get(session);
    if (!sessionInstances || sessionInstances.size === 0) return null;

    let best: AgentEvent | null = null;
    let bestPriority = -1;
    for (const event of sessionInstances.values()) {
      const p = STATUS_PRIORITY[event.status] ?? 0;
      if (p > bestPriority) {
        bestPriority = p;
        best = event;
      }
    }
    return best;
  }

  /** Returns all agent instances for a session, with unseen flag stamped */
  getAgents(session: string): AgentEvent[] {
    const sessionInstances = this.instances.get(session);
    if (!sessionInstances) return [];
    return [...sessionInstances.values()]
      .map((event) => {
        const key = instanceKey(event.agent, event.threadId);
        const isUnseen = this.unseenInstances.has(this.unseenKey(session, key));
        return isUnseen ? { ...event, unseen: true } : event;
      })
      .sort((a, b) => {
        if (!!a.isSynthetic !== !!b.isSynthetic) return Number(a.isSynthetic) - Number(b.isSynthetic);
        const priorityDiff = (STATUS_PRIORITY[b.status] ?? 0) - (STATUS_PRIORITY[a.status] ?? 0);
        if (priorityDiff !== 0) return priorityDiff;
        return b.ts - a.ts;
      });
  }

  /** Returns recent event timestamps for sparkline rendering */
  getEventTimestamps(session: string): number[] {
    return this.eventTimestamps.get(session) ?? [];
  }

  markSeen(session: string): boolean {
    const hadUnseen = this.isUnseen(session);
    if (!hadUnseen) return false;

    // Clear unseen flags for all instances — keep the instances themselves
    // (pruneTerminal will remove seen terminal instances after timeout)
    const sessionInstances = this.instances.get(session);
    if (sessionInstances) {
      for (const key of sessionInstances.keys()) {
        this.unseenInstances.delete(this.unseenKey(session, key));
      }
    }
    return true;
  }

  dismiss(session: string, agent: string, threadId?: string): boolean {
    const sessionInstances = this.instances.get(session);
    if (!sessionInstances) return false;

    const key = instanceKey(agent, threadId);
    const removed = sessionInstances.delete(key);
    if (!removed) return false;

    this.unseenInstances.delete(this.unseenKey(session, key));
    if (sessionInstances.size === 0) {
      this.instances.delete(session);
    }
    return true;
  }

  /** Ensure a specific watcher instance only exists in one session.
   *  Useful when cwd-based watcher resolution and live pane ownership disagree.
   *  Returns true if any duplicate instances were removed from other sessions. */
  dedupeInstanceToSession(session: string, agent: string, threadId?: string): boolean {
    if (!threadId) return false;
    const key = instanceKey(agent, threadId);
    let changed = false;

    for (const [otherSession, sessionInstances] of this.instances) {
      if (otherSession === session) continue;
      if (!sessionInstances.delete(key)) continue;
      this.unseenInstances.delete(this.unseenKey(otherSession, key));
      if (sessionInstances.size === 0) {
        this.instances.delete(otherSession);
      }
      changed = true;
    }

    return changed;
  }

  pruneStuck(timeoutMs: number): void {
    const now = Date.now();
    for (const [session, sessionInstances] of this.instances) {
      for (const [key, event] of sessionInstances) {
        if ((event.status === "running" || event.status === "tool-running") && now - event.ts > timeoutMs) {
          if (event.liveness === "alive") continue;
          sessionInstances.delete(key);
          this.unseenInstances.delete(this.unseenKey(session, key));
        }
      }
      if (sessionInstances.size === 0) {
        this.instances.delete(session);
      }
    }
  }

  /** Auto-prune terminal instances older than timeout, but only if instance is not unseen or alive */
  pruneTerminal(): void {
    const now = Date.now();
    for (const [session, sessionInstances] of this.instances) {
      for (const [key, event] of sessionInstances) {
        if (!TERMINAL_STATUSES.has(event.status)) continue;
        const ukey = this.unseenKey(session, key);
        if (this.unseenInstances.has(ukey)) continue; // Don't prune unseen — user hasn't looked yet
        if (event.liveness === "alive") continue; // Don't prune agents backed by live panes
        if (now - event.ts > TERMINAL_PRUNE_MS) {
          sessionInstances.delete(key);
        }
      }
      if (sessionInstances.size === 0) {
        this.instances.delete(session);
      }
    }
  }

  isUnseen(session: string): boolean {
    // Session is unseen if any instance within it is unseen
    const sessionInstances = this.instances.get(session);
    if (!sessionInstances) return false;
    for (const key of sessionInstances.keys()) {
      if (this.unseenInstances.has(this.unseenKey(session, key))) return true;
    }
    return false;
  }

  getUnseen(): string[] {
    // Derive session-level unseen from per-instance tracking
    const sessions = new Set<string>();
    for (const ukey of this.unseenInstances) {
      sessions.add(ukey.split("\0")[0]!);
    }
    return [...sessions];
  }

  handleFocus(session: string): boolean {
    this.active.clear();
    this.active.add(session);

    const hadUnseen = this.isUnseen(session);
    if (hadUnseen) {
      // Clear unseen flags — keep terminal instances visible (as "seen")
      // pruneTerminal will clean them up after timeout
      const sessionInstances = this.instances.get(session);
      if (sessionInstances) {
        for (const key of sessionInstances.keys()) {
          this.unseenInstances.delete(this.unseenKey(session, key));
        }
      }
    }
    return hadUnseen;
  }

  setActiveSessions(sessions: string[]): void {
    this.active.clear();
    for (const s of sessions) this.active.add(s);
  }

  /** Fold pane scanner results into the tracker.
   *  The scanner reports {agent, paneId} and may include threadId when it can
   *  resolve a live process to a specific watcher instance.
   *
   *  1. Entries with liveness "alive" whose paneId is missing from the scan → "exited"
   *  2. Exact threadId matches enrich the corresponding watcher entry.
   *  3. If no exact match exists, unambiguous single-instance matches fall back by agent.
   *  4. Otherwise create or update a synthetic pane-backed idle entry.
   *  Returns true if anything changed (caller uses this for broadcast decisions). */
  applyPanePresence(session: string, paneAgents: PanePresenceInput[]): boolean {
    let changed = false;
    let sessionInstances = this.instances.get(session);
    const assignedWatcherKeys = new Set<string>();

    // Index incoming pane IDs for fast lookup
    const activePaneIds = new Set<string>();
    const paneIdsWithExactThread = new Set<string>();
    const paneCwdsByAgentAndPane = new Map<string, string>();
    for (const pa of paneAgents) {
      const paneKey = `${pa.agent}\0${pa.paneId}`;
      activePaneIds.add(pa.paneId);
      if (pa.threadId) paneIdsWithExactThread.add(paneKey);
      else if (pa.cwd) paneCwdsByAgentAndPane.set(paneKey, pa.cwd);
    }

    // 1. Transition previously-alive entries whose pane disappeared → "exited"
    if (sessionInstances) {
      for (const [, event] of sessionInstances) {
        if (event.liveness === "alive" && event.paneId && !activePaneIds.has(event.paneId)) {
          event.liveness = "exited";
          event.paneId = undefined;
          changed = true;
        }
      }
    }

    // 2. Stamp pane info onto existing entries, or create minimal synthetics
    for (const pa of paneAgents) {
      if (!sessionInstances) {
        sessionInstances = new Map();
        this.instances.set(session, sessionInstances);
      }

      const stampAlive = (target: AgentEvent, key?: string) => {
        const wasDifferent = target.paneId !== pa.paneId
          || target.liveness !== "alive"
          || (pa.cwd !== undefined && target.cwd !== pa.cwd)
          || (key ? target.isSynthetic === true : false);
        target.paneId = pa.paneId;
        target.liveness = "alive";
        target.cwd = pa.cwd ?? target.cwd;
        if (key) {
          assignedWatcherKeys.add(key);
          target.isSynthetic = false;
        }
        if (wasDifferent) changed = true;
      };

      const getGenericSyntheticForPane = (): { key: string; event: AgentEvent } | null => {
        const key = syntheticPaneKey(pa.agent, pa.paneId);
        const event = sessionInstances.get(key);
        if (!event) return null;
        return { key, event };
      };

      const deleteGenericSyntheticForPane = () => {
        const existingGeneric = getGenericSyntheticForPane();
        if (!existingGeneric) return null;
        sessionInstances.delete(existingGeneric.key);
        this.unseenInstances.delete(this.unseenKey(session, existingGeneric.key));
        changed = true;
        return existingGeneric.event;
      };

      if (pa.threadId) {
        for (const [, event] of sessionInstances) {
          if (event.agent !== pa.agent) continue;
          if (event.threadId === pa.threadId) continue;
          if (event.paneId !== pa.paneId) continue;
          event.liveness = "exited";
          event.paneId = undefined;
          changed = true;
        }

        const paneKey = `${pa.agent}\0${pa.paneId}`;
        const carriedPaneCwd = pa.cwd ?? paneCwdsByAgentAndPane.get(paneKey);
        const exactKey = instanceKey(pa.agent, pa.threadId);
        const exactSyntheticKey = syntheticPaneKey(pa.agent, pa.paneId, pa.threadId);
        const genericSynthetic = getGenericSyntheticForPane();
        const exactEvent = sessionInstances.get(exactKey);
        if (exactEvent) {
          if (!exactEvent.cwd && (genericSynthetic?.event.cwd || carriedPaneCwd)) {
            exactEvent.cwd = genericSynthetic?.event.cwd ?? carriedPaneCwd;
            changed = true;
          }
          stampAlive(exactEvent, exactKey);

          // Drop any synthetic for the same pane now that we have an exact watcher entry.
          deleteGenericSyntheticForPane();
          if (sessionInstances.delete(exactSyntheticKey)) {
            this.unseenInstances.delete(this.unseenKey(session, exactSyntheticKey));
            changed = true;
          }
          continue;
        }

        const existing = sessionInstances.get(exactSyntheticKey);
        if (existing) {
          if (!existing.cwd && (genericSynthetic?.event.cwd || carriedPaneCwd)) {
            existing.cwd = genericSynthetic?.event.cwd ?? carriedPaneCwd;
            changed = true;
          }
          stampAlive(existing);
          deleteGenericSyntheticForPane();
          continue;
        }

        const genericCwd = deleteGenericSyntheticForPane()?.cwd;

        sessionInstances.set(exactSyntheticKey, {
          agent: pa.agent,
          session,
          status: "idle",
          ts: Date.now(),
          threadId: pa.threadId,
          cwd: carriedPaneCwd ?? genericCwd,
          isSynthetic: true,
          paneId: pa.paneId,
          liveness: "alive",
        });
        changed = true;
        continue;
      }

      if (paneIdsWithExactThread.has(`${pa.agent}\0${pa.paneId}`)) {
        continue;
      }

      const watcherEntries = [...sessionInstances.entries()]
        .filter(([k, ev]) => ev.agent === pa.agent && !isSyntheticPaneKey(k));
      const exactPaneMatch = watcherEntries.find(([, ev]) => ev.paneId === pa.paneId);
      if (exactPaneMatch) {
        stampAlive(exactPaneMatch[1], exactPaneMatch[0]);
        deleteGenericSyntheticForPane();
        continue;
      }

      const reusableWatcherEntries = watcherEntries.filter(([k, ev]) => {
        if (assignedWatcherKeys.has(k)) return false;
        if (ev.paneId && ev.paneId !== pa.paneId && ev.liveness === "alive") return false;
        return true;
      });

      if (reusableWatcherEntries.length === 1) {
        stampAlive(reusableWatcherEntries[0]![1], reusableWatcherEntries[0]![0]);
        deleteGenericSyntheticForPane();
        continue;
      }

      const syntheticKey = syntheticPaneKey(pa.agent, pa.paneId);
      const existing = sessionInstances.get(syntheticKey);
      if (!existing) {
        sessionInstances.set(syntheticKey, {
          agent: pa.agent,
          session,
          status: "idle",
          ts: Date.now(),
          cwd: pa.cwd,
          isSynthetic: true,
          paneId: pa.paneId,
          liveness: "alive",
        });
        changed = true;
      } else {
        stampAlive(existing);
      }
    }

    return changed;
  }
}
