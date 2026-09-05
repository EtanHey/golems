/**
 * JobGolem MCP Server
 *
 * Exposes job data as MCP tools for Claude Code.
 * Tools: getHot, getRecent, search, watchlist, dailyDigest, outreachDrafts
 *
 * Primary data source: Supabase golem_jobs table (cloud worker writes there).
 */

import "@golems/shared/lib/load-env";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { getSupabaseAnon } from "@golems/shared/lib/supabase-factory";
import { getActiveCompanies, getOutreachCandidates } from "./watchlist";
import { matchJobsToConnections } from "./connection-matcher";
import { createAndSaveDraft, getOutreachDrafts, updateDraftStatus } from "@golems/recruiter/draft-outreach";
import { getFullUsageStats, getSupabaseUsageStats, readCostLog, readFromSupabase, groupByDay, formatDaily, CC_SUBSCRIPTION_MONTHLY } from "@golems/shared/lib/cost-tracker";

// Use shared factory — anon key for RLS-respecting queries
const getSupabase = getSupabaseAnon;


const server = new Server(
  { name: "golems-jobs", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "jobs_getHot",
      description:
        "Get hot job matches (score 8+). These are the best matches for your profile.",
      inputSchema: {
        type: "object" as const,
        properties: {
          minScore: {
            type: "number",
            description: "Minimum score (default: 8)",
            default: 8,
          },
        },
      },
    },
    {
      name: "jobs_getRecent",
      description:
        "Get the most recent batch of scraped and scored jobs.",
      inputSchema: {
        type: "object" as const,
        properties: {
          limit: {
            type: "number",
            description: "Max results (default: 20)",
            default: 20,
          },
        },
      },
    },
    {
      name: "jobs_search",
      description:
        "Search job listings by keyword (company, title, or tech stack).",
      inputSchema: {
        type: "object" as const,
        properties: {
          query: {
            type: "string",
            description: "Search term to match in title, company, or description",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "jobs_watchlist",
      description:
        "Get the company watchlist - companies being tracked for outreach.",
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
    },
    {
      name: "jobs_stats",
      description:
        "Job pipeline stats: total scraped, seen, recent results.",
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
    },
    {
      name: "jobs_dailyDigest",
      description:
        "Daily job search digest: new matches, high-score jobs, follow-ups due, top matches. Perfect for morning check-in.",
      inputSchema: {
        type: "object" as const,
        properties: {
          hours: {
            type: "number",
            description: "Look back period in hours (default: 24)",
            default: 24,
          },
        },
      },
    },
    {
      name: "jobs_updateStatus",
      description:
        "Update a job's status in the pipeline. Tracks status history with timestamps.",
      inputSchema: {
        type: "object" as const,
        properties: {
          jobId: {
            type: "string",
            description: "Job ID (UUID from golem_jobs table)",
          },
          status: {
            type: "string",
            description: "New status",
            enum: ["new", "viewed", "saved", "applied", "interviewing", "offer", "rejected", "archived"],
          },
        },
        required: ["jobId", "status"],
      },
    },
    {
      name: "jobs_draftCoverLetter",
      description:
        "Draft a cover letter for a job listing using AI. Returns draft text for review.",
      inputSchema: {
        type: "object" as const,
        properties: {
          jobId: {
            type: "string",
            description: "Job ID (UUID from golem_jobs table)",
          },
          style: {
            type: "string",
            description: "Writing style (default: professional)",
            enum: ["professional", "casual", "technical"],
            default: "professional",
          },
        },
        required: ["jobId"],
      },
    },
    {
      name: "jobs_connectionMatches",
      description:
        "Find jobs where you have LinkedIn connections at the company. Shows warm leads for better applications.",
      inputSchema: {
        type: "object" as const,
        properties: {
          days: {
            type: "number",
            description: "Look back period in days (default: 7)",
            default: 7,
          },
        },
      },
    },
    {
      name: "linkedin_searchConnections",
      description:
        "Search your LinkedIn connections by name, company, or position.",
      inputSchema: {
        type: "object" as const,
        properties: {
          query: {
            type: "string",
            description: "Search term to match in name, company, or position",
          },
          limit: {
            type: "number",
            description: "Max results (default: 20)",
            default: 20,
          },
        },
        required: ["query"],
      },
    },
    {
      name: "outreach_draftForMatch",
      description:
        "Generate a personalized outreach draft for a LinkedIn connection-job match. Creates approach angle, message draft, follow-up plan, and saves to dashboard.",
      inputSchema: {
        type: "object" as const,
        properties: {
          jobId: {
            type: "string",
            description: "Job ID (UUID from golem_jobs table)",
          },
          connectionId: {
            type: "string",
            description: "Connection ID (UUID from linkedin_connections table)",
          },
        },
        required: ["jobId", "connectionId"],
      },
    },
    {
      name: "outreach_getDrafts",
      description:
        "Get outreach drafts with their associated job and connection data. Filter by status (pending/approved/sent/replied/skipped).",
      inputSchema: {
        type: "object" as const,
        properties: {
          status: {
            type: "string",
            description: "Filter by draft status (default: all)",
            enum: ["pending", "approved", "sent", "replied", "skipped"],
          },
        },
      },
    },
    {
      name: "outreach_updateDraft",
      description:
        "Update the status of an outreach draft (approve, mark as sent, skip, etc).",
      inputSchema: {
        type: "object" as const,
        properties: {
          draftId: {
            type: "string",
            description: "Draft ID (UUID from outreach_drafts table)",
          },
          status: {
            type: "string",
            description: "New status",
            enum: ["approved", "sent", "replied", "skipped"],
          },
        },
        required: ["draftId", "status"],
      },
    },
    {
      name: "usage_stats",
      description:
        "Get AI usage stats: paid API costs, free CLI helper calls, per-golem breakdown. Shows what each golem is costing.",
      inputSchema: {
        type: "object" as const,
        properties: {
          period: {
            type: "string",
            enum: ["today", "week", "month", "all"],
            description: "Time period (default: today)",
            default: "today",
          },
        },
      },
    },
    {
      name: "usage_daily",
      description:
        "Get daily cost breakdown as a formatted table.",
      inputSchema: {
        type: "object" as const,
        properties: {
          days: {
            type: "number",
            description: "Number of days to show (default: 7)",
            default: 7,
          },
        },
      },
    },
    {
      name: "usage_savings",
      description:
        "Get value metrics: CC subscription ($200/mo) vs actual value, Haiku API costs, free CLI helper savings. Shows ROI of the AI tooling stack.",
      inputSchema: {
        type: "object" as const,
        properties: {
          period: {
            type: "string",
            enum: ["today", "week", "month", "all"],
            description: "Time period (default: month)",
            default: "month",
          },
        },
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "jobs_getHot":
        return handleGetHot(args);
      case "jobs_getRecent":
        return handleGetRecent(args);
      case "jobs_search":
        return handleSearch(args);
      case "jobs_watchlist":
        return handleWatchlist();
      case "jobs_stats":
        return handleStats();
      case "jobs_dailyDigest":
        return handleDailyDigest(args);
      case "jobs_updateStatus":
        return handleUpdateStatus(args);
      case "jobs_draftCoverLetter":
        return handleDraftCoverLetter(args);
      case "jobs_connectionMatches":
        return handleConnectionMatches(args);
      case "linkedin_searchConnections":
        return handleSearchConnections(args);
      case "outreach_draftForMatch":
        return handleDraftForMatch(args);
      case "outreach_getDrafts":
        return handleGetDrafts(args);
      case "outreach_updateDraft":
        return handleUpdateDraft(args);
      case "usage_stats":
        return handleUsageStats(args);
      case "usage_daily":
        return handleUsageDaily(args);
      case "usage_savings":
        return handleUsageSavings(args);
      default:
        return {
          content: [{ type: "text" as const, text: `Unknown tool: ${name}` }],
        };
    }
  } catch (err: any) {
    return {
      content: [
        { type: "text" as const, text: `Error in ${name}: ${err.message}` },
      ],
      isError: true,
    };
  }
});

/** Format a job row from Supabase for display */
function formatSupabaseJob(j: any): string {
  const score = j.match_score != null ? j.match_score : "?";
  const reasons = j.match_reasons?.length > 0 ? ` (${j.match_reasons.join(", ")})` : "";
  return [
    `- **[${score}/10]** ${j.title} @ ${j.company}`,
    `  ${j.location || "Israel"} | ${j.source}${reasons}`,
    j.notes ? `  Why: ${j.notes.slice(0, 100)}` : "",
    j.url ? `  ${j.url}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

async function handleGetHot(args: any) {
  const sb = getSupabase();
  if (!sb) {
    return { content: [{ type: "text" as const, text: "Supabase not configured." }], isError: true };
  }

  const minScore = args?.minScore ?? 8;
  const { data, error } = await sb
    .from("golem_jobs")
    .select("*")
    .gte("match_score", minScore)
    .not("status", "in", "(archived,rejected)")
    .order("match_score", { ascending: false })
    .limit(30);

  if (error || !data || data.length === 0) {
    return {
      content: [{ type: "text" as const, text: `No jobs scoring ${minScore}+ found.` }],
    };
  }

  const lines = [
    `## Hot Jobs (score >= ${minScore})`,
    `**${data.length} matches**\n`,
    ...data.map((j: any) => formatSupabaseJob(j)),
  ];

  return { content: [{ type: "text" as const, text: lines.join("\n") }] };
}

async function handleGetRecent(args: any) {
  const sb = getSupabase();
  if (!sb) {
    return { content: [{ type: "text" as const, text: "Supabase not configured." }], isError: true };
  }

  const limit = args?.limit ?? 20;
  const { data, error } = await sb
    .from("golem_jobs")
    .select("*")
    .order("scraped_at", { ascending: false })
    .limit(limit);

  if (error || !data || data.length === 0) {
    return {
      content: [{ type: "text" as const, text: "No recent job results found." }],
    };
  }

  const lines = [
    `## Recent Job Results (${data.length})`,
    "",
    ...data.map((j: any) => formatSupabaseJob(j)),
  ];

  return { content: [{ type: "text" as const, text: lines.join("\n") }] };
}

async function handleSearch(args: any) {
  const sb = getSupabase();
  if (!sb) {
    return { content: [{ type: "text" as const, text: "Supabase not configured." }], isError: true };
  }

  const query = args?.query;
  if (!query) {
    return {
      content: [{ type: "text" as const, text: "Missing required: query" }],
      isError: true,
    };
  }

  // Search by title, company, or description using ilike
  const { data, error } = await sb
    .from("golem_jobs")
    .select("*")
    .or(`title.ilike.%${query}%,company.ilike.%${query}%,description.ilike.%${query}%`)
    .order("match_score", { ascending: false, nullsFirst: false })
    .limit(20);

  if (error || !data || data.length === 0) {
    return {
      content: [{ type: "text" as const, text: `No jobs matching "${query}".` }],
    };
  }

  const lines = [
    `## Job Search: "${query}"`,
    `**${data.length} matches**\n`,
    ...data.map((j: any) => {
      const score = j.match_score != null ? `[${j.match_score}/10] ` : "";
      return `- ${score}**${j.title}** @ ${j.company} (${j.location || "Israel"}) [${j.source}]\n  ${j.url || ""}`;
    }),
  ];

  return { content: [{ type: "text" as const, text: lines.join("\n") }] };
}

function handleWatchlist() {
  const active = getActiveCompanies();
  const outreach = getOutreachCandidates();

  const lines = [
    "## Company Watchlist",
    `**${active.length} active, ${outreach.length} outreach candidates**\n`,
    "### Active",
    ...active.map(
      (c) =>
        `- ${c.name} (${c.reason}) - last checked: ${c.lastChecked ? new Date(c.lastChecked).toLocaleDateString() : "never"}`
    ),
  ];

  if (outreach.length > 0) {
    lines.push("\n### Outreach Candidates");
    lines.push(
      ...outreach.map(
        (c) => `- ${c.name} - ${c.reason} (${c.outreachStatus || "not started"})`
      )
    );
  }

  return { content: [{ type: "text" as const, text: lines.join("\n") }] };
}

async function handleStats() {
  const sb = getSupabase();
  if (!sb) {
    return { content: [{ type: "text" as const, text: "Supabase not configured." }], isError: true };
  }

  const [totalRes, hotRes, warmRes, coldRes, unscoredRes, recentRes] = await Promise.all([
    sb.from("golem_jobs").select("id", { count: "exact", head: true }),
    sb.from("golem_jobs").select("id", { count: "exact", head: true }).gte("match_score", 8),
    sb.from("golem_jobs").select("id", { count: "exact", head: true }).gte("match_score", 6).lt("match_score", 8),
    sb.from("golem_jobs").select("id", { count: "exact", head: true }).lt("match_score", 6).not("match_score", "is", null),
    sb.from("golem_jobs").select("id", { count: "exact", head: true }).is("match_score", null),
    sb.from("golem_jobs").select("id", { count: "exact", head: true }).gte("scraped_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
  ]);

  const lines = [
    "## Job Pipeline Stats",
    `- **Total in DB:** ${totalRes.count || 0}`,
    `- **Last 24h:** ${recentRes.count || 0} new`,
    `- **Score breakdown:**`,
    `  - Hot (8+): ${hotRes.count || 0}`,
    `  - Warm (6-7): ${warmRes.count || 0}`,
    `  - Cold (<6): ${coldRes.count || 0}`,
    `  - Unscored: ${unscoredRes.count || 0}`,
  ];

  return { content: [{ type: "text" as const, text: lines.join("\n") }] };
}

// --- Supabase-powered handlers ---

async function handleDailyDigest(args: any) {
  const sb = getSupabase();
  if (!sb) {
    return { content: [{ type: "text" as const, text: "Supabase not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY." }], isError: true };
  }

  const hours = args?.hours ?? 24;
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

  // Parallel queries
  const [recentRes, highScoreRes, statusRes, totalRes] = await Promise.all([
    sb.from("golem_jobs").select("*").gte("scraped_at", since).order("match_score", { ascending: false }).limit(50),
    sb.from("golem_jobs").select("*").gte("match_score", 8).gte("scraped_at", since).order("match_score", { ascending: false }),
    sb.from("golem_jobs").select("status").not("status", "in", "(archived,rejected)"),
    sb.from("golem_jobs").select("id", { count: "exact", head: true }),
  ]);

  const recent = recentRes.data || [];
  const highScore = highScoreRes.data || [];
  const statuses = statusRes.data || [];
  const total = totalRes.count || 0;

  // Count by status
  const statusCounts: Record<string, number> = {};
  for (const s of statuses) {
    statusCounts[s.status] = (statusCounts[s.status] || 0) + 1;
  }

  const topMatches = recent.slice(0, 5);

  const lines = [
    `## Daily Job Digest (last ${hours}h)`,
    "",
    `**${recent.length} new matches** | **${highScore.length} high-score (8+)** | **${total} total in DB**`,
    "",
    "### Pipeline",
    `- New: ${statusCounts["new"] || 0}`,
    `- Viewed: ${statusCounts["viewed"] || 0}`,
    `- Saved: ${statusCounts["saved"] || 0}`,
    `- Applied: ${statusCounts["applied"] || 0}`,
    `- Interviewing: ${statusCounts["interviewing"] || 0}`,
    `- Offers: ${statusCounts["offer"] || 0}`,
    "",
  ];

  if (topMatches.length > 0) {
    lines.push("### Top Matches");
    for (const j of topMatches) {
      const reasons = j.match_reasons?.length > 0 ? ` (${j.match_reasons.join(", ")})` : "";
      const score = j.match_score != null ? j.match_score : "?";
      lines.push(`- **[${score}]** ${j.title} @ ${j.company}${reasons}`);
      if (j.url) lines.push(`  ${j.url}`);
    }
  }

  return { content: [{ type: "text" as const, text: lines.join("\n") }] };
}

async function handleUpdateStatus(args: any) {
  const sb = getSupabase();
  if (!sb) {
    return { content: [{ type: "text" as const, text: "Supabase not configured." }], isError: true };
  }

  const { jobId, status } = args || {};
  if (!jobId || !status) {
    return { content: [{ type: "text" as const, text: "Missing required: jobId, status" }], isError: true };
  }

  // Get current job to record status transition
  const { data: job } = await sb.from("golem_jobs").select("status, status_history").eq("id", jobId).single();
  if (!job) {
    return { content: [{ type: "text" as const, text: `Job not found: ${jobId}` }], isError: true };
  }

  const history = Array.isArray(job.status_history) ? job.status_history : [];
  history.push({ from: job.status, to: status, at: new Date().toISOString() });

  const update: Record<string, any> = { status, status_history: history };
  if (status === "applied") {
    update.applied_at = new Date().toISOString();
  }

  const { error } = await sb.from("golem_jobs").update(update).eq("id", jobId);

  if (error) {
    return { content: [{ type: "text" as const, text: `Failed: ${error.message}` }], isError: true };
  }

  return { content: [{ type: "text" as const, text: `Job ${jobId} status: ${job.status} → ${status}` }] };
}

async function handleDraftCoverLetter(args: any) {
  const sb = getSupabase();
  if (!sb) {
    return { content: [{ type: "text" as const, text: "Supabase not configured." }], isError: true };
  }

  const { jobId, style = "professional" } = args || {};
  if (!jobId) {
    return { content: [{ type: "text" as const, text: "Missing required: jobId" }], isError: true };
  }

  // Get job details
  const { data: job } = await sb.from("golem_jobs").select("*").eq("id", jobId).single();
  if (!job) {
    return { content: [{ type: "text" as const, text: `Job not found: ${jobId}` }], isError: true };
  }

  // Load profile for cover letter context
  const profilePath = join(import.meta.dir, "profile.json");
  let profile: any = {};
  try {
    if (existsSync(profilePath)) {
      profile = JSON.parse(readFileSync(profilePath, "utf-8"));
    }
  } catch {}

  // Use Haiku to generate the cover letter
  const { runHaiku } = await import("@golems/shared/lib/cloud-llm");

  const prompt = `Write a ${style} cover letter for this job application.

JOB:
- Title: ${job.title}
- Company: ${job.company}
- Location: ${job.location || "N/A"}
- Description: ${(job.description || "").slice(0, 2000)}

CANDIDATE:
- Name: ${profile.name || "Alon Levi"}
- Experience: ${profile.yearsExperience || 3}+ years
- Skills: ${(profile.primarySkills || []).join(", ")}
- Roles: ${(profile.roles || []).join(", ")}

Match reasons: ${(job.match_reasons || job.tags || []).join(", ")}

Keep it concise (200-300 words). Focus on why this is a great mutual fit.
Use a ${style} tone. No generic filler. Be specific about matching skills.`;

  const draft = await runHaiku(prompt, "cover-letter");

  if (!draft) {
    return { content: [{ type: "text" as const, text: "Failed to generate cover letter. Check Anthropic API key." }], isError: true };
  }

  // Save to database
  const { error } = await sb.from("job_cover_letters").insert({
    job_id: jobId,
    content: draft,
    style,
    generated_by: "haiku",
  });

  if (error) {
    console.error("[CoverLetter] Save error:", error.message);
  }

  const lines = [
    `## Cover Letter Draft — ${job.title} @ ${job.company}`,
    `*Style: ${style} | Generated by Haiku*`,
    "",
    draft,
    "",
    error ? `(Note: failed to save to DB: ${error.message})` : "(Saved to job_cover_letters table)",
  ];

  return { content: [{ type: "text" as const, text: lines.join("\n") }] };
}

async function handleConnectionMatches(args: any) {
  const sb = getSupabase();
  if (!sb) {
    return { content: [{ type: "text" as const, text: "Supabase not configured." }], isError: true };
  }

  const matches = await matchJobsToConnections(sb);

  if (matches.length === 0) {
    return { content: [{ type: "text" as const, text: "No warm leads found. Import connections first with `bun scripts/import-linkedin-connections.ts`." }] };
  }

  // Group by job
  const byJob = new Map<string, typeof matches>();
  for (const m of matches) {
    const key = `${m.jobTitle} @ ${m.jobCompany}`;
    const existing = byJob.get(key) || [];
    existing.push(m);
    byJob.set(key, existing);
  }

  const lines = [`## Warm Leads (${matches.length} connections at hiring companies)\n`];

  for (const [job, conns] of byJob) {
    lines.push(`### ${job}`);
    for (const c of conns) {
      const badge = c.matchType === "exact" ? "EXACT" : c.matchType === "substring" ? "PARTIAL" : "FUZZY";
      lines.push(`- **${c.connectionName}** — ${c.connectionPosition} at ${c.connectionCompany} [${badge}]`);
    }
    lines.push("");
  }

  return { content: [{ type: "text" as const, text: lines.join("\n") }] };
}

async function handleSearchConnections(args: any) {
  const sb = getSupabase();
  if (!sb) {
    return { content: [{ type: "text" as const, text: "Supabase not configured." }], isError: true };
  }

  const query = args?.query?.toLowerCase();
  const limit = args?.limit ?? 20;
  if (!query) {
    return { content: [{ type: "text" as const, text: "Missing required: query" }], isError: true };
  }

  const { data, error } = await sb
    .from("linkedin_connections")
    .select("*")
    .or(`first_name.ilike.%${query}%,last_name.ilike.%${query}%,company.ilike.%${query}%,position.ilike.%${query}%`)
    .limit(limit);

  if (error || !data || data.length === 0) {
    return { content: [{ type: "text" as const, text: `No connections matching "${query}".` }] };
  }

  const lines = [
    `## LinkedIn Connections: "${query}" (${data.length})\n`,
    ...data.map((c: any) =>
      `- **${c.first_name} ${c.last_name}** — ${c.position || "N/A"} at ${c.company || "N/A"}${c.has_messages ? " (has messages)" : ""}${c.linkedin_url ? `\n  ${c.linkedin_url}` : ""}`
    ),
  ];

  return { content: [{ type: "text" as const, text: lines.join("\n") }] };
}

// --- Outreach Drafts ---

async function handleDraftForMatch(args: any) {
  const sb = getSupabase();
  if (!sb) {
    return { content: [{ type: "text" as const, text: "Supabase not configured." }], isError: true };
  }

  const jobId = args?.jobId;
  const connectionId = args?.connectionId;
  if (!jobId || !connectionId) {
    return { content: [{ type: "text" as const, text: "Missing required: jobId and connectionId" }], isError: true };
  }

  const result = await createAndSaveDraft(sb, jobId, connectionId);

  if ("error" in result) {
    return { content: [{ type: "text" as const, text: `Draft failed: ${result.error}` }], isError: true };
  }

  const lines = [
    "## Outreach Draft Created\n",
    `**Approach:** ${result.draft.approachAngle}\n`,
    "**Message:**",
    "```",
    result.draft.messageDraft,
    "```\n",
    `**Follow-up:** ${result.draft.followupPlan}\n`,
    `**Notes:**\n${result.draft.notes}\n`,
    `Draft ID: ${result.id}`,
    "Use outreach_updateDraft to approve/skip.",
  ];

  return { content: [{ type: "text" as const, text: lines.join("\n") }] };
}

async function handleGetDrafts(args: any) {
  const sb = getSupabase();
  if (!sb) {
    return { content: [{ type: "text" as const, text: "Supabase not configured." }], isError: true };
  }

  const drafts = await getOutreachDrafts(sb, args?.status);

  if (drafts.length === 0) {
    return { content: [{ type: "text" as const, text: `No outreach drafts${args?.status ? ` with status "${args.status}"` : ""}.` }] };
  }

  const lines = [`## Outreach Drafts (${drafts.length})\n`];
  for (const d of drafts) {
    const job = d.golem_jobs;
    const conn = d.linkedin_connections;
    const statusBadge = d.status === "pending" ? "Pending" :
      d.status === "approved" ? "Approved" :
      d.status === "sent" ? "Sent" : d.status;

    lines.push(`### ${conn?.full_name || "Unknown"} → ${job?.title || "Unknown"} at ${job?.company || "Unknown"}`);
    lines.push(`Status: **${statusBadge}** | Score: ${job?.match_score || "N/A"}/10`);
    lines.push(`Angle: ${d.approach_angle}`);
    lines.push(`Message: ${d.message_draft.length > 100 ? d.message_draft.slice(0, 100) + "..." : d.message_draft}`);
    lines.push(`ID: ${d.id}`);
    lines.push("");
  }

  return { content: [{ type: "text" as const, text: lines.join("\n") }] };
}

async function handleUpdateDraft(args: any) {
  const sb = getSupabase();
  if (!sb) {
    return { content: [{ type: "text" as const, text: "Supabase not configured." }], isError: true };
  }

  const draftId = args?.draftId;
  const status = args?.status;
  if (!draftId || !status) {
    return { content: [{ type: "text" as const, text: "Missing required: draftId and status" }], isError: true };
  }

  const ok = await updateDraftStatus(sb, draftId, status);
  return {
    content: [{
      type: "text" as const,
      text: ok ? `Draft ${draftId} updated to "${status}".` : `Failed to update draft ${draftId}.`,
    }],
    isError: !ok,
  };
}

// --- Usage Stats ---

const COST_LOG_PATH = join(process.env.GOLEMS_STATE_DIR || `${process.env.HOME}/.golems-zikaron`, "api_costs.jsonl");

async function handleUsageStats(args: any) {
  const validPeriods = ["today", "week", "month", "all"] as const;
  const period = validPeriods.includes(args?.period) ? args.period : "today";

  // Try Supabase first (persistent), fall back to local JSONL
  let stats;
  let source = "supabase";
  try {
    stats = await getSupabaseUsageStats(period);
  } catch {
    stats = { ...getFullUsageStats(COST_LOG_PATH, period), subscription: { monthlyCost: CC_SUBSCRIPTION_MONTHLY, actualValue: 0, sessions: 0, totalTokens: 0 } };
    source = "local";
  }

  const lines = [
    `## AI Usage (${period}) [${source}]`,
    "",
    `### Paid API Calls (Haiku)`,
    `- Total: ${stats.paid.totalCalls} calls`,
    `- Cost: $${stats.paid.totalCost.toFixed(4)}`,
    `- Tokens: ${stats.paid.totalInputTokens} in / ${stats.paid.totalOutputTokens} out`,
    "",
  ];

  const sources = Object.entries(stats.paid.bySource);
  if (sources.length > 0) {
    lines.push("**By Source:**");
    for (const [src, s] of sources.sort((a, b) => b[1].totalCost - a[1].totalCost)) {
      lines.push(`- ${src}: ${s.totalCalls} calls, $${s.totalCost.toFixed(4)}`);
    }
    lines.push("");
  }

  if (stats.subscription.sessions > 0) {
    lines.push(`### Claude Code (Subscription)`);
    lines.push(`- Sessions tracked: ${stats.subscription.sessions}`);
    lines.push(`- Actual value: $${stats.subscription.actualValue.toFixed(2)}`);
    lines.push(`- Subscription: $${stats.subscription.monthlyCost}/mo`);
    lines.push(`- Tokens: ${stats.subscription.totalTokens.toLocaleString()}`);
    lines.push("");
  }

  lines.push(`### Free CLI Helpers`);
  lines.push(`- Total: ${stats.free.totalCalls} calls`);

  const helpers = Object.entries(stats.free.byHelper);
  if (helpers.length > 0) {
    lines.push("**By Helper:**");
    for (const [h, count] of helpers.sort((a, b) => b[1] - a[1])) {
      lines.push(`- ${h}: ${count} calls`);
    }
  }

  const freeSources = Object.entries(stats.free.bySource);
  if (freeSources.length > 0) {
    lines.push("**By Source:**");
    for (const [src, count] of freeSources.sort((a, b) => b[1] - a[1])) {
      lines.push(`- ${src}: ${count} calls`);
    }
  }

  if (stats.free.estimatedValueSaved > 0) {
    lines.push(`- **Value saved: ~$${stats.free.estimatedValueSaved.toFixed(4)}** (at Haiku rates)`);
  }

  lines.push("", `**Combined: ${stats.combined.totalCalls} total calls**`);

  return { content: [{ type: "text" as const, text: lines.join("\n") }] };
}

async function handleUsageDaily(args: any) {
  const days = args?.days || 7;

  // Try Supabase first
  try {
    const entries = await readFromSupabase("all");
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const recent = entries.filter(e => new Date(e.timestamp) >= cutoff);
    const daily = groupByDay(recent);
    return { content: [{ type: "text" as const, text: formatDaily(daily) }] };
  } catch {
    // Fall back to local
    const allEntries = readCostLog(COST_LOG_PATH);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const recent = allEntries.filter(e => new Date(e.timestamp) >= cutoff);
    const daily = groupByDay(recent);
    return { content: [{ type: "text" as const, text: formatDaily(daily) }] };
  }
}

async function handleUsageSavings(args: any) {
  const validPeriods = ["today", "week", "month", "all"] as const;
  const period = validPeriods.includes(args?.period) ? args.period : "month";

  let stats;
  try {
    stats = await getSupabaseUsageStats(period);
  } catch {
    stats = { ...getFullUsageStats(COST_LOG_PATH, period), subscription: { monthlyCost: CC_SUBSCRIPTION_MONTHLY, actualValue: 0, sessions: 0, totalTokens: 0 } };
  }

  // Value calculations
  const ccSubscription = CC_SUBSCRIPTION_MONTHLY;
  const ccActualValue = stats.subscription.actualValue || 0;
  const ccSavings = ccActualValue - ccSubscription;

  // Haiku costs
  const haikuCost = stats.paid.totalCost;

  // Value saved by using free CLI helpers instead of Haiku API
  const estimatedFreeValue = stats.free.estimatedValueSaved;

  const totalValue = ccActualValue + estimatedFreeValue;

  const lines = [
    `## AI Cost Savings (${period})`,
    "",
    `### What You Pay`,
    `- Claude Code Max: $${ccSubscription}/mo (subscription)`,
    `- Haiku API (cloud worker, ${period}): $${haikuCost.toFixed(4)}`,
    "",
    `### What You Get`,
    `- CC actual API value: $${ccActualValue.toFixed(2)}`,
    `- Free CLI helpers value: ~$${estimatedFreeValue.toFixed(2)}`,
    `- **Total value: ~$${totalValue.toFixed(2)}**`,
    "",
    `### ROI`,
    ccActualValue > 0
      ? `- CC savings: **$${ccSavings.toFixed(2)}** (${((ccActualValue / ccSubscription) * 100).toFixed(0)}% of cost if pay-per-use)`
      : `- CC savings: Submit usage via \`ccusage\` to track`,
    `- Free tier calls: ${stats.free.totalCalls} (saved ~$${estimatedFreeValue.toFixed(2)})`,
    `- Haiku efficiency: ${stats.paid.totalCalls} calls for $${haikuCost.toFixed(4)}`,
    "",
    `### Breakdown by Source`,
  ];

  const allSources = new Set([
    ...Object.keys(stats.paid.bySource),
    ...Object.keys(stats.free.bySource),
  ]);

  for (const src of [...allSources].sort()) {
    const paid = stats.paid.bySource[src];
    const free = stats.free.bySource[src] || 0;
    if (paid) {
      lines.push(`- ${src}: ${paid.totalCalls} paid ($${paid.totalCost.toFixed(4)}) + ${free} free`);
    } else {
      lines.push(`- ${src}: ${free} free calls`);
    }
  }

  return { content: [{ type: "text" as const, text: lines.join("\n") }] };
}

// --- Start ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[golems-jobs] MCP server running on stdio");
}

main().catch((err) => {
  console.error("[golems-jobs] Fatal:", err);
  process.exit(1);
});
