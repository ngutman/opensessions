// ─── Types ───────────────────────────────────────────────────────────────────
export type {
  MuxSpecificationVersion,
  MuxSessionInfo,
  ActiveWindow,
  SidebarPane,
  SidebarPosition,
  MuxProviderMetadata,
  MuxProviderV1,
  WindowCapable,
  SidebarCapable,
  BatchCapable,
  FullMuxProvider,
  MuxProvider,
  MuxProviderSettings,
} from "./types";

// ─── Type guards ─────────────────────────────────────────────────────────────
export {
  isWindowCapable,
  isSidebarCapable,
  isBatchCapable,
  isFullSidebarCapable,
} from "./types";
