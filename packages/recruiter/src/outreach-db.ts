/**
 * Outreach Database
 *
 * SQLite storage for job outreach tracking.
 * Tracks contacts, outreach messages, and company research.
 *
 * Location: ~/.golems-zikaron/recruiter/outreach.db
 */

import { Database } from "bun:sqlite";
import { join } from "path";
import { homedir } from "os";
import { mkdirSync, existsSync } from "fs";

/** Source where a contact was discovered */
export type ContactSource = "github" | "linkedin" | "hunter" | "lusha" | "exa" | "website" | "manual";
/** Type of outreach message */
export type MessageType = "email" | "linkedin_connect" | "linkedin_message";
/** Lifecycle status of an outreach message */
export type OutreachStatus = "draft" | "sent" | "responded" | "no_response";

/** A person at a target company */
export interface Contact {
  id: string;
  name: string;
  email: string | null;
  linkedinUrl: string | null;
  company: string;
  role: string;
  source: ContactSource;
  createdAt: string;
}

/** An outreach message sent to a contact */
export interface Outreach {
  id: string;
  jobId: string;
  contactId: string;
  messageType: MessageType;
  messageText: string;
  status: OutreachStatus;
  createdAt: string;
  sentAt: string | null;
  respondedAt: string | null;
}

/** Aggregated outreach statistics across all messages */
export interface OutreachStats {
  total: number;
  draft: number;
  sent: number;
  responded: number;
  noResponse: number;
  responseRate: number;
}

/** Raw research data gathered about a company */
export interface CompanyResearchData {
  website?: string;
  techStack?: string[];
  recentNews?: string[];
  teamSize?: string;
  founded?: string;
  israeliOffice?: boolean;
  [key: string]: unknown;
}

/** Persisted company research record with metadata */
export interface CompanyResearch {
  id: string;
  companyName: string;
  data: CompanyResearchData;
  researchedAt: string;
}

// Database instance
let db: Database | null = null;
let dbPath: string | null = null;

// Default path
const getDefaultDbPath = () =>
  join(homedir(), ".golems-zikaron/recruiter/outreach.db");

/**
 * Initialize the database
 */
export function initDb(customPath?: string): void {
  // If already initialized with a custom path, don't reinitialize
  // This allows tests to set a custom path that won't be overwritten
  if (db && !customPath) {
    return;
  }

  // Close existing connection if reinitializing with new path
  if (db && customPath) {
    db.close();
  }

  dbPath = customPath || getDefaultDbPath();

  // Ensure directory exists
  const dir = join(dbPath, "..");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  db = new Database(dbPath);

  // Enable foreign key enforcement
  db.run("PRAGMA foreign_keys = ON");

  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS contacts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT,
      linkedin_url TEXT,
      company TEXT NOT NULL,
      role TEXT NOT NULL,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS outreach (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      contact_id TEXT NOT NULL,
      message_type TEXT NOT NULL,
      message_text TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL,
      sent_at TEXT,
      responded_at TEXT,
      FOREIGN KEY (contact_id) REFERENCES contacts(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS company_research (
      id TEXT PRIMARY KEY,
      company_name TEXT NOT NULL UNIQUE,
      data_json TEXT NOT NULL,
      researched_at TEXT NOT NULL
    )
  `);

  // Create indices
  db.run(`CREATE INDEX IF NOT EXISTS idx_contacts_company ON contacts(company)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_outreach_job ON outreach(job_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_outreach_contact ON outreach(contact_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_outreach_status ON outreach(status)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_company_research_name ON company_research(company_name)`);
}

/**
 * Ensure database is initialized
 */
function ensureDb(): Database {
  if (!db) {
    initDb();
  }
  return db!;
}

/**
 * Close the database connection
 */
export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
    dbPath = null;
  }
}

/**
 * Generate a unique ID
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ============ Contact Functions ============

/** Input for creating a new contact record */
export interface CreateContactInput {
  name: string;
  email?: string;
  linkedinUrl?: string;
  company: string;
  role: string;
  source: ContactSource;
}

/**
 * Create a new contact
 */
export function createContact(input: CreateContactInput): Contact {
  const db = ensureDb();
  const id = generateId();
  const createdAt = new Date().toISOString();

  db.run(
    `INSERT INTO contacts (id, name, email, linkedin_url, company, role, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.name,
      input.email || null,
      input.linkedinUrl || null,
      input.company,
      input.role,
      input.source,
      createdAt,
    ]
  );

  return {
    id,
    name: input.name,
    email: input.email || null,
    linkedinUrl: input.linkedinUrl || null,
    company: input.company,
    role: input.role,
    source: input.source,
    createdAt,
  };
}

/**
 * Get a contact by ID
 */
export function getContact(id: string): Contact | null {
  const db = ensureDb();
  const row = db
    .query(
      `SELECT id, name, email, linkedin_url, company, role, source, created_at
       FROM contacts WHERE id = ?`
    )
    .get(id) as any;

  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    email: row.email,
    linkedinUrl: row.linkedin_url,
    company: row.company,
    role: row.role,
    source: row.source as ContactSource,
    createdAt: row.created_at,
  };
}

/**
 * Get contacts by company name
 */
export function getContactsByCompany(company: string): Contact[] {
  const db = ensureDb();
  const rows = db
    .query(
      `SELECT id, name, email, linkedin_url, company, role, source, created_at
       FROM contacts WHERE company = ? ORDER BY created_at DESC`
    )
    .all(company) as any[];

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    linkedinUrl: row.linkedin_url,
    company: row.company,
    role: row.role,
    source: row.source as ContactSource,
    createdAt: row.created_at,
  }));
}

