import { describe, expect, test } from "bun:test";

import { matchesAgentProcess } from "../src/server/agent-process-match";

describe("agent process matching", () => {
  test("matches pi only for the exact binary name", () => {
    expect(matchesAgentProcess("pi", "pi")).toBe(true);
    expect(matchesAgentProcess("pi", "/usr/local/bin/pi")).toBe(true);
    expect(matchesAgentProcess("pi", "pip")).toBe(false);
    expect(matchesAgentProcess("pi", "/usr/bin/pip")).toBe(false);
    expect(matchesAgentProcess("pi", "ping")).toBe(false);
    expect(matchesAgentProcess("pi", "/usr/bin/ping")).toBe(false);
  });
});
