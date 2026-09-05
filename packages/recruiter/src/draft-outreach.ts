/**
 * Outreach Draft Generator for Connection-Job Matches
 *
 * Given a LinkedIn connection who works at a company that's hiring,
 * generates a personalized outreach strategy including:
 * - Approach angle (what you have in common)
 * - Message draft (in user's voice)
 * - Follow-up plan
 * - Notes on what to mention/avoid
 */

import type { SupabaseClient } from "@golems/shared/lib/supabase-factory";
import { getOutreachStyleGuidelines, getStyleAppropriateGreeting, getStyleAppropriateSignOff, type StyleGuidelines } from "./style-adapter";
import { getDefaultProfile, type UserProfile } from "./outreach";

/** Connection data from Supabase linkedin_connections table */
export interface ConnectionInfo {
  id: string;
  first_name: string;
  last_name: string;
  full_name: string;
  company: string;
  position: string | null;
  linkedin_url: string | null;
  has_messages: boolean;
  relationship_strength: string | null;
}

/** Job data from Supabase golem_jobs table */
export interface JobInfo {
  id: string;
  title: string;
  company: string;
  url: string;
  description: string | null;
  match_score: number | null;
  match_reasons: string[] | null;
  tech_stack: string[] | null;
}

/** Match data from Supabase job_connections table */
export interface MatchInfo {
  company_match_type: "exact" | "fuzzy" | "substring";
  match_confidence: number;
}

/** Generated outreach draft */
export interface OutreachDraft {
  approachAngle: string;
  messageDraft: string;
  followupPlan: string;
  notes: string;
}

/**
 * Find the best approach angle for reaching out to a connection about a job.
 */
function findApproachAngle(
  connection: ConnectionInfo,
  job: JobInfo,
  match: MatchInfo,
  profile: UserProfile
): string {
  const angles: string[] = [];

  // 1. Previous messages = strongest signal
  if (connection.has_messages) {
    angles.push("You've exchanged messages before — this is a warm connection");
  }

  // 2. Relationship strength
  if (connection.relationship_strength === "strong") {
    angles.push("Strong existing relationship");
  }

  // 3. Shared company (connection works at hiring company)
  if (match.company_match_type === "exact") {
    angles.push(`${connection.first_name} works directly at ${job.company}`);
  } else if (match.company_match_type === "substring") {
    angles.push(`${connection.first_name}'s company (${connection.company}) is related to ${job.company}`);
  }

  // 4. Position-based angle (check recruiter first — most specific)
  if (connection.position) {
    const pos = connection.position.toLowerCase();
    if (pos.includes("recruiter") || pos.includes("talent") || pos.includes("hr") || pos.includes("people")) {
      angles.push(`${connection.first_name} is in recruiting/HR — direct pipeline`);
    } else if (pos.includes("manager") || pos.includes("director") || pos.includes("vp") || pos.includes("head of")) {
      angles.push(`${connection.first_name} is in a leadership role — may know the hiring manager`);
    } else if (pos.includes("engineer") || pos.includes("developer") || pos.includes("architect")) {
      angles.push(`Fellow engineer — can speak to team culture and tech stack`);
    }
  }

  // 5. Tech stack overlap
  if (job.tech_stack && job.tech_stack.length > 0) {
    const overlap = job.tech_stack.filter(t =>
      profile.techStack.some(pt => pt.toLowerCase() === t.toLowerCase())
    );
    if (overlap.length > 0) {
      angles.push(`Shared tech: ${overlap.slice(0, 3).join(", ")}`);
    }
  }

  return angles.length > 0
    ? angles.slice(0, 3).join(". ") + "."
    : `${connection.first_name} works at ${job.company} which is hiring for ${job.title}.`;
}

/**
 * Generate a personalized outreach message draft.
 */
