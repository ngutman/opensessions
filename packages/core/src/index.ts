export type {
  MuxProvider,
  MuxProviderV1,
  MuxSessionInfo,
  ActiveWindow,
  SidebarPane,
  SidebarPosition,
  WindowCapable,
  SidebarCapable,
  BatchCapable,
  FullMuxProvider,
  MuxProviderSettings,
} from "./contracts/mux";
export {
  isWindowCapable,
  isSidebarCapable,
  isBatchCapable,
  isFullSidebarCapable,
} from "./contracts/mux";
export type { AgentStatus, AgentEvent } from "./contracts/agent";
export { TERMINAL_STATUSES } from "./contracts/agent";
export { AgentTracker } from "./agents/tracker";
export { MuxRegistry } from "./mux/registry";
export { detectMux } from "./mux/detect";
export { PluginLoader } from "./plugins/loader";
export type { PluginAPI, PluginFactory } from "./plugins/loader";
export { loadConfig, saveConfig } from "./config";
export type { OpensessionsConfig } from "./config";
export { resolveTheme, BUILTIN_THEMES, DEFAULT_THEME } from "./themes";
export type { Theme, ThemePalette, PartialTheme } from "./themes";
export { startServer } from "./server/index";
export { ensureServer } from "./server/launcher";
export {
  SERVER_PORT,
  SERVER_HOST,
  PID_FILE,
  SERVER_IDLE_TIMEOUT_MS,
  STUCK_RUNNING_TIMEOUT_MS,
  EVENTS_FILE,
  C,
  STATUS_COLORS,
  STATUS_ICONS,
} from "./shared";
export type {
  SessionData,
  ServerState,
  FocusUpdate,
  ResizeNotify,
  QuitNotify,
  ServerMessage,
  ClientCommand,
} from "./shared";
