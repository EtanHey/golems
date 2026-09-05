/**
 * MLX LLM - Local MLX server via OpenAI-compatible HTTP API
 *
 * Uses mlx-lm.server at 127.0.0.1:8080 for Qwen2.5-Coder-14B or similar.
 * Tracks usage to cost-tracker with tier: "free".
 *
 * ENV: LLM_BACKEND=mlx to enable
 * ENV: MLX_URL to override endpoint (default: http://127.0.0.1:8080)
 */

import { join } from "path";
import { homedir } from "os";
import { logCost } from "./cost-tracker";
import { logLLMCall, logError } from "./axiom";

const MLX_BASE_URL = process.env.MLX_URL || "http://127.0.0.1:8080";
const MLX_CHAT_URL = `${MLX_BASE_URL}/v1/chat/completions`;
const MODEL = process.env.MLX_MODEL || "mlx-community/Qwen2.5-Coder-14B-Instruct-4bit";

// Persistent JSONL cost log — same path as cloud-llm/glm-llm
const COST_LOG_DIR =
  process.env.GOLEMS_STATE_DIR || join(homedir(), ".golems-zikaron");
const COST_LOG_PATH = join(COST_LOG_DIR, "api_costs.jsonl");

function trackUsage(
  source: string,
  inputTokens: number,
  outputTokens: number,
  durationMs = 0,
) {
  const timestamp = new Date().toISOString();
  try {
    logCost(COST_LOG_PATH, {
      timestamp,
      model: `mlx-${MODEL}`,
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
    model: `mlx-${MODEL}`,
    source,
    backend: "mlx",
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost_usd: 0,
    duration_ms: durationMs,
    tier: "free",
    success: true,
  });
}

/**
 * Run a prompt through MLX via OpenAI-compatible API.
 */
export async function runMLX(
  prompt: string,
  source = "unknown",
): Promise<string | null> {
  const startMs = Date.now();
  try {
    const resp = await fetch(MLX_CHAT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!resp.ok) {
      const errBody = await resp.text();
      console.error(
        `[MLX] API error ${resp.status} (source: ${source}):`,
        errBody,
      );
      logError({
        service: source,
        error_message: `MLX API ${resp.status}: ${errBody.slice(0, 200)}`,
        error_type: "mlx_api_error",
      });
      return null;
    }

    const data = (await resp.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    const text = data.choices?.[0]?.message?.content?.trim() ?? "";
    const inputTokens = data.usage?.prompt_tokens ?? 0;
    const outputTokens = data.usage?.completion_tokens ?? 0;
    const durationMs = Date.now() - startMs;

    trackUsage(source, inputTokens, outputTokens, durationMs);
    return text;
  } catch (err) {
    console.error(`[MLX] Error (source: ${source}):`, err);
    logError({
      service: source,
      error_message: (err as Error).message,
      error_type: "mlx_connection_error",
    });
    return null;
  }
}

/**
 * Run a prompt through MLX and parse JSON from response.
 */
export async function runMLXJSON<T>(
  prompt: string,
  source = "unknown",
): Promise<T | null> {
  const result = await runMLX(prompt, source);

  if (!result) return null;

  try {
    const match = result.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]) as T;
    }
  } catch (e) {
    console.error(`[MLX] JSON parse error (source: ${source}):`, e);
  }

  return null;
}
