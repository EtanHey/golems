/**
 * Email Follow-up Tracking
 *
 * Tracks when follow-ups are needed for important emails (interviews, job apps).
 * Integrates with the morning briefing to remind about overdue follow-ups.
 */

import { randomUUID } from "crypto";

// ═══════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════

/** Status of a follow-up tracker */
export type FollowupStatus = "pending" | "done" | "dismissed";

/** A follow-up reminder for an important email */
export interface Followup {
  id: string;
  emailSubject: string;
  emailFrom: string;
  category: string;
  status: FollowupStatus;
  createdAt: string;
  dueAt: string;
  note?: string;
  completedAt?: string;
}

/** Input for creating a new follow-up */
export interface CreateFollowupInput {
  emailSubject: string;
  emailFrom: string;
  category: string;
  dueInDays?: number;
  note?: string;
}

// ═══════════════════════════════════════════════════════
// DEFAULT DUE DAYS BY CATEGORY
// ═══════════════════════════════════════════════════════

const DEFAULT_DUE_DAYS: Record<string, number> = {
  interview: 3,
  job: 5,
  urgent: 1,
  "tech-update": 7,
  other: 7,
};

// ═══════════════════════════════════════════════════════
// CORE FUNCTIONS
// ═══════════════════════════════════════════════════════

/**
 * Create a new follow-up tracker for an email.
 */
export function createFollowup(input: CreateFollowupInput): Followup {
  const { emailSubject, emailFrom, category, note } = input;
  const dueInDays = Math.max(1, input.dueInDays ?? DEFAULT_DUE_DAYS[category] ?? 7);

  const now = new Date();
  const dueDate = new Date(now.getTime() + dueInDays * 24 * 60 * 60 * 1000);

  return {
    id: randomUUID(),
    emailSubject,
    emailFrom,
    category,
    status: "pending",
    createdAt: now.toISOString(),
    dueAt: dueDate.toISOString(),
    note,
  };
}

/**
 * Check if a follow-up is overdue (past due date and still pending).
 */
export function isOverdue(followup: Followup): boolean {
  if (followup.status !== "pending") return false;
  return new Date(followup.dueAt).getTime() < Date.now();
}
