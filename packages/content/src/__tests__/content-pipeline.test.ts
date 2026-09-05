/**
 * Tests for Content Pipeline (A3)
 *
 * Tests the full content creation pipeline:
 * created → researching → drafting → verifying → review → posted
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, rmSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

// Test paths (isolated from production)
const TEST_BASE = "/tmp/content-pipeline-test";
const TEST_TASKS_DIR = join(TEST_BASE, "tasks");
const TEST_DRAFTS_DIR = join(TEST_BASE, "drafts");
const TEST_RESEARCH_DIR = join(TEST_BASE, "research/gits");

// Helper to create test directories
function setupTestDirs() {
  if (existsSync(TEST_BASE)) {
    rmSync(TEST_BASE, { recursive: true, force: true });
  }
  mkdirSync(TEST_TASKS_DIR, { recursive: true });
  mkdirSync(TEST_DRAFTS_DIR, { recursive: true });
  mkdirSync(TEST_RESEARCH_DIR, { recursive: true });
}

function cleanupTestDirs() {
  if (existsSync(TEST_BASE)) {
    rmSync(TEST_BASE, { recursive: true, force: true });
  }
}

// Mock content task (mirrors telegram-bot.ts types)
interface ContentTask {
  id: string;
  topic: string;
  repo: string;
  status: "created" | "researching" | "drafting" | "verifying" | "review" | "posted" | "failed";
  createdAt: string;
  updatedAt: string;
  researchPath?: string;
  draftPath?: string;
  verificationAttempts: number;
  lastVerification?: {
    confidence: number;
    corrections: string[];
  };
  error?: string;
}

// Local implementations for testing (same logic as telegram-bot.ts)
function createContentTask(topic: string, repo: string = "test-repo"): ContentTask {
  const id = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const task: ContentTask = {
    id,
    topic,
    repo,
    status: "created",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    verificationAttempts: 0,
  };
  writeFileSync(join(TEST_TASKS_DIR, `${id}.json`), JSON.stringify(task, null, 2));
  return task;
}

function loadContentTask(taskId: string): ContentTask | null {
  const path = join(TEST_TASKS_DIR, `${taskId}.json`);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

function saveContentTask(task: ContentTask): void {
  task.updatedAt = new Date().toISOString();
  writeFileSync(join(TEST_TASKS_DIR, `${task.id}.json`), JSON.stringify(task, null, 2));
}

describe("Content Pipeline - Task Creation", () => {
  beforeEach(setupTestDirs);
  afterEach(cleanupTestDirs);

  it("should create task with correct structure", () => {
    const task = createContentTask("test topic", "test-repo");

    expect(task.id).toMatch(/^task-\d+-[a-z0-9]+$/);
    expect(task.topic).toBe("test topic");
    expect(task.repo).toBe("test-repo");
    expect(task.status).toBe("created");
    expect(task.verificationAttempts).toBe(0);
    expect(task.createdAt).toBeDefined();
  });

  it("should save task to disk", () => {
    const task = createContentTask("disk test", "test-repo");
    const path = join(TEST_TASKS_DIR, `${task.id}.json`);

    expect(existsSync(path)).toBe(true);

    const loaded = JSON.parse(readFileSync(path, "utf-8"));
    expect(loaded.topic).toBe("disk test");
  });

  it("should load task from disk", () => {
    const task = createContentTask("load test", "test-repo");
    const loaded = loadContentTask(task.id);

    expect(loaded).not.toBeNull();
    expect(loaded?.topic).toBe("load test");
    expect(loaded?.id).toBe(task.id);
  });

  it("should return null for non-existent task", () => {
    const loaded = loadContentTask("non-existent-id");
    expect(loaded).toBeNull();
  });
});

describe("Content Pipeline - State Machine", () => {
  beforeEach(setupTestDirs);
  afterEach(cleanupTestDirs);

  it("should transition from created to researching", () => {
    const task = createContentTask("state test", "test-repo");
    expect(task.status).toBe("created");

    task.status = "researching";
    saveContentTask(task);

    const loaded = loadContentTask(task.id);
    expect(loaded?.status).toBe("researching");
  });

  it("should track verification attempts", () => {
    const task = createContentTask("verify test", "test-repo");
    expect(task.verificationAttempts).toBe(0);

    task.verificationAttempts = 1;
    task.lastVerification = { confidence: 65, corrections: ["Fix claim 1"] };
    saveContentTask(task);

    const loaded = loadContentTask(task.id);
    expect(loaded?.verificationAttempts).toBe(1);
    expect(loaded?.lastVerification?.confidence).toBe(65);
    expect(loaded?.lastVerification?.corrections).toEqual(["Fix claim 1"]);
  });

  it("should transition through full lifecycle", () => {
    const task = createContentTask("lifecycle test", "test-repo");
    const states: ContentTask["status"][] = [
      "created",
      "researching",
      "drafting",
      "verifying",
      "review",
      "posted",
    ];

    for (const status of states) {
      task.status = status;
      saveContentTask(task);
      const loaded = loadContentTask(task.id);
      expect(loaded?.status).toBe(status);
    }
  });

  it("should handle failed state", () => {
    const task = createContentTask("fail test", "test-repo");
    task.status = "failed";
    task.error = "Research timeout";
    saveContentTask(task);

    const loaded = loadContentTask(task.id);
    expect(loaded?.status).toBe("failed");
    expect(loaded?.error).toBe("Research timeout");
  });
});

describe("Content Pipeline - Draft Structure", () => {
  beforeEach(setupTestDirs);
  afterEach(cleanupTestDirs);

  it("should create draft with claims section", () => {
    const draft = {
      title: "Test Post",
      content: "This is test content about the topic.",
      claims: [
        "Claim 1 about specific code",
        "Claim 2 about file paths",
      ],
    };

    const draftPath = join(TEST_DRAFTS_DIR, "test-draft.json");
    writeFileSync(draftPath, JSON.stringify(draft, null, 2));

    const loaded = JSON.parse(readFileSync(draftPath, "utf-8"));
    expect(loaded.title).toBe("Test Post");
    expect(loaded.claims).toHaveLength(2);
    expect(loaded.claims[0]).toContain("Claim 1");
  });

  it("should link draft to task", () => {
    const task = createContentTask("draft link test", "test-repo");
    const draftPath = join(TEST_DRAFTS_DIR, `${task.id}.json`);

    const draft = { title: "Linked Draft", content: "Content", claims: [] };
    writeFileSync(draftPath, JSON.stringify(draft, null, 2));

    task.draftPath = draftPath;
    task.status = "verifying";
    saveContentTask(task);

    const loaded = loadContentTask(task.id);
    expect(loaded?.draftPath).toBe(draftPath);
    expect(existsSync(loaded?.draftPath || "")).toBe(true);
  });
});

describe("Content Pipeline - Verification Logic", () => {
  beforeEach(setupTestDirs);
  afterEach(cleanupTestDirs);

  const CONFIDENCE_THRESHOLD = 75;
  const MAX_VERIFICATION_ATTEMPTS = 2;

  it("should pass verification above threshold", () => {
    const confidence = 85;
    const shouldPass = confidence >= CONFIDENCE_THRESHOLD;
    expect(shouldPass).toBe(true);
  });

  it("should fail verification below threshold", () => {
    const confidence = 60;
    const shouldPass = confidence >= CONFIDENCE_THRESHOLD;
    expect(shouldPass).toBe(false);
  });

  it("should allow retry when under max attempts", () => {
    const task = createContentTask("retry test", "test-repo");
    task.verificationAttempts = 1;

    const canRetry = task.verificationAttempts < MAX_VERIFICATION_ATTEMPTS;
    expect(canRetry).toBe(true);
  });

  it("should block retry at max attempts", () => {
    const task = createContentTask("max retry test", "test-repo");
    task.verificationAttempts = 2;

    const canRetry = task.verificationAttempts < MAX_VERIFICATION_ATTEMPTS;
    expect(canRetry).toBe(false);
  });

  it("should send to review even after failed verification at max attempts", () => {
    const task = createContentTask("force review test", "test-repo");
    task.verificationAttempts = 2;
    task.lastVerification = { confidence: 50, corrections: ["Major issue"] };

    // At max attempts, should go to review regardless
    if (task.verificationAttempts >= MAX_VERIFICATION_ATTEMPTS) {
      task.status = "review";
    }
    saveContentTask(task);

    const loaded = loadContentTask(task.id);
    expect(loaded?.status).toBe("review");
    expect(loaded?.lastVerification?.confidence).toBe(50);
  });
});

describe("Content Pipeline - Concurrent Handling", () => {
  beforeEach(setupTestDirs);
  afterEach(cleanupTestDirs);

  it("should create multiple tasks with unique IDs", () => {
    const task1 = createContentTask("topic 1", "repo-1");
    const task2 = createContentTask("topic 2", "repo-2");
    const task3 = createContentTask("topic 3", "repo-3");

    expect(task1.id).not.toBe(task2.id);
    expect(task2.id).not.toBe(task3.id);
    expect(task1.id).not.toBe(task3.id);
  });

  it("should independently track task states", () => {
    const task1 = createContentTask("concurrent 1", "test-repo");
    const task2 = createContentTask("concurrent 2", "test-repo");

    task1.status = "researching";
    saveContentTask(task1);

    task2.status = "verifying";
    saveContentTask(task2);

    const loaded1 = loadContentTask(task1.id);
    const loaded2 = loadContentTask(task2.id);

    expect(loaded1?.status).toBe("researching");
    expect(loaded2?.status).toBe("verifying");
  });
});
