/**
 * Nudge Queue — Zod-validated JSONL queue for proactive coach nudges.
 *
 * Nudges are queued by scheduled tasks (morning briefing, afternoon check-in,
 * evening wind-down) and consumed by the output channel (Telegram or Voice).
 *
 * File format: JSONL (one JSON object per line) at ~/.golems-zikaron/coach/nudges.jsonl
 */

import { z } from "zod/v4";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  mkdirSync,
} from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { randomUUID } from "crypto";

// --- Zod Schema ---

const NudgeTypeSchema = z.enum(["reminder", "check-in", "insight", "alert"]);
const NudgePrioritySchema = z.enum(["high", "medium", "low"]);
const NudgeStatusSchema = z.enum(["pending", "sent", "dismissed"]);
const NudgeChannelSchema = z.enum(["telegram", "voice"]);

export const NudgeSchema = z.object({
  id: z.string(),
  type: NudgeTypeSchema,
  priority: NudgePrioritySchema,
  message: z.string(),
  scheduledAt: z.string(), // ISO 8601
  status: NudgeStatusSchema,
  channel: NudgeChannelSchema,
  createdAt: z.string(), // ISO 8601
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type Nudge = z.infer<typeof NudgeSchema>;
export type NudgeType = z.infer<typeof NudgeTypeSchema>;
export type NudgePriority = z.infer<typeof NudgePrioritySchema>;
export type NudgeStatus = z.infer<typeof NudgeStatusSchema>;
export type NudgeChannel = z.infer<typeof NudgeChannelSchema>;

// --- Default Queue Path ---

const HOME = process.env.HOME ?? homedir();
if (!HOME) {
  throw new Error("[NudgeQueue] Unable to resolve HOME for queue path");
}
export const DEFAULT_QUEUE_PATH = join(
  HOME,
  ".golems-zikaron/coach/nudges.jsonl",
);

// --- Priority ordering ---

const PRIORITY_ORDER: Record<NudgePriority, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

// --- Factory ---

export interface CreateNudgeInput {
  type: NudgeType;
  message: string;
  scheduledAt: string;
  priority?: NudgePriority;
  channel?: NudgeChannel;
  metadata?: Record<string, unknown>;
}

/**
 * Create a new nudge with sensible defaults.
 */
export function createNudge(input: CreateNudgeInput): Nudge {
  return {
    id: `nudge-${randomUUID().slice(0, 8)}`,
    type: input.type,
    priority: input.priority ?? "medium",
    message: input.message,
    scheduledAt: input.scheduledAt,
    status: "pending",
    channel: input.channel ?? "telegram",
    createdAt: new Date().toISOString(),
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
}

// --- Queue File Operations ---

/**
 * Read all nudges from a JSONL queue file.
 * Returns empty array if file doesn't exist.
 * Skips invalid lines (corrupt data won't break the queue).
 */
export function readQueue(path: string = DEFAULT_QUEUE_PATH): Nudge[] {
  if (!existsSync(path)) return [];

  const content = readFileSync(path, "utf-8");
  const lines = content.split("\n").filter((line) => line.trim());
  const nudges: Nudge[] = [];

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      const result = NudgeSchema.safeParse(parsed);
      if (result.success) {
        nudges.push(result.data);
      }
    } catch {
      // Skip invalid JSON lines
    }
  }

  return nudges;
}

/** Ensure the parent directory exists before writing. */
function ensureDir(path: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Append a nudge to the JSONL queue file.
 */
export function appendNudge(
  nudge: Nudge,
  path: string = DEFAULT_QUEUE_PATH,
): void {
  ensureDir(path);
  appendFileSync(path, JSON.stringify(nudge) + "\n");
}

/**
 * Rewrite the queue file with updated nudges.
 */
function writeQueue(nudges: Nudge[], path: string): void {
  ensureDir(path);
  const content = nudges.map((n) => JSON.stringify(n)).join("\n") + "\n";
  writeFileSync(path, content);
}

/**
 * Update a nudge's status by ID.
 */
function updateStatus(
  id: string,
  status: NudgeStatus,
  path: string = DEFAULT_QUEUE_PATH,
): void {
  const nudges = readQueue(path);
  const updated = nudges.map((n) => (n.id === id ? { ...n, status } : n));
  writeQueue(updated, path);
}

/**
 * Mark a nudge as sent.
 */
export function markSent(id: string, path: string = DEFAULT_QUEUE_PATH): void {
  updateStatus(id, "sent", path);
}

/**
 * Mark a nudge as dismissed.
 */
export function markDismissed(
  id: string,
  path: string = DEFAULT_QUEUE_PATH,
): void {
  updateStatus(id, "dismissed", path);
}

/**
 * Get all pending nudges, sorted by priority (high first).
 */
export function getPending(path: string = DEFAULT_QUEUE_PATH): Nudge[] {
  return readQueue(path)
    .filter((n) => n.status === "pending")
    .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
}

/**
 * Remove all sent nudges from the queue. Returns count of cleared nudges.
 */
export function clearSent(path: string = DEFAULT_QUEUE_PATH): number {
  const nudges = readQueue(path);
  const remaining = nudges.filter((n) => n.status !== "sent");
  const cleared = nudges.length - remaining.length;
  if (cleared > 0) {
    writeQueue(remaining, path);
  }
  return cleared;
}
