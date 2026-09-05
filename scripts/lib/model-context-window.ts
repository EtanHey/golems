/**
 * Per-model context window lookup for the Claude Code status line.
 *
 * Mirrors cmuxlayer's `harness-session.ts` MODEL_WINDOW_RULES (verified windows, researcher /
 * BrainLayer brainbar-8a3da79c-159, 2026-06-04). Kept in sync manually — the two repos share no
 * dependency, so this is the single source of truth WITHIN golems. Do NOT guess/round these.
 */

const MODEL_WINDOW_RULES: Array<[RegExp, number]> = [
  // Claude — current gen ships 1M standard (Opus 4.6/4.7/4.8, Sonnet 4.6)
  [/(opus-4-?[678])|(sonnet-4-?6)/, 1_000_000],
  // Claude — Fable (Mythos tier) ships 1M standard. Live 151% repro proved this was
  // falling through to the 200K default. Bare "fable" and "fable-5" both resolve here.
  [/fable/, 1_000_000],
  // Claude — known 200K legacy/small tiers only. Do not broaden these patterns:
  // future claude-* models must fall through to the 1M default.
  [/^claude-(?:instant-)?v?[12](?:-|$)/, 200_000],
  [
    /^claude-3(?:-[0-9])?-(haiku|sonnet|opus)(?:-|$)|^(claude-)?(haiku|sonnet|opus)-3(?:-|$)/,
    200_000,
  ],
  [/^(claude-)?haiku-4(?:$|-?[0-5](?:$|[^0-9]))/, 200_000],
  [/^(claude-)?sonnet-4(?:$|-?[0-5](?:$|[^0-9])|-[0-9]{8}$)/, 200_000],
  [/^(claude-)?opus-4(?:$|-?[0-5](?:$|[^0-9])|-[0-9]{8}$)/, 200_000],
  // OpenAI GPT-5 / Codex family — 400K total window (272K input + 128K output)
  [/gpt-5/, 400_000],
  // OpenAI GPT-4 family
  [/gpt-4/, 128_000],
  // Google Gemini 2.x / 3.x — 1,048,576 (not a round 1M)
  [/gemini-[123]/, 1_048_576],
];

/** Conservative default when a non-Claude model is unknown. */
export const DEFAULT_CONTEXT_WINDOW = 200_000;
export const DEFAULT_CLAUDE_CONTEXT_WINDOW = 1_000_000;

export type ContextWindowResolution = {
  window: number;
  source: "live" | "model" | "default";
  inferredUnknownClaude: boolean;
};

/**
 * Normalize a display or id model string ("Opus 4.8", "claude-opus-4-8[1m]") into the
 * dash-delimited form the rules expect ("opus-4-8", "claude-opus-4-8[1m]").
 */
function normalizeModelId(model: string): string {
  return model
    .toLowerCase()
    .trim()
    .replace(/[.\s]+/g, "-");
}

function isClaudeModel(id: string): boolean {
  return id.startsWith("claude-") || /^(opus|sonnet|haiku|fable)(-|$)/.test(id);
}

function liveContextWindowSize(contextWindow: unknown): number | null {
  if (!contextWindow || typeof contextWindow !== "object") return null;
  const value = (contextWindow as { context_window_size?: unknown })
    .context_window_size;
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function liveUsedPercentage(contextWindow: unknown): number | null {
  if (!contextWindow || typeof contextWindow !== "object") return null;
  const value = (contextWindow as { used_percentage?: unknown })
    .used_percentage;
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function clampPct(pct: number): number {
  return Math.min(100, Math.max(0, pct));
}

/**
 * Resolve a model's context window from the verified table. Unknown/future Claude models
 * intentionally default to 1M so each new Claude release does not regress to 200K.
 */
export function modelContextWindow(model: string | null): number | null {
  if (!model) return null;
  const id = normalizeModelId(model);
  for (const [re, window] of MODEL_WINDOW_RULES) {
    if (re.test(id)) return window;
  }
  if (isClaudeModel(id)) return DEFAULT_CLAUDE_CONTEXT_WINDOW;
  return null;
}

/** Like modelContextWindow but always returns a usable number. */
export function resolveContextWindow(model: string | null): number {
  return modelContextWindow(model) ?? DEFAULT_CONTEXT_WINDOW;
}

export function resolveContextWindowForStatus({
  model,
  contextWindow,
}: {
  model: string | null;
  contextWindow?: unknown;
}): ContextWindowResolution {
  const liveWindow = liveContextWindowSize(contextWindow);
  if (liveWindow !== null) {
    return {
      window: liveWindow,
      source: "live",
      inferredUnknownClaude: false,
    };
  }

  if (!model) {
    return {
      window: DEFAULT_CONTEXT_WINDOW,
      source: "default",
      inferredUnknownClaude: false,
    };
  }

  const id = normalizeModelId(model);
  for (const [re, window] of MODEL_WINDOW_RULES) {
    if (re.test(id)) {
      return {
        window,
        source: "model",
        inferredUnknownClaude: false,
      };
    }
  }

  if (isClaudeModel(id)) {
    return {
      window: DEFAULT_CLAUDE_CONTEXT_WINDOW,
      source: "model",
      inferredUnknownClaude: true,
    };
  }

  return {
    window: DEFAULT_CONTEXT_WINDOW,
    source: "default",
    inferredUnknownClaude: false,
  };
}

/**
 * Percentage of the model's context window used, clamped to [0, 100]. The status line is a
 * gauge, not an overflow meter — a value >100% only ever meant a wrong (too-small) denominator
 * (the live 151% Fable repro), so clamping is a correctness guard against any future unmapped model.
 */
export function computeContextPct(
  contextTokens: number,
  model: string | null,
): number {
  return computeContextPctForStatus({ contextTokens, model });
}

export function computeContextPctForStatus({
  contextTokens,
  model,
  contextWindow,
}: {
  contextTokens: number;
  model: string | null;
  contextWindow?: unknown;
}): number {
  const resolution = resolveContextWindowForStatus({ model, contextWindow });
  const livePct = liveUsedPercentage(contextWindow);

  // Exact token math wins ONLY when the denominator is authoritative — i.e. Claude Code
  // sent `context_window_size`. Then `used_percentage` is merely its whole-number rounding
  // of the same quotient (a live 1M Opus 5 render at 75,203 tokens reported
  // `used_percentage: 8` for a true 7.52%), and the status line prints one decimal, so
  // deferring to it would be fake precision off by up to 0.5pp.
  //
  // When the window is INFERRED from the model table, the trade reverses. Our denominator
  // is a guess and can be 5x too large (an unmapped Claude model falls through to the 1M
  // default), so exact math against it UNDER-reports — 150,000 tokens with
  // `used_percentage: 75` renders 15%. Under-reporting is the "lead runs to the wall"
  // failure this whole module exists to prevent, and the `*` inferred marker renders green
  // and is easy to miss. `used_percentage` is computed by the harness against the REAL
  // window, so it is worth ≤0.5pp of precision. This ordering was introduced deliberately
  // in 630f8e99; PR #730 inverted it by accident and this restores it.
  const authoritativeWindow = resolution.source === "live";
  if (
    authoritativeWindow &&
    Number.isFinite(contextTokens) &&
    contextTokens > 0
  ) {
    return clampPct((contextTokens / resolution.window) * 100);
  }

  if (livePct !== null) return clampPct(livePct);

  // Last resort: no harness percentage at all, so the inferred window is all we have.
  return clampPct((contextTokens / resolution.window) * 100);
}
