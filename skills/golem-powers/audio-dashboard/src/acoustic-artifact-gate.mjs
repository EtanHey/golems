const FRAME_SECONDS = 0.040;
const HOP_SECONDS = 0.020;
const FMIN_HZ = 70;
const FMAX_HZ = 1000;
const PERIODICITY_MIN = 0.55;
const RMS_GATE_RATIO = 0.15;
const DURATION_WORD_RATIO_MAX = 1.25;
export const DURATION_WORD_ABSOLUTE_BACKSTOP_SECONDS = 1.25;
const HIGH_F0_MULTIPLIER = 2.0;
export const HIGH_F0_FRAME_THRESHOLD = 112;
export const HIGH_F0_SIBLING_MARGIN = 6;
export const ONSET_WINDOW_SECONDS = 0.750;
export const ONSET_MIN_RMS_DBFS = -35;
export const ONSET_MAX_PEAK_DELTA_DB = 26;
const DBFS_SILENCE_FLOOR = -120;
export const ACOUSTIC_ARTIFACT_DEFAULTS = {
  frameSeconds: FRAME_SECONDS,
  hopSeconds: HOP_SECONDS,
  fminHz: FMIN_HZ,
  fmaxHz: FMAX_HZ,
  periodicityMin: PERIODICITY_MIN,
  rmsGateRatio: RMS_GATE_RATIO,
  durationWordRatioMax: DURATION_WORD_RATIO_MAX,
  durationWordAbsoluteBackstopSeconds: DURATION_WORD_ABSOLUTE_BACKSTOP_SECONDS,
  highF0Multiplier: HIGH_F0_MULTIPLIER,
  highF0FrameThreshold: HIGH_F0_FRAME_THRESHOLD,
  highF0SiblingMargin: HIGH_F0_SIBLING_MARGIN,
};
export const ONSET_ENERGY_DEFAULTS = {
  windowSeconds: ONSET_WINDOW_SECONDS,
  minRmsDbfs: ONSET_MIN_RMS_DBFS,
  maxPeakDeltaDb: ONSET_MAX_PEAK_DELTA_DB,
};

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return sorted[index];
}

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
      `unsupported WAV for acoustic gate ${wavPath}: expected PCM s16 with data chunk, got format=${audioFormat} channels=${channels} bits=${bitsPerSample} sampleRate=${sampleRate}`,
    );
  }

  const usableBytes = Math.min(dataSize, Math.max(0, bytes.length - dataOffset));
  const frameCount = Math.floor(usableBytes / (channels * 2));
  const samples = new Float64Array(frameCount);
  for (let i = 0; i < frameCount; i += 1) {
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

function measureOnsetEnergy(samples, sampleRate) {
  const onsetSampleCount = Math.min(samples.length, Math.max(1, Math.floor(sampleRate * ONSET_WINDOW_SECONDS)));
  let onsetSumSquares = 0;
  let segmentPeak = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const amplitude = Math.abs(samples[index]);
    if (amplitude > segmentPeak) segmentPeak = amplitude;
    if (index < onsetSampleCount) onsetSumSquares += samples[index] * samples[index];
  }
  const onsetRms = onsetSampleCount ? Math.sqrt(onsetSumSquares / onsetSampleCount) : 0;
  const onsetRmsDbfs = amplitudeToDbfs(onsetRms);
  const segmentPeakDbfs = amplitudeToDbfs(segmentPeak);
  return {
    onsetWindowSeconds: onsetSampleCount / sampleRate,
    onsetRmsDbfs,
    segmentPeakDbfs,
    onsetPeakDeltaDb: Math.max(0, segmentPeakDbfs - onsetRmsDbfs),
  };
}

