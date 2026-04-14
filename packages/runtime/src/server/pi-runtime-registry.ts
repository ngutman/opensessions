export interface PiRuntimeInfo {
  pid: number;
  ppid?: number;
  sessionId: string;
  sessionFile?: string;
  cwd: string;
  sessionName?: string;
  ts: number;
}

const DEFAULT_TTL_MS = 20_000;

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isOptionalPositiveInt(value: unknown): value is number | undefined {
  return value === undefined || isPositiveInt(value);
}

export function parsePiRuntimeInfo(value: unknown, now = Date.now()): PiRuntimeInfo | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;

  if (!isPositiveInt(raw.pid)) return null;
  if (!isOptionalPositiveInt(raw.ppid)) return null;
  if (typeof raw.sessionId !== "string" || raw.sessionId.trim() === "") return null;
  if (typeof raw.cwd !== "string" || raw.cwd.trim() === "") return null;
  if (raw.sessionFile !== undefined && typeof raw.sessionFile !== "string") return null;
  if (raw.sessionName !== undefined && typeof raw.sessionName !== "string") return null;

  const ts = typeof raw.ts === "number" && Number.isFinite(raw.ts) ? raw.ts : now;

  return {
    pid: raw.pid,
    ...(raw.ppid !== undefined && { ppid: raw.ppid }),
    sessionId: raw.sessionId,
    ...(typeof raw.sessionFile === "string" && raw.sessionFile !== "" && { sessionFile: raw.sessionFile }),
    cwd: raw.cwd,
    ...(typeof raw.sessionName === "string" && raw.sessionName !== "" && { sessionName: raw.sessionName }),
    ts,
  };
}

export class PiRuntimeRegistry {
  private readonly byPid = new Map<number, PiRuntimeInfo>();

  constructor(private readonly ttlMs: number = DEFAULT_TTL_MS) {}

  upsert(info: PiRuntimeInfo): void {
    this.byPid.set(info.pid, info);
  }

  delete(pid: number): boolean {
    return this.byPid.delete(pid);
  }

  get(pid: number, now = Date.now()): PiRuntimeInfo | null {
    const info = this.byPid.get(pid);
    if (!info) return null;
    if (now - info.ts > this.ttlMs) {
      this.byPid.delete(pid);
      return null;
    }
    return info;
  }

  prune(now = Date.now()): boolean {
    let changed = false;
    for (const [pid, info] of this.byPid) {
      if (now - info.ts <= this.ttlMs) continue;
      this.byPid.delete(pid);
      changed = true;
    }
    return changed;
  }

  getSessionIdsForPids(pids: Iterable<number>, now = Date.now()): Array<{ pid: number; sessionId: string }> {
    const matches: Array<{ pid: number; sessionId: string }> = [];
    const seen = new Set<string>();
    for (const pid of pids) {
      const info = this.get(pid, now);
      if (!info) continue;
      if (seen.has(info.sessionId)) continue;
      seen.add(info.sessionId);
      matches.push({ pid, sessionId: info.sessionId });
    }
    return matches;
  }

  size(now = Date.now()): number {
    this.prune(now);
    return this.byPid.size;
  }
}
