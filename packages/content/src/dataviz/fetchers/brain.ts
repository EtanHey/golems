/**
 * Brain/Zikaron data fetchers — knowledge base growth and coverage stats.
 *
 * Queries the local Zikaron SQLite database directly for chunk counts,
 * project coverage, and growth trends.
 */

import { Database } from "bun:sqlite";
import { existsSync } from "fs";

const ZIKARON_DB_PATH = `${process.env.HOME}/.local/share/zikaron/zikaron.db`;

export interface ProjectCoverage {
  project: string;
  chunks: number;
  sessions: number;
}

export interface MonthlyGrowth {
  month: string;
  chunks: number;
}

export interface ContentTypeBreakdown {
  contentType: string;
  count: number;
}

export interface BrainData {
  totalChunks: number;
  totalSessions: number;
  totalProjects: number;
  projectCoverage: ProjectCoverage[];
  monthlyGrowth: MonthlyGrowth[];
  contentTypes: ContentTypeBreakdown[];
  enrichedCount: number;
  enrichmentPercent: number;
  fetchedAt: string;
}

export async function fetchBrainData(): Promise<BrainData> {
  if (!existsSync(ZIKARON_DB_PATH)) {
    return {
      totalChunks: 0,
      totalSessions: 0,
      totalProjects: 0,
      projectCoverage: [],
      monthlyGrowth: [],
      contentTypes: [],
      enrichedCount: 0,
      enrichmentPercent: 0,
      fetchedAt: new Date().toISOString(),
    };
  }

  const db = new Database(ZIKARON_DB_PATH, { readonly: true });

  try {
    // Total counts
    const totalChunks = db.query("SELECT COUNT(*) as c FROM chunks").get() as { c: number };
    const totalSessions = db.query("SELECT COUNT(DISTINCT session_id) as c FROM chunks").get() as { c: number };

    // Project coverage
    const projects = db.query(`
      SELECT project, COUNT(*) as chunks, COUNT(DISTINCT session_id) as sessions
      FROM chunks
      WHERE project IS NOT NULL AND project != ''
      GROUP BY project
      ORDER BY chunks DESC
      LIMIT 10
    `).all() as Array<{ project: string; chunks: number; sessions: number }>;

    // Monthly growth (last 12 months)
    const growth = db.query(`
      SELECT strftime('%Y-%m', timestamp) as month, COUNT(*) as chunks
      FROM chunks
      WHERE timestamp >= date('now', '-12 months')
      GROUP BY month
      ORDER BY month
    `).all() as Array<{ month: string; chunks: number }>;

    // Content type breakdown
    const types = db.query(`
      SELECT content_type, COUNT(*) as count
      FROM chunks
      WHERE content_type IS NOT NULL
      GROUP BY content_type
      ORDER BY count DESC
    `).all() as Array<{ content_type: string; count: number }>;

    // Enrichment stats
    const enriched = db.query(`
      SELECT COUNT(*) as c FROM chunks
      WHERE summary IS NOT NULL AND summary != ''
    `).get() as { c: number };

    const total = totalChunks.c || 1;

    return {
      totalChunks: totalChunks.c,
      totalSessions: totalSessions.c,
      totalProjects: projects.length,
      projectCoverage: projects.map((p) => ({
        project: p.project.replace(/^-Users-.+?-Gits-/, ""),
        chunks: p.chunks,
        sessions: p.sessions,
      })),
      monthlyGrowth: growth.map((g) => ({ month: g.month, chunks: g.chunks })),
      contentTypes: types.map((t) => ({ contentType: t.content_type, count: t.count })),
      enrichedCount: enriched.c,
      enrichmentPercent: Math.round((enriched.c / total) * 100),
      fetchedAt: new Date().toISOString(),
    };
  } finally {
    db.close();
  }
}
