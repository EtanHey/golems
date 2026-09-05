/**
 * Audio type definitions for ProductHero video compositions.
 *
 * Supports background music, sound effects, and AI-generated narration.
 * All props are JSON-serializable for Remotion defaultProps.
 *
 * TTS Provider Comparison (2026):
 * - ElevenLabs: Best Hebrew support, highest quality, ~$0.30/1k chars
 * - OpenAI TTS: Cheaper ($0.015/min) but heavy US accent on Hebrew
 * - Google Cloud: Cheapest ($0.016/1k chars) but no confirmed Hebrew
 * Recommendation: ElevenLabs for Hebrew, OpenAI for English-only
 */

// --- TTS Provider ---

export type TTSProvider = "elevenlabs" | "openai" | "google-cloud";

export type TTSConfig = {
  provider: TTSProvider;
  /** Voice ID (provider-specific) */
  voiceId: string;
  /** Language code (e.g., "he-IL", "en-US") */
  language: string;
  /** Speaking speed multiplier (1.0 = normal) */
  speed?: number;
  /** Stability (ElevenLabs only, 0-1) */
  stability?: number;
  /** Similarity boost (ElevenLabs only, 0-1) */
  similarityBoost?: number;
  /** Model (provider-specific, e.g., "eleven_multilingual_v2") */
  model?: string;
};

// --- Narration ---

export type NarrationSegment = {
  /** Text to speak */
  text: string;
  /** Frame to start this segment */
  fromFrame: number;
  /** Frame to end (will stretch/compress audio to fit) */
  toFrame: number;
  /** Language for this segment (overrides config) */
  language?: string;
  /** Emphasis/style hint for TTS */
  style?: "normal" | "excited" | "calm" | "whisper";
};

export type NarrationProps = {
  /** Pre-generated audio file path (staticFile) — use this in production */
  src?: string;
  /** Segments for TTS generation (development/preview) */
  segments?: NarrationSegment[];
  /** TTS config for generation */
  ttsConfig?: TTSConfig;
  /** Master volume (0-1) */
  volume?: number;
};

// --- Background Music ---

export type BackgroundMusicProps = {
  /** Audio file path (staticFile) */
  src: string;
  /** Volume (0-1), typically low for background */
  volume?: number;
  /** Frame to start playing */
  startFrom?: number;
  /** Fade in duration (frames) */
  fadeInFrames?: number;
  /** Fade out duration (frames) */
  fadeOutFrames?: number;
  /** Whether to loop the audio */
  loop?: boolean;
  /** Duck volume when narration is playing (0-1) */
  duckToVolume?: number;
  /** Composition-absolute frame ranges where narration should duck the music */
  duckWindows?: Array<{ fromFrame: number; toFrame: number }>;
};

// --- Sound Effects ---

export type SoundEffectTrigger = "scene-enter" | "highlight" | "metric-count" | "transition";

export type SoundEffectProps = {
  /** Audio file path (staticFile) */
  src: string;
  /** Frame to play the effect */
  atFrame: number;
  /** Volume (0-1) */
  volume?: number;
  /** Semantic trigger (for documentation, not runtime) */
  trigger?: SoundEffectTrigger;
};

// --- Audio Mix (combines all audio layers) ---

export type AudioMixProps = {
  /** Background music track */
  backgroundMusic?: BackgroundMusicProps;
  /** Narration track */
  narration?: NarrationProps;
  /** Sound effects */
  soundEffects?: SoundEffectProps[];
  /** Master volume for the entire mix (0-1) */
  masterVolume?: number;
};
