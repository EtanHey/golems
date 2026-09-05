/**
 * WORD-END TRUNCATION BUILD gate (acoustic).
 *
 * WHY THIS EXISTS — the blind spot it covers
 * -----------------------------------------
 * `src/transcript-fidelity-gate.mjs` compares the RAW Whisper transcript with the
 * script. Whisper is a *language* model as well as an acoustic one: given a word
 * whose final phoneme was cut off it reconstructs the intended word. On the
 * 2026-07-24 three-retros job, segment `s5a` audibly says "fixe" and Whisper
 * transcribed `fixes.` at confidence 0.999 (`words.raw.json` index 50). The
 * script also says "fixes", so `alignTokens` scored an exact `match`, no
 * `substitute` step was produced, and the TAIL_TRUNCATION rule at
 * `src/transcript-fidelity-gate.mjs:181-197` — which only ever fires on a
 * `substitute` step — could not see it. The gate is blind to word-end truncation
 * BY CONSTRUCTION, because its only witness is the transcript, and the
 * transcript is the thing that lies.
 *
 * This gate never reads the transcript text as evidence. It measures the WAV.
 *
 * WHAT IT MEASURES
 * ----------------
 * `vendor/narrationlayer/local-tts-runner.ts` synthesizes each breathing piece
 * (`splitForBreathing`) as its OWN daemon render, then concatenates the pieces
 * interleaved with generated PCM-silence pads (`buildPcmSilenceArgs`, wired at
 * local-tts-runner.ts:754). Those pads are exact digital silence, so every pad
 * start — plus the end of the file — is the exact sample where one daemon render
 * stopped producing audio. That is the only place a word end can be truncated.
 *
 * A complete render ends with the final phoneme fully articulated and decaying
 * into the model's own trailing silence. A truncated render stops mid-phoneme:
 * conversational-level speech energy runs straight into digital zero. So the
 * gate measures the render's OFFSET energy — the mirror of the existing
 * onset-energy gate, which measures the same thing at the other end of the clip.
 *
 * Two conditions must BOTH hold to reject, which is what keeps the false-positive
 * rate at zero on the calibration corpus:
 *   1. ABSOLUTE  — offsetRmsDbfs >= OFFSET_MAX_RMS_DBFS. The render was still
 *      audibly sounding at the cut, not tapering.
 *   2. RELATIVE  — offsetRmsDbfs - speechRmsDbfs >= OFFSET_MAX_REL_DB. The final
 *      25 ms is at the segment's own conversational speech level, i.e. NO decay
 *      happened at all. This is the physically impossible part: a speaker cannot
 *      finish a word at mean speech loudness and be silent one sample later.
 *
 * The relative test is what makes the gate portable across voices and loudness
 * normalizations; the absolute test is the backstop for an unusually quiet
 * segment whose own mean is already near the floor.
 */

export const OFFSET_GUARD_SECONDS = 0.010;
export const OFFSET_WINDOW_SECONDS = 0.025;
export const OFFSET_MAX_RMS_DBFS = -30;
export const OFFSET_MAX_REL_DB = -2;
export const PAD_SILENCE_AMPLITUDE = 1.5 / 32768;
export const PAD_MIN_SECONDS = 0.120;
export const PAD_MERGE_GAP_SECONDS = 0.005;
export const PAD_MERGE_MAX_AMPLITUDE = 4 / 32768;
export const SPEECH_FLOOR_REL_DB = -25;

export const WORD_END_TRUNCATION_DEFAULTS = {
  offsetGuardSeconds: OFFSET_GUARD_SECONDS,
  offsetWindowSeconds: OFFSET_WINDOW_SECONDS,
  offsetMaxRmsDbfs: OFFSET_MAX_RMS_DBFS,
  offsetMaxRelDb: OFFSET_MAX_REL_DB,
  padSilenceAmplitude: PAD_SILENCE_AMPLITUDE,
  padMinSeconds: PAD_MIN_SECONDS,
  padMergeGapSeconds: PAD_MERGE_GAP_SECONDS,
  padMergeMaxAmplitude: PAD_MERGE_MAX_AMPLITUDE,
  speechFloorRelDb: SPEECH_FLOOR_REL_DB,
};

const DBFS_SILENCE_FLOOR = -180;

