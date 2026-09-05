/**
 * Outreach Message Generation
 *
 * Creates personalized outreach messages based on:
 * - Company research
 * - Job requirements
 * - Contact information
 *
 * Templates for: email, LinkedIn connect, LinkedIn message
 */

import type { CompanyInfo } from "./company-research";
import type { FoundContact } from "./contact-finder";
import type { MessageType } from "./outreach-db";
import {
  getOutreachStyleGuidelines,
  applyStyleToMessage,
  getStyleAppropriateGreeting,
  getStyleAppropriateSignOff,
} from "./style-adapter";

/** Job posting context for outreach message generation */
export interface JobContext {
  title: string;
  company: string;
  techStack: string[];
  description?: string;
  url: string;
}

/** A generated outreach message with personalization details */
export interface OutreachMessage {
  type: MessageType;
  subject?: string;  // For email
  body: string;
  personalization: string[];  // What made it personal
}

/** Full context needed to generate an outreach message */
export interface OutreachContext {
  job: JobContext;
  company?: CompanyInfo;
  contact?: FoundContact;
  userProfile: UserProfile;
}

/** User profile data used to personalize outreach messages */
export interface UserProfile {
  name: string;
  title: string;
  experience: string[];  // Key achievements/experiences
  techStack: string[];   // User's tech stack
  linkedinUrl?: string;
  portfolioUrl?: string;
}

// Default user profile (from CLAUDE.md and context)
const DEFAULT_USER_PROFILE: UserProfile = {
  name: "Alon",
  title: "Full Stack Developer",
  experience: [
    "Built reusable AI-agent workflows",
    "Led development of a multi-tenant B2B SaaS platform",
    "Experience with voice AI interviews (Vapi)",
    "Production-scale enterprise applications",
  ],
  techStack: ["React", "TypeScript", "Node.js", "PostgreSQL", "Convex", "Supabase", "TanStack"],
};

/**
 * Generate outreach message based on context
 */
export function generateOutreach(
  context: OutreachContext,
  messageType: MessageType
): OutreachMessage {
  const profile = context.userProfile || DEFAULT_USER_PROFILE;

  switch (messageType) {
    case "linkedin_connect":
      return generateLinkedInConnect(context, profile);
    case "linkedin_message":
      return generateLinkedInMessage(context, profile);
    case "email":
      return generateEmail(context, profile);
    default:
      throw new Error(`Unknown message type: ${messageType}`);
  }
}

/**
 * Generate LinkedIn connection request (300 char limit)
 */
function generateLinkedInConnect(context: OutreachContext, profile: UserProfile): OutreachMessage {
  const { job, company, contact } = context;
  const personalization: string[] = [];
  const styleGuide = getOutreachStyleGuidelines();

  // Use style-appropriate greeting (shortened for connect request)
  const firstName = contact?.name?.split(" ")[0];
  let body = styleGuide.formality > 0.55
    ? `Hello${firstName ? ` ${firstName}` : ""}. `
    : `Hi${firstName ? ` ${firstName}` : ""}! `;

  // Find overlap in tech stack
  const techOverlap = findTechOverlap(profile.techStack, job.techStack);

  if (techOverlap.length > 0) {
    body += `I saw ${job.company}'s ${job.title} role and love that you're using ${techOverlap[0]}. `;
    personalization.push(`Tech overlap: ${techOverlap.join(", ")}`);
  } else {
    body += `I saw ${job.company}'s ${job.title} opening and it caught my attention. `;
    personalization.push("Job posting reference");
  }

  // Add brief value prop
  if (profile.experience[0]) {
    const shortExp = truncate(profile.experience[0], 60);
    body += `I've ${shortExp.toLowerCase()}.`;
    personalization.push("Experience highlight");
  }

  body += " Would love to connect!";

  // Apply style adjustments
  body = applyStyleToMessage(body, styleGuide);

  // Ensure under 300 chars
  body = truncate(body, 300);

  return {
    type: "linkedin_connect",
    body,
    personalization,
  };
}

/**
 * Generate LinkedIn InMail/Message
 */
function generateLinkedInMessage(context: OutreachContext, profile: UserProfile): OutreachMessage {
  const { job, company, contact } = context;
  const personalization: string[] = [];
  const styleGuide = getOutreachStyleGuidelines();

  const firstName = contact?.name?.split(" ")[0] || "";
  let body = getStyleAppropriateGreeting(firstName || undefined, styleGuide) + "\n\n";

  // Opening - reference something specific
  if (company?.recentNews?.length) {
    body += `Congratulations on ${company.recentNews[0].toLowerCase()}! `;
    personalization.push(`Recent news: ${company.recentNews[0]}`);
  } else if (company?.techStack?.length) {
    body += `I noticed ${job.company} is building with ${company.techStack.slice(0, 2).join(" and ")} - great choices! `;
    personalization.push(`Tech stack: ${company.techStack.slice(0, 2).join(", ")}`);
  }

  // Reference the job
  body += `I came across your ${job.title} role and it really resonated with my background.\n\n`;
  personalization.push(`Job: ${job.title}`);

  // Value prop - match tech stack
  const techOverlap = findTechOverlap(profile.techStack, job.techStack);
  if (techOverlap.length > 0) {
    body += `I've been working extensively with ${techOverlap.slice(0, 3).join(", ")}`;
    personalization.push(`Tech match: ${techOverlap.join(", ")}`);
  } else {
    body += `I'm a ${profile.title} with hands-on experience in ${profile.techStack.slice(0, 3).join(", ")}`;
  }

  // Add relevant experience
  if (profile.experience.length > 0) {
    const relevantExp = findRelevantExperience(profile.experience, job);
    if (relevantExp) {
      body += ` and recently ${relevantExp.toLowerCase()}`;
      personalization.push(`Experience: ${relevantExp}`);
    }
  }
  body += ".\n\n";

  // Soft ask
  body += "I'd love to learn more about the team and how I might contribute. ";
  body += "Would you be open to a brief chat this week?\n\n";

  // Sign off with style-appropriate closing
  body += `${getStyleAppropriateSignOff(styleGuide)}\n${profile.name}`;
  if (profile.portfolioUrl) {
    body += `\n${profile.portfolioUrl}`;
  }

  // Apply style adjustments (emoji removal, formality)
  body = applyStyleToMessage(body, styleGuide);

  return {
    type: "linkedin_message",
    body,
    personalization,
  };
}

