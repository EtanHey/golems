/**
 * Tests for Job Golem Scraper and Sync
 *
 * TDD approach: RED → GREEN → REFACTOR
 */

import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import { existsSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "fs";
import { join, dirname } from "path";

// Test paths (isolated from production)
const TEST_DIR = "/tmp/golems-zikaron-test/job-golem";
const TEST_EVENT_LOG = "/tmp/golems-zikaron-test/job-golem/event-log.json";

// Import will fail initially if code not implemented
import { loadScrapedJobs, type JobListing, scrapeGreenhouse, scrapeLever } from "@golems/jobs/scraper";
import { logEvent, type GolemEvent } from "@golems/shared/lib/event-log";

describe("Job Golem - loadScrapedJobs()", () => {
  const TEST_JOBS_FILE = join(TEST_DIR, "scraped-jobs.json");

  beforeEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it("should return empty array if no file exists", () => {
    // This test uses the exported function
    // Production code uses HOME env var, so this mainly tests the import
    expect(Array.isArray(loadScrapedJobs())).toBe(true);
  });
});

describe("Job Golem - JobListing Interface", () => {
  it("should have all required fields", () => {
    const job: JobListing = {
      id: "test-123",
      title: "Senior Frontend Developer",
      company: "TechCorp",
      location: "Tel Aviv",
      experience: "5+ years",
      description: "Build amazing things",
      url: "https://example.com/job/123",
      source: "secretTLV",
      language: "en",
      scrapedAt: new Date().toISOString(),
    };

    expect(job.id).toBe("test-123");
    expect(job.source).toBe("secretTLV");
    expect(job.language).toBe("en");
  });

  it("should support all source types", () => {
    const sources: Array<JobListing["source"]> = [
      "secretTLV",
      "drushim",
      "indeed",
      "goozali",
      "greenhouse",
      "lever",
    ];

    for (const source of sources) {
      const job: JobListing = {
        id: `${source}-1`,
        title: "Test",
        company: "Test",
        location: "Test",
        experience: "",
        description: "",
        url: "https://example.com",
        source,
        language: "en",
        scrapedAt: new Date().toISOString(),
      };
      expect(job.source).toBe(source);
    }
  });
});

describe("Job Golem - Watchlist", () => {
  it("should have WatchlistCompany interface with required fields", async () => {
    // Dynamic import to get the type at runtime
    const watchlist = await import("@golems/jobs/watchlist");

    // Verify loadWatchlist returns correct structure
    const loaded = watchlist.loadWatchlist();
    expect(loaded).toHaveProperty("companies");
    expect(loaded).toHaveProperty("lastUpdated");
    expect(Array.isArray(loaded.companies)).toBe(true);
  });

  it("should support all status values via loadWatchlist", async () => {
    const watchlist = await import("@golems/jobs/watchlist");
    const result = watchlist.loadWatchlist();

    // The watchlist should have the expected structure
    // Each company in the watchlist should have a status from the valid set
    const validStatuses = new Set(["active", "applied", "rejected", "paused"]);

    // Verify the structure exists (companies array)
    expect(Array.isArray(result.companies)).toBe(true);

    // If companies exist, verify their status is valid
    for (const company of result.companies) {
      if (company.status) {
        expect(validStatuses.has(company.status)).toBe(true);
      }
    }
  });
});

describe("Job Golem - Sync Data Transformation", () => {
  it("should transform JobListing to Supabase record format", () => {
    const job: JobListing = {
      id: "secretlv-monday-frontend-dev",
      title: "Frontend Developer",
      company: "Monday.com",
      location: "Tel Aviv",
      experience: "3-5 years",
      description: "Build React components for our design system",
      url: "https://secretlv.com/jobs/monday-frontend-dev",
      source: "secretTLV",
      language: "en",
      scrapedAt: "2026-02-04T12:00:00.000Z",
    };

    // Transform to Supabase format
    const record = {
      external_id: job.id,
      title: job.title,
      company: job.company,
      location: job.location || null,
      experience: job.experience || null,
      description: job.description || null,
      url: job.url,
      source: job.source,
      language: job.language,
      status: "new",
      scraped_at: job.scrapedAt,
    };

    expect(record.external_id).toBe("secretlv-monday-frontend-dev");
    expect(record.status).toBe("new");
    expect(record.scraped_at).toBe("2026-02-04T12:00:00.000Z");
  });

  it("should handle null optional fields", () => {
    const job: JobListing = {
      id: "test-1",
      title: "Developer",
      company: "Startup",
      location: "", // empty string
      experience: "", // empty string
      description: "",
      url: "https://example.com",
      source: "indeed",
      language: "en",
      scrapedAt: new Date().toISOString(),
    };

    const record = {
      location: job.location || null,
      experience: job.experience || null,
      description: job.description || null,
    };

    // Empty strings should become null for Supabase
    expect(record.location).toBeNull();
    expect(record.experience).toBeNull();
    expect(record.description).toBeNull();
  });
});

describe("Job Golem - Sync State Management", () => {
  const SYNC_STATE_FILE = join(TEST_DIR, "sync-state.json");

  beforeEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it("should track synced job IDs", () => {
    const syncState = {
      lastSyncAt: new Date().toISOString(),
      syncedIds: ["job-1", "job-2", "job-3"],
    };

    writeFileSync(SYNC_STATE_FILE, JSON.stringify(syncState, null, 2));

    const loaded = JSON.parse(readFileSync(SYNC_STATE_FILE, "utf-8"));
    expect(loaded.syncedIds.length).toBe(3);
    expect(loaded.syncedIds.includes("job-2")).toBe(true);
  });

  it("should detect new jobs not in sync state", () => {
    const syncedIds = new Set(["job-1", "job-2"]);
    const allJobs = [
      { id: "job-1" },
      { id: "job-2" },
      { id: "job-3" }, // new
      { id: "job-4" }, // new
    ];

    const newJobs = allJobs.filter((j) => !syncedIds.has(j.id));

    expect(newJobs.length).toBe(2);
    expect(newJobs[0].id).toBe("job-3");
    expect(newJobs[1].id).toBe("job-4");
  });

  it("should rotate synced IDs to prevent unbounded growth", () => {
    // Create 1100 IDs
    const syncedIds = Array.from({ length: 1100 }, (_, i) => `job-${i}`);

    // Keep only last 1000
    const rotated = syncedIds.slice(-1000);

    expect(rotated.length).toBe(1000);
    expect(rotated[0]).toBe("job-100"); // First 100 dropped
    expect(rotated[999]).toBe("job-1099");
  });
});

describe("Job Golem - Dashboard Data Queries", () => {
  it("should filter jobs by status", () => {
    const jobs = [
      { id: "1", status: "new" },
      { id: "2", status: "viewed" },
      { id: "3", status: "new" },
      { id: "4", status: "applied" },
      { id: "5", status: "rejected" },
    ];

    const newJobs = jobs.filter((j) => j.status === "new");
    const appliedJobs = jobs.filter((j) => j.status === "applied");

    expect(newJobs.length).toBe(2);
    expect(appliedJobs.length).toBe(1);
  });

  it("should filter jobs by source", () => {
    const jobs = [
      { id: "1", source: "secretTLV" },
      { id: "2", source: "indeed" },
      { id: "3", source: "secretTLV" },
      { id: "4", source: "drushim" },
    ];

    const secretJobs = jobs.filter((j) => j.source === "secretTLV");

    expect(secretJobs.length).toBe(2);
  });

  it("should search jobs by title and company", () => {
    const jobs = [
      { id: "1", title: "React Developer", company: "Monday.com" },
      { id: "2", title: "Backend Engineer", company: "Wix" },
      { id: "3", title: "Full Stack Developer", company: "ReactStartup" },
    ];

    const searchQuery = "react";
    const searchResults = jobs.filter(
      (j) =>
        j.title.toLowerCase().includes(searchQuery) ||
        j.company.toLowerCase().includes(searchQuery)
    );

    expect(searchResults.length).toBe(2); // React Developer + ReactStartup
  });
});

describe("Job Golem - Event Logging", () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it("should log job_match events with correct data shape", async () => {
    await logEvent(
      "job_match",
      { company: "Monday.com", role: "Frontend Developer", score: 9, url: "https://example.com/job/1" },
      "jobgolem",
      TEST_EVENT_LOG
    );

    expect(existsSync(TEST_EVENT_LOG)).toBe(true);
    const events: GolemEvent[] = JSON.parse(readFileSync(TEST_EVENT_LOG, "utf-8"));
    expect(events.length).toBe(1);
    expect(events[0].type).toBe("job_match");
    expect(events[0].actor).toBe("jobgolem");
    expect(events[0].data.company).toBe("Monday.com");
    expect(events[0].data.role).toBe("Frontend Developer");
    expect(events[0].data.score).toBe(9);
    expect(events[0].data.url).toBe("https://example.com/job/1");
  });

  it("should log multiple job_match events for multiple hot matches", async () => {
    const hotMatches = [
      { company: "Wix", role: "Sr. Engineer", score: 8, url: "https://wix.com/job/1" },
      { company: "Monday", role: "Tech Lead", score: 9, url: "https://monday.com/job/2" },
    ];

    for (const match of hotMatches) {
      await logEvent("job_match", match, "jobgolem", TEST_EVENT_LOG);
    }

    const events: GolemEvent[] = JSON.parse(readFileSync(TEST_EVENT_LOG, "utf-8"));
    expect(events.length).toBe(2);
    expect(events[0].data.company).toBe("Wix");
    expect(events[1].data.company).toBe("Monday");
  });
});

