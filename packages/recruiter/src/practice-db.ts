/**
 * Practice Session Database
 *
 * SQLite storage for interview practice sessions.
 * Tracks sessions, questions, and calculates stats.
 *
 * Location: ~/.golems-zikaron/recruiter/practice.db
 */

import { Database } from "bun:sqlite";
import { join } from "path";
import { homedir } from "os";
import { mkdirSync, existsSync } from "fs";

import type { InterviewMode, Difficulty } from "./elo";

/** Lifecycle status of a practice session */
export type SessionStatus = "in_progress" | "passed" | "failed" | "abandoned";

/** A single interview practice session with rating tracking */
export interface PracticeSession {
  id: string;
  mode: InterviewMode;
  difficulty: Difficulty;
  status: SessionStatus;
  passed: boolean | null;
  startedAt: string;
  endedAt: string | null;
  notes: string | null;
  ratingBefore: number | null;
  ratingAfter: number | null;
}

/** A question asked during a practice session */
export interface SessionQuestion {
  id: string;
  sessionId: string;
  difficulty: Difficulty;
  topic: string | null;
  askedAt: string;
}

/** Aggregated practice statistics with streaks and time tracking */
export interface PracticeStats {
  totalSessions: number;
  passedSessions: number;
  failedSessions: number;
  passRate: number;
  currentStreak: number;
  bestStreak: number;
  averageSessionMinutes: number;
  totalPracticeMinutes: number;
}

// Database instance
let db: Database | null = null;
let dbPath: string | null = null;

// Default path
const getDefaultDbPath = () =>
  join(homedir(), ".golems-zikaron/recruiter/practice.db");

/**
 * Initialize the database
 */
export function initDb(customPath?: string): void {
  dbPath = customPath || getDefaultDbPath();

  // Ensure directory exists
  const dir = join(dbPath, "..");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  db = new Database(dbPath);

  // Enable foreign key enforcement
  db.run("PRAGMA foreign_keys = ON");

  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      mode TEXT NOT NULL,
      difficulty TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'in_progress',
      passed INTEGER,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      notes TEXT,
      rating_before INTEGER,
      rating_after INTEGER
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS questions (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      difficulty TEXT NOT NULL,
      topic TEXT,
      asked_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    )
  `);

  // Create indices
  db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_mode ON sessions(mode)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_questions_session ON questions(session_id)`);
}

/**
 * Ensure database is initialized
 */
function ensureDb(): Database {
  if (!db) {
    initDb();
  }
  return db!;
}

/**
 * Close the database connection
 */
export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
    dbPath = null;
  }
}

/**
 * Generate a unique ID
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Create a new practice session
 */
export function createSession(
  mode: InterviewMode,
  difficulty: Difficulty
): PracticeSession {
  const db = ensureDb();
  const id = generateId();
  const startedAt = new Date().toISOString();

  db.run(
    `INSERT INTO sessions (id, mode, difficulty, status, started_at)
     VALUES (?, ?, ?, 'in_progress', ?)`,
    [id, mode, difficulty, startedAt]
  );

  return {
    id,
    mode,
    difficulty,
    status: "in_progress",
    passed: null,
    startedAt,
    endedAt: null,
    notes: null,
    ratingBefore: null,
    ratingAfter: null,
  };
}

/**
 * Get a session by ID
 */
export function getSession(id: string): PracticeSession | null {
  const db = ensureDb();
  const row = db.query(
    `SELECT id, mode, difficulty, status, passed, started_at, ended_at, notes, rating_before, rating_after
     FROM sessions WHERE id = ?`
  ).get(id) as any;

  if (!row) return null;

  return {
    id: row.id,
    mode: row.mode as InterviewMode,
    difficulty: row.difficulty as Difficulty,
    status: row.status as SessionStatus,
    passed: row.passed === 1 ? true : row.passed === 0 ? false : null,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    notes: row.notes,
    ratingBefore: row.rating_before,
    ratingAfter: row.rating_after,
  };
}

/**
 * Complete a practice session
 */
export function completeSession(
  id: string,
  passed: boolean,
  notes?: string,
  ratingBefore?: number,
  ratingAfter?: number
): PracticeSession {
  const db = ensureDb();
  const endedAt = new Date().toISOString();
  const status: SessionStatus = passed ? "passed" : "failed";

  db.run(
    `UPDATE sessions
     SET status = ?, passed = ?, ended_at = ?, notes = ?, rating_before = ?, rating_after = ?
     WHERE id = ?`,
    [status, passed ? 1 : 0, endedAt, notes || null, ratingBefore || null, ratingAfter || null, id]
  );

  return getSession(id)!;
}

/**
 * Get recent sessions
 */
export function getRecentSessions(
  limit: number = 10,
  mode?: InterviewMode
): PracticeSession[] {
  const db = ensureDb();

  let query = `SELECT id, mode, difficulty, status, passed, started_at, ended_at, notes, rating_before, rating_after
               FROM sessions`;
  const params: any[] = [];

  if (mode) {
    query += ` WHERE mode = ?`;
    params.push(mode);
  }

  query += ` ORDER BY started_at DESC LIMIT ?`;
  params.push(limit);

  const rows = db.query(query).all(...params) as any[];

  return rows.map((row) => ({
    id: row.id,
    mode: row.mode as InterviewMode,
    difficulty: row.difficulty as Difficulty,
    status: row.status as SessionStatus,
    passed: row.passed === 1 ? true : row.passed === 0 ? false : null,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    notes: row.notes,
    ratingBefore: row.rating_before,
    ratingAfter: row.rating_after,
  }));
}

