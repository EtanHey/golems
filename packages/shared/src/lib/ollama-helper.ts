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

// ═══════════════════════════════════════════════════════
// EMBEDDINGS (mxbai-embed-large)
// ═══════════════════════════════════════════════════════

const EMBED_MODEL = "mxbai-embed-large";

/**
 * Get embedding vector for text using Ollama API.
 * Uses the HTTP API for embeddings (more efficient than CLI)
 * Returns null when the embedding request fails.
 */
export async function getEmbedding(text: string): Promise<number[] | null> {
  try {
    const response = await fetch("http://127.0.0.1:11434/api/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: EMBED_MODEL,
        prompt: text.slice(0, 2000), // Limit to avoid OOM
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`[Embed] API error ${response.status}: ${errorBody}`);
      console.error("[Embed] Is Ollama running? Check: curl http://127.0.0.1:11434/api/tags");
      return null;
    }

    const data = await response.json();
    return data.embedding || [];
  } catch (err) {
    console.error("[Embed] Connection failed:", err);
    console.error("[Embed] Is Ollama running? Try: ollama serve");
    return null;
  }
}

/**
 * Batch embed multiple texts (memory efficient - one at a time).
 * Returns null if any element fails so successful results stay index-aligned.
 */
export async function batchEmbed(texts: string[]): Promise<number[][] | null> {
  const embeddings: number[][] = [];

  for (let i = 0; i < texts.length; i++) {
    console.log(`[Embed] ${i + 1}/${texts.length}`);
    const embedding = await getEmbedding(texts[i]);
    if (embedding === null) return null;
    embeddings.push(embedding);

    // Small delay to prevent overwhelming Ollama
    if (i < texts.length - 1) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  return embeddings;
}

/**
 * Cosine similarity between two vectors
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}

/**
 * Find most similar items by embedding
 */
export function findSimilar<T extends { embedding?: number[] }>(
  query: number[],
  items: T[],
  topK = 5
): Array<T & { similarity: number }> {
  const scored = items
    .filter((item) => item.embedding && item.embedding.length > 0)
    .map((item) => ({
      ...item,
      similarity: cosineSimilarity(query, item.embedding!),
    }))
    .sort((a, b) => b.similarity - a.similarity);

  return scored.slice(0, topK);
}