function framePitch(frame, sampleRate) {
  let mean = 0;
  for (const sample of frame) mean += sample;
  mean /= frame.length;

  let r0 = 0;
  for (const sample of frame) {
    const centered = sample - mean;
    r0 += centered * centered;
  }
  if (r0 <= 1e-12) return { f0: 0, periodicity: 0 };

  const minLag = Math.max(1, Math.floor(sampleRate / FMAX_HZ));
  const maxLag = Math.min(frame.length - 1, Math.floor(sampleRate / FMIN_HZ));
  let bestLag = 0;
  let best = 0;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let acc = 0;
    for (let i = 0; i < frame.length - lag; i += 1) {
      acc += (frame[i] - mean) * (frame[i + lag] - mean);
    }
    const normalized = acc / r0;
    if (normalized > best) {
      best = normalized;
      bestLag = lag;
    }
  }
  return {
    f0: bestLag ? sampleRate / bestLag : 0,
    periodicity: best,
  };
}

export function analyzeSegmentAcoustics(segment) {
  const { sampleRate, samples } = readWavPcmMono(segment.wavPath, segment.wavBytes);
  const frameSize = Math.max(1, Math.floor(sampleRate * FRAME_SECONDS));
  const hopSize = Math.max(1, Math.floor(sampleRate * HOP_SECONDS));
  const durationSec = samples.length / sampleRate;
  const onsetEnergy = measureOnsetEnergy(samples, sampleRate);
  const frames = [];
  const rmsValues = [];

  for (let start = 0; start + frameSize <= samples.length; start += hopSize) {
    let sumSquares = 0;
    const frame = samples.subarray(start, start + frameSize);
    for (const sample of frame) sumSquares += sample * sample;
    const rms = Math.sqrt(sumSquares / frame.length);
    const pitch = framePitch(frame, sampleRate);
    frames.push({ t: start / sampleRate, rms, ...pitch });
    rmsValues.push(rms);
  }

  const rms90 = percentile(rmsValues, 0.9);
  const rmsGate = RMS_GATE_RATIO * rms90;
  const voiced = frames.filter(
    (frame) => frame.rms >= rmsGate && frame.periodicity >= PERIODICITY_MIN && frame.f0 > 0,
  );
  const voicedF0 = voiced.map((frame) => frame.f0);
  const medianF0 = median(voicedF0);
  const highF0Threshold = medianF0 * HIGH_F0_MULTIPLIER;
  const highF0VoicedFrames = medianF0
    ? voiced.filter((frame) => frame.f0 > highF0Threshold).length
    : 0;

  return {
    id: segment.id,
    role: segment.role,
    wavPath: segment.wavPath,
    sourceKind: segment.sourceKind === "BYO" ? "BYO" : "TTS",
    durationSec,
    wordCount: segment.wordCount,
    durationPerWord: segment.wordCount > 0 ? durationSec / segment.wordCount : null,
    voicedFrames: voiced.length,
    medianF0,
    highF0Threshold,
    highF0VoicedFrames,
    ...onsetEnergy,
  };
}

export function analyzeOnsetEnergy(segments) {
  const stats = segments.map((segment) => {
    const { sampleRate, samples } = readWavPcmMono(segment.wavPath, segment.wavBytes);
    return {
      id: segment.id,
      role: segment.role,
      wavPath: segment.wavPath,
      sourceKind: segment.sourceKind === "BYO" ? "BYO" : "TTS",
      ...measureOnsetEnergy(samples, sampleRate),
    };
  });
  const violations = [];

  for (const stat of stats) {
    const evidence =
      `onsetWindow=${stat.onsetWindowSeconds.toFixed(3)}s ` +
      `onsetRmsDbfs=${stat.onsetRmsDbfs.toFixed(3)} ` +
      `segmentPeakDbfs=${stat.segmentPeakDbfs.toFixed(3)} ` +
      `peakDeltaDb=${stat.onsetPeakDeltaDb.toFixed(3)} ` +
      `sourceKind=${stat.sourceKind}`;
    if (stat.onsetRmsDbfs < ONSET_MIN_RMS_DBFS) {
      violations.push({
        segment: stat.id,
        role: stat.role,
        sourceKind: stat.sourceKind,
        metric: "ONSET_ENERGY_ABSOLUTE_RMS_DBFS",
        value: Number(stat.onsetRmsDbfs.toFixed(3)),
        threshold: ONSET_MIN_RMS_DBFS,
        evidence: `${evidence} requiredOnsetRmsDbfs>=${ONSET_MIN_RMS_DBFS}`,
      });
    }
    if (stat.onsetPeakDeltaDb > ONSET_MAX_PEAK_DELTA_DB) {
      violations.push({
        segment: stat.id,
        role: stat.role,
        sourceKind: stat.sourceKind,
        metric: "ONSET_ENERGY_PEAK_DELTA_DB",
        value: Number(stat.onsetPeakDeltaDb.toFixed(3)),
        threshold: ONSET_MAX_PEAK_DELTA_DB,
        evidence: `${evidence} maxPeakDeltaDb=${ONSET_MAX_PEAK_DELTA_DB}`,
      });
    }
  }

  return {
    verdict: violations.length ? "REJECTED" : "PASS",
    thresholds: ONSET_ENERGY_DEFAULTS,
    stats,
    violations,
  };
}

