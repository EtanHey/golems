/**
 * Company Research Module
 *
 * Researches companies using free sources:
 * - GitHub (org info, tech stack from repos)
 * - Company website (basic scraping)
 * - Job posting data (tech stack from requirements)
 *
 * Stores findings in outreach-db for reuse.
 */

import { saveCompanyResearch, getCompanyResearch, type CompanyResearchData } from "./outreach-db";

/** Aggregated company information from multiple research sources */
export interface CompanyInfo {
  name: string;
  website: string | null;
  techStack: string[];
  recentNews: string[];
  teamSize: string | null;
  founded: string | null;
  israeliOffice: boolean | null;
  githubOrg: string | null;
  linkedinUrl: string | null;
}

/** A single data source used during company research */
export interface ResearchSource {
  source: "github" | "website" | "job_posting" | "cache";
  data: Partial<CompanyInfo>;
}

/**
 * Main research function - combines multiple sources
 */
export async function researchCompany(
  companyName: string,
  options?: {
    jobTechStack?: string[];  // Tech mentioned in job posting
    companyUrl?: string;      // URL from job posting
    forceRefresh?: boolean;   // Skip cache
  }
): Promise<CompanyInfo> {
  // Check cache first (unless force refresh)
  if (!options?.forceRefresh) {
    const cached = getCompanyResearch(companyName);
    if (cached) {
      // Return cached data if less than 7 days old
      const cacheAge = Date.now() - new Date(cached.researchedAt).getTime();
      const sevenDays = 7 * 24 * 60 * 60 * 1000;
      if (cacheAge < sevenDays) {
        return normalizeToCompanyInfo(companyName, cached.data);
      }
    }
  }

  // Gather from multiple sources
  const sources: ResearchSource[] = [];

  // 1. GitHub organization info
  const githubData = await fetchGitHubOrgInfo(companyName);
  if (githubData) {
    sources.push({ source: "github", data: githubData });
  }

  // 2. Job posting data (if provided)
  if (options?.jobTechStack || options?.companyUrl) {
    sources.push({
      source: "job_posting",
      data: {
        techStack: options.jobTechStack || [],
        website: options.companyUrl || null,
      },
    });
  }

  // Merge all sources
  const merged = mergeSources(companyName, sources);

  // Save to cache
  saveCompanyResearch({
    companyName,
    data: {
      website: merged.website,
      techStack: merged.techStack,
      recentNews: merged.recentNews,
      teamSize: merged.teamSize,
      founded: merged.founded,
      israeliOffice: merged.israeliOffice,
      githubOrg: merged.githubOrg,
      linkedinUrl: merged.linkedinUrl,
    },
  });

  return merged;
}

/**
 * Fetch GitHub organization info using gh CLI
 */
async function fetchGitHubOrgInfo(companyName: string): Promise<Partial<CompanyInfo> | null> {
  try {
    // Normalize company name to likely GitHub org name
    const orgName = normalizeOrgName(companyName);

    // Try to get org info
    const proc = Bun.spawn(["gh", "api", `/orgs/${orgName}`], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const output = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();

    if (stderr.includes("Not Found") || !output.trim()) {
      // Try alternative spellings
      const alternatives = generateOrgAlternatives(companyName);
      for (const alt of alternatives) {
        const altProc = Bun.spawn(["gh", "api", `/orgs/${alt}`], {
          stdout: "pipe",
          stderr: "pipe",
        });
        const altOutput = await new Response(altProc.stdout).text();
        const altStderr = await new Response(altProc.stderr).text();
        if (!altStderr.includes("Not Found") && altOutput.trim()) {
          return parseGitHubOrg(altOutput, alt);
        }
      }
      return null;
    }

    return parseGitHubOrg(output, orgName);
  } catch (err) {
    console.warn(`[CompanyResearch] GitHub org lookup failed for ${companyName}:`, err);
    return null;
  }
}

/**
 * Parse GitHub org response
 */
function parseGitHubOrg(json: string, orgName: string): Partial<CompanyInfo> | null {
  try {
    const org = JSON.parse(json);
    return {
      name: org.name || org.login,
      website: org.blog || null,
      githubOrg: org.login,
      linkedinUrl: null, // GitHub doesn't have this
      techStack: [], // Will be filled from repos
      teamSize: org.public_repos ? `${org.public_repos} public repos` : null,
      founded: org.created_at ? new Date(org.created_at).getFullYear().toString() : null,
    };
  } catch (err) {
    console.warn("[CompanyResearch] Failed to parse GitHub org JSON:", err);
    return null;
  }
}

/**
 * Fetch top languages from GitHub org repos
 */
export async function fetchGitHubTechStack(orgName: string): Promise<string[]> {
  try {
    const proc = Bun.spawn(
      ["gh", "api", `/orgs/${orgName}/repos`, "--jq", ".[].language"],
      { stdout: "pipe", stderr: "pipe" }
    );

    const output = await new Response(proc.stdout).text();
    const languages = output
      .split("\n")
      .filter(Boolean)
      .filter((lang) => lang !== "null");

    // Dedupe and count
    const counts = new Map<string, number>();
    for (const lang of languages) {
      counts.set(lang, (counts.get(lang) || 0) + 1);
    }

    // Return top languages by frequency
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([lang]) => lang);
  } catch (err) {
    console.warn(`[CompanyResearch] Failed to fetch tech stack for ${orgName}:`, err);
    return [];
  }
}

