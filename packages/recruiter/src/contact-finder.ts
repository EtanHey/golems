/**
 * Contact Finder Module
 *
 * Finds contacts at companies using multiple sources:
 * - GitHub (org contributors, public emails)
 * - Exa (AI-powered web search for company contacts)
 * - Hunter.io (50 free credits/month)
 * - Lusha (5 free credits/month)
 *
 * Priority: GitHub (free) > Exa (1000/day free) > Hunter (50/mo) > Lusha (5/mo)
 */

import { createContact, getContactsByCompany, type Contact, type ContactSource } from "./outreach-db";

/** A contact discovered through GitHub, Hunter, Exa, or Lusha */
export interface FoundContact {
  name: string;
  email: string | null;
  linkedinUrl: string | null;
  role: string;
  source: ContactSource;
  confidence: "high" | "medium" | "low";
}

/** Options for filtering and limiting contact search */
export interface ContactSearchOptions {
  githubOrg?: string;
  companyDomain?: string;  // For Hunter.io
  targetRoles?: string[];  // e.g., ["Engineering Manager", "CTO", "Tech Lead"]
  maxResults?: number;
}

const DEFAULT_TARGET_ROLES = [
  "Engineering Manager",
  "Tech Lead",
  "CTO",
  "VP Engineering",
  "Director of Engineering",
  "HR Manager",
  "Recruiter",
];

/**
 * Find contacts at a company
 */
export async function findContacts(
  companyName: string,
  options?: ContactSearchOptions
): Promise<FoundContact[]> {
  const contacts: FoundContact[] = [];
  const targetRoles = options?.targetRoles || DEFAULT_TARGET_ROLES;
  const maxResults = options?.maxResults || 5;

  // Check if we already have contacts for this company
  const existing = getContactsByCompany(companyName);
  if (existing.length >= maxResults) {
    return existing.map((c) => ({
      name: c.name,
      email: c.email,
      linkedinUrl: c.linkedinUrl,
      role: c.role,
      source: c.source,
      confidence: "high" as const,
    }));
  }

  // 1. Try GitHub first (FREE, unlimited)
  if (options?.githubOrg) {
    const githubContacts = await findGitHubContacts(options.githubOrg, maxResults);
    contacts.push(...githubContacts);
  }

  // 2. Try Exa web search if we need more contacts
  if (contacts.length < maxResults) {
    const exaApiKey = process.env.EXA_API_KEY;
    if (exaApiKey) {
      const exaContacts = await findExaContacts(
        companyName,
        exaApiKey,
        targetRoles,
        maxResults - contacts.length
      );
      contacts.push(...exaContacts);
    }
  }

  // 3. Try Hunter.io if we have domain and need more contacts
  if (options?.companyDomain && contacts.length < maxResults) {
    const hunterApiKey = process.env.HUNTER_API_KEY;
    if (hunterApiKey) {
      const hunterContacts = await findHunterContacts(
        options.companyDomain,
        hunterApiKey,
        maxResults - contacts.length
      );
      contacts.push(...hunterContacts);
    }
  }

  // 4. Save new contacts to database
  for (const contact of contacts) {
    // Check if this contact already exists
    const existingContact = existing.find(
      (e) => e.email === contact.email || e.linkedinUrl === contact.linkedinUrl
    );

    if (!existingContact) {
      createContact({
        name: contact.name,
        email: contact.email || undefined,
        linkedinUrl: contact.linkedinUrl || undefined,
        company: companyName,
        role: contact.role,
        source: contact.source,
      });
    }
  }

  return contacts.slice(0, maxResults);
}

/**
 * Find contacts from GitHub org
 */
