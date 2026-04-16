import { describe, test, expect } from "bun:test";
import { join } from "path";
import { mkdirSync, rmSync, readFileSync } from "fs";
import type { ClientCommand, ServerState } from "../src/shared";
import { resolveTheme, BUILTIN_THEMES } from "../src/themes";
import { saveConfig, loadConfig } from "../src/config";

describe("set-theme command", () => {
  test("ClientCommand union accepts set-theme type", () => {
    const cmd: ClientCommand = { type: "set-theme", theme: "tokyo-night" };
    expect(cmd.type).toBe("set-theme");
    expect(cmd).toHaveProperty("theme", "tokyo-night");
  });

  test("ServerState includes theme field", () => {
    const state: ServerState = {
      type: "state",
      sessions: [],
      focusedSession: null,
      currentSession: null,
      theme: "dracula",
      agentDisplay: { showContext: true, showThreadName: true },
      ts: Date.now(),
    };
    expect(state.theme).toBe("dracula");
  });

  test("set-theme persists to config and roundtrips", () => {
    const tmpDir = `/tmp/opensessions-test-theme-${Date.now()}`;
    saveConfig({ theme: "nord" }, tmpDir);
    const config = loadConfig(tmpDir);
    expect(config.theme).toBe("nord");
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("set-theme with new theme resolves correctly", () => {
    const theme = resolveTheme("matrix");
    expect(theme.palette.text).toBe("#62ff94"); // matrix green text
  });
});
