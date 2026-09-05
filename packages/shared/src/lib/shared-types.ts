/**
 * Shared Types - Golems Type Definitions
 *
 * Canonical type definitions shared across golems.
 * Import from here, not from individual golem files.
 */

/** Style analysis for a single topic/context (e.g. "technical", "casual") */
export interface TopicStyle {
  message_count: number;
  avg_length: number;
  formality: number;
  emoji_rate: number;
  language_mix: {
    hebrew: number;
    english: number;
  };
  common_phrases: string[];
}

/** Full semantic style analysis from Zikaron */
export interface SemanticStyleData {
  topics: Record<string, TopicStyle>;
  insights: string[];
}

/** Standard status response from any golem */
export interface GolemStatus {
  /** Golem identifier */
  name: string;
  /** Whether the golem is operational */
  healthy: boolean;
  /** ISO timestamp of last successful run */
  lastRun: string | null;
  /** Human-readable summary line */
  summary: string;
  /** Optional key-value details */
  details?: Record<string, string | number | boolean>;
}
