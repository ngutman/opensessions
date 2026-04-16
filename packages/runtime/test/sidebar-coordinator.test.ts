import { describe, expect, test } from "bun:test";
import {
  applySidebarWidthReport,
  areWidthReportsSuppressed,
  createSidebarCoordinator,
  isClientResizeReportGuardActive,
  isClientResizeSyncActive,
  isUserDragActive,
  readSidebarCoordinatorState,
} from "../src/server/sidebar-coordinator";

describe("sidebar coordinator", () => {
  test("starts hidden and idle", () => {
    const actor = createSidebarCoordinator({ width: 26 });
    const state = readSidebarCoordinatorState(actor.getSnapshot());

    expect(state.mode).toBe("hidden");
    expect(state.visible).toBe(false);
    expect(state.initializing).toBe(false);
    expect(state.initLabel).toBe("");
    expect(state.width).toBe(26);
    expect(state.lifecycle).toBe("idle");
    expect(state.resizeAuthority).toBe("none");

    actor.stop();
  });

  test("tracks warmup and ready lifecycle", () => {
    const actor = createSidebarCoordinator({ width: 26 });

    actor.send({ type: "BEGIN_WARMUP" });
    let state = readSidebarCoordinatorState(actor.getSnapshot());
    expect(state.mode).toBe("warming");
    expect(state.visible).toBe(true);
    expect(state.initializing).toBe(true);
    expect(state.initLabel).toBe("warming up…");
    expect(state.lifecycle).toBe("warming");

    actor.send({ type: "WARMUP_DONE" });
    state = readSidebarCoordinatorState(actor.getSnapshot());
    expect(state.mode).toBe("ready");
    expect(state.visible).toBe(true);
    expect(state.initializing).toBe(false);
    expect(state.initLabel).toBe("");
    expect(state.lifecycle).toBe("ready");

    actor.stop();
  });

  test("tracks client resize sync without losing visibility", () => {
    const actor = createSidebarCoordinator({ width: 26 });

    actor.send({ type: "MARK_READY" });
    actor.send({ type: "BEGIN_CLIENT_RESIZE_SYNC", suppressUntil: 500, guardUntil: 700 });
    let state = readSidebarCoordinatorState(actor.getSnapshot());
    expect(state.mode).toBe("resizing");
    expect(state.visible).toBe(true);
    expect(state.initializing).toBe(true);
    expect(state.initLabel).toBe("adjusting…");
    expect(state.resizeAuthority).toBe("client-resize-sync");
    expect(isClientResizeSyncActive(state)).toBe(true);
    expect(areWidthReportsSuppressed(state, 499)).toBe(true);
    expect(isClientResizeReportGuardActive(state, 699)).toBe(true);

    actor.send({ type: "FINISH_CLIENT_RESIZE_SYNC" });
    state = readSidebarCoordinatorState(actor.getSnapshot());
    expect(state.mode).toBe("ready");
    expect(state.visible).toBe(true);
    expect(state.initializing).toBe(false);
    expect(state.resizeAuthority).toBe("none");

    actor.stop();
  });

  test("tracks programmatic cross-window adjustment separately from warmup and drag", () => {
    const actor = createSidebarCoordinator({ width: 26 });

    actor.send({ type: "MARK_READY" });
    actor.send({ type: "BEGIN_PROGRAMMATIC_ADJUSTMENT" });

    let state = readSidebarCoordinatorState(actor.getSnapshot());
    expect(state.mode).toBe("resizing");
    expect(state.initLabel).toBe("adjusting…");
    expect(state.resizeAuthority).toBe("programmatic-adjust");

    actor.send({ type: "FINISH_PROGRAMMATIC_ADJUSTMENT" });
    state = readSidebarCoordinatorState(actor.getSnapshot());
    expect(state.mode).toBe("ready");
    expect(state.resizeAuthority).toBe("none");

    actor.stop();
  });

  test("prioritizes adjusting over warming when global resize sync overlaps warmup", () => {
    const actor = createSidebarCoordinator({ width: 26 });

    actor.send({ type: "BEGIN_WARMUP" });
    actor.send({ type: "BEGIN_CLIENT_RESIZE_SYNC", suppressUntil: 500, guardUntil: 700 });

    let state = readSidebarCoordinatorState(actor.getSnapshot());
    expect(state.mode).toBe("resizing");
    expect(state.initLabel).toBe("adjusting…");
    expect(state.lifecycle).toBe("warming");
    expect(state.resizeAuthority).toBe("client-resize-sync");

    actor.send({ type: "FINISH_CLIENT_RESIZE_SYNC" });
    state = readSidebarCoordinatorState(actor.getSnapshot());
    expect(state.mode).toBe("warming");
    expect(state.initLabel).toBe("warming up…");

    actor.stop();
  });

  test("hide resets lifecycle state", () => {
    const actor = createSidebarCoordinator({ width: 26 });

    actor.send({ type: "BEGIN_WARMUP" });
    actor.send({ type: "HIDE" });

    const state = readSidebarCoordinatorState(actor.getSnapshot());
    expect(state.mode).toBe("hidden");
    expect(state.visible).toBe(false);
    expect(state.initializing).toBe(false);
    expect(state.initLabel).toBe("");
    expect(state.lifecycle).toBe("idle");
    expect(state.resizeAuthority).toBe("none");

    actor.stop();
  });

  test("suppression windows extend but do not shorten", () => {
    const actor = createSidebarCoordinator({ width: 26 });

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

  test("accepts an active foreground width report and enters user-drag authority", () => {
    const actor = createSidebarCoordinator({ width: 26 });
    actor.send({ type: "MARK_READY" });

    const decision = applySidebarWidthReport(actor, {
      width: 30,
      session: "alpha",
      windowId: "@1",
      isActiveSession: true,
      isForegroundClient: true,
      isCurrentWindow: true,
      now: 100,
    });

    const state = readSidebarCoordinatorState(actor.getSnapshot());
    expect(decision.accepted).toBe(true);
    expect(decision.reason).toBe("accepted");
    expect(decision.previousWidth).toBe(26);
    expect(decision.nextWidth).toBe(30);
    expect(state.width).toBe(30);
    expect(state.mode).toBe("resizing");
    expect(state.resizeAuthority).toBe("user-drag");
    expect(isUserDragActive(state)).toBe(true);

    actor.stop();
  });

  test("suppressed width reports only continue the current drag owner", () => {
    const actor = createSidebarCoordinator({ width: 26 });
    actor.send({ type: "MARK_READY" });

    const first = applySidebarWidthReport(actor, {
      width: 30,
      session: "alpha",
      windowId: "@1",
      isActiveSession: true,
      isForegroundClient: true,
      isCurrentWindow: true,
      now: 100,
    });
    const continued = applySidebarWidthReport(actor, {
      width: 32,
      session: "alpha",
      windowId: "@1",
      isActiveSession: true,
      isForegroundClient: true,
      isCurrentWindow: true,
      now: 200,
    });
    const rejected = applySidebarWidthReport(actor, {
      width: 34,
      session: "alpha",
      windowId: "@2",
      isActiveSession: true,
      isForegroundClient: true,
      isCurrentWindow: true,
      now: 250,
    });

    const state = readSidebarCoordinatorState(actor.getSnapshot());
    expect(first.accepted).toBe(true);
    expect(continued.accepted).toBe(true);
    expect(continued.continuedDrag).toBe(true);
    expect(rejected.accepted).toBe(false);
    expect(rejected.reason).toBe("suppressed");
    expect(state.width).toBe(32);

    actor.stop();
  });

  test("rejects width reports during warmup and client-resize guard windows", () => {
    const actor = createSidebarCoordinator({ width: 26 });

    actor.send({ type: "BEGIN_WARMUP" });
    const warmupDecision = applySidebarWidthReport(actor, {
      width: 30,
      session: "alpha",
      windowId: "@1",
      isActiveSession: true,
      isForegroundClient: true,
      isCurrentWindow: true,
      now: 100,
    });

    actor.send({ type: "MARK_READY" });
    actor.send({ type: "NOTE_CLIENT_RESIZE_GUARD", until: 400 });
    const guardedDecision = applySidebarWidthReport(actor, {
      width: 31,
      session: "alpha",
      windowId: "@1",
      isActiveSession: true,
      isForegroundClient: true,
      isCurrentWindow: true,
      now: 300,
    });

    expect(warmupDecision.accepted).toBe(false);
    expect(warmupDecision.reason).toBe("warming");
    expect(guardedDecision.accepted).toBe(false);
    expect(guardedDecision.reason).toBe("client-resize-guard");

    actor.stop();
  });

  test("focus context changes do not cut off the current drag tail", () => {
    const actor = createSidebarCoordinator({ width: 26 });
    actor.send({ type: "MARK_READY" });
    applySidebarWidthReport(actor, {
      width: 30,
      session: "alpha",
      windowId: "@1",
      isActiveSession: true,
      isForegroundClient: true,
      isCurrentWindow: true,
      now: 100,
    });

    actor.send({ type: "FOCUS_CONTEXT_CHANGED" });
    actor.send({ type: "SUPPRESS_WIDTH_REPORTS", until: 400 });

    const continued = applySidebarWidthReport(actor, {
      width: 32,
      session: "alpha",
      windowId: "@1",
      isActiveSession: false,
      isForegroundClient: false,
      isCurrentWindow: false,
      now: 200,
    });
    const foreign = applySidebarWidthReport(actor, {
      width: 34,
      session: "alpha",
      windowId: "@2",
      isActiveSession: true,
      isForegroundClient: true,
      isCurrentWindow: true,
      now: 250,
    });

    const state = readSidebarCoordinatorState(actor.getSnapshot());
    expect(continued.accepted).toBe(true);
    expect(continued.continuedDrag).toBe(true);
    expect(foreign.accepted).toBe(false);
    expect(foreign.reason).toBe("suppressed");
    expect(state.resizeAuthority).toBe("user-drag");
    expect(state.width).toBe(32);

    actor.stop();
  });
});
