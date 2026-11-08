// Type-only portability adaptation; upstream utterance planner runtime is intentionally omitted.
export type PauseStrategy = "none" | "punctuation";

export interface NarrationPacingConfig {
  pause_strategy?: PauseStrategy;
  max_utterance_words?: number;
  min_utterance_words?: number;
  sentence_pause_seconds?: number;
  comma_pause_seconds?: number;
}
