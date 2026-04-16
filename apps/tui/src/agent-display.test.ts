import { describe, expect, test } from "bun:test";

import { resolveAgentDisplayConfig } from "@opensessions/runtime";
import { compactDirPath, formatAgentContext } from "./agent-display";

describe("agent display helpers", () => {
  test("compacts paths under the home directory", () => {
    expect(compactDirPath("/Users/guti/projects/opensessions", "/Users/guti")).toBe("~/projects/opensessions");
  });

  test("formats cwd and branch together", () => {
    expect(
      formatAgentContext(
        { cwd: "/Users/guti/projects/opensessions", branch: "main" },
        { dir: "/Users/guti/projects/opensessions", branch: "main" },
        resolveAgentDisplayConfig(),
        "/Users/guti",
      ),
    ).toBe("~/projects/opensessions (main)");
  });

  test("formats cwd without branch", () => {
    expect(
      formatAgentContext(
        { cwd: "/tmp/project", branch: "" },
        { dir: "/Users/guti/projects/opensessions", branch: "main" },
        resolveAgentDisplayConfig(),
        "/Users/guti",
      ),
    ).toBe("/tmp/project");
  });

  test("formats branch without cwd", () => {
    expect(
      formatAgentContext(
        { cwd: "", branch: "feat/sidebar" },
        { dir: "/Users/guti/projects/opensessions", branch: "main" },
        resolveAgentDisplayConfig(),
        "/Users/guti",
      ),
    ).toBe("feat/sidebar");
  });

  test("hides context when disabled", () => {
    expect(
      formatAgentContext(
        { cwd: "/tmp/project", branch: "main" },
        { dir: "/Users/guti/projects/opensessions", branch: "main" },
        resolveAgentDisplayConfig({ showContext: false }),
        "/Users/guti",
      ),
    ).toBe("");
  });

  test("does not fall back to the session branch when agent cwd is outside the repo", () => {
    expect(
      formatAgentContext(
        { cwd: "/Users/guti/projects", branch: "" },
        { dir: "/Users/guti/projects/opensessions", branch: "feat/agent-display-context" },
        resolveAgentDisplayConfig(),
        "/Users/guti",
      ),
    ).toBe("~/projects");
  });
});
