/**
 * Practice Session Database - Supabase Backend
 *
 * Same interface as practice-db.ts but backed by Supabase.
 * Active when STATE_BACKEND=supabase.
 */

import { getSupabase, type SupabaseClient } from "@golems/shared/lib/supabase-factory";
import type { InterviewMode, Difficulty } from "./elo";
import type {
  PracticeSession,
  SessionQuestion,
  PracticeStats,
  SessionStatus,
} from "./practice-db";

function getClient(): SupabaseClient {
  const client = getSupabase();
  if (!client) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY required for cloud practice-db");
  }
  return client;
}

/** Create a new practice session in Supabase */
export async function createSession(
  mode: InterviewMode,
  difficulty: Difficulty
): Promise<PracticeSession> {
  const { data, error } = await getClient()
    .from("practice_sessions")
    .insert({
      mode,
      difficulty,
      status: "active",
    })
    .select()
    .single();

  if (error || !data) throw new Error(`Failed to create session: ${error?.message}`);

  return mapSession(data);
}

/** Get a practice session by ID from Supabase */
export async function getSession(id: string): Promise<PracticeSession | null> {
  const { data } = await getClient()
    .from("practice_sessions")
    .select("*")
    .eq("id", id)
    .single();

  return data ? mapSession(data) : null;
}

/** Mark a practice session as passed or failed in Supabase */
export async function completeSession(
  id: string,
  passed: boolean,
  notes?: string,
  ratingBefore?: number,
  ratingAfter?: number
): Promise<PracticeSession> {
  const status: SessionStatus = passed ? "passed" : "failed";

  const { error } = await getClient()
    .from("practice_sessions")
    .update({
      status,
      passed,
      ended_at: new Date().toISOString(),
      rating_before: ratingBefore || null,
      rating_after: ratingAfter || null,
    })
    .eq("id", id);

  if (error) throw new Error(`Failed to complete session: ${error.message}`);

  return (await getSession(id))!;
}

/** Get recent practice sessions from Supabase, optionally filtered by mode */
export async function getRecentSessions(
  limit: number = 10,
  mode?: InterviewMode
): Promise<PracticeSession[]> {
  let query = getClient()
    .from("practice_sessions")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(limit);

  if (mode) {
    query = query.eq("mode", mode);
  }

  const { data } = await query;
  return (data || []).map(mapSession);
}

/** Add a question to a practice session in Supabase */
export async function addQuestion(
  sessionId: string,
  difficulty: Difficulty,
  topic?: string
): Promise<SessionQuestion> {
  const { data, error } = await getClient()
    .from("practice_questions")
    .insert({
      session_id: sessionId,
      difficulty,
      topic: topic || null,
    })
    .select()
    .single();

  if (error || !data) throw new Error(`Failed to add question: ${error?.message}`);

  return {
    id: data.id,
    sessionId: data.session_id,
    difficulty: data.difficulty as Difficulty,
    topic: data.topic,
    askedAt: data.asked_at,
  };
}

/** Get all questions for a practice session from Supabase */
export async function getSessionQuestions(sessionId: string): Promise<SessionQuestion[]> {
  const { data } = await getClient()
    .from("practice_questions")
    .select("*")
    .eq("session_id", sessionId)
    .order("asked_at", { ascending: true });

  return (data || []).map((row) => ({
    id: row.id,
    sessionId: row.session_id,
    difficulty: row.difficulty as Difficulty,
    topic: row.topic,
    askedAt: row.asked_at,
  }));
}

/** Calculate practice statistics from Supabase, optionally filtered by mode */
export async function getStats(mode?: InterviewMode): Promise<PracticeStats> {
  let query = getClient()
    .from("practice_sessions")
    .select("*")
    .in("status", ["passed", "failed"]);

  if (mode) {
    query = query.eq("mode", mode);
  }

  const { data } = await query;
  const sessions = data || [];

  const totalSessions = sessions.length;
  const passedSessions = sessions.filter((s) => s.passed).length;
  const failedSessions = sessions.filter((s) => !s.passed).length;
  const passRate = totalSessions > 0 ? (passedSessions / totalSessions) * 100 : 0;

  // Calculate streaks (most recent first)
  const sorted = [...sessions].sort(
    (a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime()
  );

  let currentStreak = 0;
  for (const s of sorted) {
    if (s.passed) currentStreak++;
    else break;
  }

  let bestStreak = 0;
  let tempStreak = 0;
  const chronological = [...sorted].reverse();
  for (const s of chronological) {
    if (s.passed) {
      tempStreak++;
      bestStreak = Math.max(bestStreak, tempStreak);
    } else {
      tempStreak = 0;
    }
  }

  // Practice time
  const withEndTime = sessions.filter((s) => s.ended_at);
  let totalMinutes = 0;
  for (const s of withEndTime) {
    const diff = new Date(s.ended_at).getTime() - new Date(s.started_at).getTime();
    totalMinutes += diff / (1000 * 60);
  }
  const avgMinutes = withEndTime.length > 0 ? totalMinutes / withEndTime.length : 0;

  return {
    totalSessions,
    passedSessions,
    failedSessions,
    passRate: Math.round(passRate * 100) / 100,
    currentStreak,
    bestStreak,
    averageSessionMinutes: Math.round(avgMinutes),
    totalPracticeMinutes: Math.round(totalMinutes),
  };
}

/** Get the currently active practice session from Supabase, if any */
export async function getActiveSession(mode?: InterviewMode): Promise<PracticeSession | null> {
  let query = getClient()
    .from("practice_sessions")
    .select("*")
    .eq("status", "active")
    .order("started_at", { ascending: false })
    .limit(1);

  if (mode) {
    query = query.eq("mode", mode);
  }

  const { data } = await query;
  return data && data.length > 0 ? mapSession(data[0]) : null;
}

// ============ Mapper ============

function mapSession(row: any): PracticeSession {
  return {
    id: row.id,
    mode: row.mode as InterviewMode,
    difficulty: row.difficulty as Difficulty,
    status: row.status as SessionStatus,
    passed: row.passed,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    notes: null, // practice_sessions table doesn't have notes column
    ratingBefore: row.rating_before,
    ratingAfter: row.rating_after,
  };
}