function onsetEnergyRunbookForViolation(violation) {
  if (violation.sourceKind === "BYO") {
    return (
      `Replace or edit the scene audioWav source for ${violation.segment}, then rerun ` +
      `bun scripts/synth-segments.mjs --spec <job.json> --resynth-scene ${violation.segment} and rebuild.`
    );
  }
  return (
    `Run: bun scripts/synth-segments.mjs --spec <job.json> --resynth-scene ${violation.segment} ` +
    `--no-cache, then rebuild; bypass the cache so the re-roll produces a fresh take.`
  );
}

export function onsetEnergyRunbook(result) {
  return [...new Set((result?.violations ?? []).map(onsetEnergyRunbookForViolation))].join(" | ");
}

export function formatOnsetEnergyReport(result) {
  if (result.verdict === "PASS") return "audio-dashboard onset-energy gate PASS";
  const lines = ["ONSET_ENERGY: Repair segments whose opening energy is below the calibrated floor"];
  for (const violation of result.violations) {
    lines.push(
      `- segment=${violation.segment} role=${violation.role} metric=${violation.metric} ` +
        `value=${violation.value} threshold=${violation.threshold} evidence="${violation.evidence}" ` +
        `runbook=${JSON.stringify(onsetEnergyRunbookForViolation(violation))}`,
    );
  }
  return lines.join("\n");
}

