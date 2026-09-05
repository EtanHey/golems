/**
 * Axiom Observability Client
 *
 * Singleton Axiom client for sending events, LLM call traces,
 * service health events, and errors to Axiom.co.
 *
 * All methods are fire-and-forget — observability must never
 * break the main application flow.
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
  service: string; // "email-golem" | "job-golem" | "nightshift" | "briefing"
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
  stack?: string;
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

// ─── Ingest Helpers ─────────────────────────────────────────────

/**
 * Send events to Axiom. Fire-and-forget — never throws.
 * Adds timestamp automatically.
 */
function ingest(events: AxiomEvent[]): void {
  const client = getAxiom();
  if (!client) return;

  const timestamped = events.map((e) => ({
    ...e,
    _time: new Date().toISOString(),
  }));

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
