/**
 * Speech text normalization for NarrationLayer.
 *
 * The Qwen3 TTS daemon applies NO pronunciation/normalization of its own, so any
 * fix for documented mispronunciations must be applied here, in narrationlayer,
 * before the script text is sent to the daemon.
 *
 * Two layers, applied in order:
 *   1. An explicit, data-driven TERM_MAP of acronyms/words, MOST SPECIFIC FIRST
 *      (e.g. `cmux-agents` before `cmux`, `tty-input` before `tty`).
 *   2. A few small GENERAL rules (snake_case -> spaces, dotted identifier -> "dot",
 *      `x-vs-y` -> "versus", leading `@word` -> "at word").
 *
 * Matching treats `.`, `_`, `-`, `@` as token separators so we never mangle an
 * ordinary word that merely contains a target as a substring (e.g. "category"
 * must not be touched, "Statton" must stay intact).
 */

// AIDEV-NOTE: This vendored two-channel sanitizer lands vendor-side first;
// upstream NarrationLayer synchronization is still owed and must preserve it.

export interface TermRule {
  /** The literal token (case-insensitive) to replace. */
  term: string;
  /** Spoken replacement. */
  spoken: string;
}

/**
 * Explicit term map. Longest / most specific patterns MUST come first so that,
 * e.g., `cmux-agents` wins over `cmux` and `tty-input` wins over `tty`.
 */
export const TERM_MAP: TermRule[] = [
  { term: "cmux-agents", spoken: "see mux agents" },
  { term: "tty-input", spoken: "T T Y input" },
  { term: "human-vs-agent", spoken: "human versus agent" },
  { term: "@-tag", spoken: "at tag" },
  { term: "pgid", spoken: "P G I D" },
  { term: "tty", spoken: "T T Y" },
  { term: "cmux", spoken: "see mux" },
  { term: "triage", spoken: "tree azh" },
  // Tech-term respellings: the daemon has no lexicon, so product/library names
  // that TTS routinely mangles are respelled phonetically here (TTS-feed only;
  // the displayed script keeps the original spelling). Word-boundaried like the
  // entries above, so substrings (e.g. "supabased", "nextjs-config") are safe.
  // `Next.js` MUST precede the general DOTTED_RULE so it isn't split into
  // "next dot js".
  { term: "Next.js", spoken: "next jay ess" },
  { term: "Supabase", spoken: "sooper base" },
  { term: "Twilio", spoken: "twi lee oh" },
  { term: "LiveKit", spoken: "live kit" },
  { term: "Postgres", spoken: "post gres" },
  { term: "OTP", spoken: "O T P" },
];

/** Characters that count as part of a token for boundary purposes. */
const TOKEN_CHAR = "A-Za-z0-9";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build a case-insensitive matcher for a literal term that is bounded by
 * non-token characters (or string edges) on both sides. The leading/trailing
 * separator chars used in the term itself (`-`, `@`) are escaped literally, and
 * the boundary lookarounds key off alphanumerics so ordinary words are safe.
 */
export function buildTermRegExp(term: string): RegExp {
  return new RegExp(
    `(?<![${TOKEN_CHAR}])${escapeRegExp(term)}(?![${TOKEN_CHAR}])`,
    "gi",
  );
}

const COMPILED_TERMS: { regexp: RegExp; spoken: string }[] = TERM_MAP.map(
  (rule) => ({ regexp: buildTermRegExp(rule.term), spoken: rule.spoken }),
);

// General rules.

// Authored initialisms such as `P R`, `Q A`, and `M C P` are one acronym on the
// synth channel. Newlines are deliberately excluded so separate lines cannot be
// fused accidentally. A configured PR/QA entry can expand the collapsed token;
// an unmapped sequence remains the compact acronym rather than disfluent words.
const SPACED_CAPITALS_RULE =
  /(?<![A-Za-z0-9])([A-Z](?:[ \t]+[A-Z]){1,})(?![A-Za-z0-9])/g;

// `at @word` -> `at word`, preserving the already-spoken preposition.
const AT_PREPOSITION_RULE =
  /(?<![A-Za-z0-9])(\bat)\s+@([A-Za-z][A-Za-z0-9]*)/gi;

// `at @-tag` -> `at tag`, preserving the already-spoken preposition.
const AT_TAG_PREPOSITION_RULE =
  /(?<![A-Za-z0-9])(\bat)\s+@-tag(?![A-Za-z0-9])/gi;

// `x-vs-y` -> `x versus y` (generic). Operates on alphanumeric word halves.
const VS_RULE =
  /(?<![A-Za-z0-9])([A-Za-z0-9]+)-vs-([A-Za-z0-9]+)(?![A-Za-z0-9])/gi;

// Dotted lowercase identifier `a.b.c` -> `a dot b dot c`. Requires at least one
// dot joining two-or-more lowercase/digit segments, bounded by non-token chars.
// Avoids touching sentence-final words because it needs a segment AFTER each dot.
const DOTTED_RULE =
  /(?<![A-Za-z0-9.])([a-z0-9]+(?:\.[a-z0-9]+)+)(?![A-Za-z0-9])/g;

// snake_case `a_b` -> `a b`. Bounded; requires an underscore between segments.
const SNAKE_RULE =
  /(?<![A-Za-z0-9_])([A-Za-z0-9]+(?:_[A-Za-z0-9]+)+)(?![A-Za-z0-9_])/g;

// Leading `@word` -> `at word`. The `@` must NOT be preceded by a token char,
// so emails like `user@example` are left alone.
const AT_RULE = /(?<![A-Za-z0-9@])@([A-Za-z][A-Za-z0-9]*)/g;

