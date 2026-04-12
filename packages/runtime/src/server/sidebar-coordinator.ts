import { assign, createActor, setup } from "xstate";

export type SidebarCoordinatorMode = "hidden" | "warming" | "ready" | "resizing";

export interface SidebarCoordinatorState {
  mode: SidebarCoordinatorMode;
  visible: boolean;
  initializing: boolean;
  initLabel: string;
  suppressWidthReportsUntil: number;
}

type SidebarCoordinatorEvent =
  | { type: "BEGIN_WARMUP" }
  | { type: "WARMUP_DONE" }
  | { type: "BEGIN_RESIZE" }
  | { type: "RESIZE_DONE" }
  | { type: "MARK_READY" }
  | { type: "HIDE" }
  | { type: "SUPPRESS_WIDTH_REPORTS"; until: number };

const sidebarCoordinatorMachine = setup({
  types: {
    context: {} as { suppressWidthReportsUntil: number },
    events: {} as SidebarCoordinatorEvent,
  },
}).createMachine({
  id: "sidebarCoordinator",
  initial: "hidden",
  context: {
    suppressWidthReportsUntil: 0,
  },
  on: {
    SUPPRESS_WIDTH_REPORTS: {
      actions: assign({
        suppressWidthReportsUntil: ({ context, event }) =>
          Math.max(context.suppressWidthReportsUntil, event.until),
      }),
    },
  },
  states: {
    hidden: {
      on: {
        BEGIN_WARMUP: "warming",
        BEGIN_RESIZE: "resizing",
        MARK_READY: "ready",
      },
    },
    warming: {
      on: {
        WARMUP_DONE: "ready",
        BEGIN_RESIZE: "resizing",
        MARK_READY: "ready",
        HIDE: "hidden",
      },
    },
    ready: {
      on: {
        BEGIN_WARMUP: "warming",
        BEGIN_RESIZE: "resizing",
        HIDE: "hidden",
      },
    },
    resizing: {
      on: {
        RESIZE_DONE: "ready",
        BEGIN_WARMUP: "warming",
        MARK_READY: "ready",
        HIDE: "hidden",
      },
    },
  },
});

export function createSidebarCoordinator() {
  const actor = createActor(sidebarCoordinatorMachine);
  actor.start();
  return actor;
}

export function readSidebarCoordinatorState(
  snapshot: ReturnType<ReturnType<typeof createSidebarCoordinator>["getSnapshot"]>,
): SidebarCoordinatorState {
  const mode = snapshot.value as SidebarCoordinatorMode;
  const initializing = mode === "warming" || mode === "resizing";

  return {
    mode,
    visible: mode !== "hidden",
    initializing,
    initLabel: mode === "warming" ? "warming up…" : mode === "resizing" ? "adjusting…" : "",
    suppressWidthReportsUntil: snapshot.context.suppressWidthReportsUntil,
  };
}

export function areWidthReportsSuppressed(
  state: Pick<SidebarCoordinatorState, "suppressWidthReportsUntil">,
  now = Date.now(),
): boolean {
  return state.suppressWidthReportsUntil > now;
}

export function canStartTransientResize(
  state: Pick<SidebarCoordinatorState, "visible" | "mode">,
  hasActiveTransientTimer: boolean,
): boolean {
  if (!state.visible) return false;
  if (state.mode === "ready") return true;
  return state.mode === "resizing" && hasActiveTransientTimer;
}
