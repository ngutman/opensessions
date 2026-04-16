const AGENT_PROCESS_PATTERNS: Record<string, string[]> = {
  amp: ["amp"],
  "claude-code": ["claude"],
  codex: ["codex"],
  opencode: ["opencode"],
};

export function isExactCommand(comm: string, name: string): boolean {
  return comm === name || comm.endsWith(`/${name}`);
}

export function matchesCommandPattern(comm: string, pat: string): boolean {
  const idx = comm.indexOf(pat);
  if (idx < 0) return false;
  if (idx > 0 && comm[idx - 1] !== "/") return false;
  return true;
}

export function matchesAgentProcess(agentName: string, comm: string): boolean {
  const normalized = comm.trim().toLowerCase();
  if (!normalized) return false;
  if (agentName === "pi") return isExactCommand(normalized, "pi");
  const patterns = AGENT_PROCESS_PATTERNS[agentName] ?? [];
  return patterns.some((pat) => matchesCommandPattern(normalized, pat));
}

export function getAgentProcessPatterns(agentName: string): string[] {
  if (agentName === "pi") return [];
  return AGENT_PROCESS_PATTERNS[agentName] ?? [];
}
