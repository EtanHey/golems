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
 * allowlist, strings cut to 120 chars, metadata reduced to numeric/boolean
 * values. No prompt/message/transcript text, stack traces or file contents.
 *
 * Config: ~/.golems/config.yaml → observability section
 * Token: AXIOM_TOKEN env var or config.yaml
 */

import { Axiom } from "@axiomhq/js";
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

  const config = loadConfig();
  const token = process.env.AXIOM_TOKEN || config.observability.axiomToken;
  axiomEnabled = config.observability.enabled && !!token;
  axiomDataset = config.observability.axiomDataset || "golems";

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
  error?: string;
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
  error_message: string;
  error_type: string;
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
  cost_estimate_usd: number;
  session_id?: string;
  duration_seconds?: number;
  message_count?: number;
  started_at?: string;
  ended_at?: string;
  source?: string;
  hostname?: string;
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
  error_message?: string;
  response_length?: number;
}

type AxiomEvent =
  | LLMCallEvent
  | ServiceEvent
  | ErrorEvent
  | CCUsageEvent
  | MessagePipelineEvent;

// ─── Privacy Allowlist ──────────────────────────────────────────

// AIDEV-NOTE: this allowlist IS the privacy contract. A field not listed here
// never leaves the process. Add only IDs and metrics — never free text.
type FieldKind = "string" | "number" | "boolean" | "metrics";

const MAX_STRING = 120;
const MAX_METRIC_KEYS = 32;
const MAX_METRIC_KEY_LENGTH = 64;

const ALLOWED_FIELDS: Record<AxiomEvent["_type"], Record<string, FieldKind>> = {
  llm_call: {
    model: "string",
    source: "string",
    backend: "string",
    input_tokens: "number",
    output_tokens: "number",
    cost_usd: "number",
    duration_ms: "number",
    tier: "string",
    success: "boolean",
    error: "string",
  },
  service: {
    service: "string",
    event: "string",
    status: "string",
    duration_ms: "number",
    metadata: "metrics",
  },
  error: {
    service: "string",
    error_message: "string",
    error_type: "string",
    metadata: "metrics",
  },
  cc_usage: {
    model: "string",
    project: "string",
    input_tokens: "number",
    output_tokens: "number",
    cache_read_tokens: "number",
    cache_write_tokens: "number",
    cost_estimate_usd: "number",
    session_id: "string",
    duration_seconds: "number",
    message_count: "number",
    started_at: "string",
    ended_at: "string",
    source: "string",
    hostname: "string",
    branch: "string",
  },
  message_pipeline: {
    message_id: "string",
    golem_name: "string",
    phase: "string",
    latency_ms: "number",
    success: "boolean",
    error_type: "string",
    error_message: "string",
    response_length: "number",
  },
};

function isMetric(v: unknown): v is number | boolean {
  return typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v));
}

function metricsOnly(value: unknown): Record<string, number | boolean> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: Record<string, number | boolean> = {};
  let kept = 0;
  for (const [k, v] of Object.entries(value)) {
    if (kept >= MAX_METRIC_KEYS) break;
    if (k.length > MAX_METRIC_KEY_LENGTH || !isMetric(v)) continue;
    out[k] = v;
    kept++;
  }
  return kept > 0 ? out : undefined;
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
    if (kind === "string" && typeof value === "string") {
      out[key] = value.slice(0, MAX_STRING);
    } else if (kind === "number" && typeof value === "number" && Number.isFinite(value)) {
      out[key] = value;
    } else if (kind === "boolean" && typeof value === "boolean") {
      out[key] = value;
    } else if (kind === "metrics") {
      const metrics = metricsOnly(value);
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
