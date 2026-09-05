import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { rmSync, existsSync, mkdirSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import {
  initDb,
  closeDb,
  createContact,
  createOutreach,
  saveCompanyResearch,
  updateOutreachStatus,
} from "@golems/recruiter/outreach-db";
import { exportToObsidian } from "@golems/recruiter/obsidian-export";

// Use temp directories for tests
const TEST_DB_PATH = join(process.cwd(), ".test-obsidian-export.db");
const TEST_OUTPUT_DIR = join(process.cwd(), ".test-obsidian-vault");

describe("Obsidian Export", () => {
  beforeEach(() => {
    // Clean up any existing test database and output directory
    if (existsSync(TEST_DB_PATH)) {
      rmSync(TEST_DB_PATH);
    }
    if (existsSync(TEST_OUTPUT_DIR)) {
      rmSync(TEST_OUTPUT_DIR, { recursive: true });
    }
    initDb(TEST_DB_PATH);
  });

  afterEach(() => {
    closeDb();
    if (existsSync(TEST_DB_PATH)) {
      rmSync(TEST_DB_PATH);
    }
    if (existsSync(TEST_OUTPUT_DIR)) {
      rmSync(TEST_OUTPUT_DIR, { recursive: true });
    }
  });

  it("should create folder structure", () => {
    exportToObsidian(TEST_OUTPUT_DIR);

    expect(existsSync(join(TEST_OUTPUT_DIR, "contacts"))).toBe(true);
    expect(existsSync(join(TEST_OUTPUT_DIR, "companies"))).toBe(true);
    expect(existsSync(join(TEST_OUTPUT_DIR, "outreach"))).toBe(true);
  });

  it("should export contact with frontmatter and wikilink to company", () => {
    const contact = createContact({
      name: "John Doe",
      email: "john@example.com",
      linkedinUrl: "https://linkedin.com/in/johndoe",
      company: "Acme Corp",
      role: "Engineering Manager",
      source: "github",
    });

    exportToObsidian(TEST_OUTPUT_DIR);

    const contactPath = join(TEST_OUTPUT_DIR, "contacts", "John-Doe.md");
    expect(existsSync(contactPath)).toBe(true);

    const content = readFileSync(contactPath, "utf-8");

    // Check frontmatter
    expect(content).toContain("---");
    expect(content).toContain("email: john@example.com");
    expect(content).toContain("linkedin: https://linkedin.com/in/johndoe");
    expect(content).toContain("company: Acme Corp");
    expect(content).toContain("role: Engineering Manager");
    expect(content).toContain("source: github");

    // Check wikilink to company
    expect(content).toContain("[[Acme Corp]]");

    // Check tags
    expect(content).toContain("#contact");
    expect(content).toContain("#outreach");
  });

  it("should handle contact with no email (LinkedIn only)", () => {
    const contact = createContact({
      name: "Jane Smith",
      linkedinUrl: "https://linkedin.com/in/janesmith",
      company: "TechCo",
      role: "CTO",
      source: "linkedin",
    });

    exportToObsidian(TEST_OUTPUT_DIR);

    const contactPath = join(TEST_OUTPUT_DIR, "contacts", "Jane-Smith.md");
    const content = readFileSync(contactPath, "utf-8");

    // email field should be present but empty or null
    expect(content).toContain("email:");
    expect(content).toContain("linkedin: https://linkedin.com/in/janesmith");
  });

  it("should export company with frontmatter and backlinks to contacts", () => {
    // Create multiple contacts for the same company
    createContact({
      name: "John Doe",
      email: "john@acme.com",
      company: "Acme Corp",
      role: "Engineering Manager",
      source: "github",
    });

    createContact({
      name: "Jane Smith",
      email: "jane@acme.com",
      company: "Acme Corp",
      role: "CTO",
      source: "linkedin",
    });

    exportToObsidian(TEST_OUTPUT_DIR);

    const companyPath = join(TEST_OUTPUT_DIR, "companies", "Acme-Corp.md");
    expect(existsSync(companyPath)).toBe(true);

    const content = readFileSync(companyPath, "utf-8");

    // Check frontmatter
    expect(content).toContain("---");
    expect(content).toContain("name: Acme Corp");

    // Check backlinks to contacts
    expect(content).toContain("[[John Doe]]");
    expect(content).toContain("[[Jane Smith]]");

    // Check tags
    expect(content).toContain("#company");
    expect(content).toContain("#outreach");
  });

  it("should export company with research data", () => {
    createContact({
      name: "John Doe",
      email: "john@acme.com",
      company: "Acme Corp",
      role: "Engineering Manager",
      source: "github",
    });

    saveCompanyResearch({
      companyName: "Acme Corp",
      data: {
        website: "https://acme.com",
        techStack: ["React", "Node.js", "PostgreSQL"],
        teamSize: "50-100",
        founded: "2015",
        israeliOffice: true,
      },
    });

    exportToObsidian(TEST_OUTPUT_DIR);

    const companyPath = join(TEST_OUTPUT_DIR, "companies", "Acme-Corp.md");
    const content = readFileSync(companyPath, "utf-8");

    // Check research data sections
    expect(content).toContain("## Research");
    expect(content).toContain("Website: https://acme.com");
    expect(content).toContain("Team Size: 50-100");
    expect(content).toContain("Founded: 2015");
    expect(content).toContain("Israeli Office: Yes");

    // Check tech stack list
    expect(content).toContain("- React");
    expect(content).toContain("- Node.js");
    expect(content).toContain("- PostgreSQL");
  });

  it("should export outreach message with wikilinks and status tag", () => {
    const contact = createContact({
      name: "John Doe",
      email: "john@acme.com",
      company: "Acme Corp",
      role: "Engineering Manager",
      source: "github",
    });

    const outreach = createOutreach({
      jobId: "job-123",
      contactId: contact.id,
      messageType: "email",
      messageText: "Hi John,\n\nI saw your work on...\n\nBest,\nEtan",
    });

    exportToObsidian(TEST_OUTPUT_DIR);

    const outreachFiles = readdirSync(join(TEST_OUTPUT_DIR, "outreach"));
    expect(outreachFiles.length).toBe(1);

    // File name should be: YYYY-MM-DD-John-Doe.md
    const outreachFile = outreachFiles[0];
    expect(outreachFile).toContain("John-Doe.md");

    const content = readFileSync(join(TEST_OUTPUT_DIR, "outreach", outreachFile), "utf-8");

    // Check frontmatter
    expect(content).toContain("---");
    expect(content).toContain("contact: John Doe");
    expect(content).toContain("company: Acme Corp");
    expect(content).toContain("messageType: email");
    expect(content).toContain("status: draft");

    // Check wikilinks
    expect(content).toContain("[[John Doe]]");
    expect(content).toContain("[[Acme Corp]]");

    // Check status tag
    expect(content).toContain("#status/draft");
    expect(content).toContain("#outreach");

    // Check message content
    expect(content).toContain("Hi John");
    expect(content).toContain("I saw your work on");
  });

  it("should export outreach with sent status and date", () => {
    const contact = createContact({
      name: "Jane Smith",
      email: "jane@techco.com",
      company: "TechCo",
      role: "CTO",
      source: "linkedin",
    });

    const outreach = createOutreach({
      jobId: "job-456",
      contactId: contact.id,
      messageType: "linkedin_connect",
      messageText: "Hi Jane, I'd love to connect...",
    });

    updateOutreachStatus(outreach.id, "sent");

    exportToObsidian(TEST_OUTPUT_DIR);

    const outreachFiles = readdirSync(join(TEST_OUTPUT_DIR, "outreach"));
    const content = readFileSync(join(TEST_OUTPUT_DIR, "outreach", outreachFiles[0]), "utf-8");

    // Check status tag
    expect(content).toContain("#status/sent");

    // Check frontmatter
    expect(content).toContain("status: sent");
    expect(content).toContain("sentAt:");
  });

  it("should sanitize filenames with special characters", () => {
    const contact = createContact({
      name: "John O'Reilly / CEO",
      email: "john@example.com",
      company: "Tech & Innovation Ltd.",
      role: "CEO",
      source: "manual",
    });

    exportToObsidian(TEST_OUTPUT_DIR);

    // Should sanitize slashes, apostrophes, ampersands
    const contactFiles = readdirSync(join(TEST_OUTPUT_DIR, "contacts"));
    expect(contactFiles.length).toBe(1);
    expect(contactFiles[0]).not.toContain("/");
    expect(contactFiles[0]).not.toContain("'");

    const companyFiles = readdirSync(join(TEST_OUTPUT_DIR, "companies"));
    expect(companyFiles.length).toBe(1);
    expect(companyFiles[0]).not.toContain("&");
    // File should be sanitized: Tech-Innovation-Ltd.md (dots removed except .md extension)
    const baseFilename = companyFiles[0].replace(".md", "");
    expect(baseFilename).not.toContain(".");
  });

  it("should handle empty database gracefully", () => {
    exportToObsidian(TEST_OUTPUT_DIR);

    // Folders should exist but be empty
    expect(existsSync(join(TEST_OUTPUT_DIR, "contacts"))).toBe(true);
    expect(existsSync(join(TEST_OUTPUT_DIR, "companies"))).toBe(true);
    expect(existsSync(join(TEST_OUTPUT_DIR, "outreach"))).toBe(true);

    expect(readdirSync(join(TEST_OUTPUT_DIR, "contacts")).length).toBe(0);
    expect(readdirSync(join(TEST_OUTPUT_DIR, "companies")).length).toBe(0);
    expect(readdirSync(join(TEST_OUTPUT_DIR, "outreach")).length).toBe(0);
  });

  it("should deduplicate companies", () => {
    // Create multiple contacts for the same company
    createContact({
      name: "John Doe",
      email: "john@acme.com",
      company: "Acme Corp",
      role: "Engineer",
      source: "github",
    });

    createContact({
      name: "Jane Smith",
      email: "jane@acme.com",
      company: "Acme Corp",
      role: "Manager",
      source: "linkedin",
    });

    createContact({
      name: "Bob Johnson",
      email: "bob@acme.com",
      company: "Acme Corp",
      role: "CTO",
      source: "hunter",
    });

    exportToObsidian(TEST_OUTPUT_DIR);

    // Should have only 1 company file
    const companyFiles = readdirSync(join(TEST_OUTPUT_DIR, "companies"));
    expect(companyFiles.length).toBe(1);
    expect(companyFiles[0]).toBe("Acme-Corp.md");

    // Should have 3 contact files
    const contactFiles = readdirSync(join(TEST_OUTPUT_DIR, "contacts"));
    expect(contactFiles.length).toBe(3);
  });
});
