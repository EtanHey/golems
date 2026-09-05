import { estimationMethodRank } from "./estimation-methods";

export interface UsageRowWithSession {
  source?: string | null;
  created_at?: string | null;
  cost_usd?: number | null;
  metadata?: {
    session_id?: string;
    project?: string;
    estimation_method?: string;
    synced_at?: string;
  } | null;
}

export function canonicalUsageSource(source: string | null | undefined): string {
  return source === "cursor" || source === "cursor-cli"
    ? "cursor-cli"
    : source || "unknown";
}

export function usageSessionKey(
  source: string | null | undefined,
  sessionId: string,
  project?: string | null,
): string {
  const canonicalSource = canonicalUsageSource(source);
  return project
    ? `${canonicalSource}:${project}:${sessionId}`
    : `${canonicalSource}:${sessionId}`;
}

export function dedupeUsageRowsBySession<T extends UsageRowWithSession>(
  rows: T[],
): T[] {
  const deduped: T[] = [];
  const indexByKey = new Map<string, number>();

  for (const row of rows) {
    const sessionId = row.metadata?.session_id;
    if (!sessionId) {
      deduped.push(row);
      continue;
    }

    const key = usageSessionKey(row.source, sessionId, row.metadata?.project);
    const existingIndex = indexByKey.get(key);
    if (existingIndex === undefined) {
      indexByKey.set(key, deduped.length);
      deduped.push(row);
      continue;
    }

    if (shouldPreferRow(row, deduped[existingIndex])) {
      deduped[existingIndex] = row;
    }
  }

  return deduped;
}

function shouldPreferRow<T extends UsageRowWithSession>(
  candidate: T,
  current: T,
): boolean {
  const candidateMethod = candidate.metadata?.estimation_method;
  const currentMethod = current.metadata?.estimation_method;
  const candidateMethodRank = estimationMethodRank(candidateMethod);
  const currentMethodRank = estimationMethodRank(currentMethod);

  if (candidateMethodRank !== currentMethodRank) {
    return candidateMethodRank > currentMethodRank;
  }

  const candidateSyncedAt = Date.parse(candidate.metadata?.synced_at || "");
  const currentSyncedAt = Date.parse(current.metadata?.synced_at || "");
  const candidateHasSyncedAt = !Number.isNaN(candidateSyncedAt);
  const currentHasSyncedAt = !Number.isNaN(currentSyncedAt);
  if (candidateHasSyncedAt !== currentHasSyncedAt) {
    return candidateHasSyncedAt;
  }
  if (candidateHasSyncedAt && currentHasSyncedAt) {
    if (candidateSyncedAt !== currentSyncedAt) {
      return candidateSyncedAt > currentSyncedAt;
    }
  }

  const candidateTime = Date.parse(candidate.created_at || "");
  const currentTime = Date.parse(current.created_at || "");
  const candidateHasCreatedAt = !Number.isNaN(candidateTime);
  const currentHasCreatedAt = !Number.isNaN(currentTime);
  if (candidateHasCreatedAt !== currentHasCreatedAt) {
    return candidateHasCreatedAt;
  }
  if (candidateHasCreatedAt && currentHasCreatedAt) {
    if (candidateTime !== currentTime) {
      return candidateTime > currentTime;
    }
  }

  return Number(candidate.cost_usd) > Number(current.cost_usd);
}