function readWavPcmMono(wavPath, bytes) {
  if (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error(`not a RIFF/WAVE file: ${wavPath}`);
  }
  let offset = 12;
  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let audioFormat = 0;
  let dataOffset = -1;
  let dataSize = 0;
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (id === "fmt ") {
      audioFormat = bytes.readUInt16LE(start);
      channels = bytes.readUInt16LE(start + 2);
      sampleRate = bytes.readUInt32LE(start + 4);
      bitsPerSample = bytes.readUInt16LE(start + 14);
    } else if (id === "data") {
      dataOffset = start;
      dataSize = size;
      break;
    }
    offset = start + size + (size % 2);
  }
  if (audioFormat !== 1 || bitsPerSample !== 16 || channels < 1 || !sampleRate || dataOffset < 0) {
    throw new Error(
      `unsupported WAV for word-end-truncation gate ${wavPath}: expected PCM s16 with data chunk, ` +
        `got format=${audioFormat} channels=${channels} bits=${bitsPerSample} sampleRate=${sampleRate}`,
    );
  }
  const usableBytes = Math.min(dataSize, Math.max(0, bytes.length - dataOffset));
  const frameCount = Math.floor(usableBytes / (channels * 2));
  const samples = new Float64Array(frameCount);
  for (let i = 0; i < frameCount; i += 1) {
    // Non-cancelling downmix: keep the highest-magnitude channel, same as the
    // acoustic/onset family so a stereo BYO source cannot null itself out.
    let mixedSample = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      const channelSample = bytes.readInt16LE(dataOffset + (i * channels + channel) * 2) / 32768;
      if (Math.abs(channelSample) > Math.abs(mixedSample)) mixedSample = channelSample;
    }
    samples[i] = mixedSample;
  }
  return { sampleRate, samples };
}

function amplitudeToDbfs(amplitude) {
  if (!Number.isFinite(amplitude) || amplitude <= 0) return DBFS_SILENCE_FLOOR;
  return Math.max(DBFS_SILENCE_FLOOR, 20 * Math.log10(amplitude));
}

function windowRmsDbfs(samples, from, to) {
  const start = Math.max(0, Math.floor(from));
  const end = Math.min(samples.length, Math.floor(to));
  if (end <= start) return DBFS_SILENCE_FLOOR;
  let sumSquares = 0;
  for (let i = start; i < end; i += 1) sumSquares += samples[i] * samples[i];
  return amplitudeToDbfs(Math.sqrt(sumSquares / (end - start)));
}

/**
 * Speech-active RMS: mean level of the 20 ms frames that are within
 * `speechFloorRelDb` of the segment's loudest frame. Pauses and pads are excluded
 * so the reference is "how loud this voice talks", not "how much silence is in
 * this segment" — otherwise a segment with long breaths would lower its own bar.
 */
function speechRmsDbfs(samples, sampleRate, thresholds) {
  const frame = Math.max(1, Math.floor(sampleRate * 0.020));
  const frames = [];
  for (let i = 0; i + frame <= samples.length; i += frame) {
    let sumSquares = 0;
    for (let j = i; j < i + frame; j += 1) sumSquares += samples[j] * samples[j];
    frames.push(Math.sqrt(sumSquares / frame));
  }
  if (!frames.length) return DBFS_SILENCE_FLOOR;
  const loudest = Math.max(...frames);
  if (loudest <= 0) return DBFS_SILENCE_FLOOR;
  const floor = loudest * 10 ** (thresholds.speechFloorRelDb / 20);
  const active = frames.filter((value) => value >= floor);
  const pool = active.length ? active : frames;
  const meanSquare = pool.reduce((sum, value) => sum + value * value, 0) / pool.length;
  return amplitudeToDbfs(Math.sqrt(meanSquare));
}

/**
 * Every sample index where a daemon render stopped emitting audio: the start of
 * each generated PCM-silence pad, plus the end of the data if it does not end in
 * a pad. Pads are runs of |x| <= 1 LSB (generated silence, never a spoken pause,
 * which always carries the model's noise floor) at least `padMinSeconds` long;
 * runs separated by less than `padMergeGapSeconds` are merged so a stray
 * single-LSB sample inside a pad cannot split one boundary into two.
 */
