import { assign, createActor, setup } from "xstate";

export type SidebarCoordinatorMode = "hidden" | "warming" | "ready" | "resizing";
export type SidebarCoordinatorLifecycle = "idle" | "warming" | "ready";
export type SidebarResizeAuthority = "none" | "user-drag" | "client-resize-sync" | "programmatic-adjust";

export type SidebarWidthReportDecisionReason =
  | "accepted"
  | "hidden"
  | "warming"
  | "inactive-session"
  | "background-sidebar"
  | "client-resize-guard"
  | "client-resize-sync"
  | "suppressed"
  | "same-width";

export interface SidebarWidthReportDecision {
  accepted: boolean;
  reason: SidebarWidthReportDecisionReason;
  previousWidth: number;
  nextWidth: number;
  continuedDrag: boolean;
}

export interface SidebarCoordinatorState {
  mode: SidebarCoordinatorMode;
  visible: boolean;
  initializing: boolean;
  initLabel: string;
  width: number;
  lifecycle: SidebarCoordinatorLifecycle;
  resizeAuthority: SidebarResizeAuthority;
  suppressWidthReportsUntil: number;
  clientResizeReportGuardUntil: number;
  lastWidthReportDecision: SidebarWidthReportDecision | null;
}

interface SidebarCoordinatorContext {
  width: number;
  visibility: "hidden" | "visible";
  lifecycle: SidebarCoordinatorLifecycle;
  authority: SidebarResizeAuthority;
  suppressWidthReportsUntil: number;
  clientResizeReportGuardUntil: number;
  dragOwnerSession: string | null;
  dragOwnerWindowId: string | null;
  lastWidthReportDecision: SidebarWidthReportDecision | null;
}

type SidebarCoordinatorEvent =
  | { type: "BEGIN_WARMUP" }
  | { type: "WARMUP_DONE" }
  | { type: "BEGIN_CLIENT_RESIZE_SYNC"; suppressUntil: number; guardUntil: number }
  | { type: "FINISH_CLIENT_RESIZE_SYNC" }
  | { type: "BEGIN_PROGRAMMATIC_ADJUSTMENT" }
  | { type: "FINISH_PROGRAMMATIC_ADJUSTMENT" }
  | { type: "FINISH_USER_DRAG" }
  | { type: "MARK_READY" }
  | { type: "HIDE" }
  | { type: "FOCUS_CONTEXT_CHANGED" }
  | { type: "SUPPRESS_WIDTH_REPORTS"; until: number }
  | { type: "NOTE_CLIENT_RESIZE_GUARD"; until: number }
  | {
      type: "WIDTH_REPORTED";
      now: number;
      width: number;
      session: string | null;
      windowId: string | null;
      isActiveSession: boolean;
      isForegroundClient: boolean;
      isCurrentWindow: boolean;
      suppressUntil: number;
    };

export interface SidebarWidthReportInput {
  width: number;
  session: string | null;
  windowId: string | null;
  isActiveSession: boolean;
  isForegroundClient: boolean;
  isCurrentWindow: boolean;
  now?: number;
  suppressMs?: number;
}

function rejectWidth(
  previousWidth: number,
  reason: Exclude<SidebarWidthReportDecisionReason, "accepted">,
): SidebarWidthReportDecision {
  return {
    accepted: false,
    reason,
    previousWidth,
    nextWidth: previousWidth,
    continuedDrag: false,
  };
}

