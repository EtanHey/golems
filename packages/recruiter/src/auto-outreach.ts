/**
 * Auto-Outreach Integration (E6)
 *
 * Automatically triggers outreach pipeline for high-scoring jobs (8+).
 * Called by JobGolem after scoring.
 *
 * Flow:
 * 1. Research company (GitHub, job posting data)
 * 2. Find contacts (GitHub contributors, optional Hunter/Lusha)
 * 3. Generate outreach drafts using semantic style
 * 4. Save to outreach DB
 * 5. Return results for Telegram notification
 */

import { researchCompany, extractTechStack, type CompanyInfo } from "./company-research";
import { findContactsForCompany, type FoundContact } from "./contact-finder";
import { generateOutreach, getDefaultProfile, type JobContext, type OutreachContext } from "./outreach";
import {
  initDb,
  createContact,
  createOutreach,
  type ContactSource,
  type MessageType,
} from "./outreach-db";

/** A high-scoring job match from JobGolem */
export interface JobMatch {
  id: string;
  title: string;
  company: string;
  location: string;
  url: string;
  techStack?: string[];
  description?: string;
  score: number;
  reason?: string;
}

/** Result of processing a hot job match through the outreach pipeline */
export interface HotMatchResult {
  jobId: string;
  company: string;
  title: string;
  score: number;
  companyResearch?: CompanyInfo;
  contactsFound: number;
  draftsCreated: number;
  error?: string;
}

/** Options for controlling the outreach processing pipeline */
export interface ProcessOptions {
  /** Skip contact search (for testing or when rate limited) */
  skipContactSearch?: boolean;
  /** Mock contacts for testing */
  mockContacts?: Array<{
    name: string;
    role: string;
    email?: string;
    linkedinUrl?: string;
    source: ContactSource;
  }>;
}

/**
 * Process a single high-scoring job match
 */
export async function processHotMatch(
  job: JobMatch,
  options: ProcessOptions = {}
): Promise<HotMatchResult> {
  // Ensure DB is initialized
  initDb();

  const result: HotMatchResult = {
    jobId: job.id,
    company: job.company,
    title: job.title,
    score: job.score,
    contactsFound: 0,
    draftsCreated: 0,
  };

  try {
    // 1. Research the company
    const techStack = job.techStack?.length ? job.techStack : (job.description ? extractTechStack(job.description) : []);

    const companyResearch = await researchCompany(job.company, {
      jobTechStack: techStack,
      companyUrl: job.url,
    });

    result.companyResearch = companyResearch;

    // 2. Find contacts
    let contacts: FoundContact[] = [];

    if (options.mockContacts) {
      // Use mock contacts for testing
      contacts = options.mockContacts.map((c) => ({
        name: c.name,
        role: c.role,
        email: c.email || null,
        linkedinUrl: c.linkedinUrl || null,
        source: c.source,
        confidence: "medium" as const,
      }));
    } else if (!options.skipContactSearch) {
      // Real contact search
      contacts = await findContactsForCompany(job.company, {
        githubOrg: companyResearch.githubOrg || undefined,
        preferredRoles: ["Engineering Manager", "Tech Lead", "CTO", "VP Engineering"],
      });
    }

    result.contactsFound = contacts.length;

    // 3. Generate outreach drafts for each contact
    const profile = getDefaultProfile();
    const jobContext: JobContext = {
      title: job.title,
      company: job.company,
      techStack: companyResearch.techStack.length > 0 ? companyResearch.techStack : techStack,
      description: job.description,
      url: job.url,
    };

    for (const contact of contacts) {
      // Save contact to DB
      const dbContact = createContact({
        name: contact.name,
        email: contact.email || undefined,
        linkedinUrl: contact.linkedinUrl || undefined,
        company: job.company,
        role: contact.role,
        source: contact.source,
      });

      // Skip unreachable contacts (no email AND no linkedin)
      if (!contact.email && !contact.linkedinUrl) {
        console.warn(`[Outreach] Skipping unreachable contact (no email or LinkedIn)`);
        continue;
      }

      // Determine best message type based on contact info
      const messageType: MessageType = contact.email
        ? "email"
        : "linkedin_connect";

      // Generate personalized outreach
      const outreachContext: OutreachContext = {
        job: jobContext,
        company: companyResearch,
        contact: contact,
        userProfile: profile,
      };

      const outreachMessage = generateOutreach(outreachContext, messageType);

      // Save draft to DB (include subject for email messages)
      const messageText = outreachMessage.subject && messageType === "email"
        ? `Subject: ${outreachMessage.subject}\n---\n${outreachMessage.body}`
        : outreachMessage.body;

      createOutreach({
        jobId: job.id,
        contactId: dbContact.id,
        messageType,
        messageText,
      });

      result.draftsCreated++;
    }
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
  }

  return result;
}

/**
 * Process multiple hot matches
 */
export async function processHotMatches(
  jobs: JobMatch[],
  options: ProcessOptions = {}
): Promise<HotMatchResult[]> {
  const results: HotMatchResult[] = [];

  for (const job of jobs) {
    const result = await processHotMatch(job, options);
    results.push(result);
  }

  return results;
}

/**
 * Format notification message for Telegram
 */
export function formatHotMatchNotification(result: HotMatchResult): string {
  const lines: string[] = [];

  lines.push(`🎯 *Outreach Ready: ${result.company}*`);
  lines.push("");
  lines.push(`📋 ${result.title} (Score: ${result.score}/10)`);

  if (result.companyResearch) {
    if (result.companyResearch.techStack.length > 0) {
      lines.push(`🛠️ Tech: ${result.companyResearch.techStack.slice(0, 4).join(", ")}`);
    }
    if (result.companyResearch.githubOrg) {
      lines.push(`🐙 GitHub: ${result.companyResearch.githubOrg}`);
    }
  }

  lines.push("");

  if (result.contactsFound > 0) {
    lines.push(`👥 ${result.contactsFound} contacts found`);
    lines.push(`📝 ${result.draftsCreated} drafts ready`);
    lines.push("");
    lines.push("Use /outreach to review and approve");
  } else {
    lines.push("⚠️ No contacts found automatically");
    lines.push("Consider manual LinkedIn research");
  }

  if (result.error) {
    lines.push("");
    lines.push(`❌ Error: ${result.error}`);
  }

  return lines.join("\n");
}

/**
 * Format summary for multiple results
 */
export function formatHotMatchSummary(results: HotMatchResult[]): string {
  if (results.length === 0) {
    return "No hot matches to process.";
  }

  const totalContacts = results.reduce((sum, r) => sum + r.contactsFound, 0);
  const totalDrafts = results.reduce((sum, r) => sum + r.draftsCreated, 0);
  const withErrors = results.filter((r) => r.error).length;

  const lines: string[] = [];
  lines.push(`🔥 *${results.length} Hot Match${results.length > 1 ? "es" : ""} Processed*`);
  lines.push("");

  for (const result of results) {
    const status = result.error ? "❌" : result.draftsCreated > 0 ? "✅" : "⚠️";
    lines.push(`${status} ${result.company} - ${result.draftsCreated} drafts`);
  }

  lines.push("");
  lines.push(`📊 Total: ${totalContacts} contacts, ${totalDrafts} drafts`);

  if (withErrors > 0) {
    lines.push(`⚠️ ${withErrors} had errors`);
  }

  if (totalDrafts > 0) {
    lines.push("");
    lines.push("Use /outreach to review drafts");
  }

  return lines.join("\n");
}
