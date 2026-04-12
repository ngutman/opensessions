import { describe, expect, test } from "bun:test";
import {
  areWidthReportsSuppressed,
  canStartTransientResize,
  createSidebarCoordinator,
  readSidebarCoordinatorState,
} from "../src/server/sidebar-coordinator";

describe("sidebar coordinator", () => {
  test("starts hidden and idle", () => {
    const actor = createSidebarCoordinator();
    const state = readSidebarCoordinatorState(actor.getSnapshot());

    expect(state.mode).toBe("hidden");
    expect(state.visible).toBe(false);
    expect(state.initializing).toBe(false);
    expect(state.initLabel).toBe("");

    actor.stop();
  });

  test("tracks warmup and ready lifecycle", () => {
    const actor = createSidebarCoordinator();

    actor.send({ type: "BEGIN_WARMUP" });
    let state = readSidebarCoordinatorState(actor.getSnapshot());
    expect(state.mode).toBe("warming");
    expect(state.visible).toBe(true);
    expect(state.initializing).toBe(true);
    expect(state.initLabel).toBe("warming up…");

    actor.send({ type: "WARMUP_DONE" });
    state = readSidebarCoordinatorState(actor.getSnapshot());
    expect(state.mode).toBe("ready");
    expect(state.visible).toBe(true);
    expect(state.initializing).toBe(false);
    expect(state.initLabel).toBe("");

    actor.stop();
  });

  test("tracks resize lifecycle without losing visibility", () => {
    const actor = createSidebarCoordinator();

    actor.send({ type: "MARK_READY" });
    actor.send({ type: "BEGIN_RESIZE" });
    let state = readSidebarCoordinatorState(actor.getSnapshot());
    expect(state.mode).toBe("resizing");
    expect(state.visible).toBe(true);
    expect(state.initializing).toBe(true);
    expect(state.initLabel).toBe("adjusting…");

    actor.send({ type: "RESIZE_DONE" });
    state = readSidebarCoordinatorState(actor.getSnapshot());
    expect(state.mode).toBe("ready");
    expect(state.visible).toBe(true);
    expect(state.initializing).toBe(false);

    actor.stop();
  });

  test("hide resets lifecycle state", () => {
    const actor = createSidebarCoordinator();

    actor.send({ type: "BEGIN_WARMUP" });
    actor.send({ type: "HIDE" });

    const state = readSidebarCoordinatorState(actor.getSnapshot());
    expect(state.mode).toBe("hidden");
    expect(state.visible).toBe(false);
    expect(state.initializing).toBe(false);
    expect(state.initLabel).toBe("");

    actor.stop();
  });

  test("suppression windows extend but do not shorten", () => {
    const actor = createSidebarCoordinator();

    actor.send({ type: "SUPPRESS_WIDTH_REPORTS", until: 500 });
    actor.send({ type: "SUPPRESS_WIDTH_REPORTS", until: 300 });
    let state = readSidebarCoordinatorState(actor.getSnapshot());
    expect(state.suppressWidthReportsUntil).toBe(500);
    expect(areWidthReportsSuppressed(state, 499)).toBe(true);
    expect(areWidthReportsSuppressed(state, 500)).toBe(false);

    actor.send({ type: "SUPPRESS_WIDTH_REPORTS", until: 900 });
    state = readSidebarCoordinatorState(actor.getSnapshot());
    expect(state.suppressWidthReportsUntil).toBe(900);
    expect(areWidthReportsSuppressed(state, 899)).toBe(true);

    actor.stop();
  });

  test("transient resize can start from ready and extend while already resizing", () => {
    expect(canStartTransientResize({ visible: true, mode: "ready" }, false)).toBe(true);
    expect(canStartTransientResize({ visible: true, mode: "resizing" }, true)).toBe(true);
  });

  test("transient resize does not start when hidden or in non-ready lifecycle states", () => {
    expect(canStartTransientResize({ visible: false, mode: "ready" }, false)).toBe(false);
    expect(canStartTransientResize({ visible: true, mode: "warming" }, false)).toBe(false);
    expect(canStartTransientResize({ visible: true, mode: "resizing" }, false)).toBe(false);
    expect(canStartTransientResize({ visible: true, mode: "hidden" }, false)).toBe(false);
  });
});
