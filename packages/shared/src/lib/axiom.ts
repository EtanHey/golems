/**
 * Axiom Observability Client
 *
 * Singleton Axiom client for sending events, LLM call traces,
 * service health events, and errors to Axiom.co.
 *
 * All methods are fire-and-forget — observability must never
 * break the main application flow.
 *
 * Privacy posture (same as skill-creator's emitter): IDs and metrics only.
 * Every event passes sanitizeAxiomEvent() on the send path — per-type field
 * allowlist, ID strings only (no whitespace, <=120 chars), raw error text
 * dropped (error_type + status_code kept), metadata limited to named metric
 * keys, hostname hashed to host_id. No prompt/message/transcript text, stack
 * traces, file contents or personal names.
 *
 * Config: ~/.golems/config.yaml → observability section
 * Token + dataset: resolveAxiomCredentials() — env → ~/.config/golems/axiom.env → config.yaml
 */

import { createHash } from "node:crypto";
import { Axiom } from "@axiomhq/js";
import { resolveAxiomCredentials } from "./axiom-credentials";
import { loadConfig } from "./config";

// ─── Singleton ──────────────────────────────────────────────────

let axiomClient: Axiom | null = null;
let axiomEnabled = false;
let axiomDataset = "golems";

/**
 * Initialize and return the Axiom client.
 * Returns null if Axiom is not configured.
 */
export function getAxiom(): Axiom | null {
  if (axiomClient) return axiomClient;

  const { token, dataset } = resolveAxiomCredentials(loadConfig().observability);
  axiomEnabled = !!token;
  axiomDataset = dataset;

  if (!axiomEnabled || !token) return null;

  axiomClient = new Axiom({ token });
  return axiomClient;
}

/** Drop the cached client so the next getAxiom() re-reads config (tests). */
export function resetAxiom(): void {
  axiomClient = null;
}

// ─── Event Types ────────────────────────────────────────────────

export interface LLMCallEvent {
  _type: "llm_call";
  model: string;
  source: string;
  backend: string; // "haiku" | "glm" | "gemini" | "groq" | "ollama"
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  duration_ms: number;
  tier: "paid" | "free" | "subscription";
  success: boolean;
  /** Not sent: raw error text is dropped at the send boundary. */
  error?: string;
  status_code?: number;
}

export interface ServiceEvent {
  _type: "service";
  service: string; // "email-golem" | "job-golem" | "briefing"
  event: string; // "poll" | "scrape" | "run" | "generate"
  status: "success" | "failure" | "partial";
  duration_ms: number;
  metadata?: Record<string, unknown>;
}

export interface ErrorEvent {
  _type: "error";
  service: string;
  /** Not sent: raw error text is dropped at the send boundary. */
  error_message: string;
  error_type: string;
  status_code?: number;
  /** Not sent: no error metric keys are allowlisted. */
  metadata?: Record<string, unknown>;
}

export interface CCUsageEvent {
  _type: "cc_usage";
  model: string;
  project: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  session_id?: string;
  duration_seconds?: number;
  message_count?: number;
  started_at?: string;
  ended_at?: string;
  source?: string;
  /** Sent only as host_id = first 12 hex of sha256(hostname). */
  hostname?: string;
  /** Not sent: branch names are user-chosen labels. */
  branch?: string;
}

export interface MessagePipelineEvent {
  _type: "message_pipeline";
  message_id: string;
  golem_name: string;
  phase: "receive" | "process" | "respond";
  latency_ms: number;
  success: boolean;
  error_type?: string;
  /** Not sent: raw error text is dropped at the send boundary. */
  error_message?: string;
  response_length?: number;
  status_code?: number;
}

type AxiomEvent =
  | LLMCallEvent
  | ServiceEvent
  | ErrorEvent
  | CCUsageEvent
  | MessagePipelineEvent;

// ─── Privacy Allowlist ──────────────────────────────────────────

// AIDEV-NOTE: this allowlist IS the privacy contract. A field not listed here
// never leaves the process. Add only IDs and metrics — never free text:
// raw error strings (llm_call.error, *.error_message) are deliberately absent,
// metadata keys are named per event type, hostname leaves only as a hash.
type FieldKind = "id" | "number" | "boolean" | "host-hash" | { metrics: readonly string[] };

const MAX_ID = 120;
// An ID has no whitespace: anything that reads like a sentence is dropped.
const ID_PATTERN = /^[A-Za-z0-9_.:@/+-]+$/;

// Metric keys real callers send today (cloud-worker safeRun results:
// jobs → scraped/filtered/matched, calendar sync → synced).
const SERVICE_METRICS = ["scraped", "filtered", "matched", "synced"] as const;

