import type { PanePresenceInput } from "../contracts/agent";
import { PiRuntimeRegistry, type PiRuntimeInfo } from "./pi-runtime-registry";

const DEFAULT_CACHE_TTL_MS = 1_000;

export interface ProcessTreeSnapshot {
  childrenOf: Map<number, number[]>;
  commOf: Map<number, string>;
}

export interface PiPaneEntry {
  session: string;
  paneId: string;
  pid: number;
}

export interface PiThreadOwner {
  threadId: string;
  session: string;
  paneId: string;
  pid: number;
}

interface PiLiveSnapshot {
  builtAt: number;
  ownersByThreadId: Map<string, PiThreadOwner | null>;
  presenceBySession: Map<string, PanePresenceInput[]>;
}

export interface PiLiveResolverDeps {
  listPanes(): PiPaneEntry[];
  listSidebarPaneIds(): Iterable<string>;
  buildProcessTree(): ProcessTreeSnapshot;
  now?(): number;
}

function isExactCommand(comm: string, name: string): boolean {
  return comm === name || comm.endsWith(`/${name}`);
}

function collectDescendantPidsFast(
  pid: number,
  matcher: (comm: string) => boolean,
  tree: ProcessTreeSnapshot,
  depth = 0,
  out: number[] = [],
): number[] {
  if (depth > 2) return out;
  const children = tree.childrenOf.get(pid);
  if (!children) return out;
  for (const childPid of children) {
    const comm = tree.commOf.get(childPid);
    if (comm && matcher(comm)) out.push(childPid);
    collectDescendantPidsFast(childPid, matcher, tree, depth + 1, out);
  }
  return out;
}

export class PiLiveResolver {
  private snapshot: PiLiveSnapshot | null = null;

  constructor(
    private readonly deps: PiLiveResolverDeps,
    private readonly registry = new PiRuntimeRegistry(),
    private readonly cacheTtlMs = DEFAULT_CACHE_TTL_MS,
  ) {}

  upsert(info: PiRuntimeInfo): void {
    this.registry.upsert(info);
    this.invalidate();
  }

  delete(pid: number): boolean {
    const removed = this.registry.delete(pid);
    if (removed) this.invalidate();
    return removed;
  }

  prune(now = this.now()): boolean {
    const changed = this.registry.prune(now);
    if (changed) this.invalidate();
    return changed;
  }

  resolveThreadOwner(threadId: string, options?: { fresh?: boolean }): PiThreadOwner | null {
    return this.getSnapshot(options).ownersByThreadId.get(threadId) ?? null;
  }

  resolveThreadSession(threadId: string, options?: { fresh?: boolean }): string | null {
    return this.resolveThreadOwner(threadId, options)?.session ?? null;
  }

  resolveThreadPane(threadId: string, options?: { fresh?: boolean }): string | undefined {
    return this.resolveThreadOwner(threadId, options)?.paneId;
  }

  scanPresenceBySession(options?: { fresh?: boolean }): Map<string, PanePresenceInput[]> {
    const snapshot = this.getSnapshot(options);
    return new Map(
      [...snapshot.presenceBySession.entries()].map(([session, paneAgents]) => [
        session,
        paneAgents.map((paneAgent) => ({ ...paneAgent })),
      ]),
    );
  }

  size(now = this.now()): number {
    return this.registry.size(now);
  }

  invalidate(): void {
    this.snapshot = null;
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private getSnapshot(options?: { fresh?: boolean }): PiLiveSnapshot {
    const now = this.now();
    if (!options?.fresh && this.snapshot && now - this.snapshot.builtAt < this.cacheTtlMs) {
      return this.snapshot;
    }

    this.registry.prune(now);

    const panes = this.deps.listPanes();
    const sidebarPaneIds = new Set(this.deps.listSidebarPaneIds());
    const tree = this.deps.buildProcessTree();
    const ownersByThreadId = new Map<string, PiThreadOwner | null>();

    for (const pane of panes) {
      if (sidebarPaneIds.has(pane.paneId)) continue;
      const matches = this.resolveSessionsForPanePid(pane.pid, tree, now);
      for (const match of matches) {
        const owner: PiThreadOwner = {
          threadId: match.sessionId,
          session: pane.session,
          paneId: pane.paneId,
          pid: match.pid,
        };
        const existing = ownersByThreadId.get(match.sessionId);
        if (!existing) {
          ownersByThreadId.set(match.sessionId, owner);
          continue;
        }
        if (
          existing.session !== owner.session
          || existing.paneId !== owner.paneId
          || existing.pid !== owner.pid
        ) {
          ownersByThreadId.set(match.sessionId, null);
        }
      }
    }

    const presenceBySession = new Map<string, PanePresenceInput[]>();
    for (const owner of ownersByThreadId.values()) {
      if (!owner) continue;
      let sessionPresence = presenceBySession.get(owner.session);
      if (!sessionPresence) {
        sessionPresence = [];
        presenceBySession.set(owner.session, sessionPresence);
      }
      sessionPresence.push({
        agent: "pi",
        paneId: owner.paneId,
        threadId: owner.threadId,
      });
    }

    this.snapshot = {
      builtAt: now,
      ownersByThreadId,
      presenceBySession,
    };
    return this.snapshot;
  }

  private resolveSessionsForPanePid(
    panePid: number,
    tree: ProcessTreeSnapshot,
    now: number,
  ): Array<{ pid: number; sessionId: string }> {
    const piPids = collectDescendantPidsFast(panePid, (comm) => isExactCommand(comm, "pi"), tree);
    return this.registry.getSessionIdsForPids(piPids, now);
  }
}
