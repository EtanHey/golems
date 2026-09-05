/**
 * GLM LLM - Local GLM-4.7-Flash via Ollama HTTP
 *
 * Uses Ollama HTTP API at 127.0.0.1:11434 for glm-4.7-flash.
 * Tracks usage to cost-tracker with tier: "free".
 *
 * ENV: LLM_BACKEND=glm to enable
 */

import { join } from "path";
import { homedir } from "os";
import { logCost } from "./cost-tracker";
import { logLLMCall, logError } from "./axiom";

const OLLAMA_URL = "http://127.0.0.1:11434/api/generate";
const MODEL = "glm-4.7-flash";

// Persistent JSONL cost log — same path as cloud-llm
const COST_LOG_DIR = process.env.GOLEMS_STATE_DIR || join(homedir(), ".golems-zikaron");
const COST_LOG_PATH = join(COST_LOG_DIR, "api_costs.jsonl");

/** Rough estimate: ~4 chars per token for English */
function estimateInputTokens(prompt: string): number {
  return Math.ceil(prompt.length / 4);
}

function trackUsage(source: string, inputTokens: number, outputTokens: number, durationMs = 0) {
  const timestamp = new Date().toISOString();
  try {
    logCost(COST_LOG_PATH, {
      timestamp,
      model: MODEL,
      source,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cost_usd: 0,
      tier: "free",
    });
  } catch {
    // Don't let logging failures break the main flow
  }

  // Send to Axiom (fire-and-forget)
  logLLMCall({
    model: MODEL,
    source,
    backend: "glm",
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost_usd: 0,
    duration_ms: durationMs,
    tier: "free",
    success: true,
  });
}

/**
 * Run a prompt through GLM-4.7-Flash via Ollama HTTP API.
 */
export async function runGLM(prompt: string, source = "unknown"): Promise<string | null> {
  const startMs = Date.now();
  try {
    const resp = await fetch(OLLAMA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, prompt, stream: false }),
    });

    if (!resp.ok) {
      const errBody = await resp.text();
      console.error(`[GLM] API error ${resp.status} (source: ${source}):`, errBody);
      logError({ service: source, error_message: `GLM API ${resp.status}: ${errBody.slice(0, 200)}`, error_type: "glm_api_error" });
      return null;
    }

    const data = (await resp.json()) as { response?: string; eval_count?: number };
    const text = data.response?.trim() ?? "";
    const outputTokens = data.eval_count ?? 0;
    const inputTokens = estimateInputTokens(prompt);
    const durationMs = Date.now() - startMs;

    trackUsage(source, inputTokens, outputTokens, durationMs);
    return text;
  } catch (err) {
    console.error(`[GLM] Error (source: ${source}):`, err);
    logError({ service: source, error_message: (err as Error).message, error_type: "glm_connection_error" });
    return null;
  }
}

/**
 * Run a prompt through GLM and parse JSON from response.
 */
export async function runGLMJSON<T>(prompt: string, source = "unknown"): Promise<T | null> {
  const result = await runGLM(prompt, source);

  if (!result) return null;

  try {
    const match = result.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]) as T;
    }
  } catch (e) {
    console.error(`[GLM] JSON parse error (source: ${source}):`, e);
  }

  return null;
}
