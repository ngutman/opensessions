import { describe, expect, test } from "bun:test";
import { AgentTracker } from "../src/agents/tracker";
import { canonicalizeAgentEvent } from "../src/server/agent-ownership";
import type { ProcessTreeSnapshot } from "../src/server/pi-live-resolver";
import { PiLiveResolver } from "../src/server/pi-live-resolver";
import { PiRuntimeRegistry } from "../src/server/pi-runtime-registry";

function buildProcessTree(rows: Array<{ pid: number; ppid: number; comm: string }>): ProcessTreeSnapshot {
  const childrenOf = new Map<number, number[]>();
  const commOf = new Map<number, string>();

  for (const row of rows) {
    commOf.set(row.pid, row.comm.toLowerCase());
    const children = childrenOf.get(row.ppid) ?? [];
    children.push(row.pid);
    childrenOf.set(row.ppid, children);
  }

  return { childrenOf, commOf };
}

describe("PiLiveResolver", () => {
  test("resolves unambiguous live thread ownership and pane presence", () => {
    const registry = new PiRuntimeRegistry(10_000);
    const resolver = new PiLiveResolver({
      listPanes: () => [{ session: "CodexBar", paneId: "%4", pid: 100 }],
      listSidebarPaneIds: () => [],
      buildProcessTree: () => buildProcessTree([
        { pid: 201, ppid: 100, comm: "pi" },
      ]),
      now: () => 1000,
    }, registry, 10_000);

    resolver.upsert({ pid: 201, sessionId: "thread-1", cwd: "/tmp/project", ts: 1000 });

    expect(resolver.resolveThreadOwner("thread-1")).toEqual({
      threadId: "thread-1",
      session: "CodexBar",
      paneId: "%4",
      pid: 201,
    });
    expect([...resolver.scanPresenceBySession().entries()]).toEqual([
      ["CodexBar", [{ agent: "pi", paneId: "%4", threadId: "thread-1" }]],
    ]);
  });

  test("treats the same thread appearing in multiple panes as ambiguous", () => {
    const registry = new PiRuntimeRegistry(10_000);
    const resolver = new PiLiveResolver({
      listPanes: () => [
        { session: "opensessions", paneId: "%4", pid: 100 },
        { session: "CodexBar", paneId: "%7", pid: 300 },
      ],
      listSidebarPaneIds: () => [],
      buildProcessTree: () => buildProcessTree([
        { pid: 201, ppid: 100, comm: "pi" },
        { pid: 202, ppid: 300, comm: "pi" },
      ]),
      now: () => 1000,
    }, registry, 10_000);

    resolver.upsert({ pid: 201, sessionId: "thread-1", cwd: "/tmp/a", ts: 1000 });
    resolver.upsert({ pid: 202, sessionId: "thread-1", cwd: "/tmp/b", ts: 1000 });

    expect(resolver.resolveThreadOwner("thread-1")).toBeNull();
    expect([...resolver.scanPresenceBySession().entries()]).toEqual([]);
  });

  test("keeps ambiguous thread ownership sticky within a snapshot", () => {
    const registry = new PiRuntimeRegistry(10_000);
    const resolver = new PiLiveResolver({
      listPanes: () => [
        { session: "opensessions", paneId: "%4", pid: 100 },
        { session: "CodexBar", paneId: "%7", pid: 300 },
        { session: "opensessions", paneId: "%9", pid: 500 },
      ],
      listSidebarPaneIds: () => [],
      buildProcessTree: () => buildProcessTree([
        { pid: 201, ppid: 100, comm: "pi" },
        { pid: 202, ppid: 300, comm: "pi" },
        { pid: 203, ppid: 500, comm: "pi" },
      ]),
      now: () => 1000,
    }, registry, 10_000);

    resolver.upsert({ pid: 201, sessionId: "thread-1", cwd: "/tmp/a", ts: 1000 });
    resolver.upsert({ pid: 202, sessionId: "thread-1", cwd: "/tmp/b", ts: 1000 });
    resolver.upsert({ pid: 203, sessionId: "thread-1", cwd: "/tmp/c", ts: 1000 });

    expect(resolver.resolveThreadOwner("thread-1")).toBeNull();
    expect([...resolver.scanPresenceBySession().entries()]).toEqual([]);
  });

  test("canonicalizes cwd-mismatched Pi events to the live pane owner and dedupes tracker state", () => {
    const registry = new PiRuntimeRegistry(10_000);
    const resolver = new PiLiveResolver({
      listPanes: () => [{ session: "CodexBar", paneId: "%4", pid: 100 }],
      listSidebarPaneIds: () => [],
      buildProcessTree: () => buildProcessTree([
        { pid: 201, ppid: 100, comm: "pi" },
      ]),
      now: () => 1000,
    }, registry, 10_000);
    resolver.upsert({ pid: 201, sessionId: "thread-1", cwd: "/Users/guti/projects/opensessions", ts: 1000 });

    const tracker = new AgentTracker();
    tracker.applyEvent({
      agent: "pi",
      session: "opensessions",
      status: "running",
      ts: 900,
      threadId: "thread-1",
    });

    const canonical = canonicalizeAgentEvent(
      {
        agent: "pi",
        session: "opensessions",
        status: "running",
        ts: 1000,
        threadId: "thread-1",
        sessionResolution: "project-dir",
      },
      (agent, threadId) => {
        if (agent !== "pi" || !threadId) return null;
        const owner = resolver.resolveThreadOwner(threadId);
        return owner ? { session: owner.session, paneId: owner.paneId } : null;
      },
    );

    tracker.dedupeInstanceToSession(canonical.session, canonical.agent, canonical.threadId);
    tracker.applyEvent(canonical);

    expect(tracker.getAgents("opensessions")).toHaveLength(0);
    expect(tracker.getAgents("CodexBar")).toHaveLength(1);
    expect(tracker.getAgents("CodexBar")[0]).toMatchObject({
      agent: "pi",
      session: "CodexBar",
      threadId: "thread-1",
      paneId: "%4",
      sessionResolution: "live-owner",
    });
  });
});
