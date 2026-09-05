export const TRANSCRIPT_FIDELITY_DEFAULTS = {
  minCriticalTokenChars: 8,
  minCriticalEditDistance: 4,
  minCriticalEditRatio: 0.4,
  maxCriticalEditRatio: 0.5,
  minCriticalLengthRatio: 0.8,
  minTruncatedPrefixChars: 4,
  minMissingSuffixChars: 3,
  maxMissingTailWords: 0,
};

function normalizeToken(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function scriptTokens(script) {
  return (String(script ?? "").match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? [])
    .map((word, index) => ({ index, word, token: normalizeToken(word) }))
    .filter((item) => item.token);
}

function rawTokens(words) {
  if (!Array.isArray(words)) return [];
  return words
    .map((word, index) => ({
      index,
      word: String(word?.word ?? word?.text ?? "").trim(),
      token: normalizeToken(word?.word ?? word?.text),
      start: Number(word?.start),
      end: Number(word?.end),
    }))
    .filter((item) => item.token);
}

function editDistance(a, b) {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = new Array(b.length + 1);
  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    for (let j = 0; j <= b.length; j += 1) previous[j] = current[j];
  }
  return previous[b.length];
}

function alignTokens(expected, raw) {
  const cells = Array.from({ length: expected.length + 1 }, () =>
    Array.from({ length: raw.length + 1 }, () => ({ cost: Number.POSITIVE_INFINITY, step: null })),
  );
  cells[0][0] = { cost: 0, step: null };
  for (let i = 0; i <= expected.length; i += 1) {
    for (let j = 0; j <= raw.length; j += 1) {
      const cell = cells[i][j];
      if (!Number.isFinite(cell.cost)) continue;
      const update = (nextI, nextJ, cost, step) => {
        if (cell.cost + cost < cells[nextI][nextJ].cost) {
          cells[nextI][nextJ] = { cost: cell.cost + cost, step: { ...step, prevI: i, prevJ: j } };
        }
      };
      if (i < expected.length && j < raw.length) {
        const exact = expected[i].token === raw[j].token;
        update(i + 1, j + 1, exact ? 0 : 1, {
          kind: exact ? "match" : "substitute",
          expected: expected[i],
          raw: raw[j],
        });
      }
      if (i < expected.length) update(i + 1, j, 1, { kind: "delete", expected: expected[i] });
      if (j < raw.length) update(i, j + 1, 1, { kind: "insert", raw: raw[j] });
    }
  }

  const steps = [];
  let i = expected.length;
  let j = raw.length;
  while (i > 0 || j > 0) {
    const step = cells[i][j].step;
    if (!step) break;
    steps.push(step);
    i = step.prevI;
    j = step.prevJ;
  }
  return steps.reverse();
}

function addViolation(violations, violation) {
  const existing = violations.find(
    (item) => item.metric === violation.metric && item.segment === violation.segment,
  );
  if (!existing) {
    violations.push(violation);
    return;
  }
  if (violation.evidence && violation.evidence !== existing.evidence) {
    existing.evidence = `${existing.evidence} | ${violation.evidence}`;
  }
}

function runbookForViolation(violation) {
  if (violation.metric === "SCRIPTLESS_SCENE_UNSUPPORTED") {
    return "transcript-fidelity requires a scene script; add `script` to the scene — NOT_APPLICABLE verdict class is filed as a spec question";
  }
  if (violation.metric === "MISSING_RAW_TRANSCRIPT_SERIES") {
    return `re-run synth-segments for segment ${violation.segment} to create words.raw.json, then rebuild`;
  }
  if (
    violation.metric === "MISSING_SYNTH_PROVENANCE_SERIES" ||
    violation.metric === "SYNTH_PROVENANCE_STALE"
  ) {
    return `rerun synth-segments for segment ${violation.segment} to refresh the synth-input sidecar, then rebuild`;
  }
  if (violation.sourceKind === "BYO") {
    return (
      `Replace or edit the scene audioWav source for ${violation.segment}, then rerun ` +
      `bun scripts/synth-segments.mjs --spec <job.json> --resynth-scene ${violation.segment} and rebuild.`
    );
  }
  return `bun scripts/synth-segments.mjs --spec <job.json> --resynth-scene ${violation.segment} --no-cache && bun scripts/build-dashboard.mjs --spec <job.json>`;
}

export function transcriptFidelityRunbook(result) {
  return [...new Set((result?.violations ?? []).map(runbookForViolation))].join(" | ");
}

