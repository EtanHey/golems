#!/usr/bin/env bun
/**
 * Job Golem - Matcher
 *
 * Uses Ollama (Qwen3) to match jobs against your profile.
 * Handles both English and Hebrew job listings.
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import type { JobListing } from "./scraper";
import { forJobGolem } from "@golems/shared/lib/llm";

// Try multiple paths — import.meta.dir can differ between local/hosted/compiled
const PROFILE_CANDIDATES = [
  join(import.meta.dir, "profile.json"),
  join(import.meta.dir, "../jobs/src/profile.json"),
  "/root/Gits/golems/packages/jobs/src/profile.json",
  join(process.env.HOME || "", "Gits/golems/packages/jobs/src/profile.json"),
];
const PROFILE_PATH = PROFILE_CANDIDATES.find(p => existsSync(p)) || PROFILE_CANDIDATES[0];

export interface MatchResult {
  job: JobListing;
  score: number; // 1-10
  reason: string;
  highlights: string[]; // Matching skills/keywords
}

// Cached profile to avoid redundant file reads
let cachedProfile: any = null;

// Load candidate profile (cached)
function loadProfile() {
  if (!cachedProfile) {
    if (!existsSync(PROFILE_PATH)) {
      console.error(`[Matcher] profile.json not found! Tried: ${PROFILE_CANDIDATES.join(", ")}`);
      // Return minimal fallback so JobGolem doesn't crash
      return {
        yearsExperience: 3,
        roles: ["Full Stack Developer", "Frontend Engineer"],
        primarySkills: ["TypeScript", "React", "Next.js", "Node.js"],
        secondarySkills: [],
        integrations: [],
        languages: { Hebrew: "native", English: "near-native" },
        keywords: ["react", "typescript", "frontend", "fullstack"],
        excludeKeywords: [],
        excludeCompanies: [],
      };
    }
    cachedProfile = JSON.parse(readFileSync(PROFILE_PATH, "utf-8"));
  }
  return cachedProfile;
}

/**
 * Call Ollama for job matching (via wrapper for sandboxed mode support)
 */
async function callLLM(prompt: string): Promise<{ score: number; reason: string; highlights: string[] } | null> {
  const result = await forJobGolem.runLLMJSON<{
    score: number;
    reason: string;
    highlights: string[];
  }>(prompt);

  if (result) {
    // Normalize score to 1-10 range — LLMs sometimes return 0-100 scale
    let score = result.score || 5;
    if (score > 10) score = Math.max(1, Math.min(10, Math.round(score / 10)));
    score = Math.max(1, Math.min(10, score));

    return {
      score,
      reason: result.reason || "No reason",
      highlights: result.highlights || [],
    };
  }

  return null;
}

/**
 * Match a single job against profile
 */
export async function matchJob(job: JobListing): Promise<MatchResult> {
  const profile = loadProfile();

  const isHebrew = job.language === "he";

  // Build matching prompt with nuanced requirements understanding
  const prompt = `You are a job matching assistant. Analyze if this job is a good fit for the candidate.

CANDIDATE PROFILE:
- Experience: ${profile.yearsExperience}+ years
- Target roles: ${profile.roles.join(", ")}
- PRIMARY skills (daily use): ${profile.primarySkills.join(", ")}
- SECONDARY skills (production experience): ${profile.secondarySkills.join(", ")}
- Languages: Hebrew (native), English (near-native), Spanish (intermediate)
- Location: Looking for jobs in Israel or fully remote

JOB LISTING${isHebrew ? " (Hebrew - translate if needed)" : ""}:
- Title: ${job.title}
- Company: ${job.company}
- Location: ${job.location}
- Description: ${job.description || "(no description)"}
- Source: ${job.source}

CRITICAL: Distinguish between REQUIREMENTS and NICE-TO-HAVE!
- Look for sections like "Requirements", "Must have" vs "Nice to have", "Preferred", "Bonus"
- Wrong-stack tech (C#, .NET, Java, Angular, PHP) in REQUIREMENTS = low score (1-3)
- Wrong-stack tech in NICE-TO-HAVE only, with right-stack (React/TypeScript) in REQUIREMENTS = still good (7-9)

SCORING LOGIC:
1. First: Is this the RIGHT tech stack (React/TypeScript/Next.js ecosystem)?
   - If wrong stack (Java/.NET/C#/Angular/PHP) is REQUIRED → score 1-3
   - If wrong stack is only nice-to-have but React/TS is required → continue scoring
2. Then: Does experience level match (3+ years, not senior/staff/principal)?
3. Then: Is location compatible (Israel or remote)?
4. Finally: How many primary skills match the requirements?

SCORES:
- 9-10: React/TS ecosystem, experience matches, location works, most skills align
- 7-8: Right stack, good fit with minor gaps
- 5-6: Partial match, might be worth a look
- 3-4: Weak match, significant gaps
- 1-2: Wrong stack in requirements, wrong seniority, or wrong location

Respond with ONLY a JSON object:
{"score": 1-10, "reason": "brief explanation including what's REQUIRED vs nice-to-have", "highlights": ["matching", "skills"]}`;

  const result = await callLLM(prompt);

  if (result) {
    return {
      job,
      score: result.score,
      reason: result.reason,
      highlights: result.highlights,
    };
  }

  // Default score if Ollama fails
  return {
    job,
    score: 5,
    reason: "Scoring unavailable",
    highlights: [],
  };
}

