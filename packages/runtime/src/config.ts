import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

import type { PartialTheme } from "./themes";

/** Session filter mode for the TUI sidebar */
export type SessionFilterMode = "all" | "active" | "running";

export interface AgentDisplayConfig {
  showContext: boolean;
  showThreadName: boolean;
}

export function resolveAgentDisplayConfig(agentDisplay?: Partial<AgentDisplayConfig>): AgentDisplayConfig {
  return {
    showContext: true,
    showThreadName: true,
    ...(agentDisplay ?? {}),
  };
}

export interface OpensessionsConfig {
  /** Explicit mux provider name (overrides auto-detect) */
  mux?: string;
  /** Custom server port */
  port?: number;
  /** Community plugin package names to load (e.g. ["opensessions-mux-zellij"]) */
  plugins: string[];
  /** Theme: builtin name (e.g. "catppuccin-latte") or partial inline theme object */
  theme?: string | PartialTheme;
  /** Sidebar column width (default 26) */
  sidebarWidth?: number;
  /** Sidebar position relative to the terminal window (default "left") */
  sidebarPosition?: "left" | "right";
  /** Tmux prefix key for sidebar toggle (default "s") */
  keybinding?: string;
  /** Persisted detail panel heights keyed by mux session name */
  detailPanelHeights?: Record<string, number>;
  /** Default session filter: "all" (default), "active" (any agent), "running" (running agents only) */
  sessionFilter?: SessionFilterMode;
  /** Controls which context fields appear in agent rows */
  agentDisplay?: AgentDisplayConfig;
}

export type OpensessionsConfigUpdate = Partial<Omit<OpensessionsConfig, "agentDisplay">> & {
  agentDisplay?: Partial<AgentDisplayConfig>;
};

const DEFAULTS: OpensessionsConfig = {
  plugins: [],
  agentDisplay: resolveAgentDisplayConfig(),
};

/**
 * Load config from ~/.config/opensessions/config.json
 * @param homeDir — override home directory (for testing)
 */
export function loadConfig(homeDir?: string): OpensessionsConfig {
  const home = homeDir ?? process.env.HOME ?? process.env.USERPROFILE ?? "";
  const configPath = join(home, ".config", "opensessions", "config.json");

  if (!existsSync(configPath)) {
    return { ...DEFAULTS };
  }

  try {
    const raw = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw) as OpensessionsConfigUpdate;
    return {
      ...DEFAULTS,
      ...parsed,
      plugins: parsed.plugins ?? DEFAULTS.plugins,
      agentDisplay: resolveAgentDisplayConfig(parsed.agentDisplay),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

/**
 * Save partial config updates to ~/.config/opensessions/config.json
 * Merges with existing config on disk to preserve fields.
 * @param updates — partial config fields to write
 * @param homeDir — override home directory (for testing)
 */
export function saveConfig(updates: OpensessionsConfigUpdate, homeDir?: string): void {
  const home = homeDir ?? process.env.HOME ?? process.env.USERPROFILE ?? "";
  const configDir = join(home, ".config", "opensessions");
  const configPath = join(configDir, "config.json");

  const existing = loadConfig(homeDir);
  const merged: OpensessionsConfig = {
    ...existing,
    ...updates,
    plugins: updates.plugins ?? existing.plugins,
    agentDisplay: resolveAgentDisplayConfig({
      ...(existing.agentDisplay ?? {}),
      ...(updates.agentDisplay ?? {}),
    }),
  };

  mkdirSync(configDir, { recursive: true });
  writeFileSync(configPath, JSON.stringify(merged, null, 2) + "\n");
}
