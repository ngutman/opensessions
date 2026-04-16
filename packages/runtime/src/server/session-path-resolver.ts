export interface SessionPathCandidate {
  session: string;
  path: string;
}

interface SessionPathScore {
  exact: boolean;
  specificity: number;
  relation: 0 | 1 | 2;
}

function normalizePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return "";
  if (trimmed === "/") return "/";
  return trimmed.replace(/\/+$/, "");
}

function compareScores(a: SessionPathScore, b: SessionPathScore): number {
  if (a.exact !== b.exact) return a.exact ? 1 : -1;
  if (a.specificity !== b.specificity) return a.specificity > b.specificity ? 1 : -1;
  if (a.relation !== b.relation) return a.relation > b.relation ? 1 : -1;
  return 0;
}

function scoreCandidate(projectDir: string, candidatePath: string): SessionPathScore | null {
  if (projectDir === candidatePath) {
    return { exact: true, specificity: candidatePath.length, relation: 2 };
  }
  if (projectDir.startsWith(candidatePath + "/")) {
    return { exact: false, specificity: candidatePath.length, relation: 2 };
  }
  if (candidatePath.startsWith(projectDir + "/")) {
    return { exact: false, specificity: projectDir.length, relation: 1 };
  }
  return null;
}

function encodePathCandidate(path: string): string {
  return path.replace(/[/._]/g, "-");
}

export function resolveSessionFromCandidates(
  projectDir: string,
  candidates: readonly SessionPathCandidate[],
): string | null {
  const normalizedProjectDir = normalizePath(projectDir);
  if (!normalizedProjectDir) return null;

  const bestBySession = new Map<string, SessionPathScore>();

  if (normalizedProjectDir.startsWith("__encoded__:")) {
    const encodedProjectDir = normalizedProjectDir.slice("__encoded__:".length);
    for (const candidate of candidates) {
      const normalizedCandidatePath = normalizePath(candidate.path);
      if (!normalizedCandidatePath) continue;
      const encodedCandidatePath = encodePathCandidate(normalizedCandidatePath);
      const score = scoreCandidate(encodedProjectDir, encodedCandidatePath);
      if (!score) continue;
      const previous = bestBySession.get(candidate.session);
      if (!previous || compareScores(score, previous) > 0) {
        bestBySession.set(candidate.session, score);
      }
    }
  } else {
    for (const candidate of candidates) {
      const normalizedCandidatePath = normalizePath(candidate.path);
      if (!normalizedCandidatePath) continue;
      const score = scoreCandidate(normalizedProjectDir, normalizedCandidatePath);
      if (!score) continue;
      const previous = bestBySession.get(candidate.session);
      if (!previous || compareScores(score, previous) > 0) {
        bestBySession.set(candidate.session, score);
      }
    }
  }

  let winner: { session: string; score: SessionPathScore } | null = null;
  let tied = false;
  for (const [session, score] of bestBySession) {
    if (!winner) {
      winner = { session, score };
      tied = false;
      continue;
    }
    const cmp = compareScores(score, winner.score);
    if (cmp > 0) {
      winner = { session, score };
      tied = false;
      continue;
    }
    if (cmp === 0 && session !== winner.session) {
      tied = true;
    }
  }

  if (tied) return null;
  return winner?.session ?? null;
}

export function dedupeSessionPathCandidates(
  candidates: readonly SessionPathCandidate[],
): SessionPathCandidate[] {
  const seen = new Set<string>();
  const deduped: SessionPathCandidate[] = [];
  for (const candidate of candidates) {
    const path = normalizePath(candidate.path);
    if (!candidate.session || !path) continue;
    const key = `${candidate.session}\0${path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push({ session: candidate.session, path });
  }
  return deduped;
}
