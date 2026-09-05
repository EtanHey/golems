/**
 * Obsidian Export for RecruiterGolem
 *
 * Exports outreach data to Obsidian-compatible markdown files with:
 * - Wikilinks for cross-referencing
 * - Frontmatter for metadata
 * - Tags for organization
 */

import { mkdirSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import {
  getContact,
  getCompanyResearch,
  type Contact,
  type Outreach,
  type CompanyResearch,
} from "./outreach-db";
import { Database } from "bun:sqlite";

/**
 * Sanitize filename to be filesystem-safe
 * @param name - Original filename or string
 * @returns Sanitized string safe for filesystem (removes slashes, special chars, dots, spaces→hyphens)
 */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[/\\]/g, "-") // Replace slashes
    .replace(/[<>:"|?*]/g, "") // Remove invalid chars
    .replace(/['&]/g, "") // Remove apostrophes and ampersands
    .replace(/\./g, "") // Remove dots
    .replace(/\s+/g, "-") // Replace spaces with hyphens
    .trim();
}

/**
 * Format frontmatter for markdown
 * @param data - Key-value pairs to include in frontmatter
 * @returns YAML frontmatter wrapped in --- delimiters
 */
function formatFrontmatter(data: Record<string, any>): string {
  const lines = ["---"];
  for (const [key, value] of Object.entries(data)) {
    if (value === null || value === undefined) {
      lines.push(`${key}:`);
    } else if (typeof value === "string") {
      lines.push(`${key}: ${value}`);
    } else {
      lines.push(`${key}: ${value}`);
    }
  }
  lines.push("---");
  return lines.join("\n");
}

/**
 * Format date for outreach filename
 * @param isoDate - ISO date string
 * @returns Date formatted as YYYY-MM-DD for filename prefix
 */
function formatDateForFilename(isoDate: string): string {
  const date = new Date(isoDate);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Get all contacts from database
 * @param db - SQLite database instance
 * @returns Array of all contacts ordered by creation date (newest first)
 */
function getAllContacts(db: Database): Contact[] {
  const rows = db.query(`
    SELECT id, name, email, linkedin_url, company, role, source, created_at
    FROM contacts
    ORDER BY created_at DESC
  `).all() as any[];

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    linkedinUrl: row.linkedin_url,
    company: row.company,
    role: row.role,
    source: row.source,
    createdAt: row.created_at,
  }));
}

/**
 * Get all outreach messages from database
 * @param db - SQLite database instance
 * @returns Array of all outreach messages ordered by creation date (newest first)
 */
function getAllOutreach(db: Database): Outreach[] {
  const rows = db.query(`
    SELECT id, job_id, contact_id, message_type, message_text, status, created_at, sent_at, responded_at
    FROM outreach
    ORDER BY created_at DESC
  `).all() as any[];

  return rows.map((row) => ({
    id: row.id,
    jobId: row.job_id,
    contactId: row.contact_id,
    messageType: row.message_type,
    messageText: row.message_text,
    status: row.status,
    createdAt: row.created_at,
    sentAt: row.sent_at,
    respondedAt: row.responded_at,
  }));
}

/**
 * Export contact to markdown file with frontmatter and wikilinks
 * @param contact - Contact data to export
 * @param outputDir - Output directory root (contact will be written to contacts/ subdirectory)
 */
function exportContact(contact: Contact, outputDir: string): void {
  const frontmatter = formatFrontmatter({
    email: contact.email || "",
    linkedin: contact.linkedinUrl || "",
    company: contact.company,
    role: contact.role,
    source: contact.source,
    createdAt: contact.createdAt,
  });

  const body = [
    `# ${contact.name}`,
    "",
    `Company: [[${contact.company}]]`,
    `Role: ${contact.role}`,
    "",
    "#contact #outreach",
  ].join("\n");

  const content = `${frontmatter}\n\n${body}\n`;
  const filename = sanitizeFilename(contact.name) + ".md";
  const filepath = join(outputDir, "contacts", filename);

  writeFileSync(filepath, content, "utf-8");
}

/**
 * Export company to markdown file with contacts and research data
 * @param companyName - Company name
 * @param contacts - Array of contacts at this company
 * @param research - Company research data (optional)
 * @param outputDir - Output directory root (company will be written to companies/ subdirectory)
 */
function exportCompany(
  companyName: string,
  contacts: Contact[],
  research: CompanyResearch | null,
  outputDir: string
): void {
  const frontmatter = formatFrontmatter({
    name: companyName,
    contactCount: contacts.length,
    researchedAt: research?.researchedAt || "",
  });

  const sections = [`# ${companyName}`, ""];

  // Contacts section
  if (contacts.length > 0) {
    sections.push("## Contacts", "");
    for (const contact of contacts) {
      sections.push(`- [[${contact.name}]] - ${contact.role}`);
    }
    sections.push("");
  }

  // Research section
  if (research) {
    sections.push("## Research", "");
    const data = research.data;

    if (data.website) {
      sections.push(`Website: ${data.website}`);
    }
    if (data.teamSize) {
      sections.push(`Team Size: ${data.teamSize}`);
    }
    if (data.founded) {
      sections.push(`Founded: ${data.founded}`);
    }
    if (data.israeliOffice !== undefined) {
      sections.push(`Israeli Office: ${data.israeliOffice ? "Yes" : "No"}`);
    }

    if (data.techStack && data.techStack.length > 0) {
      sections.push("", "### Tech Stack", "");
      for (const tech of data.techStack) {
        sections.push(`- ${tech}`);
      }
    }

    if (data.recentNews && data.recentNews.length > 0) {
      sections.push("", "### Recent News", "");
      for (const news of data.recentNews) {
        sections.push(`- ${news}`);
      }
    }

    sections.push("");
  }

  // Tags
  sections.push("#company #outreach");

  const body = sections.join("\n");
  const content = `${frontmatter}\n\n${body}\n`;
  const filename = sanitizeFilename(companyName) + ".md";
  const filepath = join(outputDir, "companies", filename);

  writeFileSync(filepath, content, "utf-8");
}

/**
 * Export outreach message to markdown file with wikilinks and status tags
 * @param outreach - Outreach message data
 * @param contact - Contact associated with this outreach
 * @param outputDir - Output directory root (outreach will be written to outreach/ subdirectory)
 */
function exportOutreach(outreach: Outreach, contact: Contact, outputDir: string): void {
  const frontmatter = formatFrontmatter({
    contact: contact.name,
    company: contact.company,
    messageType: outreach.messageType,
    status: outreach.status,
    createdAt: outreach.createdAt,
    sentAt: outreach.sentAt || "",
    respondedAt: outreach.respondedAt || "",
  });

  const body = [
    `# Outreach to ${contact.name}`,
    "",
    `Contact: [[${contact.name}]]`,
    `Company: [[${contact.company}]]`,
    `Type: ${outreach.messageType}`,
    `Status: ${outreach.status}`,
    "",
    "## Message",
    "",
    outreach.messageText,
    "",
    `#outreach #status/${outreach.status}`,
  ].join("\n");

  const content = `${frontmatter}\n\n${body}\n`;

  // Filename: YYYY-MM-DD-Contact-Name.md
  const dateStr = formatDateForFilename(outreach.createdAt);
  const contactName = sanitizeFilename(contact.name);
  const filename = `${dateStr}-${contactName}.md`;
  const filepath = join(outputDir, "outreach", filename);

  writeFileSync(filepath, content, "utf-8");
}

/**
 * Export all outreach data to Obsidian-compatible markdown
 */
export function exportToObsidian(outputDir: string): void {
  // Create folder structure
  const folders = ["contacts", "companies", "outreach"];
  for (const folder of folders) {
    const folderPath = join(outputDir, folder);
    if (!existsSync(folderPath)) {
      mkdirSync(folderPath, { recursive: true });
    }
  }

  // Get database handle (we need direct access for bulk queries)
  // The outreach-db module doesn't expose the db instance, so we need to initialize it
  const { initDb, closeDb } = require("./outreach-db");
  const db = require("./outreach-db").db || (() => {
    // If db is not exported, we need to get it via initDb
    initDb();
    // Access the internal db by requiring the module again
    // This is a workaround - in production we'd expose getAllContacts/getAllOutreach
    const dbModule = require("bun:sqlite");
    // We'll use the exported functions instead
    return null;
  })();

  // For now, we'll use a different approach: query via the exported functions
  // We need to add helper functions to get all data
  // Let's import Database and create our own connection temporarily
  const { homedir } = require("os");
  const dbPath = process.env.GOLEMS_STATE_DIR
    ? join(process.env.GOLEMS_STATE_DIR, "recruiter/outreach.db")
    : join(homedir(), ".golems-zikaron/recruiter/outreach.db");

  // Check if test path was used
  const testDbPath = join(process.cwd(), ".test-obsidian-export.db");
  const actualDbPath = existsSync(testDbPath) ? testDbPath : dbPath;

  // Open database connection
  const Database = require("bun:sqlite").Database;
  const dbConn = new Database(actualDbPath);

  try {
    // Get all contacts
    const contacts = getAllContacts(dbConn);

    // Export contacts
    for (const contact of contacts) {
      exportContact(contact, outputDir);
    }

    // Group contacts by company
    const contactsByCompany = new Map<string, Contact[]>();
    for (const contact of contacts) {
      if (!contactsByCompany.has(contact.company)) {
        contactsByCompany.set(contact.company, []);
      }
      contactsByCompany.get(contact.company)!.push(contact);
    }

    // Export companies
    for (const [companyName, companyContacts] of contactsByCompany.entries()) {
      const research = getCompanyResearch(companyName);
      exportCompany(companyName, companyContacts, research, outputDir);
    }

    // Get all outreach messages
    const outreachMessages = getAllOutreach(dbConn);

    // Export outreach messages
    for (const outreach of outreachMessages) {
      const contact = getContact(outreach.contactId);
      if (contact) {
        exportOutreach(outreach, contact, outputDir);
      }
    }
  } finally {
    dbConn.close();
  }
}

/**
 * CLI entry point
 */
if (import.meta.main) {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help")) {
    console.log(`
Usage: bun run src/obsidian-export.ts --output <path>

Options:
  --output <path>   Output directory for Obsidian vault (required)

Example:
  bun run src/obsidian-export.ts --output ~/Documents/Obsidian/Recruiting
    `);
    process.exit(args.includes("--help") ? 0 : 1);
  }

  const outputIndex = args.indexOf("--output");
  if (outputIndex === -1 || outputIndex === args.length - 1) {
    console.error("Error: --output flag requires a path");
    process.exit(1);
  }

  const outputDir = args[outputIndex + 1];

  console.log(`Exporting outreach data to: ${outputDir}`);
  exportToObsidian(outputDir);
  console.log("Export complete!");
}
