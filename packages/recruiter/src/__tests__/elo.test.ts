import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { rmSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import {
  calculateNewRating,
  getExpectedScore,
  getCandidateRating,
  updateAfterSession,
  getRecommendedDifficulty,
  resetEloState,
  type InterviewMode,
} from "@golems/recruiter/elo";

// Use a temp directory for tests
const TEST_DATA_DIR = join(process.cwd(), ".test-elo-data");

describe("Elo Rating System", () => {
  beforeEach(() => {
    // Clean and create test directory
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true });
    }
    mkdirSync(TEST_DATA_DIR, { recursive: true });
    // Reset elo state to use test directory
    resetEloState(TEST_DATA_DIR);
  });

  afterEach(() => {
    // Cleanup
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true });
    }
  });

  describe("calculateNewRating", () => {
    it("should increase rating when winning against equal opponent", () => {
      const newRating = calculateNewRating(1200, 1200, true);
      expect(newRating).toBeGreaterThan(1200);
      // With K=32 and 50% expected score, win gives +16
      expect(newRating).toBe(1216);
    });

    it("should decrease rating when losing against equal opponent", () => {
      const newRating = calculateNewRating(1200, 1200, false);
      expect(newRating).toBeLessThan(1200);
      // With K=32 and 50% expected score, loss gives -16
      expect(newRating).toBe(1184);
    });

    it("should increase more when winning against stronger opponent", () => {
      // Winning against 1400 when you're 1200
      const gainAgainstStrong = calculateNewRating(1200, 1400, true) - 1200;
      // Winning against 1000 when you're 1200
      const gainAgainstWeak = calculateNewRating(1200, 1000, true) - 1200;

      expect(gainAgainstStrong).toBeGreaterThan(gainAgainstWeak);
    });

    it("should decrease less when losing against stronger opponent", () => {
      // Losing against 1400 when you're 1200
      const lossAgainstStrong = 1200 - calculateNewRating(1200, 1400, false);
      // Losing against 1000 when you're 1200
      const lossAgainstWeak = 1200 - calculateNewRating(1200, 1000, false);

      expect(lossAgainstStrong).toBeLessThan(lossAgainstWeak);
    });

    it("should use custom K-factor when provided", () => {
      const defaultK = calculateNewRating(1200, 1200, true);
      const lowK = calculateNewRating(1200, 1200, true, 16);

      // Lower K = smaller change
      expect(defaultK - 1200).toBeGreaterThan(lowK - 1200);
    });
  });

  describe("getExpectedScore", () => {
    it("should return 0.5 for equal ratings", () => {
      const expected = getExpectedScore(1200, 1200);
      expect(expected).toBeCloseTo(0.5, 5);
    });

    it("should return higher expected score against weaker opponent", () => {
      const expected = getExpectedScore(1400, 1200);
      expect(expected).toBeGreaterThan(0.5);
      expect(expected).toBeLessThan(1);
    });

    it("should return lower expected score against stronger opponent", () => {
      const expected = getExpectedScore(1200, 1400);
      expect(expected).toBeLessThan(0.5);
      expect(expected).toBeGreaterThan(0);
    });
  });

  describe("getCandidateRating", () => {
    it("should return initial rating for new mode", () => {
      const rating = getCandidateRating("leetcode");
      expect(rating).toBe(1200); // Default initial rating
    });

    it("should return updated rating after session", () => {
      // First update
      updateAfterSession("leetcode", true, 1200);
      const rating = getCandidateRating("leetcode");
      expect(rating).toBeGreaterThan(1200);
    });

    it("should track different modes independently", () => {
      updateAfterSession("leetcode", true, 1200);
      updateAfterSession("system-design", false, 1200);

      const leetcodeRating = getCandidateRating("leetcode");
      const systemDesignRating = getCandidateRating("system-design");

      expect(leetcodeRating).toBeGreaterThan(1200);
      expect(systemDesignRating).toBeLessThan(1200);
    });
  });

  describe("updateAfterSession", () => {
    it("should update rating on pass", () => {
      const result = updateAfterSession("leetcode", true, 1300);

      expect(result.oldRating).toBe(1200);
      expect(result.newRating).toBeGreaterThan(1200);
      expect(result.change).toBeGreaterThan(0);
    });

    it("should update rating on fail", () => {
      const result = updateAfterSession("leetcode", false, 1100);

      expect(result.oldRating).toBe(1200);
      expect(result.newRating).toBeLessThan(1200);
      expect(result.change).toBeLessThan(0);
    });

    it("should persist across calls", () => {
      updateAfterSession("leetcode", true, 1200);
      const firstRating = getCandidateRating("leetcode");

      updateAfterSession("leetcode", true, 1200);
      const secondRating = getCandidateRating("leetcode");

      expect(secondRating).toBeGreaterThan(firstRating);
    });
  });

  describe("getRecommendedDifficulty", () => {
    it("should recommend easy for low ratings", () => {
      const difficulty = getRecommendedDifficulty("leetcode");
      // Initial rating 1200 should give medium
      expect(["easy", "medium", "hard"]).toContain(difficulty);
    });

    it("should recommend harder difficulty as rating increases", () => {
      // Simulate several wins to increase rating
      for (let i = 0; i < 10; i++) {
        updateAfterSession("leetcode", true, 1200 + i * 50);
      }

      const difficulty = getRecommendedDifficulty("leetcode");
      // After wins, should recommend harder questions
      expect(["medium", "hard"]).toContain(difficulty);
    });

    it("should recommend easier difficulty as rating decreases", () => {
      // Simulate several losses
      for (let i = 0; i < 10; i++) {
        updateAfterSession("behavioral", false, 1400);
      }

      const difficulty = getRecommendedDifficulty("behavioral");
      // After losses, should recommend easier questions
      expect(["easy", "medium"]).toContain(difficulty);
    });
  });

  describe("All interview modes", () => {
    const allModes: InterviewMode[] = [
      "leetcode",
      "system-design",
      "debugging",
      "code-review",
      "behavioral",
      "optimization",
      "complexity",
    ];

    it("should support all 7 interview modes", () => {
      for (const mode of allModes) {
        const rating = getCandidateRating(mode);
        expect(rating).toBe(1200); // All start at initial
      }
    });

    it("should track each mode independently", () => {
      // Win in leetcode, lose in behavioral
      updateAfterSession("leetcode", true, 1200);
      updateAfterSession("behavioral", false, 1200);

      expect(getCandidateRating("leetcode")).toBeGreaterThan(getCandidateRating("behavioral"));
    });
  });
});
