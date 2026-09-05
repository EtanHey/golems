/**
 * Elo Rating System for Interview Practice
 *
 * Tracks candidate skill level across 7 interview modes.
 * Uses the standard Elo formula to adjust ratings based on pass/fail.
 *
 * Elo formula: New = Old + K × (Actual - Expected)
 * Expected = 1 / (1 + 10^((OpponentRating - PlayerRating) / 400))
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

/** Interview practice modes (7 total) */
export type InterviewMode =
  | "leetcode"
  | "system-design"
  | "debugging"
  | "code-review"
  | "behavioral"
  | "optimization"
  | "complexity";

/** Question difficulty level */
export type Difficulty = "easy" | "medium" | "hard";

/** Elo rating system configuration */
export interface EloConfig {
  kFactor: number; // How much ratings change (default 32)
  initialRating: number; // Starting rating (default 1200)
}

/** Persisted Elo ratings for all interview modes */
export interface EloState {
  ratings: Record<InterviewMode, number>;
  updatedAt: string;
}

/** Rating change result after a practice session */
export interface SessionResult {
  oldRating: number;
  newRating: number;
  change: number;
  mode: InterviewMode;
  difficulty: Difficulty;
}

// Default configuration
const DEFAULT_CONFIG: EloConfig = {
  kFactor: 32,
  initialRating: 1200,
};

/** All interview modes, exported for reuse */
export const ALL_MODES: InterviewMode[] = [
  "leetcode",
  "system-design",
  "debugging",
  "code-review",
  "behavioral",
  "optimization",
  "complexity",
];

// Difficulty thresholds (rating ranges for question difficulty)
const DIFFICULTY_THRESHOLDS = {
  easy: { min: 0, max: 1100 },
  medium: { min: 1100, max: 1400 },
  hard: { min: 1400, max: 3000 },
};

// Question difficulty ratings (what difficulty level is "worth")
const DIFFICULTY_RATINGS: Record<Difficulty, number> = {
  easy: 1000,
  medium: 1200,
  hard: 1500,
};

// State management
let dataDir = join(homedir(), ".golems-zikaron/recruiter");
let eloState: EloState | null = null;

/**
 * Reset Elo state - used for testing with custom data directory
 */
export function resetEloState(customDataDir?: string): void {
  if (customDataDir) {
    dataDir = customDataDir;
  }
  eloState = null;
}

/**
 * Get the state file path
 */
function getStateFilePath(): string {
  return join(dataDir, "elo-state.json");
}

/**
 * Load Elo state from disk
 */
function loadState(): EloState {
  if (eloState) return eloState;

  const filePath = getStateFilePath();

  if (existsSync(filePath)) {
    try {
      const loaded = JSON.parse(readFileSync(filePath, "utf-8")) as EloState;

      // Backfill any missing modes (handles older state files when new modes are added)
      for (const mode of ALL_MODES) {
        if (loaded.ratings[mode] === undefined) {
          loaded.ratings[mode] = DEFAULT_CONFIG.initialRating;
        }
      }
      loaded.updatedAt = new Date().toISOString();
      eloState = loaded;
      return eloState;
    } catch {
      // Invalid JSON, create fresh state
    }
  }

  // Create initial state with all modes at initial rating
  const initialRatings: Record<string, number> = {};
  for (const mode of ALL_MODES) {
    initialRatings[mode] = DEFAULT_CONFIG.initialRating;
  }

  eloState = {
    ratings: initialRatings as Record<InterviewMode, number>,
    updatedAt: new Date().toISOString(),
  };

  return eloState;
}

/**
 * Save Elo state to disk
 */
function saveState(): void {
  if (!eloState) return;

  // Ensure directory exists
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  eloState.updatedAt = new Date().toISOString();
  writeFileSync(getStateFilePath(), JSON.stringify(eloState, null, 2));
}

/**
 * Calculate expected score using Elo formula
 * Expected = 1 / (1 + 10^((OpponentRating - PlayerRating) / 400))
 */
