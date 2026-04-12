import { describe, expect, test } from "bun:test";

import { resolveSyncedFocus } from "./focus-sync";

describe("resolveSyncedFocus", () => {
  test("keeps a background sidebar pinned to its own session", () => {
    expect(resolveSyncedFocus("alpha", "alpha", "beta")).toBe("beta");
  });

  test("uses the shared focus once the sidebar is current", () => {
    expect(resolveSyncedFocus("beta", "beta", "beta")).toBe("beta");
  });

  test("falls back to the local session when focus is missing", () => {
    expect(resolveSyncedFocus(null, null, "beta")).toBe("beta");
  });
});
