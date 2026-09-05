import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  getPrompts,
  getPromptById,
  getAllPrompts,
  createSession,
  formatPrompt,
  formatFeedback,
  loadGolemMemory,
  saveGolemMemory,
  recordTeachingResponse,
  setPreference,
  getPreference,
  getAverageScore,
  type TeachingResponse,
} from "@golems/shared/lib/teaching";

const TEST_DIR = join(tmpdir(), `golems-teaching-test-${Date.now()}`);

describe("teaching", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  // ─── Prompts ─────────────────────────────────────────────────

  test("getPrompts returns prompts for a golem", () => {
    const recruiterPrompts = getPrompts("recruitergolem");
    expect(recruiterPrompts.length).toBeGreaterThanOrEqual(2);
    for (const p of recruiterPrompts) {
      expect(p.golem).toBe("recruitergolem");
    }
  });

  test("getPrompts is case-insensitive", () => {
    const prompts = getPrompts("RecruiterGolem");
    expect(prompts.length).toBeGreaterThanOrEqual(2);
  });

  test("getPrompts returns empty for unknown golem", () => {
    expect(getPrompts("unknowngolem")).toEqual([]);
  });

  test("getPromptById finds existing prompt", () => {
    const prompt = getPromptById("recruiter-why-role");
    expect(prompt).toBeDefined();
    expect(prompt!.golem).toBe("recruitergolem");
    expect(prompt!.question).toBeTruthy();
    expect(prompt!.hints.length).toBeGreaterThan(0);
    expect(prompt!.rubric).toBeTruthy();
  });

  test("getPromptById returns undefined for unknown ID", () => {
    expect(getPromptById("nonexistent")).toBeUndefined();
  });

  test("getAllPrompts returns all prompts", () => {
    const all = getAllPrompts();
    expect(all.length).toBeGreaterThanOrEqual(4);
    const golems = new Set(all.map((p) => p.golem));
    expect(golems.size).toBeGreaterThanOrEqual(3);
  });

  test("every prompt has required fields", () => {
    for (const prompt of getAllPrompts()) {
      expect(prompt.id).toBeTruthy();
      expect(prompt.golem).toBeTruthy();
      expect(prompt.context).toBeTruthy();
      expect(prompt.question).toBeTruthy();
      expect(prompt.hints.length).toBeGreaterThan(0);
      expect(prompt.rubric).toBeTruthy();
    }
  });

  // ─── Sessions ────────────────────────────────────────────────

  test("createSession creates a session in prompt step", () => {
    const prompt = getPromptById("recruiter-why-role")!;
    const session = createSession(prompt);
    expect(session.id).toMatch(/^teach-/);
    expect(session.golem).toBe("recruitergolem");
    expect(session.step).toBe("prompt");
    expect(session.prompt).toBe(prompt);
    expect(session.response).toBeUndefined();
    expect(session.startedAt).toBeTruthy();
  });

  test("session IDs are unique", () => {
    const prompt = getPromptById("recruiter-why-role")!;
    const s1 = createSession(prompt);
    const s2 = createSession(prompt);
    expect(s1.id).not.toBe(s2.id);
  });

  // ─── Formatting ──────────────────────────────────────────────

  test("formatPrompt includes question and hints", () => {
    const prompt = getPromptById("recruiter-why-role")!;
    const formatted = formatPrompt(prompt);
    expect(formatted).toContain("💡");
    expect(formatted).toContain(prompt.question);
    expect(formatted).toContain("Hints:");
    for (const hint of prompt.hints) {
      expect(formatted).toContain(hint);
    }
  });

  test("formatFeedback shows score and points", () => {
    const response: TeachingResponse = {
      promptId: "recruiter-why-role",
      userAnswer: "I love their product because...",
      score: 8,
      feedback: "Great answer! Specific and enthusiastic.",
      keyPoints: ["Product expertise", "Relevant experience"],
      timestamp: new Date().toISOString(),
    };
    const formatted = formatFeedback(response);
    expect(formatted).toContain("🌟"); // score >= 8
    expect(formatted).toContain("8/10");
    expect(formatted).toContain("Great answer!");
    expect(formatted).toContain("Product expertise");
  });

  test("formatFeedback uses correct emoji for scores", () => {
    const makeResponse = (score: number): TeachingResponse => ({
      promptId: "test",
      userAnswer: "test",
      score,
      feedback: "feedback",
      keyPoints: [],
      timestamp: new Date().toISOString(),
    });

    expect(formatFeedback(makeResponse(9))).toContain("🌟");
    expect(formatFeedback(makeResponse(7))).toContain("👍");
    expect(formatFeedback(makeResponse(5))).toContain("📝");
    expect(formatFeedback(makeResponse(3))).toContain("💪");
  });

  // ─── Golem Memory ───────────────────────────────────────────

  test("loadGolemMemory returns empty memory for new golem", () => {
    const memory = loadGolemMemory("testgolem", TEST_DIR);
    expect(memory.golem).toBe("testgolem");
    expect(memory.preferences).toEqual({});
    expect(memory.pastResponses).toEqual([]);
    expect(memory.taughtTopics).toEqual([]);
  });

  test("saveGolemMemory and loadGolemMemory round-trip", () => {
    const memory = {
      golem: "testgolem",
      preferences: { tone: "casual" },
      pastResponses: [],
      taughtTopics: ["topic-1"],
    };
    saveGolemMemory(memory, TEST_DIR);
    const loaded = loadGolemMemory("testgolem", TEST_DIR);
    expect(loaded).toEqual(memory);
  });

  test("recordTeachingResponse adds to memory", () => {
    const response: TeachingResponse = {
      promptId: "recruiter-why-role",
      userAnswer: "I built something similar...",
      score: 7,
      feedback: "Good connection to the role.",
      keyPoints: ["Relevant project"],
      timestamp: new Date().toISOString(),
    };

    recordTeachingResponse("testgolem", response, TEST_DIR);
    const memory = loadGolemMemory("testgolem", TEST_DIR);
    expect(memory.pastResponses).toHaveLength(1);
    expect(memory.pastResponses[0].score).toBe(7);
    expect(memory.taughtTopics).toContain("recruiter-why-role");
  });

  test("recordTeachingResponse caps at 50 responses", () => {
    for (let i = 0; i < 55; i++) {
      recordTeachingResponse(
        "testgolem",
        {
          promptId: `prompt-${i}`,
          userAnswer: "answer",
          score: 5,
          feedback: "ok",
          keyPoints: [],
          timestamp: new Date().toISOString(),
        },
        TEST_DIR
      );
    }
    const memory = loadGolemMemory("testgolem", TEST_DIR);
    expect(memory.pastResponses).toHaveLength(50);
  });

  test("setPreference and getPreference work", () => {
    setPreference("testgolem", "reply_tone", "casual", TEST_DIR);
    setPreference("testgolem", "greeting", "Hey", TEST_DIR);

    expect(getPreference("testgolem", "reply_tone", TEST_DIR)).toBe("casual");
    expect(getPreference("testgolem", "greeting", TEST_DIR)).toBe("Hey");
    expect(getPreference("testgolem", "nonexistent", TEST_DIR)).toBeUndefined();
  });

  test("getAverageScore returns null for no responses", () => {
    expect(getAverageScore("testgolem", TEST_DIR)).toBeNull();
  });

  test("getAverageScore calculates correctly", () => {
    const responses: TeachingResponse[] = [
      { promptId: "a", userAnswer: "x", score: 8, feedback: "", keyPoints: [], timestamp: "" },
      { promptId: "b", userAnswer: "y", score: 6, feedback: "", keyPoints: [], timestamp: "" },
      { promptId: "c", userAnswer: "z", score: 10, feedback: "", keyPoints: [], timestamp: "" },
    ];
    for (const r of responses) {
      recordTeachingResponse("testgolem", r, TEST_DIR);
    }
    expect(getAverageScore("testgolem", TEST_DIR)).toBe(8);
  });
});
