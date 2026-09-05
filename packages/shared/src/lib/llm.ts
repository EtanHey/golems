/**
 * LLM Facade
 *
 * Unified LLM interface - switches between backends:
 *   - direct: Ollama CLI (default)
 *   - sandboxed: Ollama with validation queue (OLLAMA_SANDBOXED=1)
 *   - haiku: Claude Haiku 4.5 via Anthropic SDK (LLM_BACKEND=haiku)
 *   - glm: GLM-4.7-Flash via Ollama HTTP (LLM_BACKEND=glm)
 *   - mlx: Local MLX server via OpenAI-compatible API (LLM_BACKEND=mlx)
 *   - gemini: Gemini Flash-Lite via Vercel AI SDK (LLM_BACKEND=gemini)
 *   - groq: Groq Llama via Vercel AI SDK (LLM_BACKEND=groq)
 *
 * Consumers call runLLM/runLLMJSON regardless of backend.
 */

import * as directOllama from "./ollama-helper";
import * as sandboxedOllama from "./ollama-sandboxed";
import { runHaiku, runHaikuJSON } from "./cloud-llm";
import { runGLM, runGLMJSON } from "./glm-llm";
import { runMLX, runMLXJSON } from "./mlx-llm";
import { runCloudFree, runCloudFreeJSON } from "./vercel-llm";

const LLM_BACKEND = process.env.LLM_BACKEND || "ollama";
const USE_SANDBOX = process.env.OLLAMA_SANDBOXED === "1";

if (LLM_BACKEND === "haiku") {
  console.log("[LLM] Using HAIKU mode (Anthropic API)");
} else if (LLM_BACKEND === "glm") {
  console.log("[LLM] Using GLM mode (glm-4.7-flash via Ollama)");
} else if (LLM_BACKEND === "mlx") {
  console.log("[LLM] Using MLX mode (local MLX server, OpenAI-compatible)");
} else if (LLM_BACKEND === "gemini") {
  console.log("[LLM] Using GEMINI mode (Vercel AI SDK, free tier)");
} else if (LLM_BACKEND === "groq") {
  console.log("[LLM] Using GROQ mode (Vercel AI SDK, free tier)");
} else if (USE_SANDBOX) {
  console.log("[LLM] Using SANDBOXED Ollama mode (validation queue)");
} else {
  console.log("[LLM] Using DIRECT Ollama mode");
}

/**
 * Run an LLM prompt. Backend determined by LLM_BACKEND env var.
 * Returns null when the selected backend reports an operation failure.
 *
 * - "haiku": Claude Haiku 4.5 via Anthropic SDK (paid)
 * - "glm": GLM-4.7-Flash via Ollama HTTP (local, free)
 * - "mlx": Local MLX server via OpenAI-compatible API (local, free)
 * - "gemini": Gemini Flash-Lite via Vercel AI SDK (cloud, free)
 * - "groq": Groq Llama via Vercel AI SDK (cloud, free)
 * - "ollama" (default): Local Ollama, optionally sandboxed
 */
export async function runLLM(prompt: string, source = "unknown"): Promise<string | null> {
  if (LLM_BACKEND === "haiku") {
    return runHaiku(prompt, source);
  }

  if (LLM_BACKEND === "glm") {
    return runGLM(prompt, source);
  }

  if (LLM_BACKEND === "mlx") {
    return runMLX(prompt, source);
  }

  if (LLM_BACKEND === "gemini" || LLM_BACKEND === "groq") {
    return runCloudFree(prompt, source);
  }

  if (USE_SANDBOX) {
    const result = await sandboxedOllama.runOllamaSandboxed(prompt, source);

    if (result.autoApproved) {
      return result.response;
    }

    // Wait for approval (with timeout)
    const approved = await sandboxedOllama.waitForApproval(result.id, 120000);
    return approved;
  }

  return directOllama.runOllama(prompt);
}

/**
 * Run an LLM prompt and parse JSON from the response.
 */
export async function runLLMJSON<T>(prompt: string, source = "unknown"): Promise<T | null> {
  if (LLM_BACKEND === "haiku") {
    return runHaikuJSON<T>(prompt, source);
  }

  if (LLM_BACKEND === "glm") {
    return runGLMJSON<T>(prompt, source);
  }

  if (LLM_BACKEND === "mlx") {
    return runMLXJSON<T>(prompt, source);
  }

  if (LLM_BACKEND === "gemini" || LLM_BACKEND === "groq") {
    return runCloudFreeJSON<T>(prompt, source);
  }

  const result = await runLLM(prompt, source);

  if (!result) return null;

  try {
    const match = result.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]) as T;
    }
  } catch (e) {
    console.error("[LLM] JSON parse error:", e);
  }

  return null;
}

// Embeddings don't need validation - pass through directly
export const getEmbedding = USE_SANDBOX
  ? sandboxedOllama.getEmbedding
  : directOllama.getEmbedding;

export const batchEmbed = USE_SANDBOX
  ? sandboxedOllama.batchEmbed
  : directOllama.batchEmbed;

// Utility functions (same for both modes)
export const cosineSimilarity = directOllama.cosineSimilarity;
export const findSimilar = directOllama.findSimilar;

/**
 * Quick helpers for common sources
 */
export const forJobGolem = {
  runLLM: (prompt: string) => runLLM(prompt, "job-golem"),
  runLLMJSON: <T>(prompt: string) => runLLMJSON<T>(prompt, "job-golem"),
};

export const forNightShift = {
  runLLM: (prompt: string) => runLLM(prompt, "night-shift"),
  runLLMJSON: <T>(prompt: string) => runLLMJSON<T>(prompt, "night-shift"),
};

export const forEmailGolem = {
  runLLM: (prompt: string) => runLLM(prompt, "email-golem"),
  runLLMJSON: <T>(prompt: string) => runLLMJSON<T>(prompt, "email-golem"),
};

// Backward-compatible aliases (deprecated — use runLLM/runLLMJSON)
export const runOllama = runLLM;
export const runOllamaJSON = runLLMJSON;