/**
 * Generate cold email
 */
function generateEmail(context: OutreachContext, profile: UserProfile): OutreachMessage {
  const { job, company, contact } = context;
  const personalization: string[] = [];
  const styleGuide = getOutreachStyleGuidelines();

  // Subject line
  let subject = `${job.title} at ${job.company}`;
  if (company?.recentNews?.length) {
    subject = `Re: ${job.company}'s growth - ${job.title} role`;
    personalization.push("Subject references news");
  }

  const firstName = contact?.name?.split(" ")[0] || "";
  let body = getStyleAppropriateGreeting(firstName || undefined, styleGuide) + "\n\n";

  // Opening hook
  if (company?.recentNews?.length) {
    body += `I saw the news about ${company.recentNews[0].toLowerCase()} - exciting times at ${job.company}!\n\n`;
    personalization.push(`News hook: ${company.recentNews[0]}`);
  } else {
    body += `I hope this email finds you well.\n\n`;
  }

  // Reference job + why interested
  body += `I noticed ${job.company} is looking for a ${job.title}`;

  const techOverlap = findTechOverlap(profile.techStack, job.techStack);
  if (techOverlap.length >= 2) {
    body += `, and the focus on ${techOverlap.slice(0, 2).join(" and ")} caught my attention`;
    personalization.push(`Tech overlap: ${techOverlap.join(", ")}`);
  }
  body += ".\n\n";

  // Value proposition
  body += "A bit about me:\n";

  // Pick 2-3 relevant experiences
  const relevantExps = profile.experience.slice(0, 3);
  for (const exp of relevantExps) {
    body += `• ${exp}\n`;
  }
  personalization.push("Experience bullets");

  body += "\n";

  // Soft CTA
  body += `I'd love to learn more about what ${job.company} is building and explore whether there might be a fit. `;
  body += "Would you have 15 minutes for a quick call this week?\n\n";

  // Sign off with style-appropriate closing
  body += `${getStyleAppropriateSignOff(styleGuide)}\n${profile.name}`;
  if (profile.linkedinUrl) {
    body += `\n\nLinkedIn: ${profile.linkedinUrl}`;
  }
  if (profile.portfolioUrl) {
    body += `\nPortfolio: ${profile.portfolioUrl}`;
  }

  // Apply style adjustments (emoji removal, formality)
  body = applyStyleToMessage(body, styleGuide);

  return {
    type: "email",
    subject,
    body,
    personalization,
  };
}

/**
 * Find overlapping technologies
 */
function findTechOverlap(userTech: string[], jobTech: string[]): string[] {
  const userLower = userTech.map((t) => t.toLowerCase());
  const overlap: string[] = [];

  for (const tech of jobTech) {
    if (userLower.includes(tech.toLowerCase())) {
      overlap.push(tech);
    }
  }

  return overlap;
}

/**
 * Find most relevant experience for this job
 */
function findRelevantExperience(experiences: string[], job: JobContext): string | null {
  const jobLower = `${job.title} ${job.description || ""} ${job.techStack.join(" ")}`.toLowerCase();

  // Keywords to match
  const keywords = [
    "ai", "autonomous", "agent", "saas", "b2b", "enterprise",
    "react", "typescript", "node", "voice", "scale", "production",
  ];

  let bestMatch: string | null = null;
  let bestScore = 0;

  for (const exp of experiences) {
    const expLower = exp.toLowerCase();
    let score = 0;

    for (const keyword of keywords) {
      if (jobLower.includes(keyword) && expLower.includes(keyword)) {
        score++;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = exp;
    }
  }

  return bestMatch;
}

/**
 * Truncate text to max length
 */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + "...";
}

/**
 * Format outreach message for display
 */
export function formatOutreachMessage(message: OutreachMessage): string {
  const lines: string[] = [];

  if (message.type === "email" && message.subject) {
    lines.push(`*Subject:* ${message.subject}`);
    lines.push("");
  }

  lines.push("---");
  lines.push(message.body);
  lines.push("---");

  if (message.personalization.length > 0) {
    lines.push("");
    lines.push("*Personalization:*");
    for (const p of message.personalization) {
      lines.push(`• ${p}`);
    }
  }

  return lines.join("\n");
}

/**
 * Generate all message types for a job
 */
export function generateAllOutreachTypes(context: OutreachContext): OutreachMessage[] {
  const types: MessageType[] = ["linkedin_connect", "linkedin_message", "email"];
  return types.map((type) => generateOutreach(context, type));
}

/**
 * Get default user profile
 */
export function getDefaultProfile(): UserProfile {
  return { ...DEFAULT_USER_PROFILE };
}

// Re-export style functions for external use
export { getOutreachStyleGuidelines, getStyleSummary } from "./style-adapter";
