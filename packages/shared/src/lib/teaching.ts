/**
 * Teaching Framework for Golems
 *
 * Instead of just drafting for users, golems can teach first:
 * 1. Ask a probing question about the task
 * 2. User writes their answer
 * 3. Golem evaluates and gives feedback
 * 4. Golem produces improved draft incorporating user's insights
 *
 * This creates a "learn then draft" loop that builds user skill
 * while still producing high-quality output.
 *
 * Used by: RecruiterGolem (outreach), EmailGolem (replies), ContentGolem
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

// ─── Types ─────────────────────────────────────────────────────────

export interface TeachingPrompt {
  /** Unique prompt ID */
  id: string;
  /** Which golem uses this prompt */
  golem: string;
  /** Context for when to use this prompt */
  context: string;
  /** The question to ask the user */
  question: string;
  /** Hints to help the user answer */
  hints: string[];
  /** What a good answer looks like (for evaluation) */
  rubric: string;
}

export interface TeachingResponse {
  /** The prompt that was asked */
  promptId: string;
  /** User's raw answer */
  userAnswer: string;
  /** Evaluation score 1-10 */
  score: number;
  /** Feedback on the answer */
  feedback: string;
  /** Key points extracted from the answer */
  keyPoints: string[];
  /** Timestamp */
  timestamp: string;
}

export interface TeachingSession {
  /** Session ID */
  id: string;
  /** Which golem is teaching */
  golem: string;
  /** Current step in the teaching flow */
  step: "prompt" | "evaluate" | "draft" | "complete";
  /** The teaching prompt used */
  prompt: TeachingPrompt;
  /** User's response (set after they answer) */
  response?: TeachingResponse;
  /** The final draft incorporating teaching insights */
  draft?: string;
  /** When the session started */
  startedAt: string;
  /** When the session completed */
  completedAt?: string;
}

export interface GolemMemory {
  /** Golem name */
  golem: string;
  /** User preferences learned over time */
  preferences: Record<string, string>;
  /** Past teaching responses for this golem */
  pastResponses: TeachingResponse[];
  /** Topics the user has been taught */
  taughtTopics: string[];
}

// ─── Teaching Prompts Library ──────────────────────────────────────

const TEACHING_PROMPTS: TeachingPrompt[] = [
  // RecruiterGolem prompts
  {
    id: "recruiter-why-role",
    golem: "recruitergolem",
    context: "Before drafting outreach for a job application",
    question:
      "Before I draft your outreach, tell me: why does this specific role excite you? What about the company or product resonates with your experience?",
    hints: [
      "Think about a specific project that connects to their product",
      "Mention what you admire about their tech stack or approach",
      "Be specific — generic enthusiasm doesn't stand out",
    ],
    rubric:
      "A strong answer includes: (1) specific connection to the company/product, (2) relevant personal experience, (3) genuine enthusiasm backed by knowledge",
  },
  {
    id: "recruiter-unique-value",
    golem: "recruitergolem",
    context: "When personalizing outreach to a specific contact",
    question:
      "What's one thing you can bring to this team that most other candidates can't? Think about a unique combination of skills or an unconventional experience.",
    hints: [
      "Consider cross-domain expertise (e.g., music + engineering)",
      "Think about open-source contributions or side projects",
      "What problem have you solved that others found too hard?",
    ],
    rubric:
      "A strong answer includes: (1) a specific differentiator, (2) evidence/example backing it up, (3) relevance to the target role",
  },
  // EmailGolem prompts
  {
    id: "email-reply-tone",
    golem: "emailgolem",
    context: "Before drafting a reply to an important email",
    question:
      "What's the relationship with this sender? How formal/casual should the reply be? Any specific points you want to make sure are included?",
    hints: [
      "Consider: is this a first interaction or ongoing conversation?",
      "Think about what action you want the recipient to take",
      "Mention any constraints (timing, budget, availability)",
    ],
    rubric:
      "A good answer specifies: (1) relationship context, (2) desired tone, (3) key points to include, (4) desired outcome",
  },
  // ContentGolem prompts
  {
    id: "content-audience",
    golem: "contentgolem",
    context: "Before drafting a post or article",
    question:
      "Who's the audience for this piece? What should they feel or do after reading it? What's the one key takeaway?",
    hints: [
      "Be specific about the audience: junior devs? Senior engineers? Hiring managers?",
      "Think about the emotional arc: curiosity → understanding → action",
      "One clear takeaway beats five vague points",
    ],
    rubric:
      "A strong answer defines: (1) specific audience, (2) desired emotional response, (3) single clear takeaway, (4) call to action",
  },
];

