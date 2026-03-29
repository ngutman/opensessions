import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { CodexAgentWatcher, determineStatus } from "../src/agents/watchers/codex";
import type { AgentEvent } from "../src/contracts/agent";
import type { AgentWatcherContext } from "../src/contracts/agent-watcher";

describe("Codex determineStatus", () => {
  test("returns running for user messages", () => {
    expect(determineStatus({ type: "event_msg", payload: { type: "user_message" } })).toBe("running");
  });

  test("returns running for assistant commentary", () => {
    expect(determineStatus({
      type: "response_item",
      payload: { type: "message", role: "assistant", phase: "commentary" },
    })).toBe("running");
  });

  test("returns done for assistant final answers", () => {
    expect(determineStatus({
      type: "response_item",
      payload: { type: "message", role: "assistant", phase: "final_answer" },
    })).toBe("done");
  });

  test("returns done for task_complete events", () => {
    expect(determineStatus({ type: "event_msg", payload: { type: "task_complete" } })).toBe("done");
  });

  test("returns interrupted for aborted turns", () => {
    expect(determineStatus({ type: "event_msg", payload: { type: "turn_aborted" } })).toBe("interrupted");
  });
});

describe("CodexAgentWatcher", () => {
  let tmpDir: string;
  let watcher: CodexAgentWatcher;
  let events: AgentEvent[];
  let ctx: AgentWatcherContext;
  let sessionFile: string;
  const threadId = "019d2e1e-c764-773e-8e63-894331c70b6b";

  beforeEach(() => {
    tmpDir = join(tmpdir(), `codex-watcher-test-${Date.now()}`);
    const sessionsDayDir = join(tmpDir, "sessions", "2026", "03", "27");
    mkdirSync(sessionsDayDir, { recursive: true });

    sessionFile = join(sessionsDayDir, `rollout-2026-03-27T12-00-00-${threadId}.jsonl`);
    writeFileSync(sessionFile,
      JSON.stringify({ type: "turn_context", payload: { cwd: "/projects/myapp" } }) + "\n" +
      JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: "Fix the auth bug" } }) + "\n",
    );

    writeFileSync(join(tmpDir, "session_index.jsonl"),
      JSON.stringify({ id: threadId, thread_name: "Fix auth bug", updated_at: "2026-03-27T12:00:00.000Z" }) + "\n",
    );

    events = [];
    ctx = {
      resolveSession: (dir) => dir === "/projects/myapp" ? "myapp-session" : null,
      emit: (event) => events.push(event),
    };

    watcher = new CodexAgentWatcher();
    (watcher as any).sessionsDir = join(tmpDir, "sessions");
    (watcher as any).sessionIndexFile = join(tmpDir, "session_index.jsonl");
  });

  afterEach(() => {
    watcher.stop();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("seed scan emits events for non-idle sessions", async () => {
    watcher.start(ctx);
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Seed file has running status → should emit
    expect(events).toHaveLength(1);
    expect(events[0]!.agent).toBe("codex");
    expect(events[0]!.status).toBe("running");
  });

  test("emits done when Codex writes a final answer", async () => {
    watcher.start(ctx);
    await new Promise((resolve) => setTimeout(resolve, 200));
    const seedCount = events.length;

    appendFileSync(sessionFile,
      JSON.stringify({
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          phase: "final_answer",
          content: [{ type: "output_text", text: "Implemented the fix." }],
        },
      }) + "\n" +
      JSON.stringify({ type: "event_msg", payload: { type: "task_complete" } }) + "\n",
    );

    await new Promise((resolve) => setTimeout(resolve, 2500));

    const postSeed = events.slice(seedCount);
    expect(postSeed.length).toBeGreaterThanOrEqual(1);
    const last = postSeed[postSeed.length - 1]!;
    expect(last.agent).toBe("codex");
    expect(last.session).toBe("myapp-session");
    expect(last.status).toBe("done");
    expect(last.threadId).toBe(threadId);
    expect(last.threadName).toBe("Fix auth bug");
  });
});