// ============ Outreach Functions ============

/** Input for creating a new outreach record */
export interface CreateOutreachInput {
  jobId: string;
  contactId: string;
  messageType: MessageType;
  messageText: string;
}

/**
 * Create a new outreach record
 */
export function createOutreach(input: CreateOutreachInput): Outreach {
  const db = ensureDb();
  const id = generateId();
  const createdAt = new Date().toISOString();

  db.run(
    `INSERT INTO outreach (id, job_id, contact_id, message_type, message_text, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'draft', ?)`,
    [id, input.jobId, input.contactId, input.messageType, input.messageText, createdAt]
  );

  return {
    id,
    jobId: input.jobId,
    contactId: input.contactId,
    messageType: input.messageType,
    messageText: input.messageText,
    status: "draft",
    createdAt,
    sentAt: null,
    respondedAt: null,
  };
}

/**
 * Get an outreach by ID
 */
export function getOutreach(id: string): Outreach | null {
  const db = ensureDb();
  const row = db
    .query(
      `SELECT id, job_id, contact_id, message_type, message_text, status, created_at, sent_at, responded_at
       FROM outreach WHERE id = ?`
    )
    .get(id) as any;

  if (!row) return null;

  return {
    id: row.id,
    jobId: row.job_id,
    contactId: row.contact_id,
    messageType: row.message_type as MessageType,
    messageText: row.message_text,
    status: row.status as OutreachStatus,
    createdAt: row.created_at,
    sentAt: row.sent_at,
    respondedAt: row.responded_at,
  };
}

/**
 * Get all outreach for a job
 */
export function getOutreachByJob(jobId: string): Outreach[] {
  const db = ensureDb();
  const rows = db
    .query(
      `SELECT id, job_id, contact_id, message_type, message_text, status, created_at, sent_at, responded_at
       FROM outreach WHERE job_id = ? ORDER BY created_at DESC`
    )
    .all(jobId) as any[];

  return rows.map((row) => ({
    id: row.id,
    jobId: row.job_id,
    contactId: row.contact_id,
    messageType: row.message_type as MessageType,
    messageText: row.message_text,
    status: row.status as OutreachStatus,
    createdAt: row.created_at,
    sentAt: row.sent_at,
    respondedAt: row.responded_at,
  }));
}

/**
 * Get all outreach for a contact
 */
export function getOutreachByContact(contactId: string): Outreach[] {
  const db = ensureDb();
  const rows = db
    .query(
      `SELECT id, job_id, contact_id, message_type, message_text, status, created_at, sent_at, responded_at
       FROM outreach WHERE contact_id = ? ORDER BY created_at DESC`
    )
    .all(contactId) as any[];

  return rows.map((row) => ({
    id: row.id,
    jobId: row.job_id,
    contactId: row.contact_id,
    messageType: row.message_type as MessageType,
    messageText: row.message_text,
    status: row.status as OutreachStatus,
    createdAt: row.created_at,
    sentAt: row.sent_at,
    respondedAt: row.responded_at,
  }));
}

/**
 * Update outreach status
 */
