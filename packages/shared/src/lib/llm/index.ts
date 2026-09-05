/**
 * LLM layer — barrel re-export.
 *
 * Canonical import path for new code:
 *   import { runLLM, runLLMJSON } from "@golems/shared/lib/llm";
 *
 * Old imports still work:
 *   import { runLLM } from "@golems/shared/lib/llm";  (same path, was already the file)
 *
 * Backend-specific imports:
 *   import { runHaiku } from "@golems/shared/lib/llm/cloud";
 *   import { runGLM } from "@golems/shared/lib/llm/glm";
 */

// Primary multi-backend runner (the main entry point)
export {
  runLLM,
  runLLMJSON,
  getEmbedding,
  batchEmbed,
  cosineSimilarity,
} from "../llm";

// Error handling + retry
export {
  LLMErrorType,
  classifyLLMError,
  isRetryable,
  withRetry,
} from "../llm-errors";

// Cost tracking
export type {
  CostEntry,
  CostSummary,
  CostBySource,
  CostByModel,
  DailyCost,
} from "../cost-tracker";
