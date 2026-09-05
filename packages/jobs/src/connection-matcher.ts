/**
 * Connection Matcher
 *
 * Matches job listings against LinkedIn connections by company name.
 * Finds warm intros: "Your connection X works at company Y which is hiring for Z."
 */

import type { SupabaseClient } from "@golems/shared/lib/supabase-factory";

/** Company name suffixes to strip for matching */
const COMPANY_SUFFIXES = [
  /\s*\(.*?\)\s*/g,
  /\s*[-–]\s*.+$/,
  /\s*(ltd|inc|corp|llc|gmbh|sa|ag|plc|co|limited|בע"?מ)\.?\s*$/i,
  /\s*®\s*/g,
  /\s*™\s*/g,
];

function normalizeCompany(company: string): string {
  let normalized = company.trim().toLowerCase();
  for (const pattern of COMPANY_SUFFIXES) {
    normalized = normalized.replace(pattern, "");
  }
  return normalized.trim();
}

/** Simple Levenshtein distance */
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    }
  }
  return dp[m][n];
}

export interface ConnectionMatch {
  jobId: string;
  jobTitle: string;
  jobCompany: string;
  connectionId: string;
  connectionName: string;
  connectionPosition: string;
  connectionCompany: string;
  matchType: "exact" | "fuzzy" | "substring";
  confidence: number;
}

/**
 * Match jobs against LinkedIn connections.
 * Call this after scoring jobs to find warm leads.
 */
export async function matchJobsToConnections(
  supabase: SupabaseClient,
  jobIds?: string[]
): Promise<ConnectionMatch[]> {
  // Get all connections with their companies
  const { data: connections } = await supabase
    .from("linkedin_connections")
    .select("id, first_name, last_name, company, company_normalized, position")
    .not("company", "is", null);

  if (!connections || connections.length === 0) {
    console.log("[ConnectionMatcher] No connections found");
    return [];
  }

  // Build company lookup: normalized company → connections[]
  const companyMap = new Map<string, typeof connections>();
  for (const conn of connections) {
    const key = conn.company_normalized || normalizeCompany(conn.company || "");
    if (!key) continue;
    const existing = companyMap.get(key) || [];
    existing.push(conn);
    companyMap.set(key, existing);
  }

  // Get jobs to match
  let jobQuery = supabase
    .from("golem_jobs")
    .select("id, title, company")
    .not("company", "is", null);

  if (jobIds && jobIds.length > 0) {
    jobQuery = jobQuery.in("id", jobIds);
  } else {
    // Default: match jobs from last 7 days
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    jobQuery = jobQuery.gte("scraped_at", since);
  }

  const { data: jobs } = await jobQuery;
  if (!jobs || jobs.length === 0) {
    console.log("[ConnectionMatcher] No jobs to match");
    return [];
  }

  const matches: ConnectionMatch[] = [];

  for (const job of jobs) {
    const jobCompanyNorm = normalizeCompany(job.company);
    if (!jobCompanyNorm || jobCompanyNorm.length < 2) continue;

    // 1. Exact match
    const exact = companyMap.get(jobCompanyNorm);
    if (exact) {
      for (const conn of exact) {
        matches.push({
          jobId: job.id,
          jobTitle: job.title,
          jobCompany: job.company,
          connectionId: conn.id,
          connectionName: `${conn.first_name} ${conn.last_name}`,
          connectionPosition: conn.position || "",
          connectionCompany: conn.company || "",
          matchType: "exact",
          confidence: 1.0,
        });
      }
      continue; // Found exact, skip fuzzy
    }

    // 2. Substring match (e.g., "Google Israel" contains "Google")
    for (const [connCompany, conns] of companyMap) {
      if (connCompany.length < 3) continue;

      if (jobCompanyNorm.includes(connCompany) || connCompany.includes(jobCompanyNorm)) {
        for (const conn of conns) {
          matches.push({
            jobId: job.id,
            jobTitle: job.title,
            jobCompany: job.company,
            connectionId: conn.id,
            connectionName: `${conn.first_name} ${conn.last_name}`,
            connectionPosition: conn.position || "",
            connectionCompany: conn.company || "",
            matchType: "substring",
            confidence: 0.8,
          });
        }
        continue;
      }

      // 3. Fuzzy match (Levenshtein distance <= 2)
      if (Math.abs(jobCompanyNorm.length - connCompany.length) <= 3) {
        const dist = levenshtein(jobCompanyNorm, connCompany);
        if (dist <= 2) {
          for (const conn of conns) {
            matches.push({
              jobId: job.id,
              jobTitle: job.title,
              jobCompany: job.company,
              connectionId: conn.id,
              connectionName: `${conn.first_name} ${conn.last_name}`,
              connectionPosition: conn.position || "",
              connectionCompany: conn.company || "",
              matchType: "fuzzy",
              confidence: 1 - (dist / Math.max(jobCompanyNorm.length, connCompany.length)),
            });
          }
        }
      }
    }
  }

  console.log(`[ConnectionMatcher] ${matches.length} matches found for ${jobs.length} jobs`);
  return matches;
}

/**
 * Save connection matches to Supabase and return new ones for notification
 */
export async function saveConnectionMatches(
  supabase: SupabaseClient,
  matches: ConnectionMatch[]
): Promise<ConnectionMatch[]> {
  if (matches.length === 0) return [];

  const newMatches: ConnectionMatch[] = [];

  for (const match of matches) {
    const { data, error } = await supabase
      .from("job_connections")
      .upsert({
        job_id: match.jobId,
        connection_id: match.connectionId,
        company_match_type: match.matchType,
        match_confidence: match.confidence,
      }, { onConflict: "job_id,connection_id" })
      .select()
      .single();

    if (error) {
      // Ignore duplicates (already exists)
      if (!error.message.includes("duplicate")) {
        console.error(`[ConnectionMatcher] Save error:`, error.message);
      }
    } else if (data && !data.notified) {
      newMatches.push(match);
    }
  }

  console.log(`[ConnectionMatcher] ${newMatches.length} new matches to notify about`);
  return newMatches;
}
