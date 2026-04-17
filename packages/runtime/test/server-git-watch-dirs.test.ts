import { describe, expect, test } from "bun:test";
import type { AgentEvent } from "../src/contracts/agent";
import { collectGitWatchDirs } from "../src/server/index";
import type { SessionData } from "../src/shared";

function agent(overrides: Partial<AgentEvent> = {}): AgentEvent {
  return {
    agent: "pi",
    session: "sess-1",
    status: "running",
    ts: 1,
    ...overrides,
  };
}

function session(overrides: Partial<SessionData> = {}): SessionData {
  return {
    name: "sess-1",
    createdAt: 1,
    dir: "/workspace/session-root",
    branch: "main",
    dirty: false,
    isWorktree: false,
    unseen: false,
    panes: 1,
    ports: [],
    localLinks: [],
    windows: 1,
    uptime: "1m",
    agentState: null,
    agents: [],
    eventTimestamps: [],
    ...overrides,
  };
}

describe("collectGitWatchDirs", () => {
  test("includes agent cwd when it differs from the session directory", () => {
    const dirs = collectGitWatchDirs([
      session({
        agents: [
          agent({ cwd: "/workspace/session-root/nested-repo" }),
          agent({ cwd: "/workspace/worktrees/feature", threadId: "thread-2" }),
        ],
      }),
    ]);

    expect([...dirs].sort()).toEqual([
      "/workspace/session-root",
      "/workspace/session-root/nested-repo",
      "/workspace/worktrees/feature",
    ]);
  });

  test("dedupes repeated session and agent git directories", () => {
    const dirs = collectGitWatchDirs([
      session({
        agentState: agent({ cwd: "/workspace/session-root" }),
        agents: [
          agent({ cwd: "/workspace/session-root" }),
          agent({ cwd: "/workspace/worktrees/feature", threadId: "thread-2" }),
          agent({ cwd: "/workspace/worktrees/feature", threadId: "thread-3" }),
        ],
      }),
    ]);

    expect([...dirs].sort()).toEqual([
      "/workspace/session-root",
      "/workspace/worktrees/feature",
    ]);
  });
});
