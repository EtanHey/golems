/**
 * Core utilities — barrel re-export.
 *
 * Canonical import path for new code:
 *   import { loadEnv } from "@golems/shared/lib/core";
 *   import { loadConfig } from "@golems/shared/lib/core";
 *
 * Old imports still work:
 *   import { loadEnv } from "@golems/shared/lib/load-env";
 *   import { loadConfig } from "@golems/shared/lib/config";
 */

// Environment
export { loadEnv } from "../load-env";

// Config
export {
  loadConfig,
  resetConfig,
  initConfig,
  deepMerge,
  type GolemsConfig,
} from "../config";

// Types
export type {
  TopicStyle,
  SemanticStyleData,
  GolemStatus,
} from "../shared-types";

// Process guards
export { installProcessGuards } from "../process-guards";

// Observability
export {
  getAxiom,
  logLLMCall,
  logServiceEvent,
  type LLMCallEvent,
  type ServiceEvent,
  type ErrorEvent,
} from "../axiom";