export function findRenderOffsets(samples, sampleRate, options = {}) {
  const thresholds = { ...WORD_END_TRUNCATION_DEFAULTS, ...options };
  const minPad = Math.max(1, Math.floor(sampleRate * thresholds.padMinSeconds));
  const mergeGap = Math.max(0, Math.floor(sampleRate * thresholds.padMergeGapSeconds));
  const runs = [];
  let index = 0;
  while (index < samples.length) {
    if (Math.abs(samples[index]) <= thresholds.padSilenceAmplitude) {
      let end = index;
      while (end < samples.length && Math.abs(samples[end]) <= thresholds.padSilenceAmplitude) end += 1;
      const previous = runs[runs.length - 1];
      // Bridge ONLY the stray one-LSB samples that ffmpeg leaves inside a generated
      // pad: a short gap whose loudest sample is still far below any speech. A gap
      // containing real audio must never be swallowed, or two separate renders get
      // merged into one and the boundary between them is lost.
      let bridge = false;
      if (previous && index - previous.end <= mergeGap) {
        bridge = true;
        for (let i = previous.end; i < index; i += 1) {
          if (Math.abs(samples[i]) > thresholds.padMergeMaxAmplitude) {
            bridge = false;
            break;
          }
        }
      }
      if (bridge) previous.end = end;
      else runs.push({ start: index, end });
      index = end;
    } else {
      index += 1;
    }
  }
  const offsets = runs
    .filter((run) => run.start > 0 && run.end - run.start >= minPad)
    .map((run) => run.start);
  // The end of the data is ALWAYS a render offset: it is where the last render
  // stopped emitting. Anchor it at the first sample of the trailing sub-LSB run
  // regardless of that run's length — a segment whose final word is cut off can
  // end with only a few tens of milliseconds of trailing zeros, far short of a
  // generated breath pad, and must not escape measurement for that reason.
  let end = samples.length;
  while (end > 0 && Math.abs(samples[end - 1]) <= thresholds.padSilenceAmplitude) end -= 1;
  if (end > 0) offsets.push(end);
  offsets.sort((a, b) => a - b);
  // Collapse offsets closer together than one measurement span: a file that ends
  // part-way through a pad yields both a pad offset and a file-end offset for the
  // SAME physical cut, and one cut must be reported once.
  const span = Math.max(1, Math.floor(sampleRate * (thresholds.offsetGuardSeconds + thresholds.offsetWindowSeconds)));
  return offsets.filter((offset, index) => index === 0 || offset - offsets[index - 1] > span);
}

/**
 * Name the word that the flagged render was in the middle of speaking.
 * `pieceLastWords` (from splitForBreathing over the `.spoken.txt` provenance) is
 * authoritative when its count matches the acoustic offsets one-for-one; it is
 * script truth and cannot be re-inferred by an STT model. Otherwise fall back to
 * the last RAW Whisper word that began before the cut — used only to LABEL a
 * rejection that was already decided acoustically, never as evidence for it.
 */
function attributeWord(offsetIndex, offsetCount, boundarySeconds, pieceLastWords, rawWords) {
  if (Array.isArray(pieceLastWords) && pieceLastWords.length === offsetCount) {
    return { word: pieceLastWords[offsetIndex] ?? "", attribution: "piece-script" };
  }
  const before = (Array.isArray(rawWords) ? rawWords : []).filter(
    (word) => Number(word?.start) <= boundarySeconds + 0.35,
  );
  const last = before[before.length - 1];
  return { word: String(last?.word ?? last?.text ?? ""), attribution: "raw-whisper-fallback" };
}