const ALLOWED_FIELDS: Record<AxiomEvent["_type"], Record<string, FieldKind>> = {
  llm_call: {
    model: "id",
    source: "id",
    backend: "id",
    input_tokens: "number",
    output_tokens: "number",
    cost_usd: "number",
    duration_ms: "number",
    tier: "id",
    success: "boolean",
    status_code: "number",
  },
  service: {
    service: "id",
    event: "id",
    status: "id",
    duration_ms: "number",
    metadata: { metrics: SERVICE_METRICS },
  },
  error: {
    service: "id",
    error_type: "id",
    status_code: "number",
  },
  cc_usage: {
    model: "id",
    project: "id",
    input_tokens: "number",
    output_tokens: "number",
    cache_read_tokens: "number",
    cache_write_tokens: "number",
    cost_estimate_usd: "number",
    session_id: "id",
    duration_seconds: "number",
    message_count: "number",
    started_at: "id",
    ended_at: "id",
    source: "id",
    hostname: "host-hash",
  },
  message_pipeline: {
    message_id: "id",
    golem_name: "id",
    phase: "id",
    latency_ms: "number",
    success: "boolean",
    error_type: "id",
    response_length: "number",
    status_code: "number",
  },
};

function isMetric(v: unknown): v is number | boolean {
  return typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v));
}

function namedMetrics(
  value: unknown,
  keys: readonly string[],
): Record<string, number | boolean> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const out: Record<string, number | boolean> = {};
  for (const key of keys) {
    if (Object.hasOwn(source, key) && isMetric(source[key])) out[key] = source[key];
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Opaque, stable machine id: first 12 hex of sha256(hostname). */
function hostId(hostname: string): string {
  return createHash("sha256").update(hostname).digest("hex").slice(0, 12);
}

/**
 * Reduce an event to its type's allowlisted fields. Returns null for an
 * unknown _type. Exported for tests; ingest() applies it to every event.
 */
export function sanitizeAxiomEvent(event: AxiomEvent): Record<string, unknown> | null {
  const allowed = ALLOWED_FIELDS[event._type];
  if (!allowed) return null;

  const out: Record<string, unknown> = { _type: event._type };
  for (const [key, value] of Object.entries(event)) {
    const kind = allowed[key];
    if (!kind) continue;
    if (kind === "id") {
      if (typeof value === "string" && value.length <= MAX_ID && ID_PATTERN.test(value)) out[key] = value;
    } else if (kind === "number") {
      if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
    } else if (kind === "boolean") {
      if (typeof value === "boolean") out[key] = value;
    } else if (kind === "host-hash") {
      if (typeof value === "string" && value) out.host_id = hostId(value);
    } else {
      const metrics = namedMetrics(value, kind.metrics);
      if (metrics) out[key] = metrics;
    }
  }
  return out;
}

// ─── Ingest Helpers ─────────────────────────────────────────────

/**
 * Send events to Axiom. Fire-and-forget — never throws.
 * Sanitizes every event (see sanitizeAxiomEvent) and adds a timestamp.
 */
function ingest(events: AxiomEvent[]): void {
  const client = getAxiom();
  if (!client) return;

  const timestamped = events.flatMap((e) => {
    const clean = sanitizeAxiomEvent(e);
    return clean ? [{ ...clean, _time: new Date().toISOString() }] : [];
  });
  if (timestamped.length === 0) return;

  client.ingest(axiomDataset, timestamped);
  // Flush is async but we don't await — fire and forget
  client.flush().catch((err: unknown) => {
    console.warn(
      "[Axiom] Flush failed:",
      err instanceof Error ? err.message : err,
    );
  });
}

/**
 * Log an LLM call to Axiom.
 */
export function logLLMCall(event: Omit<LLMCallEvent, "_type">): void {
  ingest([{ _type: "llm_call", ...event }]);
}

/**
 * Log a service health event to Axiom.
 */
export function logServiceEvent(event: Omit<ServiceEvent, "_type">): void {
  ingest([{ _type: "service", ...event }]);
}

/**
 * Log an error to Axiom.
 */
export function logError(event: Omit<ErrorEvent, "_type">): void {
  ingest([{ _type: "error", ...event }]);
}

/**
 * Log a message pipeline event to Axiom.
 * Tracks receive → process → respond lifecycle.
 */
export function logMessagePipeline(
  event: Omit<MessagePipelineEvent, "_type">,
): void {
  ingest([{ _type: "message_pipeline", ...event }]);
}

/**
 * Log Claude Code usage to Axiom.
 */
export function logCCUsage(event: Omit<CCUsageEvent, "_type">): void {
  ingest([{ _type: "cc_usage", ...event }]);
}

/**
 * Flush any pending events. Call this before process exit.
 */
export async function flushAxiom(): Promise<void> {
  const client = getAxiom();
  if (!client) return;
  try {
    await client.flush();
  } catch {
    // Never fail on observability
  }
}
