import { describe, test, expect } from "bun:test";
import { PiRuntimeRegistry, parsePiRuntimeInfo } from "../src/server/pi-runtime-registry";

describe("parsePiRuntimeInfo", () => {
  test("parses a valid payload", () => {
    const info = parsePiRuntimeInfo({
      pid: 123,
      ppid: 45,
      sessionId: "sess-123",
      sessionFile: "/tmp/session.jsonl",
      cwd: "/tmp/project",
      sessionName: "demo",
      ts: 1000,
    });

    expect(info).toEqual({
      pid: 123,
      ppid: 45,
      sessionId: "sess-123",
      sessionFile: "/tmp/session.jsonl",
      cwd: "/tmp/project",
      sessionName: "demo",
      ts: 1000,
    });
  });

  test("rejects invalid payloads", () => {
    expect(parsePiRuntimeInfo(null)).toBeNull();
    expect(parsePiRuntimeInfo({ pid: 0, sessionId: "x", cwd: "/tmp" })).toBeNull();
    expect(parsePiRuntimeInfo({ pid: 1, sessionId: "", cwd: "/tmp" })).toBeNull();
    expect(parsePiRuntimeInfo({ pid: 1, sessionId: "x", cwd: 42 })).toBeNull();
    expect(parsePiRuntimeInfo({ pid: 1, sessionId: "x", cwd: "/tmp", sessionName: 42 })).toBeNull();
  });
});

describe("PiRuntimeRegistry", () => {
  test("stores and returns live entries", () => {
    const registry = new PiRuntimeRegistry(10_000);
    registry.upsert({ pid: 123, sessionId: "sess-123", cwd: "/tmp/project", ts: 1000 });

    expect(registry.get(123, 1500)?.sessionId).toBe("sess-123");
    expect(registry.size(1500)).toBe(1);
  });

  test("expires stale entries on read", () => {
    const registry = new PiRuntimeRegistry(1000);
    registry.upsert({ pid: 123, sessionId: "sess-123", cwd: "/tmp/project", ts: 1000 });

    expect(registry.get(123, 2501)).toBeNull();
    expect(registry.size(2501)).toBe(0);
  });

  test("dedupes session ids when resolving pid matches", () => {
    const registry = new PiRuntimeRegistry(10_000);
    registry.upsert({ pid: 123, sessionId: "sess-a", cwd: "/tmp/a", ts: 1000 });
    registry.upsert({ pid: 124, sessionId: "sess-a", cwd: "/tmp/a", ts: 1000 });
    registry.upsert({ pid: 125, sessionId: "sess-b", cwd: "/tmp/b", ts: 1000 });

    expect(registry.getSessionIdsForPids([123, 124, 125], 1500)).toEqual([
      { pid: 123, sessionId: "sess-a" },
      { pid: 125, sessionId: "sess-b" },
    ]);
  });

  test("deletes entries explicitly", () => {
    const registry = new PiRuntimeRegistry(10_000);
    registry.upsert({ pid: 123, sessionId: "sess-123", cwd: "/tmp/project", ts: 1000 });

    expect(registry.delete(123)).toBe(true);
    expect(registry.get(123, 1000)).toBeNull();
  });
});