function decideWidthReport(
  context: SidebarCoordinatorContext,
  event: Extract<SidebarCoordinatorEvent, { type: "WIDTH_REPORTED" }>,
): SidebarWidthReportDecision {
  const isContinuingDrag =
    context.authority === "user-drag"
    && !!context.dragOwnerSession
    && !!context.dragOwnerWindowId
    && context.dragOwnerSession === event.session
    && context.dragOwnerWindowId === event.windowId;

  if (context.visibility !== "visible") {
    return rejectWidth(context.width, "hidden");
  }

  if (context.lifecycle !== "ready") {
    return rejectWidth(context.width, "warming");
  }

  if (!isContinuingDrag && !event.isActiveSession) {
    return rejectWidth(context.width, "inactive-session");
  }

  if (!isContinuingDrag && !event.isForegroundClient) {
    return rejectWidth(context.width, "background-sidebar");
  }

  if (context.clientResizeReportGuardUntil > event.now) {
    return rejectWidth(context.width, "client-resize-guard");
  }

  if (context.authority === "client-resize-sync") {
    return rejectWidth(context.width, "client-resize-sync");
  }

  const widthReportsSuppressed = context.suppressWidthReportsUntil > event.now;

  if (widthReportsSuppressed && !isContinuingDrag) {
    return rejectWidth(context.width, "suppressed");
  }

  if (event.width === context.width) {
    return rejectWidth(context.width, "same-width");
  }

  return {
    accepted: true,
    reason: "accepted",
    previousWidth: context.width,
    nextWidth: event.width,
    continuedDrag: isContinuingDrag,
  };
}