// ─── Core Functions ────────────────────────────────────────────────

/** Get available teaching prompts for a golem */
export function getPrompts(golem: string): TeachingPrompt[] {
  return TEACHING_PROMPTS.filter((p) => p.golem === golem.toLowerCase());
}

/** Get a specific prompt by ID */
export function getPromptById(id: string): TeachingPrompt | undefined {
  return TEACHING_PROMPTS.find((p) => p.id === id);
}

/** Get all teaching prompts */
export function getAllPrompts(): TeachingPrompt[] {
  return TEACHING_PROMPTS;
}

/** Start a new teaching session */
export function createSession(prompt: TeachingPrompt): TeachingSession {
  return {
    id: `teach-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    golem: prompt.golem,
    step: "prompt",
    prompt,
    startedAt: new Date().toISOString(),
  };
}

/** Format a teaching prompt for display (Telegram or CLI) */
export function formatPrompt(prompt: TeachingPrompt): string {
  const lines = [
    `💡 ${prompt.question}`,
    "",
    "Hints:",
    ...prompt.hints.map((h) => `  • ${h}`),
  ];
  return lines.join("\n");
}

/** Format evaluation feedback for display */
export function formatFeedback(response: TeachingResponse): string {
  const scoreEmoji =
    response.score >= 8
      ? "🌟"
      : response.score >= 6
        ? "👍"
        : response.score >= 4
          ? "📝"
          : "💪";

  const lines = [
    `${scoreEmoji} Score: ${response.score}/10`,
    "",
    response.feedback,
    "",
    "Key points I'll use in the draft:",
    ...response.keyPoints.map((p) => `  ✓ ${p}`),
  ];
  return lines.join("\n");
}

// ─── Per-Golem Memory ──────────────────────────────────────────────

const DEFAULT_MEMORY_DIR = join(
  process.env.HOME || "",
  ".golems-zikaron",
  "golem-memory"
);

function getMemoryPath(golem: string, memoryDir?: string): string {
  const dir = memoryDir || DEFAULT_MEMORY_DIR;
  return join(dir, `${golem}.json`);
}

/** Load memory for a golem */
export function loadGolemMemory(
  golem: string,
  memoryDir?: string
): GolemMemory {
  const path = getMemoryPath(golem, memoryDir);
  if (existsSync(path)) {
    try {
      return JSON.parse(readFileSync(path, "utf-8"));
    } catch {
      // Corrupted file, start fresh
    }
  }
  return {
    golem,
    preferences: {},
    pastResponses: [],
    taughtTopics: [],
  };
}

/** Save memory for a golem */
export function saveGolemMemory(
  memory: GolemMemory,
  memoryDir?: string
): void {
  const dir = memoryDir || DEFAULT_MEMORY_DIR;
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const path = getMemoryPath(memory.golem, memoryDir);
  writeFileSync(path, JSON.stringify(memory, null, 2));
}

/** Record a teaching response in golem memory */
export function recordTeachingResponse(
  golem: string,
  response: TeachingResponse,
  memoryDir?: string
): void {
  const memory = loadGolemMemory(golem, memoryDir);

  memory.pastResponses.push(response);

  // Keep last 50 responses
  if (memory.pastResponses.length > 50) {
    memory.pastResponses = memory.pastResponses.slice(-50);
  }

  // Track taught topics
  const promptId = response.promptId;
  if (!memory.taughtTopics.includes(promptId)) {
    memory.taughtTopics.push(promptId);
  }

  saveGolemMemory(memory, memoryDir);
}

/** Set a preference in golem memory */
export function setPreference(
  golem: string,
  key: string,
  value: string,
  memoryDir?: string
): void {
  const memory = loadGolemMemory(golem, memoryDir);
  memory.preferences[key] = value;
  saveGolemMemory(memory, memoryDir);
}

/** Get a preference from golem memory */
export function getPreference(
  golem: string,
  key: string,
  memoryDir?: string
): string | undefined {
  const memory = loadGolemMemory(golem, memoryDir);
  return memory.preferences[key];
}

/** Get the user's average score for a golem's teaching prompts */
export function getAverageScore(
  golem: string,
  memoryDir?: string
): number | null {
  const memory = loadGolemMemory(golem, memoryDir);
  if (memory.pastResponses.length === 0) return null;

  const sum = memory.pastResponses.reduce((acc, r) => acc + r.score, 0);
  return Math.round((sum / memory.pastResponses.length) * 10) / 10;
}
