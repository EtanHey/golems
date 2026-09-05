/**
 * Tests for auto-outreach integration (E6)
 *
 * When JobGolem finds a job scoring 8+, it should:
 * 1. Research the company
 * 2. Find contacts
 * 3. Generate outreach draft
 * 4. Save to outreach DB
 * 5. Return result for notification
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import {
  processHotMatch,
  type HotMatchResult,
  type JobMatch,
} from "@golems/recruiter/auto-outreach";
import { initDb, closeDb, getOutreachByJob, getCompanyResearch } from "@golems/recruiter/outreach-db";

describe("Auto-Outreach (E6)", () => {
  let testDbPath: string;
  let tempDir: string;

  beforeEach(() => {
    // Create temp directory for test DB
    tempDir = mkdtempSync(join(tmpdir(), "auto-outreach-test-"));
    testDbPath = join(tempDir, "test-outreach.db");
    initDb(testDbPath);
  });

  afterEach(() => {
    closeDb();
    // Clean up temp directory
    try {
      rmSync(tempDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("processHotMatch", () => {
    const mockJob: JobMatch = {
      id: "job-123",
      title: "Senior Full Stack Developer",
      company: "Acme Corp",
      location: "Tel Aviv",
      url: "https://example.com/job/123",
      techStack: ["React", "TypeScript", "Node.js"],
      description: "We are looking for a senior developer...",
      score: 9,
      reason: "Strong tech stack match",
    };

    test("returns result with company research", async () => {
      const result = await processHotMatch(mockJob, { skipContactSearch: true });

      expect(result).toBeDefined();
      expect(result.jobId).toBe("job-123");
      expect(result.company).toBe("Acme Corp");
      expect(result.companyResearch).toBeDefined();
    });

    test("saves company research to database", async () => {
      await processHotMatch(mockJob, { skipContactSearch: true });

      const cached = getCompanyResearch("Acme Corp");
      expect(cached).toBeDefined();
      expect(cached!.companyName).toBe("Acme Corp");
    });

    test("creates outreach draft when contacts found", async () => {
      // Use unique job ID to avoid conflicts with other tests
      const uniqueJob = { ...mockJob, id: `job-unique-${Date.now()}` };

      // Mock contact finder to return a contact
      const result = await processHotMatch(uniqueJob, {
        mockContacts: [
          {
            name: "John Smith",
            role: "Engineering Manager",
            email: "john@acme.com",
            source: "github" as const,
          },
        ],
      });

      expect(result.contactsFound).toBe(1);
      expect(result.draftsCreated).toBe(1);

      // Verify outreach saved to DB
      const outreaches = getOutreachByJob(uniqueJob.id);
      expect(outreaches.length).toBe(1);
      expect(outreaches[0].status).toBe("draft");
    });

    test("creates multiple drafts for multiple contacts", async () => {
      const result = await processHotMatch(mockJob, {
        mockContacts: [
          { name: "John Smith", role: "Engineering Manager", email: "john@acme.com", source: "github" as const },
          { name: "Jane Doe", role: "Tech Lead", linkedinUrl: "linkedin.com/in/janedoe", source: "linkedin" as const },
        ],
      });

      expect(result.contactsFound).toBe(2);
      expect(result.draftsCreated).toBe(2);
    });

    test("handles no contacts found gracefully", async () => {
      const result = await processHotMatch(mockJob, { skipContactSearch: true });

      expect(result.contactsFound).toBe(0);
      expect(result.draftsCreated).toBe(0);
      expect(result.error).toBeUndefined();
    });

    test("skips unreachable contacts (no email AND no linkedin)", async () => {
      const result = await processHotMatch(mockJob, {
        mockContacts: [
          { name: "Reachable", role: "CTO", email: "cto@acme.com", source: "github" as const },
          { name: "Unreachable", role: "PM", source: "github" as const },
        ],
      });

      // Should only create draft for the reachable contact
      expect(result.contactsFound).toBe(2);
      expect(result.draftsCreated).toBe(1);
    });

    test("includes tech stack in company research from job posting", async () => {
      const result = await processHotMatch(mockJob, { skipContactSearch: true });

      // The job's tech stack should be included
      expect(result.companyResearch?.techStack).toContain("React");
      expect(result.companyResearch?.techStack).toContain("TypeScript");
    });

    test("generates personalized outreach message", async () => {
      const result = await processHotMatch(mockJob, {
        mockContacts: [
          { name: "John Smith", role: "Engineering Manager", email: "john@acme.com", source: "github" as const },
        ],
      });

      const outreaches = getOutreachByJob("job-123");
      expect(outreaches[0].messageText).toContain("Acme Corp");
      expect(outreaches[0].messageText).toContain("Senior Full Stack Developer");
    });

    test("handles company research failure gracefully", async () => {
      // Use a company name that will fail GitHub lookup
      const badJob: JobMatch = {
        ...mockJob,
        company: "NonexistentCompanyXYZ123456",
      };

      const result = await processHotMatch(badJob, { skipContactSearch: true });

      // Should still succeed, just with minimal research
      expect(result).toBeDefined();
      expect(result.error).toBeUndefined();
    });
  });

  describe("formatHotMatchNotification", () => {
    test("formats notification for Telegram", async () => {
      const { formatHotMatchNotification } = await import("@golems/recruiter/auto-outreach");

      const result: HotMatchResult = {
        jobId: "job-123",
        company: "Acme Corp",
        title: "Senior Developer",
        score: 9,
        companyResearch: {
          name: "Acme Corp",
          website: "https://acme.com",
          techStack: ["React", "Node.js"],
          recentNews: [],
          teamSize: null,
          founded: null,
          israeliOffice: null,
          githubOrg: "acmecorp",
          linkedinUrl: null,
        },
        contactsFound: 2,
        draftsCreated: 2,
      };

      const notification = formatHotMatchNotification(result);

      expect(notification).toContain("Acme Corp");
      expect(notification).toContain("2 contacts");
      expect(notification).toContain("2 drafts");
    });

    test("handles zero contacts in notification", async () => {
      const { formatHotMatchNotification } = await import("@golems/recruiter/auto-outreach");

      const result: HotMatchResult = {
        jobId: "job-123",
        company: "Acme Corp",
        title: "Senior Developer",
        score: 9,
        contactsFound: 0,
        draftsCreated: 0,
      };

      const notification = formatHotMatchNotification(result);

      expect(notification).toContain("Acme Corp");
      expect(notification).toContain("No contacts");
    });
  });
});

describe("Integration: JobGolem -> RecruiterGolem", () => {
  test("processHotMatches processes multiple jobs", async () => {
    const { processHotMatches } = await import("@golems/recruiter/auto-outreach");

    // Create temp DB
    const tempDir = mkdtempSync(join(tmpdir(), "integration-test-"));
    const testDbPath = join(tempDir, "test-outreach.db");
    initDb(testDbPath);

    const jobs: JobMatch[] = [
      {
        id: "job-1",
        title: "Developer",
        company: "Company A",
        location: "Tel Aviv",
        url: "https://example.com/1",
        techStack: ["React"],
        score: 9,
        reason: "Match",
      },
      {
        id: "job-2",
        title: "Engineer",
        company: "Company B",
        location: "Haifa",
        url: "https://example.com/2",
        techStack: ["Vue"],
        score: 8,
        reason: "Match",
      },
    ];

    const results = await processHotMatches(jobs, { skipContactSearch: true });

    expect(results.length).toBe(2);
    expect(results[0].company).toBe("Company A");
    expect(results[1].company).toBe("Company B");

    closeDb();
    rmSync(tempDir, { recursive: true });
  });
});
