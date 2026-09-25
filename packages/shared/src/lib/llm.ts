/**
 * LLM Facade
 *
 * Unified LLM interface - switches between backends:
 *   - ollama: local Ollama CLI (default; Homebrew Ollama on the Mac)
 *   - haiku: Claude Haiku 4.5 via Anthropic SDK (LLM_BACKEND=haiku)
 *   - mlx: Local MLX server via OpenAI-compatible API (LLM_BACKEND=mlx)
 *   - gemini: Gemini Flash-Lite via Vercel AI SDK (LLM_BACKEND=gemini)
 *   - groq: Groq Llama via Vercel AI SDK (LLM_BACKEND=groq)
 *
 * Consumers call runLLM/runLLMJSON regardless of backend. Any other value,
 * including the retired "glm" and OLLAMA_SANDBOXED, uses the Ollama default.
 * (Whether the default should move off Ollama is Etan's question gL2.)
 */

import * as directOllama from "./ollama-helper";
import { runHaiku, runHaikuJSON } from "./cloud-llm";
import { runMLX, runMLXJSON } from "./mlx-llm";
import { runCloudFree, runCloudFreeJSON } from "./vercel-llm";
import type { ZodType } from "zod";

const LLM_BACKEND = process.env.LLM_BACKEND || "ollama";

if (LLM_BACKEND === "haiku") {
  console.log("[LLM] Using HAIKU mode (Anthropic API)");
} else if (LLM_BACKEND === "mlx") {
  console.log("[LLM] Using MLX mode (local MLX server, OpenAI-compatible)");
} else if (LLM_BACKEND === "gemini") {
  console.log("[LLM] Using GEMINI mode (Vercel AI SDK, free tier)");
} else if (LLM_BACKEND === "groq") {
  console.log("[LLM] Using GROQ mode (Vercel AI SDK, free tier)");
} else {
  if (LLM_BACKEND !== "ollama") {
    console.warn(`[LLM] Unknown LLM_BACKEND "${LLM_BACKEND}"; using the Ollama default`);
  }
  console.log("[LLM] Using DIRECT Ollama mode");
}

/**
 * Run an LLM prompt. Backend determined by LLM_BACKEND env var.
 * Returns null when the selected backend reports an operation failure.
 *
 * - "haiku": Claude Haiku 4.5 via Anthropic SDK (paid)
 * - "mlx": Local MLX server via OpenAI-compatible API (local, free)
 * - "gemini": Gemini Flash-Lite via Vercel AI SDK (cloud, free)
 * - "groq": Groq Llama via Vercel AI SDK (cloud, free)
 * - "ollama" (default): local Ollama CLI
 */
export async function runLLM(prompt: string, source = "unknown"): Promise<string | null> {
  if (LLM_BACKEND === "haiku") {
    return runHaiku(prompt, source);
  }

  if (LLM_BACKEND === "mlx") {
    return runMLX(prompt, source);
  }

  if (LLM_BACKEND === "gemini" || LLM_BACKEND === "groq") {
    return runCloudFree(prompt, source);
  }

  return directOllama.runOllama(prompt);
}

/**
 * Run an LLM prompt and parse JSON from the response.
 */
export async function runLLMJSON<T>(
  prompt: string,
  schema: ZodType<T>,
  source = "unknown",
): Promise<T | null> {
  if (LLM_BACKEND === "haiku") {
    return runHaikuJSON(prompt, schema, source);
  }

  if (LLM_BACKEND === "mlx") {
    return validateJSON(await runMLXJSON<unknown>(prompt, source), schema, source);
  }

  if (LLM_BACKEND === "gemini" || LLM_BACKEND === "groq") {
    return validateJSON(
      await runCloudFreeJSON<unknown>(prompt, source),
      schema,
      source,
    );
  }

  const result = await runLLM(prompt, source);

  if (!result) return null;

  try {
    const match = result.match(/\{[\s\S]*\}/);
    if (match) {
      return validateJSON(JSON.parse(match[0]), schema, source);
    }
  } catch (e) {
    console.error("[LLM] JSON parse error:", e);
  }

  return null;
}

function validateJSON<T>(
  value: unknown,
  schema: ZodType<T>,
  source: string,
): T | null {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  console.error(
    `[LLM] JSON schema validation error (source: ${source})`,
    parsed.error.issues,
  );
  return null;
}

/**
 * Quick helpers for common sources
 */
export const forJobGolem = {
  runLLM: (prompt: string) => runLLM(prompt, "job-golem"),
  runLLMJSON: <T>(prompt: string, schema: ZodType<T>) =>
    runLLMJSON(prompt, schema, "job-golem"),
};

export const forEmailGolem = {
  runLLM: (prompt: string) => runLLM(prompt, "email-golem"),
  runLLMJSON: <T>(prompt: string, schema: ZodType<T>) =>
    runLLMJSON(prompt, schema, "email-golem"),
};

// Backward-compatible aliases (deprecated — use runLLM/runLLMJSON)
export const runOllama = runLLM;
export const runOllamaJSON = runLLMJSON;
