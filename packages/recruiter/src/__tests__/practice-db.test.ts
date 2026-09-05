import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { rmSync, existsSync } from "fs";
import { join } from "path";
import {
  initDb,
  closeDb,
  createSession,
  getSession,
  completeSession,
  getRecentSessions,
  addQuestion,
  getSessionQuestions,
  getStats,
  type PracticeSession,
  type SessionQuestion,
} from "@golems/recruiter/practice-db";

// Use a temp directory for tests
const TEST_DB_PATH = join(process.cwd(), ".test-practice.db");

describe("Practice Database", () => {
  beforeEach(() => {
    // Clean up any existing test database
    if (existsSync(TEST_DB_PATH)) {
      rmSync(TEST_DB_PATH);
    }
    initDb(TEST_DB_PATH);
  });

  afterEach(() => {
    closeDb();
    if (existsSync(TEST_DB_PATH)) {
      rmSync(TEST_DB_PATH);
    }
  });

  describe("Session Management", () => {
    it("should create a new session", () => {
      const session = createSession("leetcode", "easy");

      expect(session.id).toBeDefined();
      expect(session.mode).toBe("leetcode");
      expect(session.difficulty).toBe("easy");
      expect(session.status).toBe("in_progress");
      expect(session.startedAt).toBeDefined();
      expect(session.endedAt).toBeNull();
    });

    it("should retrieve a session by ID", () => {
      const created = createSession("system-design", "hard");
      const retrieved = getSession(created.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(created.id);
      expect(retrieved!.mode).toBe("system-design");
    });

    it("should complete a session with pass result", () => {
      const session = createSession("behavioral", "medium");
      const completed = completeSession(session.id, true, "Good performance");

      expect(completed.status).toBe("passed");
      expect(completed.passed).toBe(true);
      expect(completed.notes).toBe("Good performance");
      expect(completed.endedAt).toBeDefined();
    });

    it("should complete a session with fail result", () => {
      const session = createSession("debugging", "hard");
      const completed = completeSession(session.id, false, "Struggled with edge cases");

      expect(completed.status).toBe("failed");
      expect(completed.passed).toBe(false);
      expect(completed.notes).toBe("Struggled with edge cases");
    });

    it("should retrieve recent sessions", () => {
      createSession("leetcode", "easy");
      createSession("system-design", "medium");
      createSession("behavioral", "hard");

      const recent = getRecentSessions(2);
      expect(recent.length).toBe(2);
    });

    it("should filter recent sessions by mode", () => {
      createSession("leetcode", "easy");
      createSession("leetcode", "medium");
      createSession("system-design", "hard");

      const leetcodeSessions = getRecentSessions(10, "leetcode");
      expect(leetcodeSessions.length).toBe(2);
      expect(leetcodeSessions.every((s) => s.mode === "leetcode")).toBe(true);
    });
  });

  describe("Question Tracking", () => {
    it("should add a question to a session", () => {
      const session = createSession("complexity", "medium");
      const question = addQuestion(session.id, "medium", "What is O(n log n)?");

      expect(question.id).toBeDefined();
      expect(question.sessionId).toBe(session.id);
      expect(question.difficulty).toBe("medium");
      expect(question.topic).toBe("What is O(n log n)?");
    });

    it("should retrieve all questions for a session", () => {
      const session = createSession("leetcode", "easy");
      addQuestion(session.id, "easy", "Two Sum");
      addQuestion(session.id, "medium", "Add Two Numbers");

      const questions = getSessionQuestions(session.id);
      expect(questions.length).toBe(2);
    });
  });

  describe("Statistics", () => {
    it("should calculate stats for a mode", () => {
      // Create and complete sessions
      const s1 = createSession("leetcode", "easy");
      completeSession(s1.id, true);

      const s2 = createSession("leetcode", "medium");
      completeSession(s2.id, false);

      const s3 = createSession("leetcode", "hard");
      completeSession(s3.id, true);

      const stats = getStats("leetcode");

      expect(stats.totalSessions).toBe(3);
      expect(stats.passedSessions).toBe(2);
      expect(stats.failedSessions).toBe(1);
      expect(stats.passRate).toBeCloseTo(66.67, 1);
    });

    it("should calculate overall stats", () => {
      const s1 = createSession("leetcode", "easy");
      completeSession(s1.id, true);

      const s2 = createSession("system-design", "medium");
      completeSession(s2.id, true);

      const s3 = createSession("behavioral", "hard");
      completeSession(s3.id, false);

      const stats = getStats(); // No mode = overall

      expect(stats.totalSessions).toBe(3);
      expect(stats.passedSessions).toBe(2);
      expect(stats.passRate).toBeCloseTo(66.67, 1);
    });

    it("should return zero stats for mode with no sessions", () => {
      const stats = getStats("debugging");

      expect(stats.totalSessions).toBe(0);
      expect(stats.passedSessions).toBe(0);
      expect(stats.passRate).toBe(0);
    });

    it("should calculate streak correctly", () => {
      // 3 wins in a row
      const s1 = createSession("leetcode", "easy");
      completeSession(s1.id, true);

      const s2 = createSession("leetcode", "medium");
      completeSession(s2.id, true);

      const s3 = createSession("leetcode", "hard");
      completeSession(s3.id, true);

      const stats = getStats("leetcode");
      expect(stats.currentStreak).toBe(3);

      // Now fail
      const s4 = createSession("leetcode", "hard");
      completeSession(s4.id, false);

      const statsAfterFail = getStats("leetcode");
      expect(statsAfterFail.currentStreak).toBe(0);
    });
  });

  describe("All Interview Modes", () => {
    const allModes = [
      "leetcode",
      "system-design",
      "debugging",
      "code-review",
      "behavioral",
      "optimization",
      "complexity",
    ] as const;

    it("should support all 7 interview modes", () => {
      for (const mode of allModes) {
        const session = createSession(mode, "medium");
        expect(session.mode).toBe(mode);
      }
    });
  });
});