/**
 * Match multiple jobs and sort by score
 * Now with parallel processing support via OLLAMA_NUM_PARALLEL env var
 */
export async function matchJobs(jobs: JobListing[], minScore = 6): Promise<MatchResult[]> {
  console.log(`[Matcher] Scoring ${jobs.length} jobs with Ollama...`);

  const startTime = Date.now();
  const results: MatchResult[] = [];

  // Process jobs - Ollama handles parallelism via OLLAMA_NUM_PARALLEL
  // No artificial delay needed - Ollama batches requests automatically
  for (const job of jobs) {
    console.log(`  • Scoring: ${job.title} @ ${job.company}`);
    const result = await matchJob(job);
    results.push(result);
    // Removed 500ms delay - Ollama handles rate limiting internally
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // Filter and sort by score
  const matches = results
    .filter(r => r.score >= minScore)
    .sort((a, b) => b.score - a.score);

  console.log(`[Matcher] ${matches.length}/${jobs.length} jobs scored ${minScore}+ in ${elapsed}s`);
  return matches;
}

/**
 * TIER 0: NOT A JOB - these are notification emails from job boards
 * Pattern: "0 משרות חדשות של X" = "0 new jobs of type X"
 */
const NOT_A_JOB_PATTERNS = [
  /^0\s+משרות/i,  // "0 משרות..." - notification email, not a job
  /משרות.*מחכות לכם/i,  // "X jobs are waiting for you" - notification
];

/**
 * TIER 0: Instant reject based on job title
 * These are wrong-stack jobs that don't need any further analysis
 */
const WRONG_STACK_TITLE_PATTERNS = [
  // Wrong programming languages/frameworks
  // Note: \.net requires word boundary before to avoid matching domain names like company.net
  /\b(java|c#|dotnet|php|angular)\s+(developer|engineer|programmer)/i,
  /(?<![a-z])\.net\s+(developer|engineer|programmer)/i,  // .net but not domain.net
  /\bsenior\s+java\b/i,
  /\bsenior\s+c\+\+/i,
  /\bc\+\+\s+(developer|engineer)/i,
  /\brust\s+(developer|engineer)/i,
  /\b(devops|sre|site reliability|infrastructure|platform)\s+(engineer|developer)/i,
  /\b(data\s+scientist|machine\s+learning|ml\s+engineer|ai\s+engineer)/i,
  /\b(embedded|firmware|hardware)\s+(engineer|developer)/i,
  /\b(qa|quality\s+assurance|test)\s+(engineer|developer|analyst)/i,
  /\bcobol\b/i,
  /\brpg\s+developer/i,
  /\babap\b/i,
  /\bsap\s+developer/i,
  /\bmagento/i,
  /\bdocumentum/i,
  /\boutsystems/i,
  /\brpa\s+(developer|bot|automation)/i,

  // Wrong roles (non-development)
  /\bdba\b/i,
  /\bdatabase\s+administrator/i,
  /\b(system|systems)\s+analyst/i,
  /\bbusiness\s+intelligence\b/i,
  /\bbi\s+(developer|analyst|engineer)/i,
  /\bcustomer\s+success/i,
  /\bhelpdesk/i,
  /\bhelp\s+desk/i,
  /\bit\s+support/i,
  /\btechnical\s+support/i,
  /\bsupport\s+(engineer|specialist)/i,
  /\bpmo\b/i,
  /\bproject\s+management\s+office/i,
  /\btraining\b/i,
  /\b(system|it)\s+admin/i,
  // Note: "data engineer" moved to WRONG_STACK_REQUIRED_KEYWORDS - it's often nice-to-have

  // Hebrew wrong roles
  /מנתח[\\/]?ת?\s+מערכות/,  // System analyst
  /מיישם[\\/]?ת?\s+מערכות/,  // System implementer
  /מהנדס[\\/]?ת?\s+אוטומציה/,  // Automation engineer
  /מנהל[\\/]?ת?\s+מערכות\s+מחשוב/,  // IT admin
  /מפתח[\\/]?ת?\s+אינטגרציה/,  // Integration developer
  /מפתח[\\/]?ת?\s+תקשורת/,  // Communication/network developer
  /תמיכה\s+טכנית/,  // Technical support

  // Hebrew wrong stack (Java, Angular, .NET etc)
  /מפתח[\\/]?ת?\s+java/i,  // Java developer
  /מפתח[\\/]?ת?\s+angular/i,  // Angular developer
  /מפתח[\\/]?ת?\s+\.net/i,  // .NET developer
  /מפתח[\\/]?ת?\s+c#/i,  // C# developer
  /מפתח[\\/]?ת?\s+מערכות\s+מידע/,  // Information systems developer
];

/**
 * TIER 0: Instant pass - these are definitely worth scoring
 */
const RIGHT_STACK_TITLE_PATTERNS = [
  /\b(react|next\.?js|typescript|frontend|front-end)\s+(developer|engineer)/i,
  /\b(full\s*stack|fullstack)\s+(developer|engineer)/i,
  /\bnode\.?js\s+(developer|engineer)/i,
];

/**
 * TIER 1: Wrong-stack keywords in REQUIREMENTS section
 * If these appear in requirements (not just nice-to-have), likely wrong fit
 */
const WRONG_STACK_REQUIRED_KEYWORDS = [
  // C# / .NET ecosystem
  'c# required', 'c# is required', 'must have c#', 'must know c#',
  '.net required', '.net is required', 'must have .net', 'must know .net',
  '.net core', 'asp.net', 'wcf', 'entity framework',
  'experience with c#', 'years of c#', 'שנות ניסיון ב-c#',

  // Java ecosystem
  'java required', 'java is required', 'must have java', 'must know java',
  'experience with java', 'years of java', 'spring boot', 'spring framework',
  'שנות ניסיון ב-java', 'שליטה ב-java',

  // Angular (not React)
  'angular required', 'angular is required', 'must have angular',
  'experience with angular', 'years of angular',
  'שליטה ב-angular', 'ניסיון ב-angular',

  // PHP
  'php required', 'php is required', 'must have php',
  'laravel', 'symfony', 'wordpress developer',

  // Go/Rust/Python as primary
  'python required', 'python is required', 'must have python',
  'go required', 'golang required', 'must have go',
  'rust required', 'must have rust',

  // Data/DBA
  'dba experience', 'database administration',
  'neo4j', 'cassandra', 'hadoop', 'spark',

  // Data Engineering (when it's the primary role)
  'data engineer required', 'data engineer is required',
  'must have data engineering', 'data engineering experience required',
];

/**
 * Section headers that indicate REQUIREMENTS (not nice-to-have)
 */
const REQUIREMENTS_SECTION_PATTERNS = [
  /requirements?:?/i,
  /must\s+have:?/i,
  /essential:?/i,
  /what\s+you('ll)?\s+need:?/i,
  /minimum\s+qualifications?:?/i,
  /required\s+skills?:?/i,
];

/**
 * Section headers that indicate NICE-TO-HAVE (safe to have wrong-stack here)
 */
const PREFERRED_SECTION_PATTERNS = [
  /nice\s+to\s+have:?/i,
  /preferred:?/i,
  /bonus:?/i,
  /a\s+plus:?/i,
  /ideal(ly)?:?/i,
  /desired:?/i,
  /advantage:?/i,
];

/**
 * Extract the requirements section from a job description
 */
function extractRequirementsSection(description: string): string {
  const lines = description.split('\n');
  let inRequirements = false;
  let requirementsText = '';

  for (const line of lines) {
    // Check if we're entering a requirements section
    if (REQUIREMENTS_SECTION_PATTERNS.some(p => p.test(line))) {
      inRequirements = true;
      continue;
    }
    // Check if we're entering a preferred section (exit requirements)
    if (PREFERRED_SECTION_PATTERNS.some(p => p.test(line))) {
      inRequirements = false;
      continue;
    }
    // Collect requirements text
    if (inRequirements) {
      requirementsText += line + ' ';
    }
  }

  // If no clear sections, treat first 60% as requirements
  if (!requirementsText) {
    const cutoff = Math.floor(description.length * 0.6);
    requirementsText = description.substring(0, cutoff);
  }

  return requirementsText.toLowerCase();
}

export interface PrefilterResult {
  job: JobListing;
  tier: 'PASS' | 'REJECT' | 'NEEDS_LLM';
  reason: string;
}

/**
 * Tiered pre-filter before expensive Ollama scoring
 *
 * Tier 0: Title-based instant reject/pass (~40% filtered)
 * Tier 1: Requirements section analysis (~30% filtered)
 * Tier 2: Needs LLM for nuanced decision (~30% go to Ollama)
 */
export function prefilterJob(job: JobListing): PrefilterResult {
  const title = job.title.toLowerCase();
  const description = (job.description || '').toLowerCase();
  const text = `${title} ${description}`;

  // TIER -1: Not a job - these are notification emails from job boards
  for (const pattern of NOT_A_JOB_PATTERNS) {
    if (pattern.test(job.title)) {
      return { job, tier: 'REJECT', reason: `Not a job listing (notification email): ${job.title}` };
    }
  }

  // TIER 0: Title-based instant reject
  for (const pattern of WRONG_STACK_TITLE_PATTERNS) {
    if (pattern.test(job.title)) {
      return { job, tier: 'REJECT', reason: `Wrong role/stack in title: ${job.title}` };
    }
  }

  // TIER 0: Title-based instant pass (still needs LLM for scoring, but definitely worth it)
  for (const pattern of RIGHT_STACK_TITLE_PATTERNS) {
    if (pattern.test(job.title)) {
      return { job, tier: 'PASS', reason: `Right stack in title: ${job.title}` };
    }
  }

  // Load profile for excludeKeywords check (needed for both Hebrew and English)
  const profile = loadProfile();
  const excludeKeywords = profile.excludeKeywords.map((k: string) => k.toLowerCase());

  // Check excludeKeywords for ALL jobs (including Hebrew)
  for (const kw of excludeKeywords) {
    if (text.includes(kw)) {
      return { job, tier: 'REJECT', reason: `Excluded keyword: "${kw}"` };
    }
  }

  // Hebrew jobs skip remaining checks but pass to LLM (need language understanding)
  if (job.language === 'he') {
    return { job, tier: 'NEEDS_LLM', reason: 'Hebrew job - needs LLM' };
  }

  // TIER 1: Check for wrong-stack in requirements section
  const requirementsSection = extractRequirementsSection(description);
  for (const keyword of WRONG_STACK_REQUIRED_KEYWORDS) {
    if (requirementsSection.includes(keyword)) {
      return { job, tier: 'REJECT', reason: `Wrong stack in requirements: "${keyword}"` };
    }
  }

  // TIER 1: Check if any primary skills are mentioned (profile already loaded above)
  const primarySkills = profile.primarySkills.map((s: string) => s.toLowerCase());
  const hasPrimarySkill = primarySkills.some((skill: string) => text.includes(skill));

  if (!hasPrimarySkill) {
    // No primary skills mentioned - likely wrong stack
    return { job, tier: 'REJECT', reason: 'No primary skills (React/TypeScript/Next.js) mentioned' };
  }

  // Passed basic checks - needs LLM for nuanced scoring
  return { job, tier: 'NEEDS_LLM', reason: 'Passed pre-filter, needs LLM scoring' };
}

/**
 * Quick keyword filter before expensive Ollama scoring
 * Now uses tiered approach for better filtering
 */
export function prefilterJobs(jobs: JobListing[]): JobListing[] {
  const results = jobs.map(job => prefilterJob(job));

  // Log filtering stats
  const rejected = results.filter(r => r.tier === 'REJECT');
  const passed = results.filter(r => r.tier === 'PASS');
  const needsLlm = results.filter(r => r.tier === 'NEEDS_LLM');

  console.log(`[Prefilter] ${jobs.length} jobs → ${rejected.length} rejected, ${passed.length} instant pass, ${needsLlm.length} need LLM`);

  // Log some rejection reasons for debugging
  if (rejected.length > 0) {
    console.log(`[Prefilter] Sample rejections:`);
    rejected.slice(0, 3).forEach(r => console.log(`  • ${r.job.title}: ${r.reason}`));
  }

  // Return jobs that passed or need LLM (not rejected)
  return results
    .filter(r => r.tier !== 'REJECT')
    .map(r => r.job);
}

// CLI
if (import.meta.main) {
  console.log("🎯 Job Golem Matcher Test\n");

  // Test with a sample job
  const testJob: JobListing = {
    id: "test-1",
    title: "Full Stack Developer",
    company: "Test Startup",
    location: "Tel Aviv, Israel",
    description: "Looking for a React/Node.js developer with 2+ years experience. Tailwind CSS, TypeScript preferred.",
    url: "https://example.com/job/1",
    source: "secretTLV",
    language: "en",
    scrapedAt: new Date().toISOString(),
  };

  const result = await matchJob(testJob);
  console.log(`\nScore: ${result.score}/10`);
  console.log(`Reason: ${result.reason}`);
  console.log(`Highlights: ${result.highlights.join(", ")}`);
}