export function analyzeTranscriptFidelity(input = {}, options = {}) {
  const thresholds = { ...TRANSCRIPT_FIDELITY_DEFAULTS, ...options };
  const segments = Array.isArray(input.segments) ? input.segments : [];
  const violations = [];
  const stats = [];

  if (!segments.length) {
    addViolation(violations, {
      segment: "<none>",
      metric: "MISSING_TRANSCRIPT_FIDELITY_INPUT",
      value: 0,
      threshold: 1,
      evidence: "No transcript-fidelity segments were supplied.",
    });
  }

  for (const segment of segments) {
    const id = String(segment?.id ?? `segment-${stats.length + 1}`);
    const sourceKind = segment?.sourceKind === "BYO" ? "BYO" : "TTS";
    const expected = scriptTokens(segment?.script);
    const raw = rawTokens(segment?.rawWords);
    const steps = alignTokens(expected, raw);
    stats.push({ id, sourceKind, scriptWordCount: expected.length, rawWordCount: raw.length, alignmentSteps: steps.length });

    if (!expected.length) {
      addViolation(violations, {
        segment: id,
        sourceKind,
        metric: "SCRIPTLESS_SCENE_UNSUPPORTED",
        value: expected.length,
        threshold: 1,
        evidence: `scriptWords=${expected.length} rawWords=${raw.length}; transcript-fidelity cannot compare BYO audio without a scene script`,
      });
      continue;
    }

    if (!raw.length) {
      addViolation(violations, {
        segment: id,
        sourceKind,
        metric: "MISSING_RAW_TRANSCRIPT_SERIES",
        value: raw.length,
        threshold: 1,
        evidence: `scriptWords=${expected.length} rawWords=${raw.length}`,
      });
      continue;
    }

    for (const [stepIndex, step] of steps.entries()) {
      if (step.kind !== "substitute") continue;
      const expectedToken = step.expected.token;
      const rawToken = step.raw.token;
      if (
        rawToken.length >= thresholds.minTruncatedPrefixChars &&
        expectedToken.startsWith(rawToken) &&
        expectedToken.length - rawToken.length >= thresholds.minMissingSuffixChars
      ) {
        addViolation(violations, {
          segment: id,
          sourceKind,
          metric: "TAIL_TRUNCATION",
          value: rawToken.length,
          threshold: expectedToken.length,
          evidence: `raw="${step.raw.word}" expected="${step.expected.word}" missingSuffixChars=${expectedToken.length - rawToken.length}`,
        });
        continue;
      }

      const distance = editDistance(expectedToken, rawToken);
      const maxLength = Math.max(expectedToken.length, rawToken.length);
      const ratio = maxLength ? distance / maxLength : 0;
      const lengthRatio = maxLength ? Math.min(expectedToken.length, rawToken.length) / maxLength : 0;
      const exactAnchors = [steps[stepIndex - 1], steps[stepIndex + 1]].filter(
        (neighbor) => neighbor?.kind === "match",
      ).length;
      if (
        Math.min(expectedToken.length, rawToken.length) >= thresholds.minCriticalTokenChars &&
        distance >= thresholds.minCriticalEditDistance &&
        ratio >= thresholds.minCriticalEditRatio &&
        ratio <= thresholds.maxCriticalEditRatio &&
        lengthRatio >= thresholds.minCriticalLengthRatio
      ) {
        addViolation(violations, {
          segment: id,
          sourceKind,
          metric: "PHONEME_CRITICAL_SUBSTITUTION",
          value: distance,
          threshold: thresholds.minCriticalEditDistance,
          evidence:
            `raw="${step.raw.word}" expected="${step.expected.word}" editDistance=${distance} ` +
            `editRatio=${ratio.toFixed(3)} lengthRatio=${lengthRatio.toFixed(3)} exactAnchors=${exactAnchors}`,
        });
      }
    }

    const missingTail = [];
    for (let index = steps.length - 1; index >= 0 && steps[index]?.kind === "delete"; index -= 1) {
      missingTail.unshift(steps[index].expected.word);
    }
    if (missingTail.length > thresholds.maxMissingTailWords) {
      addViolation(violations, {
        segment: id,
        sourceKind,
        metric: "TAIL_TRUNCATION",
        value: missingTail.length,
        threshold: thresholds.maxMissingTailWords,
        evidence: `raw transcript ends before script tail: missing=${JSON.stringify(missingTail)}`,
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

export function formatTranscriptFidelityReport(result) {
  if (result.verdict === "PASS") return "transcript fidelity gate PASS";
  const lines = ["TRANSCRIPT_FIDELITY: Raw Whisper words do not faithfully reproduce the script"];
  for (const violation of result.violations) {
    lines.push(
      `- segment=${violation.segment} metric=${violation.metric} value=${violation.value ?? "n/a"} ` +
        `threshold=${violation.threshold ?? "n/a"} evidence=${JSON.stringify(violation.evidence)} ` +
        `runbook=${JSON.stringify(runbookForViolation(violation))}`,
    );
  }
  return lines.join("\n");
}