export function analyzeWordEndTruncation(segments, options = {}) {
  const thresholds = { ...WORD_END_TRUNCATION_DEFAULTS, ...options };
  const stats = [];
  const violations = [];

  for (const segment of segments) {
    const id = String(segment?.id ?? "<unknown>");
    const sourceKind = segment?.sourceKind === "BYO" ? "BYO" : "TTS";
    const { sampleRate, samples } = readWavPcmMono(segment.wavPath, segment.wavBytes);
    const speechDbfs = speechRmsDbfs(samples, sampleRate, thresholds);
    const offsets = findRenderOffsets(samples, sampleRate, thresholds);
    const guard = Math.floor(sampleRate * thresholds.offsetGuardSeconds);
    const window = Math.floor(sampleRate * thresholds.offsetWindowSeconds);

    const renderUnits = offsets.map((offset, offsetIndex) => {
      const measureEnd = offset - guard;
      const offsetRmsDbfs = windowRmsDbfs(samples, measureEnd - window, measureEnd);
      const boundarySeconds = offset / sampleRate;
      const { word, attribution } = attributeWord(
        offsetIndex,
        offsets.length,
        boundarySeconds,
        segment.pieceLastWords,
        segment.rawWords,
      );
      return {
        offsetIndex,
        boundarySeconds: Number(boundarySeconds.toFixed(3)),
        offsetRmsDbfs: Number(offsetRmsDbfs.toFixed(3)),
        offsetRelDb: Number((offsetRmsDbfs - speechDbfs).toFixed(3)),
        word,
        attribution,
      };
    });

    stats.push({
      id,
      role: segment?.role,
      sourceKind,
      wavPath: segment.wavPath,
      speechRmsDbfs: Number(speechDbfs.toFixed(3)),
      renderUnits: renderUnits.length,
      maxOffsetRmsDbfs: renderUnits.length
        ? Number(Math.max(...renderUnits.map((unit) => unit.offsetRmsDbfs)).toFixed(3))
        : DBFS_SILENCE_FLOOR,
      units: renderUnits,
    });

    for (const unit of renderUnits) {
      const absoluteHit = unit.offsetRmsDbfs >= thresholds.offsetMaxRmsDbfs;
      const relativeHit = unit.offsetRelDb >= thresholds.offsetMaxRelDb;
      if (!absoluteHit || !relativeHit) continue;
      violations.push({
        segment: id,
        role: segment?.role,
        sourceKind,
        metric: "WORD_END_TRUNCATION",
        word: unit.word,
        value: unit.offsetRmsDbfs,
        threshold: thresholds.offsetMaxRmsDbfs,
        evidence:
          `word="${unit.word}" (${unit.attribution}) boundary=${unit.boundarySeconds}s ` +
          `offsetRmsDbfs=${unit.offsetRmsDbfs} (>=${thresholds.offsetMaxRmsDbfs}) ` +
          `speechRmsDbfs=${stats[stats.length - 1].speechRmsDbfs} ` +
          `offsetRelDb=${unit.offsetRelDb} (>=${thresholds.offsetMaxRelDb}); ` +
          `the render stopped at conversational speech level and ran straight into ` +
          `generated silence — the final phoneme of "${unit.word}" was never emitted. ` +
          `Whisper reconstructs the whole word from the truncated one, so transcript ` +
          `fidelity cannot see this.`,
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

function runbookForViolation(violation) {
  if (violation.sourceKind === "BYO") {
    return (
      `Replace or edit the scene audioWav source for ${violation.segment} — the word ` +
      `"${violation.word}" is cut off in the operator-supplied audio and no re-roll can ` +
      `repair it — then rerun bun scripts/synth-segments.mjs --spec <job.json> ` +
      `--resynth-scene ${violation.segment} and rebuild.`
    );
  }
  return (
    `Run: bun scripts/synth-segments.mjs --spec <job.json> --resynth-scene ${violation.segment} ` +
    `--no-cache, then rebuild; bypass the cache so the re-roll produces a fresh take ` +
    `(a cache hit returns the identical truncated audio).`
  );
}

export function wordEndTruncationRunbook(result) {
  return [...new Set((result?.violations ?? []).map(runbookForViolation))].join(" | ");
}

export function formatWordEndTruncationReport(result) {
  if (result.verdict === "PASS") return "audio-dashboard word-end-truncation gate PASS";
  const lines = [
    "WORD_END_TRUNCATION: a synthesized render stopped mid-word; the transcript cannot show this",
  ];
  for (const violation of result.violations) {
    lines.push(
      `- segment=${violation.segment} role=${violation.role} metric=${violation.metric} ` +
        `word=${JSON.stringify(violation.word)} value=${violation.value} ` +
        `threshold=${violation.threshold} evidence="${violation.evidence}" ` +
        `runbook=${JSON.stringify(runbookForViolation(violation))}`,
    );
  }
  return lines.join("\n");
}