function generateMessageDraft(
  connection: ConnectionInfo,
  job: JobInfo,
  match: MatchInfo,
  profile: UserProfile,
  style: StyleGuidelines
): string {
  const firstName = connection.first_name;
  const greeting = getStyleAppropriateGreeting(firstName, style);
  const signOff = getStyleAppropriateSignOff(style);

  const lines: string[] = [];
  lines.push(greeting);
  lines.push("");

  // Opening — reference the relationship
  if (connection.has_messages) {
    lines.push(`Hope you're doing well! It's been a while since we last connected.`);
  } else {
    lines.push(`Hope you're doing well!`);
  }
  lines.push("");

  // The ask — specific job reference
  lines.push(`I noticed ${job.company} has an opening for a ${job.title}, and since you're at ${connection.company}, I thought you might have some insight.`);
  lines.push("");

  // Brief value prop
  if (job.match_reasons && job.match_reasons.length > 0) {
    const topReasons = job.match_reasons.slice(0, 2);
    lines.push(`The role caught my eye because:`);
    for (const reason of topReasons) {
      lines.push(`- ${reason}`);
    }
  } else if (job.tech_stack && job.tech_stack.length > 0) {
    const overlap = job.tech_stack.filter(t =>
      profile.techStack.some(pt => pt.toLowerCase() === t.toLowerCase())
    );
    if (overlap.length > 0) {
      lines.push(`I've been working extensively with ${overlap.slice(0, 3).join(", ")} which aligns well with the role.`);
    } else {
      lines.push(`My background in ${profile.techStack.slice(0, 3).join(", ")} seems like a good fit.`);
    }
  } else {
    lines.push(`My background in ${profile.techStack.slice(0, 3).join(", ")} seems like a good fit.`);
  }
  lines.push("");

  // Soft ask
  lines.push(`Would you be open to a quick chat about the team, or would you be comfortable putting in a referral? Either way, totally appreciate your time.`);
  lines.push("");

  // Sign off
  lines.push(signOff);
  lines.push(profile.name);

  return lines.join("\n");
}

/**
 * Generate a follow-up plan based on connection strength.
 */
function generateFollowupPlan(connection: ConnectionInfo): string {
  if (connection.has_messages || connection.relationship_strength === "strong") {
    return "Wait 3-4 days. If no response, send a brief follow-up: 'Hey, just bumping this up — no worries if the timing isn't right!'";
  }
  return "Wait 5-7 days. One follow-up max: 'Hi [name], just wanted to make sure this didn't get lost. Totally understand if you're busy!'";
}

/**
 * Generate notes on what to mention/avoid.
 */
function generateNotes(
  connection: ConnectionInfo,
  job: JobInfo,
  match: MatchInfo
): string {
  const notes: string[] = [];

  // Mention
  if (job.match_score && job.match_score >= 8) {
    notes.push("MENTION: High match score — lead with enthusiasm about the role");
  }
  if (connection.position) {
    notes.push(`MENTION: Reference their role as ${connection.position}`);
  }
  if (match.company_match_type === "exact") {
    notes.push("MENTION: They can speak directly about the team");
  }

  // Avoid
  if (match.company_match_type === "fuzzy") {
    notes.push("AVOID: Don't assume they know about this specific team/role — their company match is fuzzy");
  }
  if (!connection.has_messages) {
    notes.push("AVOID: Don't be overly familiar — you haven't messaged before");
  }
  notes.push("AVOID: Don't send on weekends. Best: Tue-Thu, 8-10am or 5-7pm");
  notes.push("AVOID: Keep under 150 words. LinkedIn DMs should be concise");

  return notes.join("\n");
}

/**
 * Generate a complete outreach draft for a connection-job match.
 */
export function generateOutreachDraft(
  connection: ConnectionInfo,
  job: JobInfo,
  match: MatchInfo
): OutreachDraft {
  const profile = getDefaultProfile();
  const style = getOutreachStyleGuidelines();

  return {
    approachAngle: findApproachAngle(connection, job, match, profile),
    messageDraft: generateMessageDraft(connection, job, match, profile, style),
    followupPlan: generateFollowupPlan(connection),
    notes: generateNotes(connection, job, match),
  };
}

/**
 * Generate and save an outreach draft to Supabase.
 */
