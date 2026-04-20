import { describe, expect, test } from "bun:test";
import type { AgentEvent } from "../src/contracts/agent";
import {
  filterSessionAgentsForDisplay,
  getDisplayedAgentState,
  isSessionUnseenFromDisplayedAgents,
} from "../src/server/index";

function agent(overrides: Partial<AgentEvent> = {}): AgentEvent {
  return {
    agent: "pi",
    session: "sess-1",
    status: "running",
    ts: 1,
    ...overrides,
  };
}

describe("Pi display filtering", () => {
  test("suppresses project-dir Pi rows when live-owner Pi rows exist", () => {
    const displayed = filterSessionAgentsForDisplay([
      agent({ threadId: "fallback", ts: 30, unseen: true, sessionResolution: "project-dir" }),
      agent({ threadId: "live", ts: 20, sessionResolution: "live-owner", paneId: "%4", liveness: "alive" }),
      agent({ agent: "codex", threadId: "codex-1", ts: 10, unseen: false }),
    ]);

    expect(displayed.map((entry) => `${entry.agent}:${entry.threadId}`)).toEqual([
      "pi:live",
      "codex:codex-1",
    ]);
    expect(getDisplayedAgentState(displayed)?.threadId).toBe("live");
    expect(isSessionUnseenFromDisplayedAgents(displayed)).toBe(false);
  });

  test("keeps only the newest project-dir Pi row when no live-owner row exists", () => {
    const displayed = filterSessionAgentsForDisplay([
      agent({ threadId: "older", ts: 10, sessionResolution: "project-dir" }),
      agent({ threadId: "newer", ts: 20, sessionResolution: "project-dir", unseen: true }),
      agent({ agent: "claude-code", threadId: "claude-1", ts: 15 }),
    ]);

    expect(displayed.map((entry) => `${entry.agent}:${entry.threadId}`)).toEqual([
      "pi:newer",
      "claude-code:claude-1",
    ]);
    expect(getDisplayedAgentState(displayed)?.threadId).toBe("newer");
    expect(isSessionUnseenFromDisplayedAgents(displayed)).toBe(true);
  });

  test("keeps unclassified Pi rows while filtering cwd-fallback duplicates", () => {
    const displayed = filterSessionAgentsForDisplay([
      agent({ threadId: "fallback", ts: 10, sessionResolution: "project-dir" }),
      agent({ threadId: "synthetic-live", ts: 9, paneId: "%9", liveness: "alive" }),
    ]);

    expect(displayed.map((entry) => `${entry.agent}:${entry.threadId}`)).toEqual([
      "pi:fallback",
      "pi:synthetic-live",
    ]);
  });
});
