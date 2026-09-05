// Minimal type shim vendored for the audio-dashboard skill.
//
// The full narrationlayer schema.ts is large and pulls in renderer/profile
// types that belong to the non-portable TTS engine. The two timing modules we
// vendored (word-timings.ts, word-timing-repair.ts) import ONLY these two
// TYPES via `import type { ... } from "./schema.js"`. Type-only imports are
// erased at runtime by bun, so this shim is compile/lint-time only and carries
// no runtime behavior — it exists so the vendored modules resolve standalone,
// with zero dependency on the narrationlayer repo.

export type TimingSource = "whisper-cli" | "estimated" | (string & {});

export interface WordTiming {
  index: number;
  word: string;
  start: number;
  end: number;
  confidence?: number;
}

// ---------------------------------------------------------------------------
// Additional type-only shims for the vendored profiles.ts + local-tts-runner.ts.
// The full narrationlayer schema/renderer types are large and belong to the
// non-portable engine. profiles.ts imports ONLY these TYPES via `import type`,
// which bun erases at runtime, so these loose shims carry no runtime behavior —
// they only let the vendored modules type-resolve standalone with zero
// dependency on the narrationlayer repo.
export type RendererName =
  "fake" | "voicelayer-qwen3" | "external-command" | (string & {});

// The real VoiceLayerQwen3Config is far richer; profiles.ts only builds a
// Partial<> of it from parsed YAML, so a permissive record is sufficient here.
export type VoiceLayerQwen3Config = Record<string, unknown>;

// Same rationale for the external-command renderer config.
export type ExternalCommandConfig = Record<string, unknown>;