export function getExpectedScore(
  playerRating: number,
  opponentRating: number
): number {
  return 1 / (1 + Math.pow(10, (opponentRating - playerRating) / 400));
}

/**
 * Calculate new rating after a match
 *
 * @param currentRating - Player's current rating
 * @param opponentRating - Opponent's (question difficulty) rating
 * @param won - Whether the player passed/won
 * @param kFactor - K-factor (default 32)
 * @returns New rating
 */
export function calculateNewRating(
  currentRating: number,
  opponentRating: number,
  won: boolean,
  kFactor: number = DEFAULT_CONFIG.kFactor
): number {
  const expectedScore = getExpectedScore(currentRating, opponentRating);
  const actualScore = won ? 1 : 0;
  const change = kFactor * (actualScore - expectedScore);
  return Math.round(currentRating + change);
}

/**
 * Get candidate's current rating for a mode
 */
export function getCandidateRating(mode: InterviewMode): number {
  const state = loadState();
  return state.ratings[mode] ?? DEFAULT_CONFIG.initialRating;
}

/**
 * Get all ratings for display
 */
export function getAllRatings(): Record<InterviewMode, number> {
  const state = loadState();
  return { ...state.ratings };
}

/**
 * Update rating after a practice session
 *
 * @param mode - Interview mode
 * @param passed - Whether candidate passed
 * @param questionDifficulty - Rating of the question (or use DIFFICULTY_RATINGS)
 * @returns Session result with old/new ratings
 */
export function updateAfterSession(
  mode: InterviewMode,
  passed: boolean,
  questionDifficulty: number
): SessionResult {
  const state = loadState();
  const oldRating = state.ratings[mode] ?? DEFAULT_CONFIG.initialRating;
  const newRating = calculateNewRating(oldRating, questionDifficulty, passed);

  state.ratings[mode] = newRating;
  saveState();

  // Determine difficulty level from question rating
  let difficulty: Difficulty = "medium";
  if (questionDifficulty <= DIFFICULTY_RATINGS.easy + 100) {
    difficulty = "easy";
  } else if (questionDifficulty >= DIFFICULTY_RATINGS.hard - 100) {
    difficulty = "hard";
  }

  return {
    oldRating,
    newRating,
    change: newRating - oldRating,
    mode,
    difficulty,
  };
}

/**
 * Get recommended question difficulty based on current rating
 *
 * Uses "optimal challenge" principle: questions slightly above current level
 */
export function getRecommendedDifficulty(mode: InterviewMode): Difficulty {
  const rating = getCandidateRating(mode);

  // Sweet spot is slightly above current level (50-100 points)
  const targetRating = rating + 50;

  if (targetRating < DIFFICULTY_THRESHOLDS.medium.min) {
    return "easy";
  } else if (targetRating < DIFFICULTY_THRESHOLDS.hard.min) {
    return "medium";
  } else {
    return "hard";
  }
}

/**
 * Get question rating for a difficulty level
 */
export function getQuestionRating(difficulty: Difficulty): number {
  return DIFFICULTY_RATINGS[difficulty];
}

/**
 * Format rating for display
 */
export function formatRating(rating: number): string {
  if (rating < 1000) return `${rating} (Beginner)`;
  if (rating < 1200) return `${rating} (Intermediate)`;
  if (rating < 1400) return `${rating} (Advanced)`;
  if (rating < 1600) return `${rating} (Expert)`;
  return `${rating} (Master)`;
}

/**
 * Get stats summary for all modes
 */
export function getStatsSummary(): string {
  const ratings = getAllRatings();
  const lines = [
    "📊 *Interview Practice Stats*",
    "",
  ];

  for (const mode of ALL_MODES) {
    const rating = ratings[mode];
    const difficulty = getRecommendedDifficulty(mode);
    const emoji = rating >= 1400 ? "🔥" : rating >= 1200 ? "✨" : "📈";
    lines.push(`${emoji} *${mode}*: ${formatRating(rating)}`);
    lines.push(`   Recommended: ${difficulty}`);
  }

  return lines.join("\n");
}
