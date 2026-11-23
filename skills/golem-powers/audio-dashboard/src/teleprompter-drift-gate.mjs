import {
  TRANSCRIPTION_TOKEN,
  transcriptionNumberKeys,
} from "../vendor/narrationlayer/src/text/transcription-equivalence.ts";

export const TELEPROMPTER_DRIFT_DEFAULTS = {
  maxWordDeltaSeconds: 0.35,
  tailStartFraction: 2 / 3,
  minTranscriptChars: 1500,
  minWords: 150,
  maxMergeWords: 3,
  maxUnalignedTokenRatio: 0.2,
};

const CONTRACTION_PARTS = {
  "i'm": ["i", "am"],
  "i've": ["i", "have"],
  "i'll": ["i", "will"],
  "i'd": ["i", "would"],
  "can't": ["can", "not"],
  "won't": ["will", "not"],
};

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeToken(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9'-]+/g, "");
}

function normalizeWords(words) {
  if (!Array.isArray(words)) return [];
  return words.map((word, index) => ({
    index,
    word: String(word.word ?? word.text ?? "").trim(),
    token: normalizeToken(word.word ?? word.text),
    start: finiteNumber(word.start),
    end: finiteNumber(word.end),
  }));
}

function canonicalParts(value) {
  const token = String(value ?? "")
    .toLowerCase()
    .replaceAll("’", "'")
    .replace(/[^a-z0-9']+/g, "");
  if (!token) return [];
  if (CONTRACTION_PARTS[token]) return CONTRACTION_PARTS[token];
  const suffixes = [
    ["'re", "are"],
    ["'ve", "have"],
    ["'ll", "will"],
    ["'d", "would"],
    ["'s", "is"],
  ];
  for (const [suffix, expansion] of suffixes) {
    if (token.endsWith(suffix) && token.length > suffix.length) {
      return [token.slice(0, -suffix.length), expansion];
    }
  }
  if (token.endsWith("n't") && token.length > 3) {
    return [token.slice(0, -3), "not"];
  }
  return [token.replaceAll("'", "")];
}

function blockSignature(words, start, length) {
  return words
    .slice(start, start + length)
    .flatMap((word) => canonicalParts(word.word))
    .join("");
}

function phraseSignature(value) {
  return String(value ?? "")
    .split(/\s+/)
    .flatMap(canonicalParts)
    .join("");
}

function compileAliasSignatures(aliases) {
  const signatures = new Map();
  for (const alias of Array.isArray(aliases) ? aliases : []) {
    const rendered = phraseSignature(alias?.term);
    const source = phraseSignature(alias?.spoken);
    if (!rendered || !source) continue;
    const candidates = signatures.get(rendered) ?? new Set();
    candidates.add(source);
    signatures.set(rendered, candidates);
  }
  return signatures;
}

// Spoken numbers run longer than other blocks ("one hundred twenty-three dollars").
// Same bound as NarrationLayer's word-timing repair (MAX_NUMBER_BLOCK).
const MAX_NUMBER_BLOCK = 8;

/**
 * Number-equivalence keys of every word block up to MAX_NUMBER_BLOCK words, by start then length.
 * AIDEV-NOTE: equivalence comes only from the vendored NarrationLayer parser
 * (src/text/transcription-equivalence.ts), the one the repair and take check use; never add a
 * second number parser here. "$400" tokenizes to ["$", "400"] and "dollars." to ["dollars"].
 */
function numberBlockKeys(words) {
  const parts = words.map((word) => word.word.match(TRANSCRIPTION_TOKEN) ?? []);
  return words.map((_, start) => {
    const byLength = [[]];
    for (let length = 1; length <= Math.min(MAX_NUMBER_BLOCK, words.length - start); length += 1) {
      const tokens = parts.slice(start, start + length).flat();
      byLength.push(tokens.length ? transcriptionNumberKeys(tokens) : []);
    }
    return byLength;
  });
}

/** Every [sourceLength, renderedLength] pair whose two blocks say the same number. */
function numberBlockPairs(sourceNumbers, renderedNumbers, sourceIndex, renderedIndex) {
  const pairs = [];
  const sourceByLength = sourceNumbers[sourceIndex] ?? [];
  const renderedByLength = renderedNumbers[renderedIndex] ?? [];
  for (let sourceLength = 1; sourceLength < sourceByLength.length; sourceLength += 1) {
    const sourceKeys = sourceByLength[sourceLength];
    if (!sourceKeys.length) continue;
    for (let renderedLength = 1; renderedLength < renderedByLength.length; renderedLength += 1) {
      if (renderedByLength[renderedLength].some((key) => sourceKeys.includes(key))) {
        pairs.push([sourceLength, renderedLength]);
      }
    }
  }
  return pairs;
}

function alignExactWordBlocks(sourceWords, renderedWords, maxMergeWords, aliases) {
  const aliasSignatures = compileAliasSignatures(aliases);
  const sourceNumbers = numberBlockKeys(sourceWords);
  const renderedNumbers = numberBlockKeys(renderedWords);
  const memo = new Map();
  function visit(sourceIndex, renderedIndex) {
    const key = `${sourceIndex}:${renderedIndex}`;
    if (memo.has(key)) return memo.get(key);
    if (sourceIndex === sourceWords.length && renderedIndex === renderedWords.length) return [];
    if (sourceIndex === sourceWords.length || renderedIndex === renderedWords.length) return null;

    const accept = (sourceLength, renderedLength) => {
      const rest = visit(sourceIndex + sourceLength, renderedIndex + renderedLength);
      if (!rest) return null;
      return [{
        sourceStart: sourceIndex,
        sourceEnd: sourceIndex + sourceLength,
        renderedStart: renderedIndex,
        renderedEnd: renderedIndex + renderedLength,
      }, ...rest];
    };

    for (let total = 2; total <= maxMergeWords * 2; total += 1) {
      for (let sourceLength = 1; sourceLength <= maxMergeWords; sourceLength += 1) {
        const renderedLength = total - sourceLength;
        if (renderedLength < 1 || renderedLength > maxMergeWords) continue;
        if (sourceIndex + sourceLength > sourceWords.length) continue;
        if (renderedIndex + renderedLength > renderedWords.length) continue;
        const sourceSignature = blockSignature(sourceWords, sourceIndex, sourceLength);
        const renderedSignature = blockSignature(renderedWords, renderedIndex, renderedLength);
        if (
          sourceSignature !== renderedSignature &&
          !aliasSignatures.get(renderedSignature)?.has(sourceSignature)
        ) continue;
        const result = accept(sourceLength, renderedLength);
        if (result) {
          memo.set(key, result);
          return result;
        }
      }
    }
    // A spoken number and its written form ("four hundred dollars" / "$400") are one block.
    for (const [sourceLength, renderedLength] of numberBlockPairs(sourceNumbers, renderedNumbers, sourceIndex, renderedIndex)) {
      const result = accept(sourceLength, renderedLength);
      if (result) {
        memo.set(key, result);
        return result;
      }
    }
    memo.set(key, null);
    return null;
  }
  return visit(0, 0);
}

function lexicalUnits(words) {
  return words.flatMap((word, wordIndex) =>
    canonicalParts(word.word).map((token) => ({ token, wordIndex })),
  );
}

function wordBlocksFromLexicalSteps(steps) {
  const blocks = [];
  for (const step of steps) {
    if (step.kind !== "match" && step.kind !== "substitute" && step.kind !== "number") continue;
    const candidate = step.kind === "number"
      ? { ...step.block }
      : {
        sourceStart: step.source.wordIndex,
        sourceEnd: step.source.wordIndex + 1,
        renderedStart: step.rendered.wordIndex,
        renderedEnd: step.rendered.wordIndex + 1,
      };
    const previous = blocks.at(-1);
    const sharesSourceWord = previous && candidate.sourceStart < previous.sourceEnd;
    const sharesRenderedWord = previous && candidate.renderedStart < previous.renderedEnd;
    if (sharesSourceWord || sharesRenderedWord) {
      previous.sourceEnd = Math.max(previous.sourceEnd, candidate.sourceEnd);
      previous.renderedEnd = Math.max(previous.renderedEnd, candidate.renderedEnd);
    } else {
      blocks.push(candidate);
    }
  }
  return blocks;
}

/** Unit offset where each word starts (offsets[words.length] is the unit count), and words by offset. */
function unitOffsets(words) {
  const offsets = [0];
  for (const word of words) offsets.push(offsets.at(-1) + canonicalParts(word.word).length);
  const startsAt = new Map();
  words.forEach((_, index) => {
    if (offsets[index + 1] > offsets[index]) startsAt.set(offsets[index], [...(startsAt.get(offsets[index]) ?? []), index]);
  });
  return { offsets, startsAt };
}

function alignLexicalUnits(sourceWords, renderedWords) {
  const source = lexicalUnits(sourceWords);
  const rendered = lexicalUnits(renderedWords);
  const sourceUnits = unitOffsets(sourceWords);
  const renderedUnits = unitOffsets(renderedWords);
  const sourceNumbers = numberBlockKeys(sourceWords);
  const renderedNumbers = numberBlockKeys(renderedWords);
  const cells = Array.from({ length: source.length + 1 }, () =>
    Array.from({ length: rendered.length + 1 }, () => ({ cost: Number.POSITIVE_INFINITY, step: null })),
  );
  cells[0][0] = { cost: 0, step: null };
  for (let i = 0; i <= source.length; i += 1) {
    for (let j = 0; j <= rendered.length; j += 1) {
      const cell = cells[i][j];
      if (!Number.isFinite(cell.cost)) continue;
      const update = (nextI, nextJ, cost, step) => {
        if (cell.cost + cost < cells[nextI][nextJ].cost) {
          cells[nextI][nextJ] = { cost: cell.cost + cost, step: { ...step, prevI: i, prevJ: j } };
        }
      };
      // A number-equivalent word block is aligned, not a run of substitutions and inserts.
      for (const sourceStart of sourceUnits.startsAt.get(i) ?? []) {
        for (const renderedStart of renderedUnits.startsAt.get(j) ?? []) {
          for (const [sourceLength, renderedLength] of numberBlockPairs(sourceNumbers, renderedNumbers, sourceStart, renderedStart)) {
            update(sourceUnits.offsets[sourceStart + sourceLength], renderedUnits.offsets[renderedStart + renderedLength], 0, {
              kind: "number",
              block: {
                sourceStart,
                sourceEnd: sourceStart + sourceLength,
                renderedStart,
                renderedEnd: renderedStart + renderedLength,
              },
            });
          }
        }
      }
      if (i < source.length && j < rendered.length) {
        const exact = source[i].token === rendered[j].token;
        update(i + 1, j + 1, exact ? 0 : 1, {
          kind: exact ? "match" : "substitute",
          source: source[i],
          rendered: rendered[j],
        });
      }
      if (i < source.length) update(i + 1, j, 1, { kind: "delete", source: source[i] });
      if (j < rendered.length) update(i, j + 1, 1, { kind: "insert", rendered: rendered[j] });
    }
  }

  const steps = [];
  let i = source.length;
  let j = rendered.length;
  while (i > 0 || j > 0) {
    const step = cells[i][j].step;
    if (!step) break;
    steps.push(step);
    i = step.prevI;
    j = step.prevJ;
  }
  steps.reverse();
  return {
    blocks: wordBlocksFromLexicalSteps(steps),
    unalignedCount: steps.filter((step) => step.kind !== "match" && step.kind !== "number").length,
    totalUnits: Math.max(source.length, rendered.length),
  };
}

function alignWordBlocks(sourceWords, renderedWords, maxMergeWords, aliases) {
  const exactBlocks = alignExactWordBlocks(sourceWords, renderedWords, maxMergeWords, aliases);
  if (exactBlocks) return { blocks: exactBlocks, unalignedCount: 0, totalUnits: exactBlocks.length };
  return alignLexicalUnits(sourceWords, renderedWords);
}

function max(values) {
  return values.length ? Math.max(...values) : 0;
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function addViolation(violations, violation) {
  if (violations.some((v) => v.code === violation.code && v.segment === violation.segment)) return;
  violations.push(violation);
}

function wordDelta(source, rendered) {
  const startDelta =
    source.start == null || rendered.start == null ? Number.POSITIVE_INFINITY : Math.abs(source.start - rendered.start);
  const endDelta =
    source.end == null || rendered.end == null ? Number.POSITIVE_INFINITY : Math.abs(source.end - rendered.end);
  return { startDelta, endDelta, maxDelta: Math.max(startDelta, endDelta) };
}

function segmentTranscript(segment, sourceWords) {
  const text = segment.transcript ?? segment.script ?? segment.text;
  if (typeof text === "string" && text.trim()) return text;
  return sourceWords.map((word) => word.word).join(" ");
}

export function analyzeTeleprompterDrift(input = {}, options = {}) {
  const thresholds = { ...TELEPROMPTER_DRIFT_DEFAULTS, ...options };
  const segments = Array.isArray(input.segments) ? input.segments : [];
  const violations = [];
  const stats = [];

  if (!segments.length) {
    addViolation(violations, {
      code: "MISSING_TELEPROMPTER_DRIFT_INPUT",
      segment: "<none>",
      evidence: "Provide teleprompter drift eval segments with sourceWords and renderedWords.",
    });
  }

  for (const segment of segments) {
    const id = String(segment.id ?? `segment-${stats.length + 1}`);
    const sourceWords = normalizeWords(segment.sourceWords ?? segment.wordsJson ?? segment.words);
    const renderedWords = normalizeWords(segment.renderedWords ?? segment.timingWords ?? segment.tpdataWords);
    const aliases = Array.isArray(segment.aliases) ? segment.aliases : [];
    const transcript = segmentTranscript(segment, sourceWords);
    const transcriptChars = transcript.length;
    const tailStartIndex = Math.max(0, Math.min(sourceWords.length, Math.floor(sourceWords.length * thresholds.tailStartFraction)));
    const aliasBlockLimit = Math.max(
      thresholds.maxMergeWords,
      ...aliases.flatMap((alias) => [alias?.term, alias?.spoken].map(
        (phrase) => String(phrase ?? "").trim().split(/\s+/).filter(Boolean).length,
      )),
    );
    const alignment = alignWordBlocks(sourceWords, renderedWords, aliasBlockLimit, aliases);
    const alignedBlocks = alignment.blocks;
    const unalignedTokenRatio = alignment.totalUnits
      ? alignment.unalignedCount / alignment.totalUnits
      : 1;
    const structureAligned = alignedBlocks.length > 0 && unalignedTokenRatio <= thresholds.maxUnalignedTokenRatio;
    const tailWordCount = Math.max(0, sourceWords.length - tailStartIndex);
    const deltas = [];
    const tailDeltas = [];
    const headStartDeltas = [];
    const tailStartDeltas = [];
    const tailWeightedDeltas = [];
    const tokenMismatches = alignment.unalignedCount;

    for (const block of alignedBlocks) {
      const source = {
        start: sourceWords[block.sourceStart]?.start,
        end: sourceWords[block.sourceEnd - 1]?.end,
      };
      const rendered = {
        start: renderedWords[block.renderedStart]?.start,
        end: renderedWords[block.renderedEnd - 1]?.end,
      };
      const delta = wordDelta(source, rendered);
      deltas.push(delta);
      if (block.sourceEnd > tailStartIndex) {
        tailDeltas.push(delta);
        tailStartDeltas.push(delta.startDelta);
        tailWeightedDeltas.push(delta.maxDelta, delta.maxDelta, delta.maxDelta);
      } else {
        headStartDeltas.push(delta.startDelta);
        tailWeightedDeltas.push(delta.maxDelta);
      }
    }

    const maxTailStartDelta = max(tailStartDeltas);
    const maxTailDelta = max(tailDeltas.map((delta) => delta.maxDelta));
    const maxOverallDelta = max(deltas.map((delta) => delta.maxDelta));
    const maxHeadStartDelta = max(headStartDeltas);
    const tailStress = transcriptChars >= thresholds.minTranscriptChars || sourceWords.length >= thresholds.minWords;
    const stat = {
      id,
      sourceWordCount: sourceWords.length,
      renderedWordCount: renderedWords.length,
      transcriptChars,
      tailStartIndex,
      tailWordCount,
      tailStress,
      tokenMismatches,
      unalignedTokenRatio,
      alignedBlockCount: alignedBlocks.length,
      maxHeadStartDelta,
      maxTailStartDelta,
      maxTailDelta,
      maxOverallDelta,
      tailWeightedMeanDelta: mean(tailWeightedDeltas),
    };
    stats.push(stat);

    if (!sourceWords.length || !renderedWords.length) {
      addViolation(violations, {
        code: "MISSING_WORD_TIMING_SERIES",
        segment: id,
        evidence: "Provide non-empty sourceWords and renderedWords arrays for drift checking.",
      });
      continue;
    }

    if (!structureAligned) {
      addViolation(violations, {
        code: "WORD_SEQUENCE_MISMATCH",
        segment: id,
        value: Number(unalignedTokenRatio.toFixed(3)),
        threshold: thresholds.maxUnalignedTokenRatio,
        evidence: `unalignedTokens=${alignment.unalignedCount} totalUnits=${alignment.totalUnits} alignedBlocks=${alignedBlocks.length}.`,
      });
    }

    if (tailStress && maxTailDelta > thresholds.maxWordDeltaSeconds) {
      addViolation(violations, {
        code: "TAIL_WORD_TIMING_DRIFT",
        segment: id,
        value: Number(maxTailDelta.toFixed(3)),
        threshold: thresholds.maxWordDeltaSeconds,
        evidence:
          `tailMaxDelta=${maxTailDelta.toFixed(3)}s headMaxStartDelta=${maxHeadStartDelta.toFixed(3)}s ` +
          `tailStartIndex=${tailStartIndex} tailWords=${tailWordCount} transcriptChars=${transcriptChars}`,
      });
    }
  }

  return {
    verdict: violations.length ? "REJECTED" : "PASS",
    thresholds,
    stats,
    violations,
  };
}

export function formatTeleprompterDriftReport(result) {
  if (result.verdict === "PASS") return "teleprompter drift gate PASS";
  const lines = ["TELEPROMPTER_DRIFT: Align rendered teleprompter words to words.raw.json through the tail"];
  for (const violation of result.violations) {
    lines.push(
      `- segment=${violation.segment} metric=${violation.code} value=${violation.value ?? "n/a"} ` +
        `threshold=${violation.threshold ?? "n/a"} evidence="${violation.evidence}" ` +
        'runbook="Regenerate the segment with real STT word timings, rebuild the dashboard, then rerun the drift gate."',
    );
  }
  return lines.join("\n");
}