async function findGitHubContacts(orgName: string, maxResults: number): Promise<FoundContact[]> {
  const contacts: FoundContact[] = [];

  try {
    // Get org members (if public)
    const membersProc = Bun.spawn(
      ["gh", "api", `/orgs/${orgName}/members`, "--jq", ".[].login"],
      { stdout: "pipe", stderr: "pipe" }
    );

    const membersOutput = await new Response(membersProc.stdout).text();
    const members = membersOutput.split("\n").filter(Boolean).slice(0, 10);

    // For each member, get their profile
    for (const login of members) {
      if (contacts.length >= maxResults) break;

      const userProc = Bun.spawn(
        ["gh", "api", `/users/${login}`, "--jq", "{name, email, blog, twitter_username, bio, company}"],
        { stdout: "pipe", stderr: "pipe" }
      );

      const userOutput = await new Response(userProc.stdout).text();

      try {
        const user = JSON.parse(userOutput);

        // Only include if they have useful contact info
        if (user.email || user.blog || user.twitter_username) {
          const role = inferRoleFromBio(user.bio) || "Developer";

          contacts.push({
            name: user.name || login,
            email: user.email,
            linkedinUrl: null, // GitHub doesn't have LinkedIn
            role,
            source: "github",
            confidence: user.email ? "high" : "medium",
          });
        }
      } catch (err) {
        console.warn(`[GitHub] Could not parse user ${login}:`, err);
      }
    }

    // Also check contributors to popular repos
    if (contacts.length < maxResults) {
      const reposProc = Bun.spawn(
        ["gh", "api", `/orgs/${orgName}/repos`, "--jq", "sort_by(.stargazers_count) | reverse | .[0].name"],
        { stdout: "pipe", stderr: "pipe" }
      );

      const topRepo = (await new Response(reposProc.stdout).text()).trim();

      if (topRepo) {
        const contributorsProc = Bun.spawn(
          ["gh", "api", `/repos/${orgName}/${topRepo}/contributors`, "--jq", ".[].login"],
          { stdout: "pipe", stderr: "pipe" }
        );

        const contributorsOutput = await new Response(contributorsProc.stdout).text();
        const contributors = contributorsOutput.split("\n").filter(Boolean).slice(0, 5);

        for (const login of contributors) {
          if (contacts.length >= maxResults) break;

          // Skip if already found
          if (contacts.some((c) => c.name.toLowerCase().includes(login.toLowerCase()))) {
            continue;
          }

          const userProc = Bun.spawn(
            ["gh", "api", `/users/${login}`, "--jq", "{name, email, blog, bio}"],
            { stdout: "pipe", stderr: "pipe" }
          );

          const userOutput = await new Response(userProc.stdout).text();

          try {
            const user = JSON.parse(userOutput);

            if (user.email) {
              contacts.push({
                name: user.name || login,
                email: user.email,
                linkedinUrl: null,
                role: inferRoleFromBio(user.bio) || "Senior Developer",
                source: "github",
                confidence: "high",
              });
            }
          } catch (err) {
            console.warn(`[GitHub] Could not parse contributor ${login}:`, err);
          }
        }
      }
    }
  } catch (err) {
    console.error(`[GitHub] API failed for org ${orgName}:`, err);
    console.error("[GitHub] Is gh CLI authenticated? Try: gh auth status");
  }

  return contacts;
}

/**
 * Find contacts using Hunter.io
 */
async function findHunterContacts(
  domain: string,
  apiKey: string,
  maxResults: number
): Promise<FoundContact[]> {
  const contacts: FoundContact[] = [];

  try {
    // Hunter.io domain search
    const url = `https://api.hunter.io/v2/domain-search?domain=${domain}&api_key=${apiKey}&limit=${maxResults}`;
    const response = await fetch(url);

    if (!response.ok) {
      const text = await response.text();
      console.error(`[Hunter] API error ${response.status}: ${text}`);
      console.error("[Hunter] Check API key at: https://hunter.io/api-keys");
      return contacts;
    }

    const data = await response.json() as {
      data?: {
        emails?: Array<{
          value: string;
          first_name?: string;
          last_name?: string;
          position?: string;
          linkedin?: string;
          confidence?: number;
        }>;
      };
    };

    if (!data.data?.emails) return contacts;

    for (const email of data.data.emails) {
      contacts.push({
        name: [email.first_name, email.last_name].filter(Boolean).join(" ") || "Unknown",
        email: email.value,
        linkedinUrl: email.linkedin || null,
        role: email.position || "Unknown",
        source: "hunter",
        confidence: (email.confidence || 0) > 80 ? "high" : "medium",
      });
    }
  } catch (err) {
    console.error("[Hunter] Connection error:", err);
    console.error("[Hunter] Check network and API key at: https://hunter.io/api-keys");
  }

  return contacts;
}

/**
 * Find contact using Lusha (5 free credits/month)
 * This is expensive - use sparingly!
 */
export async function findLushaContact(
  linkedinUrl: string,
  apiKey: string
): Promise<FoundContact | null> {
  try {
    const response = await fetch("https://api.lusha.com/person", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api_key": apiKey,
      },
      body: JSON.stringify({ linkedInUrl: linkedinUrl }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`[Lusha] API error ${response.status}: ${text}`);
      console.error("[Lusha] Check API key and credits at: https://dashboard.lusha.com/");
      return null;
    }

    const data = await response.json() as {
      firstName?: string;
      lastName?: string;
      emailAddresses?: Array<{ email: string }>;
      currentJobTitle?: string;
    };

    const email = data.emailAddresses?.[0]?.email;
    if (!email) return null;

    return {
      name: [data.firstName, data.lastName].filter(Boolean).join(" "),
      email,
      linkedinUrl,
      role: data.currentJobTitle || "Unknown",
      source: "lusha",
      confidence: "high",
    };
  } catch (err) {
    console.error("[Lusha] Connection error:", err);
    console.error("[Lusha] Check network and API key at: https://dashboard.lusha.com/");
    return null;
  }
}

