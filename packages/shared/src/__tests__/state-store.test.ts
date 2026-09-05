import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, rmSync } from "fs";
import { join } from "path";

// Set test dir BEFORE importing state-store (it reads env at module level)
const TEST_DIR = join(import.meta.dir, "../../.test-state-store");
process.env.GOLEMS_STATE_DIR = TEST_DIR;
process.env.STATE_BACKEND = "file";

// Now import — paths will use TEST_DIR
const { getState, setState, logEvent, getRecentEvents, isJobSeen, markJobSeen, markJobsSeen, getSeenJobIds } =
  await import("@golems/shared/lib/state-store");

describe("state-store (file mode)", () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
  });

  describe("key-value state", () => {
    it("returns null for non-existent key", async () => {
      const result = await getState("nonexistent");
      expect(result).toBeNull();
    });

    it("can set and get a value", async () => {
      await setState("testKey", { hello: "world" });
      const result = await getState<{ hello: string }>("testKey");
      expect(result?.hello).toBe("world");
    });

    it("preserves other keys when setting", async () => {
      await setState("key1", "value1");
      await setState("key2", "value2");
      expect(await getState("key1")).toBe("value1");
      expect(await getState("key2")).toBe("value2");
    });
  });

  describe("seen jobs", () => {
    it("reports unseen job correctly", async () => {
      expect(await isJobSeen("job-123")).toBe(false);
    });

    it("can mark and check job as seen", async () => {
      await markJobSeen("job-456");
      expect(await isJobSeen("job-456")).toBe(true);
    });

    it("supports batch mark", async () => {
      await markJobsSeen(["a", "b", "c"]);
      expect(await isJobSeen("a")).toBe(true);
      expect(await isJobSeen("b")).toBe(true);
      expect(await isJobSeen("c")).toBe(true);
      expect(await isJobSeen("d")).toBe(false);
    });

    it("returns Set from getSeenJobIds", async () => {
      await markJobsSeen(["x", "y"]);
      const ids = await getSeenJobIds();
      expect(ids.has("x")).toBe(true);
      expect(ids.has("y")).toBe(true);
      expect(ids.size).toBe(2);
    });

    it("does not duplicate on re-mark", async () => {
      await markJobSeen("dup");
      await markJobSeen("dup");
      const ids = await getSeenJobIds();
      // Count how many times "dup" appears
      const arr = [...ids];
      expect(arr.filter((x) => x === "dup").length).toBe(1);
    });
  });

  describe("event log", () => {
    it("returns empty array when no events", async () => {
      const events = await getRecentEvents(24);
      expect(events).toEqual([]);
    });

    it("can log and retrieve events", async () => {
      await logEvent("job_match", { company: "Google", role: "SWE" }, "jobgolem");
      const events = await getRecentEvents(1);
      expect(events.length).toBe(1);
      expect(events[0].type).toBe("job_match");
      expect(events[0].actor).toBe("jobgolem");
      expect(events[0].data.company).toBe("Google");
    });

    it("logs multiple events", async () => {
      await logEvent("job_match", { company: "A" }, "jobgolem");
      await logEvent("email_routed", { subject: "B" }, "emailgolem");
      const events = await getRecentEvents(1);
      expect(events.length).toBe(2);
    });

    it("includes event ID and timestamp", async () => {
      await logEvent("job_match", { company: "Test" }, "jobgolem");
      const events = await getRecentEvents(1);
      expect(events[0].id).toBeTruthy();
      expect(events[0].timestamp).toBeTruthy();
    });
  });
});
