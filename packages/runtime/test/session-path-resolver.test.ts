import { describe, expect, test } from "bun:test";

import { dedupeSessionPathCandidates, resolveSessionFromCandidates } from "../src/server/session-path-resolver";

describe("session path resolver", () => {
  test("prefers exact matches over broad parents", () => {
    expect(resolveSessionFromCandidates(
      "/Users/guti/workspace/extract/repos/extract-2",
      [
        { session: "guti", path: "/Users/guti" },
        { session: "extract-3", path: "/Users/guti/workspace/extract/repos/extract-2" },
      ],
    )).toBe("extract-3");
  });

  test("uses the most specific unique ancestor match", () => {
    expect(resolveSessionFromCandidates(
      "/Users/guti/projects/opensessions/apps/tui",
      [
        { session: "guti", path: "/Users/guti" },
        { session: "opensessions", path: "/Users/guti/projects/opensessions" },
      ],
    )).toBe("opensessions");
  });

  test("uses pane descendants to resolve multi-repo sessions", () => {
    expect(resolveSessionFromCandidates(
      "/Users/guti/workspace/extract/repos",
      [
        { session: "guti", path: "/Users/guti" },
        { session: "extract-3", path: "/Users/guti/workspace/extract/repos/extract-1" },
        { session: "extract-3", path: "/Users/guti/workspace/extract/repos/extract-2" },
      ],
    )).toBe("extract-3");
  });

  test("returns null for ambiguous ties across sessions", () => {
    expect(resolveSessionFromCandidates(
      "/Users/guti/projects",
      [
        { session: "opensessions", path: "/Users/guti/projects/opensessions" },
        { session: "openclaw", path: "/Users/guti/projects/openclaw" },
      ],
    )).toBeNull();
  });

  test("keeps searching after an early tie when a later candidate is more specific", () => {
    expect(resolveSessionFromCandidates(
      "/Users/guti/workspace/extract/repos/extract-2",
      [
        { session: "sess-a", path: "/Users/guti/projects/foo" },
        { session: "sess-b", path: "/Users/guti/projects/bar" },
        { session: "extract-3", path: "/Users/guti/workspace/extract/repos/extract-2" },
      ],
    )).toBe("extract-3");
  });

  test("supports encoded path resolution", () => {
    expect(resolveSessionFromCandidates(
      "__encoded__:-Users-guti-projects-opensessions",
      [
        { session: "opensessions", path: "/Users/guti/projects/opensessions" },
      ],
    )).toBe("opensessions");
  });

  test("dedupes candidates by session and normalized path", () => {
    expect(dedupeSessionPathCandidates([
      { session: "opensessions", path: "/Users/guti/projects/opensessions/" },
      { session: "opensessions", path: "/Users/guti/projects/opensessions" },
      { session: "guti", path: "/Users/guti" },
    ])).toEqual([
      { session: "opensessions", path: "/Users/guti/projects/opensessions" },
      { session: "guti", path: "/Users/guti" },
    ]);
  });
});