export async function createAndSaveDraft(
  supabase: SupabaseClient,
  jobId: string,
  connectionId: string
): Promise<{ draft: OutreachDraft; id: string } | { error: string }> {
  // Fetch connection data
  const { data: connection, error: connError } = await supabase
    .from("linkedin_connections")
    .select("id, first_name, last_name, full_name, company, position, linkedin_url, has_messages, relationship_strength")
    .eq("id", connectionId)
    .single();

  if (connError || !connection) {
    return { error: `Connection not found: ${connError?.message || "unknown"}` };
  }

  // Fetch job data
  const { data: job, error: jobError } = await supabase
    .from("golem_jobs")
    .select("id, title, company, url, description, match_score, match_reasons, tech_stack")
    .eq("id", jobId)
    .single();

  if (jobError || !job) {
    return { error: `Job not found: ${jobError?.message || "unknown"}` };
  }

  // Fetch match data
  const { data: matchData, error: matchError } = await supabase
    .from("job_connections")
    .select("company_match_type, match_confidence")
    .eq("job_id", jobId)
    .eq("connection_id", connectionId)
    .single();

  if (matchError || !matchData) {
    return { error: `Match not found: ${matchError?.message || "unknown"}` };
  }

  // Generate the draft
  const draft = generateOutreachDraft(connection, job, matchData);

  // Save to Supabase
  const { data: saved, error: saveError } = await supabase
    .from("outreach_drafts")
    .upsert({
      job_id: jobId,
      connection_id: connectionId,
      approach_angle: draft.approachAngle,
      message_draft: draft.messageDraft,
      followup_plan: draft.followupPlan,
      notes: draft.notes,
      status: "pending",
      updated_at: new Date().toISOString(),
    }, { onConflict: "job_id,connection_id" })
    .select("id")
    .single();

  if (saveError || !saved) {
    return { error: `Save failed: ${saveError?.message || "unknown"}` };
  }

  return { draft, id: saved.id };
}

/**
 * Get all outreach drafts with their associated job and connection data.
 */
export async function getOutreachDrafts(
  supabase: SupabaseClient,
  status?: string
): Promise<any[]> {
  let query = supabase
    .from("outreach_drafts")
    .select(`
      id, approach_angle, message_draft, followup_plan, notes, status, created_at,
      golem_jobs!outreach_drafts_job_id_fkey (id, title, company, url, match_score),
      linkedin_connections!outreach_drafts_connection_id_fkey (id, full_name, company, position, linkedin_url)
    `)
    .order("created_at", { ascending: false })
    .limit(50);

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error } = await query;
  if (error) {
    console.error("[DraftOutreach] Failed to fetch drafts:", error.message);
    return [];
  }

  return data || [];
}

/**
 * Update outreach draft status.
 */
export async function updateDraftStatus(
  supabase: SupabaseClient,
  draftId: string,
  status: "approved" | "sent" | "replied" | "skipped"
): Promise<boolean> {
  const updates: Record<string, any> = {
    status,
    updated_at: new Date().toISOString(),
  };

  if (status === "approved") updates.approved_at = new Date().toISOString();
  if (status === "sent") updates.sent_at = new Date().toISOString();

  const { error } = await supabase
    .from("outreach_drafts")
    .update(updates)
    .eq("id", draftId);

  if (error) {
    console.error("[DraftOutreach] Failed to update status:", error.message);
    return false;
  }

  return true;
}

/**
 * Format a draft for Telegram display (short preview).
 */
export function formatDraftForTelegram(draft: OutreachDraft, connectionName: string, jobTitle: string, company: string): string {
  const lines: string[] = [];
  lines.push(`*Outreach Draft: ${connectionName}*`);
  lines.push(`Job: ${jobTitle} at ${company}`);
  lines.push("");
  lines.push(`*Angle:* ${draft.approachAngle}`);
  lines.push("");
  // Show first 200 chars of message
  const preview = draft.messageDraft.length > 200
    ? draft.messageDraft.slice(0, 200) + "..."
    : draft.messageDraft;
  lines.push(`*Message:*\n${preview}`);
  lines.push("");
  lines.push(`*Follow-up:* ${draft.followupPlan}`);
  lines.push("");
  lines.push("Reply: approve / edit / skip");
  lines.push("Full draft on dashboard");
  return lines.join("\n");
}