export function updateOutreachStatus(id: string, status: OutreachStatus): Outreach {
  const db = ensureDb();
  const now = new Date().toISOString();

  if (status === "sent") {
    db.run(`UPDATE outreach SET status = ?, sent_at = ? WHERE id = ?`, [status, now, id]);
  } else if (status === "responded") {
    db.run(`UPDATE outreach SET status = ?, responded_at = ? WHERE id = ?`, [status, now, id]);
  } else {
    db.run(`UPDATE outreach SET status = ? WHERE id = ?`, [status, id]);
  }

  return getOutreach(id)!;
}

/**
 * Get pending follow-ups (sent more than N days ago with no response)
 */
export function getPendingFollowups(daysOld: number = 5): Outreach[] {
  const db = ensureDb();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysOld);
  const cutoffIso = cutoffDate.toISOString();

  const rows = db
    .query(
      `SELECT id, job_id, contact_id, message_type, message_text, status, created_at, sent_at, responded_at
       FROM outreach
       WHERE status = 'sent' AND sent_at < ?
       ORDER BY sent_at ASC`
    )
    .all(cutoffIso) as any[];

  return rows.map((row) => ({
    id: row.id,
    jobId: row.job_id,
    contactId: row.contact_id,
    messageType: row.message_type as MessageType,
    messageText: row.message_text,
    status: row.status as OutreachStatus,
    createdAt: row.created_at,
    sentAt: row.sent_at,
    respondedAt: row.responded_at,
  }));
}

/**
 * Get outreach statistics
 */
export function getOutreachStats(): OutreachStats {
  const db = ensureDb();

  const counts = db
    .query(
      `SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) as draft,
        SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent,
        SUM(CASE WHEN status = 'responded' THEN 1 ELSE 0 END) as responded,
        SUM(CASE WHEN status = 'no_response' THEN 1 ELSE 0 END) as no_response
      FROM outreach`
    )
    .get() as any;

  const total = counts?.total || 0;
  const draft = counts?.draft || 0;
  const sent = counts?.sent || 0;
  const responded = counts?.responded || 0;
  const noResponse = counts?.no_response || 0;

  // Response rate = responded / (sent + responded + no_response) * 100
  const nonDraft = sent + responded + noResponse;
  const responseRate = nonDraft > 0 ? (responded / nonDraft) * 100 : 0;

  return {
    total,
    draft,
    sent,
    responded,
    noResponse,
    responseRate: Math.round(responseRate * 100) / 100,
  };
}

// ============ Company Research Functions ============

/** Input for saving or updating company research */
export interface SaveCompanyResearchInput {
  companyName: string;
  data: CompanyResearchData;
}

/**
 * Save company research (upsert)
 */
export function saveCompanyResearch(input: SaveCompanyResearchInput): CompanyResearch {
  const db = ensureDb();
  const id = generateId();
  const researchedAt = new Date().toISOString();
  const dataJson = JSON.stringify(input.data);

  // Upsert - try insert, on conflict update
  db.run(
    `INSERT INTO company_research (id, company_name, data_json, researched_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(company_name) DO UPDATE SET
       data_json = excluded.data_json,
       researched_at = excluded.researched_at`,
    [id, input.companyName, dataJson, researchedAt]
  );

  // Fetch the current record (might have different ID if updated)
  return getCompanyResearch(input.companyName)!;
}

/**
 * Get company research by name
 */
export function getCompanyResearch(companyName: string): CompanyResearch | null {
  const db = ensureDb();
  const row = db
    .query(
      `SELECT id, company_name, data_json, researched_at
       FROM company_research WHERE company_name = ?`
    )
    .get(companyName) as any;

  if (!row) return null;

  return {
    id: row.id,
    companyName: row.company_name,
    data: JSON.parse(row.data_json) as CompanyResearchData,
    researchedAt: row.researched_at,
  };
}

/**
 * Format outreach stats for display
 */
export function formatOutreachStats(stats: OutreachStats): string {
  const lines = [
    "📊 *Outreach Statistics*",
    "",
    `📝 Total: ${stats.total}`,
    `📋 Draft: ${stats.draft}`,
    `📤 Sent: ${stats.sent}`,
    `✅ Responded: ${stats.responded}`,
    `❌ No Response: ${stats.noResponse}`,
    "",
    `📈 Response Rate: ${stats.responseRate.toFixed(1)}%`,
  ];

  return lines.join("\n");
}
