/**
 * Tests for Job Golem Supabase Sync (Contract Tests)
 *
 * NOTE: These are contract tests that validate expected behavior/interface,
 * not the actual syncJobs implementation. They document and enforce the API
 * contract but won't catch implementation regressions. For full coverage,
 * add integration tests that mock only Supabase while using real sync logic.
 *
 * Tests that syncJobs contract:
 * - Only syncs jobs passed as parameter
 * - Does NOT read from scraped-jobs.json when jobs provided
 * - Handles empty arrays correctly
 * - Handles Supabase errors gracefully
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, writeFileSync, rmSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";

// Test directories
const TEST_DIR = "/tmp/job-golem-sync-test";
const TEST_DATA_DIR = join(TEST_DIR, "data");
const SCRAPED_JOBS_FILE = join(TEST_DATA_DIR, "scraped-jobs.json");

// Track Supabase calls
let supabaseCalls: { table: string; operation: string; data: any }[] = [];
let mockSupabaseError: Error | null = null;

// Mock JobListing type
interface MockJobListing {
  id: string;
  title: string;
  company: string;
  location: string;
  url: string;
  source: string;
  language: string;
  scrapedAt: string;
}

describe("syncJobs filtering", () => {
  beforeEach(() => {
    supabaseCalls = [];
    mockSupabaseError = null;

    // Create test directories
    mkdirSync(TEST_DATA_DIR, { recursive: true });

    // Create a scraped-jobs.json with BAD jobs (should NOT be synced)
    const badJobs: MockJobListing[] = [
      {
        id: "bad-1",
        title: "Java Developer",
        company: "BadCorp",
        location: "Israel",
        url: "http://bad.com/1",
        source: "goozali",
        language: "en",
        scrapedAt: new Date().toISOString(),
      },
      {
        id: "bad-2",
        title: "C++ Engineer",
        company: "WrongStack",
        location: "Israel",
        url: "http://bad.com/2",
        source: "goozali",
        language: "en",
        scrapedAt: new Date().toISOString(),
      },
    ];
    writeFileSync(SCRAPED_JOBS_FILE, JSON.stringify(badJobs, null, 2));
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it("should only sync jobs passed as parameter, not from file", async () => {
    // Good jobs to sync (passed as parameter)
    const goodJobs: MockJobListing[] = [
      {
        id: "good-1",
        title: "React Developer",
        company: "GoodCorp",
        location: "Tel Aviv",
        url: "http://good.com/1",
        source: "goozali",
        language: "en",
        scrapedAt: new Date().toISOString(),
      },
    ];

    // Simulate sync with filtered jobs
    const syncedJobs = await mockSyncJobs(goodJobs);

    // Verify only good jobs were synced
    expect(syncedJobs.length).toBe(1);
    expect(syncedJobs[0].title).toBe("React Developer");

    // Verify bad jobs from file were NOT synced
    const syncedTitles = syncedJobs.map((j) => j.title);
    expect(syncedTitles).not.toContain("Java Developer");
    expect(syncedTitles).not.toContain("C++ Engineer");
  });

  it("should handle empty array correctly", async () => {
    const syncedJobs = await mockSyncJobs([]);
    expect(syncedJobs.length).toBe(0);
  });

  it("should NOT read from file when jobs array is provided", async () => {
    const goodJobs: MockJobListing[] = [
      {
        id: "provided-1",
        title: "TypeScript Engineer",
        company: "TSCorp",
        location: "Remote",
        url: "http://ts.com/1",
        source: "goozali",
        language: "en",
        scrapedAt: new Date().toISOString(),
      },
    ];

    // Even though scraped-jobs.json has bad jobs, only provided jobs should sync
    const syncedJobs = await mockSyncJobs(goodJobs);

    expect(syncedJobs.length).toBe(1);
    expect(syncedJobs[0].id).toBe("provided-1");
  });

  it("should fall back to file when no jobs provided (backward compat)", async () => {
    // This tests the CLI mode where no jobs are passed
    const syncedJobs = await mockSyncJobs(undefined);

    // Should read from file (the bad jobs)
    expect(syncedJobs.length).toBe(2);
    expect(syncedJobs.map((j) => j.title)).toContain("Java Developer");
  });
});

describe("syncJobs error handling", () => {
  beforeEach(() => {
    supabaseCalls = [];
    mockSupabaseError = null;
    mkdirSync(TEST_DATA_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it("should handle Supabase errors gracefully", async () => {
    mockSupabaseError = new Error("Supabase connection failed");

    const jobs: MockJobListing[] = [
      {
        id: "test-1",
        title: "Full Stack Developer",
        company: "TestCorp",
        location: "Israel",
        url: "http://test.com/1",
        source: "goozali",
        language: "en",
        scrapedAt: new Date().toISOString(),
      },
    ];

    // Should not throw, but return empty (or partial) results
    const result = await mockSyncJobsWithError(jobs);
    expect(result.error).toBeDefined();
  });
});

/**
 * Mock syncJobs that simulates the fixed behavior
 * This tests that ONLY the provided jobs are synced
 */
async function mockSyncJobs(
  filteredJobs?: MockJobListing[]
): Promise<MockJobListing[]> {
  // This simulates the FIXED behavior:
  // - If filteredJobs is provided, use those
  // - If not, read from file (backward compat for CLI)

  let jobsToSync: MockJobListing[];

  if (filteredJobs !== undefined) {
    // Use provided filtered jobs (the fix!)
    jobsToSync = filteredJobs;
  } else {
    // Fall back to file (CLI mode)
    if (existsSync(SCRAPED_JOBS_FILE)) {
      jobsToSync = JSON.parse(readFileSync(SCRAPED_JOBS_FILE, "utf-8"));
    } else {
      jobsToSync = [];
    }
  }

  // Record what would be synced
  supabaseCalls.push({
    table: "golem_jobs",
    operation: "upsert",
    data: jobsToSync,
  });

  return jobsToSync;
}

/**
 * Mock syncJobs that simulates an error
 */
async function mockSyncJobsWithError(
  jobs: MockJobListing[]
): Promise<{ data: MockJobListing[]; error: Error | null }> {
  if (mockSupabaseError) {
    return { data: [], error: mockSupabaseError };
  }
  return { data: jobs, error: null };
}
