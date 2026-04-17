import type { AgentDisplayConfig, AgentEvent, SessionData } from "@opensessions/runtime";

export function compactDirPath(dir: string, homeDir = process.env.HOME ?? ""): string {
  if (!dir) return "";
  const normalized = dir === "/" ? "/" : dir.replace(/\/+$/, "");
  if (!normalized) return "/";
  if (homeDir && normalized === homeDir) return "~";
  if (normalized === "/") return "/";
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? normalized;
}

export function formatAgentContext(
  agent: Pick<AgentEvent, "cwd" | "branch">,
  session: Pick<SessionData, "dir" | "branch">,
  config: Pick<AgentDisplayConfig, "showContext">,
  homeDir = process.env.HOME ?? "",
): string {
  if (!config.showContext) return "";

  const cwdSource = agent.cwd ?? session.dir;
  const branchSource = agent.cwd != null ? (agent.branch ?? "") : session.branch;
  const cwd = compactDirPath(cwdSource, homeDir);
  const branch = branchSource.trim();

  if (cwd && branch) return `${cwd} (${branch})`;
  return cwd || branch;
}
