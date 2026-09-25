/**
 * Ollama Helper - Safe prompt execution without Bun shell issues
 */

import { logCost } from "./cost-tracker";
import { join } from "path";

const MODEL = process.env.OLLAMA_MODEL || "qwen2.5-coder:7b";

function getStateDir(): string {
  const home = process.env.HOME;
  if (!home && !process.env.GOLEMS_STATE_DIR) {
    throw new Error("HOME environment variable is required when GOLEMS_STATE_DIR is not set");
  }
  return process.env.GOLEMS_STATE_DIR || join(home!, ".golems-zikaron");
}

/**
 * Run Ollama with a prompt, avoiding Bun shell escaping issues.
 * Returns null when the Ollama process fails.
 */
export async function runOllama(prompt: string, source?: string): Promise<string | null> {
  const start = Date.now();
  const proc = Bun.spawn(["ollama", "run", MODEL], {
    stdin: new Response(prompt),
    stdout: "pipe",
    stderr: "pipe",
  });

  const output = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  const durationMs = Date.now() - start;

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    console.error("[Ollama] Process error (exit code", exitCode + "):", stderr);
    console.error("[Ollama] Is Ollama running? Check: ollama list");
    console.error("[Ollama] Model available? Try: ollama pull", MODEL);
    return null;
  }

  // Log local model call for usage tracking
  try {
    const costLogPath = join(getStateDir(), "api_costs.jsonl");
    logCost(costLogPath, {
      timestamp: new Date().toISOString(),
      model: MODEL,
      source: source || "ollama",
      input_tokens: Math.round(prompt.length / 4), // rough estimate
      output_tokens: Math.round(output.length / 4),
      cost_usd: 0,
      tier: "free",
      duration_ms: durationMs,
    });
  } catch { /* don't let logging break the flow */ }

  return output.trim();
}

/**
 * Run Ollama and parse JSON from response.
 */
export async function runOllamaJSON<T>(prompt: string, source?: string): Promise<T | null> {
  const result = await runOllama(prompt, source);
  if (result === null) return null;

  try {
    const match = result.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]) as T;
    }
  } catch (e) {
    console.error("[Ollama] JSON parse error:", e);
  }

  return null;
}
