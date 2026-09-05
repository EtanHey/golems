/**
 * Status Aggregator for CoachGolem
 *
 * Reads GolemStatus from all registered golems and aggregates into
 * an ecosystem-level view with pending work items.
 */

import type { GolemStatus } from "@golems/shared/lib/shared-types";

export interface EcosystemStatus {
  timestamp: string;
  golems: GolemStatus[];
  healthy: number;
  unhealthy: number;
  summary: string;
}

export interface PendingWorkItem {
  item: string;
  priority: "high" | "medium" | "low";
  golem?: string;
}

type StatusFetcher = () => Promise<GolemStatus>;

const registry = new Map<string, StatusFetcher>();

export function registerGolem(name: string, fetcher: StatusFetcher): void {
  registry.set(name, fetcher);
}

export function resetRegistry(): void {
  registry.clear();
}

export async function registerAllGolems(): Promise<void> {
  const packages = [
    { name: "jobs", import: () => import("@golems/jobs/index") },
    { name: "recruiter", import: () => import("@golems/recruiter/index") },
    { name: "teller", import: () => import("@golems/teller/index") },
    { name: "email", import: () => import("@golems/shared/email/index") },
  ];

  for (const pkg of packages) {
    try {
      const mod = await pkg.import();
      if (typeof mod.getStatus === "function") {
        registerGolem(pkg.name, mod.getStatus);
      }
    } catch {
      // Package not available — skip
    }
  }
}

export async function getEcosystemStatus(): Promise<EcosystemStatus> {
  const entries = Array.from(registry.entries());
  const results = await Promise.allSettled(
    entries.map(([, fetcher]) => fetcher())
  );

  const golems: GolemStatus[] = results.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    return {
      name: entries[i][0],
      healthy: false,
      lastRun: null,
      summary: `Error: ${(r.reason as Error)?.message ?? "unknown"}`,
    };
  });

  const healthy = golems.filter((g) => g.healthy).length;
  const unhealthy = golems.filter((g) => !g.healthy).length;

  return {
    timestamp: new Date().toISOString(),
    golems,
    healthy,
    unhealthy,
    summary: `${healthy}/${golems.length} golems healthy`,
  };
}

const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

/**
 * Extract actionable work items from ecosystem status.
 */
export function getPendingWork(status: EcosystemStatus): PendingWorkItem[] {
  const items: PendingWorkItem[] = [];

  for (const golem of status.golems) {
    if (!golem.healthy) {
      items.push({
        item: `${golem.name} is unhealthy: ${golem.summary}`,
        priority: "high",
        golem: golem.name,
      });
      continue;
    }

    if (!golem.details) continue;

    const overdueFollowups = golem.details.overdueFollowups;
    if (typeof overdueFollowups === "number" && overdueFollowups > 0) {
      items.push({
        item: `${overdueFollowups} overdue follow-ups`,
        priority: "high",
        golem: golem.name,
      });
    }

    const pendingMatches = golem.details.pendingMatches;
    if (typeof pendingMatches === "number" && pendingMatches > 0) {
      items.push({
        item: `${pendingMatches} job matches to review`,
        priority: "medium",
        golem: golem.name,
      });
    }

    const uncategorized = golem.details.uncategorized;
    if (typeof uncategorized === "number" && uncategorized > 0) {
      items.push({
        item: `${uncategorized} uncategorized transactions`,
        priority: "low",
        golem: golem.name,
      });
    }

    const draftCount = golem.details.draftCount;
    if (typeof draftCount === "number" && draftCount > 0) {
      items.push({
        item: `${draftCount} outreach drafts pending`,
        priority: "medium",
        golem: golem.name,
      });
    }
  }

  items.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
  return items;
}
