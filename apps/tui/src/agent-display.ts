import type { AgentDisplayConfig, AgentEvent, SessionData } from "@opensessions/runtime";

export function compactDirPath(dir: string, homeDir = process.env.HOME ?? ""): string {
  if (!dir) return "";
  if (homeDir && dir === homeDir) return "~";
  if (homeDir && dir.startsWith(homeDir + "/")) return `~${dir.slice(homeDir.length)}`;
  return dir;
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