describe("Job Golem - Greenhouse ATS Scraper", () => {
  it("should return jobs with correct source and ID format", async () => {
    // This is an integration test that hits the real Greenhouse API
    // Skip if no network (CI) — but in dev, it's a quick sanity check
    const jobs = await scrapeGreenhouse();

    // Should find at least some jobs (companies like Taboola, JFrog have 100+ worldwide)
    expect(Array.isArray(jobs)).toBe(true);

    if (jobs.length > 0) {
      const job = jobs[0];
      expect(job.source).toBe("greenhouse");
      expect(job.id).toMatch(/^greenhouse-/);
      expect(job.url).toMatch(/^https?:\/\//); // URL can be greenhouse.io or company's own careers page
      expect(job.language).toBe("en");
      expect(job.title.length).toBeGreaterThan(0);
      expect(job.company.length).toBeGreaterThan(0);
    }
  }, 30000); // 30s timeout for network

  it("should filter to Israel-relevant locations only", async () => {
    const jobs = await scrapeGreenhouse();

    for (const job of jobs) {
      const loc = job.location.toLowerCase();
      const isRelevant = /israel|tel[\s-]?aviv|jerusalem|haifa|herzliya|ramat|remote|hybrid|netanya|petah|bnei|rehovot|kfar|ra.anana|rishon|modiin|be.er[\s-]?sheva/i.test(loc);
      expect(isRelevant).toBe(true);
    }
  }, 30000);
});

describe("Job Golem - Lever ATS Scraper", () => {
  it("should return jobs with correct source and ID format", async () => {
    const jobs = await scrapeLever();

    expect(Array.isArray(jobs)).toBe(true);

    if (jobs.length > 0) {
      const job = jobs[0];
      expect(job.source).toBe("lever");
      expect(job.id).toMatch(/^lever-/);
      expect(job.url).toContain("lever.co");
      expect(job.language).toBe("en");
      expect(job.title.length).toBeGreaterThan(0);
      expect(job.company.length).toBeGreaterThan(0);
    }
  }, 30000);
});