const sidebarCoordinatorMachine = setup({
  types: {
    input: {} as { width: number },
    context: {} as SidebarCoordinatorContext,
    events: {} as SidebarCoordinatorEvent,
  },
  guards: {
    shouldAcceptWidthReport: ({ context, event }) => {
      if (event.type !== "WIDTH_REPORTED") return false;
      return decideWidthReport(context, event).accepted;
    },
  },
  actions: {
    markHidden: assign({ visibility: "hidden" }),
    markVisible: assign({ visibility: "visible" }),
    markLifecycleIdle: assign({ lifecycle: "idle" }),
    markLifecycleWarming: assign({ lifecycle: "warming" }),
    markLifecycleReady: assign({ lifecycle: "ready" }),
    markAuthorityNone: assign({ authority: "none" }),
    markAuthorityUserDrag: assign({ authority: "user-drag" }),
    markAuthorityClientResizeSync: assign({ authority: "client-resize-sync" }),
    markAuthorityProgrammaticAdjust: assign({ authority: "programmatic-adjust" }),
    clearDragOwner: assign({
      dragOwnerSession: null,
      dragOwnerWindowId: null,
    }),
    extendSuppression: assign({
      suppressWidthReportsUntil: ({ context, event }) => {
        if (event.type !== "SUPPRESS_WIDTH_REPORTS") return context.suppressWidthReportsUntil;
        return Math.max(context.suppressWidthReportsUntil, event.until);
      },
    }),
    extendClientResizeGuard: assign({
      clientResizeReportGuardUntil: ({ context, event }) => {
        if (event.type !== "NOTE_CLIENT_RESIZE_GUARD") return context.clientResizeReportGuardUntil;
        return Math.max(context.clientResizeReportGuardUntil, event.until);
      },
    }),
    beginClientResizeSync: assign(({ context, event }) => {
      if (event.type !== "BEGIN_CLIENT_RESIZE_SYNC") return context;
      return {
        ...context,
        suppressWidthReportsUntil: Math.max(context.suppressWidthReportsUntil, event.suppressUntil),
        clientResizeReportGuardUntil: Math.max(context.clientResizeReportGuardUntil, event.guardUntil),
        dragOwnerSession: null,
        dragOwnerWindowId: null,
      };
    }),
    acceptWidthReport: assign(({ context, event }) => {
      if (event.type !== "WIDTH_REPORTED") return context;
      const decision = decideWidthReport(context, event);
      if (!decision.accepted) {
        return {
          ...context,
          lastWidthReportDecision: decision,
        };
      }
      return {
        ...context,
        width: decision.nextWidth,
        suppressWidthReportsUntil: Math.max(context.suppressWidthReportsUntil, event.suppressUntil),
        dragOwnerSession: event.session,
        dragOwnerWindowId: event.windowId,
        lastWidthReportDecision: decision,
      };
    }),
    rejectWidthReport: assign({
      lastWidthReportDecision: ({ context, event }) => {
        if (event.type !== "WIDTH_REPORTED") return context.lastWidthReportDecision;
        return decideWidthReport(context, event);
      },
    }),
  },
}).createMachine({
  id: "sidebarCoordinator",
  initial: "hidden",
  context: ({ input }) => ({
    width: input.width,
    visibility: "hidden",
    lifecycle: "idle",
    authority: "none",
    suppressWidthReportsUntil: 0,
    clientResizeReportGuardUntil: 0,
    dragOwnerSession: null,
    dragOwnerWindowId: null,
    lastWidthReportDecision: null,
  }),
  on: {
    SUPPRESS_WIDTH_REPORTS: {
      actions: { type: "extendSuppression" },
    },
    NOTE_CLIENT_RESIZE_GUARD: {
      actions: { type: "extendClientResizeGuard" },
    },
  },
  states: {
    hidden: {
      entry: [
        { type: "markHidden" },
        { type: "markLifecycleIdle" },
        { type: "markAuthorityNone" },
        { type: "clearDragOwner" },
      ],
      on: {
        BEGIN_WARMUP: {
          target: ["#sidebarCoordinatorLifecycleWarming", "#sidebarCoordinatorAuthorityQuiescent"],
        },
        MARK_READY: {
          target: ["#sidebarCoordinatorLifecycleReady", "#sidebarCoordinatorAuthorityQuiescent"],
        },
        WIDTH_REPORTED: {
          actions: { type: "rejectWidthReport" },
        },
      },
    },
    visible: {
      entry: { type: "markVisible" },
      on: {
        HIDE: "hidden",
      },
      type: "parallel",
      states: {
        lifecycle: {
          initial: "ready",
          states: {
            warming: {
              id: "sidebarCoordinatorLifecycleWarming",
              entry: { type: "markLifecycleWarming" },
              on: {
                WARMUP_DONE: "ready",
                MARK_READY: "ready",
              },
            },
            ready: {
              id: "sidebarCoordinatorLifecycleReady",
              entry: { type: "markLifecycleReady" },
              on: {
                BEGIN_WARMUP: "warming",
              },
            },
          },
        },
        authority: {
          initial: "quiescent",
          states: {
            quiescent: {
              id: "sidebarCoordinatorAuthorityQuiescent",
              entry: [{ type: "markAuthorityNone" }, { type: "clearDragOwner" }],
              on: {
                BEGIN_PROGRAMMATIC_ADJUSTMENT: {
                  target: "programmaticAdjust",
                },
                BEGIN_CLIENT_RESIZE_SYNC: {
                  target: "clientResizeSync",
                  actions: { type: "beginClientResizeSync" },
                },
                WIDTH_REPORTED: [
                  {
                    guard: { type: "shouldAcceptWidthReport" },
                    target: "userDrag",
                    actions: { type: "acceptWidthReport" },
                  },
                  {
                    actions: { type: "rejectWidthReport" },
                  },
                ],
              },
            },
            userDrag: {
              id: "sidebarCoordinatorAuthorityUserDrag",
              entry: { type: "markAuthorityUserDrag" },
              on: {
                BEGIN_CLIENT_RESIZE_SYNC: {
                  target: "clientResizeSync",
                  actions: { type: "beginClientResizeSync" },
                },
                WIDTH_REPORTED: [
                  {
                    guard: { type: "shouldAcceptWidthReport" },
                    actions: { type: "acceptWidthReport" },
                  },
                  {
                    actions: { type: "rejectWidthReport" },
                  },
                ],
                FINISH_USER_DRAG: "quiescent",
              },
            },
            programmaticAdjust: {
              id: "sidebarCoordinatorAuthorityProgrammaticAdjust",
              entry: [{ type: "markAuthorityProgrammaticAdjust" }, { type: "clearDragOwner" }],
              on: {
                BEGIN_PROGRAMMATIC_ADJUSTMENT: undefined,
                BEGIN_CLIENT_RESIZE_SYNC: {
                  target: "clientResizeSync",
                  actions: { type: "beginClientResizeSync" },
                },
                WIDTH_REPORTED: [
                  {
                    guard: { type: "shouldAcceptWidthReport" },
                    target: "userDrag",
                    actions: { type: "acceptWidthReport" },
                  },
                  {
                    actions: { type: "rejectWidthReport" },
                  },
                ],
                FINISH_PROGRAMMATIC_ADJUSTMENT: "quiescent",
              },
            },
            clientResizeSync: {
              id: "sidebarCoordinatorAuthorityClientResizeSync",
              entry: [{ type: "markAuthorityClientResizeSync" }, { type: "clearDragOwner" }],
              on: {
                BEGIN_CLIENT_RESIZE_SYNC: {
                  actions: { type: "beginClientResizeSync" },
                },
                WIDTH_REPORTED: {
                  actions: { type: "rejectWidthReport" },
                },
                FINISH_CLIENT_RESIZE_SYNC: "quiescent",
                FOCUS_CONTEXT_CHANGED: {
                  actions: { type: "clearDragOwner" },
                },
              },
            },
          },
        },
      },
    },
  },
});