export function analyzeAcousticArtifacts(segments) {
  const stats = segments.map(analyzeSegmentAcoustics);
  const violations = [];

  for (const stat of stats) {
    const siblings = stats.filter((other) => other.role === stat.role && other.id !== stat.id);
    const siblingMedianDurationPerWord = median(siblings.map((s) => s.durationPerWord).filter(Number.isFinite));
    const durationSiblingViolation =
      siblingMedianDurationPerWord > 0 &&
      Number.isFinite(stat.durationPerWord) &&
      stat.durationPerWord > siblingMedianDurationPerWord * DURATION_WORD_RATIO_MAX;
    if (durationSiblingViolation) {
      violations.push({
        segment: stat.id,
        role: stat.role,
        sourceKind: stat.sourceKind,
        metric: "DURATION_WORD_SIBLING_RATIO",
        value: Number(stat.durationPerWord.toFixed(3)),
        threshold: Number((siblingMedianDurationPerWord * DURATION_WORD_RATIO_MAX).toFixed(3)),
        evidence: `durationPerWord=${stat.durationPerWord.toFixed(3)}s siblingMedian=${siblingMedianDurationPerWord.toFixed(3)}s maxMultiplier=${DURATION_WORD_RATIO_MAX}`,
      });
    }

    if (
      !durationSiblingViolation &&
      Number.isFinite(stat.durationPerWord) &&
      stat.durationPerWord > DURATION_WORD_ABSOLUTE_BACKSTOP_SECONDS
    ) {
      violations.push({
        segment: stat.id,
        role: stat.role,
        sourceKind: stat.sourceKind,
        metric: "DURATION_WORD_ABSOLUTE_BACKSTOP",
        value: Number(stat.durationPerWord.toFixed(3)),
        threshold: DURATION_WORD_ABSOLUTE_BACKSTOP_SECONDS,
        evidence:
          `durationPerWord=${stat.durationPerWord.toFixed(3)}s absoluteMax=${DURATION_WORD_ABSOLUTE_BACKSTOP_SECONDS.toFixed(3)}s ` +
          `siblingMedian=${siblingMedianDurationPerWord.toFixed(3)}s same-role median may be incident-heavy`,
      });
    }

    const siblingMedianHighFrames = median(siblings.map((s) => s.highF0VoicedFrames));
    const highF0SiblingViolation =
      stat.highF0VoicedFrames > HIGH_F0_FRAME_THRESHOLD &&
      stat.highF0VoicedFrames > siblingMedianHighFrames + HIGH_F0_SIBLING_MARGIN;
    if (highF0SiblingViolation) {
      violations.push({
        segment: stat.id,
        role: stat.role,
        sourceKind: stat.sourceKind,
        metric: "HIGH_F0_VOICED_FRAME_COUNT",
        value: stat.highF0VoicedFrames,
        threshold: HIGH_F0_FRAME_THRESHOLD,
        evidence:
          `highF0VoicedFrames=${stat.highF0VoicedFrames} threshold=${HIGH_F0_FRAME_THRESHOLD} ` +
          `siblingMedian=${siblingMedianHighFrames.toFixed(1)} medianF0=${stat.medianF0.toFixed(1)}Hz ` +
          `f0Gate=>${stat.highF0Threshold.toFixed(1)}Hz voicedFrames=${stat.voicedFrames}`,
      });
    }

    if (!highF0SiblingViolation && stat.highF0VoicedFrames > HIGH_F0_FRAME_THRESHOLD) {
      violations.push({
        segment: stat.id,
        role: stat.role,
        sourceKind: stat.sourceKind,
        metric: "HIGH_F0_VOICED_FRAME_ABSOLUTE_BACKSTOP",
        value: stat.highF0VoicedFrames,
        threshold: HIGH_F0_FRAME_THRESHOLD,
        evidence:
          `highF0VoicedFrames=${stat.highF0VoicedFrames} absoluteThreshold=${HIGH_F0_FRAME_THRESHOLD} ` +
          `siblingMedian=${siblingMedianHighFrames.toFixed(1)} medianF0=${stat.medianF0.toFixed(1)}Hz ` +
          `f0Gate=>${stat.highF0Threshold.toFixed(1)}Hz voicedFrames=${stat.voicedFrames}`,
      });
    }
  }

  return { verdict: violations.length ? "REJECTED" : "PASS", thresholds: ACOUSTIC_ARTIFACT_DEFAULTS, stats, violations };
}

function acousticArtifactRunbookForViolation(violation) {
  if (violation.sourceKind === "BYO") {
    return (
      `Replace or edit the scene audioWav source for ${violation.segment}, then rerun ` +
      `bun scripts/synth-segments.mjs --spec <job.json> --resynth-scene ${violation.segment} and rebuild.`
    );
  }
  return (
    `Run: bun scripts/synth-segments.mjs --spec <job.json> --resynth-scene ${violation.segment} ` +
    `--no-cache, then rebuild; bypass the cache so the re-roll produces a fresh take.`
  );
}

export function acousticArtifactRunbook(result) {
  return [...new Set((result?.violations ?? []).map(acousticArtifactRunbookForViolation))].join(" | ");
}

export function formatAcousticArtifactReport(result) {
  if (result.verdict === "PASS") return "audio-dashboard acoustic gate PASS";
  const lines = ["ACOUSTIC_ARTIFACT: Regenerate segments that trip acoustic-artifact invariants"];
  for (const violation of result.violations) {
    lines.push(
      `- segment=${violation.segment} role=${violation.role} metric=${violation.metric} ` +
        `value=${violation.value} threshold=${violation.threshold} evidence="${violation.evidence}" ` +
        `runbook=${JSON.stringify(acousticArtifactRunbookForViolation(violation))}`,
    );
  }
  return lines.join("\n");
}