/**
 * Normalize company name to likely GitHub org name
 */
function normalizeOrgName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, "")      // Remove spaces
    .replace(/[^a-z0-9-]/g, "") // Remove special chars
    .replace(/inc$|corp$|ltd$|llc$/i, ""); // Remove suffixes
}

/**
 * Generate alternative org name spellings
 */
function generateOrgAlternatives(name: string): string[] {
  const base = normalizeOrgName(name);
  const alternatives: string[] = [];

  // With hyphens instead of camelCase
  alternatives.push(base.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase());

  // Common variations
  if (base.endsWith("io")) {
    alternatives.push(base.slice(0, -2) + "-io");
  }
  if (base.endsWith("ai")) {
    alternatives.push(base.slice(0, -2) + "-ai");
  }
  if (base.endsWith("hq")) {
    alternatives.push(base.slice(0, -2));
  }

  // With "com" suffix removed
  if (base.endsWith("com")) {
    alternatives.push(base.slice(0, -3));
  }

  return alternatives.filter((alt) => alt !== base && alt.length > 2);
}

/**
 * Merge data from multiple sources
 */
function mergeSources(companyName: string, sources: ResearchSource[]): CompanyInfo {
  const result: CompanyInfo = {
    name: companyName,
    website: null,
    techStack: [],
    recentNews: [],
    teamSize: null,
    founded: null,
    israeliOffice: null,
    githubOrg: null,
    linkedinUrl: null,
  };

  // Merge all sources, with priority: github > job_posting > website
  for (const { data } of sources) {
    if (data.website && !result.website) result.website = data.website;
    if (data.techStack?.length) {
      result.techStack = [...new Set([...result.techStack, ...data.techStack])];
    }
    if (data.recentNews?.length) {
      result.recentNews = [...new Set([...result.recentNews, ...data.recentNews])];
    }
    if (data.teamSize && !result.teamSize) result.teamSize = data.teamSize;
    if (data.founded && !result.founded) result.founded = data.founded;
    if (data.israeliOffice !== undefined && result.israeliOffice === null) {
      result.israeliOffice = data.israeliOffice;
    }
    if (data.githubOrg && !result.githubOrg) result.githubOrg = data.githubOrg;
    if (data.linkedinUrl && !result.linkedinUrl) result.linkedinUrl = data.linkedinUrl;
  }

  return result;
}

/**
 * Convert cached CompanyResearchData back to CompanyInfo
 */
function normalizeToCompanyInfo(name: string, data: CompanyResearchData): CompanyInfo {
  return {
    name,
    website: data.website || null,
    techStack: data.techStack || [],
    recentNews: data.recentNews || [],
    teamSize: data.teamSize || null,
    founded: data.founded || null,
    israeliOffice: data.israeliOffice ?? null,
    githubOrg: (data.githubOrg as string) || null,
    linkedinUrl: (data.linkedinUrl as string) || null,
  };
}

/**
 * Extract tech stack keywords from job description
 */
export function extractTechStack(description: string): string[] {
  const techKeywords = [
    // Languages
    "JavaScript", "TypeScript", "Python", "Java", "Go", "Rust", "Ruby", "PHP", "C++", "C#", "Swift", "Kotlin",
    // Frontend
    "React", "Vue", "Angular", "Next.js", "Nuxt", "Svelte", "Remix",
    // Backend
    "Node.js", "Express", "Fastify", "Django", "Flask", "FastAPI", "Spring", "Rails",
    // Databases
    "PostgreSQL", "MySQL", "MongoDB", "Redis", "Elasticsearch", "DynamoDB", "Supabase", "Firebase",
    // Cloud/Infra
    "AWS", "GCP", "Azure", "Docker", "Kubernetes", "Terraform", "Vercel", "Cloudflare",
    // Other
    "GraphQL", "REST", "gRPC", "Kafka", "RabbitMQ", "WebSocket", "CI/CD", "Git",
  ];

  const found: string[] = [];
  const lowerDesc = description.toLowerCase();

  for (const tech of techKeywords) {
    if (lowerDesc.includes(tech.toLowerCase())) {
      found.push(tech);
    }
  }

  return [...new Set(found)];
}

/**
 * Format company info for display
 */
export function formatCompanyInfo(info: CompanyInfo): string {
  const lines = [`*${info.name}*`, ""];

  if (info.website) {
    lines.push(`🌐 ${info.website}`);
  }

  if (info.githubOrg) {
    lines.push(`🐙 github.com/${info.githubOrg}`);
  }

  if (info.linkedinUrl) {
    lines.push(`💼 ${info.linkedinUrl}`);
  }

  if (info.techStack.length > 0) {
    lines.push("");
    lines.push(`*Tech Stack:* ${info.techStack.join(", ")}`);
  }

  if (info.teamSize) {
    lines.push(`*Size:* ${info.teamSize}`);
  }

  if (info.founded) {
    lines.push(`*Founded:* ${info.founded}`);
  }

  if (info.israeliOffice !== null) {
    lines.push(`*Israel office:* ${info.israeliOffice ? "Yes" : "Unknown"}`);
  }

  if (info.recentNews.length > 0) {
    lines.push("");
    lines.push("*Recent News:*");
    for (const news of info.recentNews.slice(0, 3)) {
      lines.push(`• ${news}`);
    }
  }

  return lines.join("\n");
}