function compileConfiguredTerms(rules: TermRule[]): {
  regexp: RegExp;
  spokenByTerm: Map<string, string>;
} | null {
  const spokenByTerm = new Map<string, string>();
  for (const rule of rules) {
    if (rule.term && rule.spoken) {
      spokenByTerm.set(rule.term.toLocaleLowerCase("en-US"), rule.spoken);
    }
  }
  if (spokenByTerm.size === 0) return null;

  const alternatives = [...spokenByTerm.keys()]
    .sort((left, right) => right.length - left.length)
    .map(escapeRegExp)
    .join("|");
  return {
    regexp: new RegExp(
      `(?<![${TOKEN_CHAR}])(?:${alternatives})(?![${TOKEN_CHAR}])`,
      "gi",
    ),
    spokenByTerm,
  };
}

export interface SpeechChannels {
  /** Original author text. This is the only value display/renderers may consume. */
  displayText: string;
  /** Normalized engine text. This is the only value TTS/cache/breathing may consume. */
  synthInput: string;
}

interface SpeechAliasToken {
  word: string;
  comparable: string;
}

function speechAliasTokens(text: string): SpeechAliasToken[] {
  return (String(text).match(/[\p{L}\p{N}]+(?:[._'’@-][\p{L}\p{N}]+)*/gu) ?? [])
    .map((word) => ({
      word,
      comparable: word.toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]+/gu, ""),
    }))
    .filter((token) => token.comparable);
}

/**
 * Derive only the lexical spans changed by deterministic speech preprocessing.
 * These aliases let STT timing stay anchored to the actual synth transcript
 * while display words keep the original authored tokens.
 */
export function deriveSpeechAliases(displayText: string, synthInput: string): TermRule[] {
  const display = speechAliasTokens(displayText);
  const synth = speechAliasTokens(synthInput);
  const lengths = Array.from({ length: display.length + 1 }, () =>
    new Array<number>(synth.length + 1).fill(0),
  );
  for (let displayIndex = display.length - 1; displayIndex >= 0; displayIndex -= 1) {
    for (let synthIndex = synth.length - 1; synthIndex >= 0; synthIndex -= 1) {
      lengths[displayIndex][synthIndex] =
        display[displayIndex].comparable === synth[synthIndex].comparable
          ? 1 + lengths[displayIndex + 1][synthIndex + 1]
          : Math.max(lengths[displayIndex + 1][synthIndex], lengths[displayIndex][synthIndex + 1]);
    }
  }

  const aliases = new Map<string, TermRule>();
  let displayIndex = 0;
  let synthIndex = 0;
  let displayGap: SpeechAliasToken[] = [];
  let synthGap: SpeechAliasToken[] = [];
  const flushGap = () => {
    if (displayGap.length && synthGap.length) {
      const term = displayGap.map((token) => token.word).join(" ");
      const spoken = synthGap.map((token) => token.word).join(" ");
      const key = displayGap.map((token) => token.comparable).join("");
      aliases.set(`${key}\u0000${synthGap.map((token) => token.comparable).join("")}`, {
        term,
        spoken,
      });
    }
    displayGap = [];
    synthGap = [];
  };

  while (displayIndex < display.length && synthIndex < synth.length) {
    if (display[displayIndex].comparable === synth[synthIndex].comparable) {
      flushGap();
      displayIndex += 1;
      synthIndex += 1;
    } else if (lengths[displayIndex + 1][synthIndex] >= lengths[displayIndex][synthIndex + 1]) {
      displayGap.push(display[displayIndex]);
      displayIndex += 1;
    } else {
      synthGap.push(synth[synthIndex]);
      synthIndex += 1;
    }
  }
  displayGap.push(...display.slice(displayIndex));
  synthGap.push(...synth.slice(synthIndex));
  flushGap();
  return [...aliases.values()].sort((left, right) => right.term.length - left.term.length);
}

export function normalizeForSpeech(text: string, configuredRules: TermRule[] = []): string {
  if (!text) {
    return text;
  }

  let result = text.replace(
    SPACED_CAPITALS_RULE,
    (match) => match.replace(/[ \t]+/g, ""),
  );

  // Install overlays win by running before the legacy static term map. Phrase
  // rules are sorted longest-first so a contextual entry cannot be pre-empted by
  // a shorter token from the same overlay.
  const configuredTerms = compileConfiguredTerms(configuredRules);
  if (configuredTerms) {
    result = result.replace(
      configuredTerms.regexp,
      (match) => configuredTerms.spokenByTerm.get(match.toLocaleLowerCase("en-US")) ?? match,
    );
  }

  result = result.replace(
    AT_TAG_PREPOSITION_RULE,
    (_match, preposition: string) => `${preposition} tag`,
  );
  result = result.replace(
    AT_PREPOSITION_RULE,
    (_match, preposition: string, word: string) => `${preposition} ${word}`,
  );

  // 1. Explicit terms, most specific first.
  for (const { regexp, spoken } of COMPILED_TERMS) {
    result = result.replace(regexp, spoken);
  }

  // 2. General rules.
  result = result.replace(
    VS_RULE,
    (_match, left: string, right: string) => `${left} versus ${right}`,
  );
  result = result.replace(DOTTED_RULE, (match) =>
    match.split(".").join(" dot "),
  );
  result = result.replace(SNAKE_RULE, (match) => match.split("_").join(" "));
  result = result.replace(AT_RULE, (_match, word: string) => `at ${word}`);

  return result;
}

/**
 * Make the display/engine separation explicit at the preprocessing seam.
 * Callers must render displayText and send only synthInput to the TTS engine.
 */
export function prepareSpeechChannels(
  displayText: string,
  configuredRules: TermRule[] = [],
): SpeechChannels {
  return {
    displayText,
    synthInput: normalizeForSpeech(displayText, configuredRules),
  };
}