/**
 * Find contacts using Exa AI-powered web search (1000 req/day free tier)
 */
async function findExaContacts(
  companyName: string,
  apiKey: string,
  targetRoles: string[],
  maxResults: number
): Promise<FoundContact[]> {
  const contacts: FoundContact[] = [];

  try {
    const query = `${companyName} ${targetRoles.slice(0, 3).join(" OR ")} email LinkedIn`;

    const response = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        query,
        numResults: maxResults * 2,
        type: "neural",
        contents: {
          text: { maxCharacters: 1000 },
          highlights: { numSentences: 3 },
        },
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`[Exa] API error ${response.status}: ${text}`);
      return contacts;
    }

    const data = (await response.json()) as {
      results?: Array<{
        title?: string;
        url?: string;
        text?: string;
        highlights?: string[];
      }>;
    };

    if (!data.results) return contacts;

    for (const result of data.results) {
      if (contacts.length >= maxResults) break;

      const text = [result.title, result.text, ...(result.highlights || [])].join(" ");

      // Extract email from result text
      const emailMatch = text.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
      // Extract LinkedIn URL
      const linkedinMatch = text.match(/linkedin\.com\/in\/[\w-]+/);

      if (!emailMatch && !linkedinMatch) continue;

      // Try to extract name from title or text
      const name = result.title?.split(/[|–-]/)[0]?.trim() || "Unknown";
      const role = inferRoleFromText(text, targetRoles) || "Unknown";

      contacts.push({
        name,
        email: emailMatch?.[0] || null,
        linkedinUrl: linkedinMatch ? `https://www.${linkedinMatch[0]}` : null,
        role,
        source: "exa",
        confidence: emailMatch ? "medium" : "low",
      });
    }
  } catch (err) {
    console.error("[Exa] Search failed:", err);
  }

  return contacts;
}

/**
 * Infer role from arbitrary text using target role keywords
 */
function inferRoleFromText(text: string, targetRoles: string[]): string | null {
  const lowerText = text.toLowerCase();
  for (const role of targetRoles) {
    if (lowerText.includes(role.toLowerCase())) return role;
  }
  return inferRoleFromBio(text);
}

/**
 * Infer role from GitHub bio
 */
function inferRoleFromBio(bio: string | null): string | null {
  if (!bio) return null;

  const lowerBio = bio.toLowerCase();

  if (lowerBio.includes("cto") || lowerBio.includes("chief technology")) return "CTO";
  if (lowerBio.includes("vp") && lowerBio.includes("engineering")) return "VP Engineering";
  if (lowerBio.includes("director") && lowerBio.includes("engineering")) return "Director of Engineering";
  if (lowerBio.includes("engineering manager") || lowerBio.includes("eng manager")) return "Engineering Manager";
  if (lowerBio.includes("tech lead") || lowerBio.includes("team lead")) return "Tech Lead";
  if (lowerBio.includes("staff engineer")) return "Staff Engineer";
  if (lowerBio.includes("principal")) return "Principal Engineer";
  if (lowerBio.includes("senior") || lowerBio.includes("sr")) return "Senior Developer";
  if (lowerBio.includes("founder")) return "Founder";

  return null;
}

/**
 * Get domain from company name/url
 */
export function extractDomain(companyNameOrUrl: string): string | null {
  // If it looks like a URL, extract domain
  const urlMatch = companyNameOrUrl.match(/(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9-]+\.[a-zA-Z]{2,})/);
  if (urlMatch) {
    return urlMatch[1];
  }

  // Otherwise, guess domain from company name
  const normalized = companyNameOrUrl
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9]/g, "");

  // Common patterns
  return `${normalized}.com`;
}

/**
 * Convenience wrapper for finding contacts with common options
 */
export async function findContactsForCompany(
  companyName: string,
  options?: {
    githubOrg?: string;
    preferredRoles?: string[];
    maxResults?: number;
  }
): Promise<FoundContact[]> {
  return findContacts(companyName, {
    githubOrg: options?.githubOrg,
    targetRoles: options?.preferredRoles,
    maxResults: options?.maxResults || 3,
  });
}

/**
 * Format contacts for display
 */
export function formatContacts(contacts: FoundContact[]): string {
  if (contacts.length === 0) {
    return "No contacts found.";
  }

  const lines = ["*Found Contacts:*", ""];

  for (const contact of contacts) {
    const confidence = contact.confidence === "high" ? "✅" : contact.confidence === "medium" ? "⚠️" : "❓";

    lines.push(`${confidence} *${contact.name}*`);
    lines.push(`   ${contact.role}`);

    if (contact.email) {
      lines.push(`   📧 ${contact.email}`);
    }
    if (contact.linkedinUrl) {
      lines.push(`   💼 ${contact.linkedinUrl}`);
    }

    lines.push(`   _Source: ${contact.source}_`);
    lines.push("");
  }

  return lines.join("\n");
}