/**
 * Add a question to a session
 */
export function addQuestion(
  sessionId: string,
  difficulty: Difficulty,
  topic?: string
): SessionQuestion {
  const db = ensureDb();
  const id = generateId();
  const askedAt = new Date().toISOString();

  db.run(
    `INSERT INTO questions (id, session_id, difficulty, topic, asked_at)
     VALUES (?, ?, ?, ?, ?)`,
    [id, sessionId, difficulty, topic || null, askedAt]
  );

  return {
    id,
    sessionId,
    difficulty,
    topic: topic || null,
    askedAt,
  };
}

/**
 * Get questions for a session
 */
export function getSessionQuestions(sessionId: string): SessionQuestion[] {
  const db = ensureDb();
  const rows = db.query(
    `SELECT id, session_id, difficulty, topic, asked_at
     FROM questions WHERE session_id = ? ORDER BY asked_at ASC`
  ).all(sessionId) as any[];

  return rows.map((row) => ({
    id: row.id,
    sessionId: row.session_id,
    difficulty: row.difficulty as Difficulty,
    topic: row.topic,
    askedAt: row.asked_at,
  }));
}

/**
 * Calculate practice statistics
 */
export function getStats(mode?: InterviewMode): PracticeStats {
  const db = ensureDb();

  // Build query
  let whereClause = `WHERE status IN ('passed', 'failed')`;
  const params: any[] = [];

  if (mode) {
    whereClause += ` AND mode = ?`;
    params.push(mode);
  }

  // Get basic counts
  const countQuery = `
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN passed = 1 THEN 1 ELSE 0 END) as passed,
      SUM(CASE WHEN passed = 0 THEN 1 ELSE 0 END) as failed
    FROM sessions ${whereClause}
  `;
  const counts = db.query(countQuery).get(...params) as any;

  const totalSessions = counts?.total || 0;
  const passedSessions = counts?.passed || 0;
  const failedSessions = counts?.failed || 0;
  const passRate = totalSessions > 0 ? (passedSessions / totalSessions) * 100 : 0;

  // Calculate current streak
  const streakQuery = `
    SELECT passed
    FROM sessions
    ${whereClause}
    ORDER BY started_at DESC, rowid DESC
  `;
  const sessions = db.query(streakQuery).all(...params) as any[];

  let currentStreak = 0;
  for (const session of sessions) {
    if (session.passed === 1) {
      currentStreak++;
    } else {
      break;
    }
  }

  // Calculate best streak
  let bestStreak = 0;
  let tempStreak = 0;
  for (const session of sessions.reverse()) {
    if (session.passed === 1) {
      tempStreak++;
      bestStreak = Math.max(bestStreak, tempStreak);
    } else {
      tempStreak = 0;
    }
  }

  // Calculate practice time (sessions with end time)
  const timeQuery = `
    SELECT
      AVG((julianday(ended_at) - julianday(started_at)) * 24 * 60) as avg_minutes,
      SUM((julianday(ended_at) - julianday(started_at)) * 24 * 60) as total_minutes
    FROM sessions
    ${whereClause} AND ended_at IS NOT NULL
  `;
  const times = db.query(timeQuery).get(...params) as any;

  return {
    totalSessions,
    passedSessions,
    failedSessions,
    passRate: Math.round(passRate * 100) / 100,
    currentStreak,
    bestStreak,
    averageSessionMinutes: Math.round(times?.avg_minutes || 0),
    totalPracticeMinutes: Math.round(times?.total_minutes || 0),
  };
}

/**
 * Get active (in_progress) session if any
 */
export function getActiveSession(mode?: InterviewMode): PracticeSession | null {
  const db = ensureDb();

  let query = `SELECT id, mode, difficulty, status, passed, started_at, ended_at, notes, rating_before, rating_after
               FROM sessions WHERE status = 'in_progress'`;
  const params: any[] = [];

  if (mode) {
    query += ` AND mode = ?`;
    params.push(mode);
  }

  query += ` ORDER BY started_at DESC LIMIT 1`;

  const row = db.query(query).get(...params) as any;
  if (!row) return null;

  return {
    id: row.id,
    mode: row.mode as InterviewMode,
    difficulty: row.difficulty as Difficulty,
    status: row.status as SessionStatus,
    passed: row.passed === 1 ? true : row.passed === 0 ? false : null,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    notes: row.notes,
    ratingBefore: row.rating_before,
    ratingAfter: row.rating_after,
  };
}

/**
 * Format stats for display
 */
export function formatStats(stats: PracticeStats, mode?: string): string {
  const lines = [
    `📊 *${mode ? `${mode} Stats` : "Overall Practice Stats"}*`,
    "",
    `📝 Sessions: ${stats.totalSessions}`,
    `✅ Passed: ${stats.passedSessions}`,
    `❌ Failed: ${stats.failedSessions}`,
    `📈 Pass Rate: ${stats.passRate.toFixed(1)}%`,
    "",
    `🔥 Current Streak: ${stats.currentStreak}`,
    `🏆 Best Streak: ${stats.bestStreak}`,
  ];

  if (stats.totalPracticeMinutes > 0) {
    lines.push("");
    lines.push(`⏱️ Total Practice: ${stats.totalPracticeMinutes} minutes`);
    lines.push(`📊 Avg Session: ${stats.averageSessionMinutes} minutes`);
  }

  return lines.join("\n");
}