export function createSidebarCoordinator(input: { width: number }) {
  const actor = createActor(sidebarCoordinatorMachine, { input });
  actor.start();
  return actor;
}

export function readSidebarCoordinatorState(
  snapshot: ReturnType<ReturnType<typeof createSidebarCoordinator>["getSnapshot"]>,
): SidebarCoordinatorState {
  const visible = snapshot.context.visibility === "visible";
  const resizing = snapshot.context.authority !== "none";
  const mode: SidebarCoordinatorMode = !visible
    ? "hidden"
    : resizing
        ? "resizing"
        : snapshot.context.lifecycle === "warming"
          ? "warming"
          : "ready";
  const initializing = visible && (snapshot.context.lifecycle === "warming" || resizing);

  return {
    mode,
    visible,
    initializing,
    initLabel: resizing ? "adjusting…" : snapshot.context.lifecycle === "warming" ? "warming up…" : "",
    width: snapshot.context.width,
    lifecycle: snapshot.context.lifecycle,
    resizeAuthority: snapshot.context.authority,
    suppressWidthReportsUntil: snapshot.context.suppressWidthReportsUntil,
    clientResizeReportGuardUntil: snapshot.context.clientResizeReportGuardUntil,
    lastWidthReportDecision: snapshot.context.lastWidthReportDecision,
  };
}

export function areWidthReportsSuppressed(
  state: Pick<SidebarCoordinatorState, "suppressWidthReportsUntil">,
  now = Date.now(),
): boolean {
  return state.suppressWidthReportsUntil > now;
}

export function isClientResizeReportGuardActive(
  state: Pick<SidebarCoordinatorState, "clientResizeReportGuardUntil">,
  now = Date.now(),
): boolean {
  return state.clientResizeReportGuardUntil > now;
}

export function isClientResizeSyncActive(
  state: Pick<SidebarCoordinatorState, "resizeAuthority">,
): boolean {
  return state.resizeAuthority === "client-resize-sync";
}

export function isUserDragActive(
  state: Pick<SidebarCoordinatorState, "resizeAuthority">,
): boolean {
  return state.resizeAuthority === "user-drag";
}

export function applySidebarWidthReport(
  actor: ReturnType<typeof createSidebarCoordinator>,
  input: SidebarWidthReportInput,
): SidebarWidthReportDecision {
  const now = input.now ?? Date.now();
  actor.send({
    type: "WIDTH_REPORTED",
    now,
    width: input.width,
    session: input.session,
    windowId: input.windowId,
    isActiveSession: input.isActiveSession,
    isForegroundClient: input.isForegroundClient,
    isCurrentWindow: input.isCurrentWindow,
    suppressUntil: now + (input.suppressMs ?? 500),
  });

  return readSidebarCoordinatorState(actor.getSnapshot()).lastWidthReportDecision ?? rejectWidth(input.width, "hidden");
}
