// Deterministic two-sided eval for the canonical audio-dashboard skill.
// The GREEN fixture is a minimal read-along dashboard evidence record:
// real words.json, real transcript text, word-click seek, canonical generator,
// and publish-to-tailnet source path. RED fixtures pin the regressions that
// caused the Stalker failure: WPM/estimated timing, placeholder recap text,
// and old GolemPlaylist V1 generation.

import { test, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { validateAudioDashboardEvidence } from "../src/audio-dashboard-evidence.mjs";
import {
  analyzeAcousticArtifacts,
  analyzeOnsetEnergy,
  formatOnsetEnergyReport,
  ONSET_ENERGY_DEFAULTS,
} from "../src/acoustic-artifact-gate.mjs";
import { analyzeTeleprompterDrift, formatTeleprompterDriftReport } from "../src/teleprompter-drift-gate.mjs";
import {
  analyzeTranscriptFidelity,
  formatTranscriptFidelityReport,
  TRANSCRIPT_FIDELITY_DEFAULTS,
} from "../src/transcript-fidelity-gate.mjs";
import { createBuildReceipts, readNarrationVendorStamp, writeBuildReceipts } from "../src/build-receipts.mjs";
import { clearTakeCacheReceiptForByo, writeWordTimingArtifacts } from "../src/word-timing-artifacts.mjs";
import { formatCachePurgeReceipt, purgeRejectedTakeCaches } from "../src/take-cache.mjs";
import { answersMarkdown, injectDecisionSurfaceIntoHtml } from "../src/decision-surface.mjs";
import { buildAfterCodeDashboardPlan } from "../scripts/audio-dashboard-generator.mjs";
import { renderV4 } from "../vendor/agent-html/lib/render-v4.mjs";
import { clearTakeCacheReceipt, writeTakeCacheReceipt } from "../vendor/narrationlayer/local-tts-runner.ts";
import { loadPronunciationRules } from "../vendor/narrationlayer/pronunciation-config.ts";
import { normalizeForSpeech } from "../vendor/narrationlayer/text-normalize.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const redDir = path.join(here, "fixtures", "red");
const greenDir = path.join(here, "fixtures", "green");
const transcriptCalibrationPath = path.join(
  here,
  "fixtures",
  "calibration",
  "2026-07-17-fable-blind-weave-transcript-fidelity.json",
);
const onsetEnergyCalibrationPath = path.join(
  here,
  "fixtures",
  "calibration",
  "2026-07-17-fable-blind-weave-onset-energy.json",
);
const skillPath = path.join(here, "..", "SKILL.md");
const skillRoot = path.join(here, "..");
const placeholderMp3 = path.join(skillRoot, "vendor", "agent-html", "templates", "v4-story-mode", "_placeholder.mp3");
const placeholderMp3Duration = 1.0;

function loadFixtures(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => ({ file: f, ...JSON.parse(readFileSync(path.join(dir, f), "utf8")) }));
}

const reds = loadFixtures(redDir);
const greens = loadFixtures(greenDir);
const evidenceReds = reds.filter((fx) => fx.evidence);
const evidenceGreens = greens.filter((fx) => fx.evidence);
const driftReds = reds.filter((fx) => fx.gate === "teleprompter-drift");
const driftGreens = greens.filter((fx) => fx.gate === "teleprompter-drift");
const acousticReds = reds.filter((fx) => fx.gate === "acoustic");
const onsetEnergyReds = reds.filter((fx) => fx.gate === "onset-energy");
const transcriptReds = reds.filter((fx) => fx.gate === "transcript-fidelity");
const publishDriftReds = reds.filter((fx) => fx.gate === "teleprompter-drift-publish");

function tpdataFromHtml(html) {
  const match = html.match(/<script[^>]*id=["']tpdata["'][^>]*>([\s\S]*?)<\/script>/i);
  expect(match).toBeTruthy();
  return JSON.parse(match[1].trim());
}

function writeFixtureFfprobe(root) {
  const binDir = path.join(root, "bin");
  mkdirSync(binDir, { recursive: true });
  const ffprobePath = path.join(binDir, "ffprobe");
  writeFileSync(ffprobePath, `#!/usr/bin/env sh\nprintf '${placeholderMp3Duration.toFixed(6)}\\n'\n`);
  chmodSync(ffprobePath, 0o755);
  return binDir;
}

function writeSegment(jobDir, sceneId, words, mp3Source = placeholderMp3, rawWords = words) {
  const segDir = path.join(jobDir, "segments", sceneId);
  mkdirSync(segDir, { recursive: true });
  copyFileSync(mp3Source, path.join(segDir, `${sceneId}.mp3`));
  writeFileSync(path.join(segDir, "words.raw.json"), `${JSON.stringify(rawWords, null, 2)}\n`);
  writeFileSync(path.join(segDir, "words.json"), `${JSON.stringify(words, null, 2)}\n`);
  writeToneWav(path.join(segDir, `${sceneId}.wav`), { seconds: 1.0, baseHz: 140 });
}

function writeToneWav(outPath, { seconds, baseHz = 140, sampleRate = 24000, baseAmplitude = 0.55, highBursts = [] }) {
  const totalSamples = Math.max(1, Math.floor(seconds * sampleRate));
  const bytes = Buffer.alloc(44 + totalSamples * 2);
  bytes.write("RIFF", 0, "ascii");
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVE", 8, "ascii");
  bytes.write("fmt ", 12, "ascii");
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36, "ascii");
  bytes.writeUInt32LE(totalSamples * 2, 40);
  for (let i = 0; i < totalSamples; i += 1) {
    const t = i / sampleRate;
    const burst = highBursts.find((b) => t >= b.start && t < b.end);
    const hz = burst?.hz ?? baseHz;
    const amplitude = burst?.amplitude ?? baseAmplitude;
    const sample = Math.max(-1, Math.min(1, Math.sin(2 * Math.PI * hz * t) * amplitude));
    bytes.writeInt16LE(Math.round(sample * 32767), 44 + i * 2);
  }
  writeFileSync(outPath, bytes);
}

function writeStereoToneWav(
  outPath,
  { seconds, baseHz = 140, sampleRate = 24000, leftAmplitude = 0, rightAmplitude = 0.55 },
) {
  const channels = 2;
  const totalFrames = Math.max(1, Math.floor(seconds * sampleRate));
  const bytes = Buffer.alloc(44 + totalFrames * channels * 2);
  bytes.write("RIFF", 0, "ascii");
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVE", 8, "ascii");
  bytes.write("fmt ", 12, "ascii");
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(channels, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * channels * 2, 28);
  bytes.writeUInt16LE(channels * 2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36, "ascii");
  bytes.writeUInt32LE(totalFrames * channels * 2, 40);
  for (let frame = 0; frame < totalFrames; frame += 1) {
    const sample = Math.sin(2 * Math.PI * baseHz * (frame / sampleRate));
    bytes.writeInt16LE(Math.round(sample * leftAmplitude * 32767), 44 + frame * 4);
    bytes.writeInt16LE(Math.round(sample * rightAmplitude * 32767), 46 + frame * 4);
  }
  writeFileSync(outPath, bytes);
}

function wordsForDuration(count, duration = placeholderMp3Duration) {
  return Array.from({ length: count }, (_, index) => ({
    word: `w${index + 1}`,
    start: Number((0.02 + index * ((duration - 0.08) / count)).toFixed(3)),
    end: Number((0.02 + (index + 0.5) * ((duration - 0.08) / count)).toFixed(3)),
  }));
}

function writeAcousticSegment(
  jobDir,
  sceneId,
  { seconds = 4, words = 10, role = "narrator", highBursts = [], sampleRate = 24000, baseAmplitude = 0.55 } = {},
) {
  const segDir = path.join(jobDir, "segments", sceneId);
  mkdirSync(segDir, { recursive: true });
  copyFileSync(placeholderMp3, path.join(segDir, `${sceneId}.mp3`));
  const timingWords = wordsForDuration(words);
  writeFileSync(path.join(segDir, "words.raw.json"), `${JSON.stringify(timingWords, null, 2)}\n`);
  writeFileSync(path.join(segDir, "words.json"), `${JSON.stringify(timingWords, null, 2)}\n`);
  writeToneWav(path.join(segDir, `${sceneId}.wav`), { seconds, baseHz: 140, highBursts, sampleRate, baseAmplitude });
  return { id: sceneId, title: sceneId, role, script: wordsForDuration(words).map((w) => w.word).join(" ") };
}

function acousticFixtureSegments(fixture) {
  return fixture.segments.map((segment) => {
    const root = mkdtempSync(path.join(tmpdir(), `audio-dashboard-${fixture.case}-${segment.id}-`));
    const wavPath = path.join(root, `${segment.id}.wav`);
    writeToneWav(wavPath, {
      seconds: segment.seconds,
      baseHz: segment.baseHz ?? 140,
      baseAmplitude: segment.baseAmplitude ?? 0,
      sampleRate: segment.sampleRate ?? 8000,
      highBursts: segment.highBursts ?? [],
    });
    return {
      id: segment.id,
      role: segment.role,
      wavPath,
      wavBytes: readFileSync(wavPath),
      wordCount: segment.words,
    };
  });
}

function buildDashboard(spec, jobDir, name = spec.id, extraEnv = {}, options = {}) {
  const root = mkdtempSync(path.join(tmpdir(), `audio-dashboard-${name}-`));
  const fixtureBin = writeFixtureFfprobe(root);
  const invocationEnv = { ...process.env };
  delete invocationEnv.NARRATIONLAYER_PRONUNCIATION_FILE;
  Object.assign(invocationEnv, extraEnv);
  const pronunciationRules = loadPronunciationRules({ env: invocationEnv });
  const specPath = path.join(root, "job.json");
  const outputPath = spec.outputPath ?? path.join(root, "repo", "docs.local", "dashboards", `${name}.html`);
  const fullSpec = { ...spec, outputPath };
  if (!options.omitSynthSidecars) {
    for (const scene of fullSpec.scenes ?? []) {
      if (scene.audioWav) continue;
      const spokenPath = path.join(jobDir, "segments", scene.id, `${scene.id}.wav.spoken.txt`);
      if (!existsSync(spokenPath)) {
        mkdirSync(path.dirname(spokenPath), { recursive: true });
        writeFileSync(
          spokenPath,
          normalizeForSpeech(String(scene.script ?? ""), pronunciationRules),
        );
      }
    }
  }
  writeFileSync(specPath, `${JSON.stringify(fullSpec, null, 2)}\n`);
  const result = spawnSync(
    "bun",
    ["scripts/build-dashboard.mjs", "--spec", specPath, "--job-dir", jobDir],
    {
      cwd: skillRoot,
      encoding: "utf8",
      env: {
        ...invocationEnv,
        PATH: `${fixtureBin}${path.delimiter}${invocationEnv.PATH || ""}`,
      },
    },
  );
  return { result, outputPath, specPath };
}

test("fixture coverage: canonical PASS plus the four named regression families", () => {
  expect(greens.map((fx) => fx.file)).toEqual([
    "01-canonical-readalong.json",
    "02-transcript-mentions-estimated.json",
    "03-teleprompter-drift-insync.json"
  ]);
  expect(reds.map((fx) => fx.file)).toEqual([
    "01-wpm-estimated-timing.json",
    "02-placeholder-recap.json",
    "03-golemplaylist-v1.json",
    "04-teleprompter-tail-drift.json",
    "05-acoustic-repeated-token-loop.json",
    "06-acoustic-multi-incident-poisoned-median.json",
    "07-acoustic-high-f0-poisoned-median.json",
    "08-transcript-overtime-substitution.json",
    "09-transcript-webseacut-substitution.json",
    "10-teleprompter-s11a-raw-rendered-drift.json",
    "11-poisoned-take-cache.json",
    "12-acoustic-quiet-onset.json",
    "12-narration-vendor-pre-sync.json"
  ]);
});

test("B14 RED real quiet-onset audio rejects with typed absolute and relative energy metrics", () => {
  const fixture = onsetEnergyReds.find((item) => item.case === "quiet-onset-real-voice-ask");
  expect(fixture).toBeDefined();
  const wavPath = path.join(redDir, fixture.audioFile);
  const wavBytes = readFileSync(wavPath);
  const audioSha256 = createHash("sha256").update(wavBytes).digest("hex");

  expect(fixture.source.provenanceClass).toBe("REAL_DOMAIN_MATCHED_AUDIO");
  expect(fixture.source.surface).toBe("L1 voice_ask playback");
  expect(fixture.source.domainTransfer).toContain("target gate runs on narration BUILD segments");
  expect(fixture.source.parentSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(audioSha256).toBe(fixture.audioSha256);
  expect(fixture.independentMeasurement.historicalPeakReproducedOnRawSource).toBe(true);
  expect(fixture.independentMeasurement.historicalRawSourcePeak).toEqual({
    windowStartSeconds: 1206,
    windowDurationSeconds: 1,
    peakDbfs: -8.131347,
    secondsBeforeFixtureStart: 15,
  });
  expect(fixture.independentMeasurement.adjacentRawSourceOneSecondPeaksDbfs).toEqual({
    1205: -20.900524,
    1206: -8.131347,
    1207: -45.751,
  });
  expect(fixture.independentMeasurement.disclosure).toContain("QA window misalignment, not loudness normalization");

  const result = analyzeOnsetEnergy([{
    id: "quiet-onset",
    role: "narrator",
    wavPath,
    wavBytes,
    wordCount: 5,
  }]);
  const report = formatOnsetEnergyReport(result);

  expect(result.verdict).toBe("REJECTED");
  expect(result.violations.map((violation) => violation.metric)).toEqual(fixture.expectedMetrics);
  expect(result.stats[0].onsetWindowSeconds).toBe(0.75);
  expect(result.stats[0].onsetRmsDbfs).toBeCloseTo(fixture.independentMeasurement.onsetRmsDbfs, 3);
  expect(result.stats[0].segmentPeakDbfs).toBeCloseTo(fixture.independentMeasurement.segmentPeakDbfs, 3);
  expect(result.stats[0].onsetPeakDeltaDb).toBeCloseTo(fixture.independentMeasurement.onsetPeakDeltaDb, 3);
  for (const violation of result.violations) {
    expect(violation).toMatchObject({ segment: "quiet-onset", role: "narrator" });
    expect(violation.value).toBeNumber();
    expect(violation.threshold).toBeNumber();
    expect(violation.evidence).toContain("onsetRmsDbfs=");
  }
  expect(report).toContain("ONSET_ENERGY");
  expect(report).toContain("--resynth-scene quiet-onset --no-cache");
  expect(report).toContain("then rebuild");
});

test("B14 multichannel onset energy uses a non-cancelling full-level downmix", () => {
  const root = mkdtempSync(path.join(tmpdir(), "audio-dashboard-b14-stereo-"));
  const cases = [
    { id: "right-channel-speech", leftAmplitude: 0, rightAmplitude: 0.55 },
    { id: "opposite-polarity-speech", leftAmplitude: 0.55, rightAmplitude: -0.55 },
  ];

  for (const fixture of cases) {
    const wavPath = path.join(root, `${fixture.id}.wav`);
    writeStereoToneWav(wavPath, { seconds: 1, ...fixture });
    const result = analyzeOnsetEnergy([{
      id: fixture.id,
      role: "host",
      wavPath,
      wavBytes: readFileSync(wavPath),
    }]);

    expect(result.verdict).toBe("PASS");
    expect(result.stats[0].onsetRmsDbfs).toBeCloseTo(-8.2, 1);
    expect(result.stats[0].onsetPeakDeltaDb).toBeLessThan(ONSET_ENERGY_DEFAULTS.maxPeakDeltaDb);
  }
});

test("B14 calibration summary reports every non-PASS corpus scene as an unexpected reject", async () => {
  const { summarizeOnsetCalibrationRows } = await import("./generate-onset-energy-calibration.mjs");
  const summary = summarizeOnsetCalibrationRows([
    { id: "clean-a", verdict: "PASS" },
    { id: "quiet-b", verdict: "REJECTED" },
  ]);

  expect(summary).toEqual({
    sceneCount: 2,
    pass: 1,
    rejected: 1,
    unexpectedRejects: ["quiet-b"],
  });
});

test("B14 33-scene narration calibration receipt has zero onset-energy false trips", () => {
  const receipt = JSON.parse(readFileSync(onsetEnergyCalibrationPath, "utf8"));
  const expectedSceneIds = [
    "s1q", "s1a", "s2q", "s2a", "s3q", "s3a", "s4q", "s4a", "s5q", "s5a", "s6q",
    "s6a", "s7q", "s7a", "s8q", "s8a", "s9q", "s9a", "s10q", "s10a", "s11q", "s11a",
    "s11b", "s12q", "s12a", "s12m", "s12b", "s13q", "s13a", "s13b", "s14q", "s14a", "s14b",
  ];

  expect(receipt.version).toBe(1);
  expect(receipt.kind).toBe("ONSET_ENERGY_CALIBRATION");
  expect(receipt.source).toMatchObject({
    provenanceClass: "REAL_NARRATION_CORPUS",
    jobId: "fable-blind-weave-2026-07-15",
    analyzer: "analyzeOnsetEnergy",
  });
  expect(receipt.source.wavCorpusSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(receipt.gateConfig).toEqual(ONSET_ENERGY_DEFAULTS);
  expect(receipt.summary).toEqual({
    sceneCount: 33,
    pass: 33,
    rejected: 0,
    unexpectedRejects: [],
  });
  expect(receipt.scenes.map((scene) => scene.id)).toEqual(expectedSceneIds);
  expect(new Set(receipt.scenes.map((scene) => scene.id)).size).toBe(expectedSceneIds.length);

  for (const scene of receipt.scenes) {
    expect(Object.keys(scene).sort()).toEqual([
      "classification",
      "id",
      "onsetPeakDeltaDb",
      "onsetRmsDbfs",
      "onsetWindowSeconds",
      "segmentPeakDbfs",
      "verdict",
      "violations",
      "wavBasename",
      "wavSha256",
    ]);
    expect(scene.classification).toBe("CLEAN");
    expect(scene.wavBasename).toBe(`${scene.id}.wav`);
    expect(scene.wavSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(scene.onsetWindowSeconds).toBe(0.75);
    expect(scene.onsetRmsDbfs).toBeGreaterThanOrEqual(ONSET_ENERGY_DEFAULTS.minRmsDbfs);
    expect(scene.onsetPeakDeltaDb).toBeLessThanOrEqual(ONSET_ENERGY_DEFAULTS.maxPeakDeltaDb);
    expect(scene.segmentPeakDbfs).toBeNumber();
    expect(scene.verdict).toBe("PASS");
    expect(scene.violations).toEqual([]);
  }

  const recomputedCorpusSha256 = createHash("sha256")
    .update(JSON.stringify(receipt.scenes.map((scene) => [scene.id, scene.wavSha256])))
    .digest("hex");
  expect(receipt.source.wavCorpusSha256).toBe(recomputedCorpusSha256);
  expect(Math.min(...receipt.scenes.map((scene) => scene.onsetRmsDbfs))).toBeCloseTo(-26.031, 2);
  expect(Math.max(...receipt.scenes.map((scene) => scene.onsetPeakDeltaDb))).toBeCloseTo(22.794, 2);
  expect(JSON.stringify(receipt)).not.toMatch(/\/(?:Users|home|private|tmp)\//);
  expect(JSON.stringify(receipt)).not.toMatch(/[A-Za-z]:[\\/]/);
});

for (const fixture of transcriptReds) {
  test(`D6b RED ${fixture.file} (${fixture.specimen}) -> REJECTED ${fixture.violation}`, () => {
    const segment = fixture.transcriptFidelity.segments[0];
    const rawWordsSha256 = createHash("sha256").update(JSON.stringify(segment.rawWords)).digest("hex");
    const result = analyzeTranscriptFidelity(fixture.transcriptFidelity);
    const report = formatTranscriptFidelityReport(result);

    expect(fixture.provenanceClass).toBe("PROVEN_VERBATIM");
    expect(fixture.source.kind).toBe("real-deterministic-decode");
    expect(fixture.source.repeatedDecodeCount).toBe(3);
    expect(rawWordsSha256).toBe(fixture.source.rawWordsSha256);
    expect(result.verdict).toBe("REJECTED");
    expect(result.violations.map((violation) => violation.metric)).toContain(fixture.violation);
    expect(report).toContain(`segment=${fixture.transcriptFidelity.segments[0].id}`);
    expect(report).toContain(`metric=${fixture.violation}`);
    expect(report).toContain("value=");
    expect(report).toContain("threshold=");
    expect(report).toContain("evidence=");
    expect(report).toContain("runbook=");
  });
}

test("D6d poisoned frozen take is purged without deleting its clean sibling", () => {
  const fixture = reds.find((item) => item.file === "11-poisoned-take-cache.json");
  const root = mkdtempSync(path.join(tmpdir(), "audio-dashboard-d6d-cache-"));
  const cacheDir = path.join(root, "tts-cache");
  mkdirSync(cacheDir, { recursive: true });
  const poisonedPath = path.join(cacheDir, `${fixture.cacheKey}.wav`);
  const cleanPath = path.join(cacheDir, `${fixture.cleanSiblingKey}.wav`);
  const incidentExtraction = Buffer.from(fixture.portableExtraction.base64, "base64");
  expect(incidentExtraction).toHaveLength(fixture.portableExtraction.bytes);
  expect(createHash("sha256").update(incidentExtraction).digest("hex")).toBe(fixture.portableExtraction.sha256);
  writeFileSync(poisonedPath, incidentExtraction);
  writeFileSync(cleanPath, "accepted-clean-take");
  const cacheReceiptPath = path.join(root, `${fixture.segment}.wav.cache.json`);
  writeFileSync(cacheReceiptPath, `${JSON.stringify({ version: 1, cacheKey: fixture.cacheKey }, null, 2)}\n`);

  const receipts = purgeRejectedTakeCaches({
    artifacts: [{ id: fixture.segment, cacheReceiptPath }],
    rejectedSegments: [fixture.segment],
    cacheDir,
  });

  expect(existsSync(poisonedPath)).toBe(false);
  expect(existsSync(cleanPath)).toBe(true);
  expect(receipts).toHaveLength(1);
  expect(receipts[0]).toMatchObject({ segment: fixture.segment, status: "PURGED", cacheKey: fixture.cacheKey });
  expect(formatCachePurgeReceipt(receipts[0])).toContain(
    `CACHE_PURGE segment=${fixture.segment} status=PURGED key=${fixture.cacheKey}`,
  );
});

test("D6d duplicate rejection records preserve BYO cache protection regardless of order", () => {
  const root = mkdtempSync(path.join(tmpdir(), "audio-dashboard-d6d-byo-dedupe-"));
  const cacheDir = path.join(root, "tts-cache");
  mkdirSync(cacheDir, { recursive: true });
  const staleCacheKey = "f".repeat(64);
  const unrelatedTtsTake = path.join(cacheDir, `${staleCacheKey}.wav`);
  writeFileSync(unrelatedTtsTake, "unrelated prior TTS take");
  const cacheReceiptPath = path.join(root, "scene.wav.cache.json");
  writeFileSync(cacheReceiptPath, `${JSON.stringify({ version: 1, cacheKey: staleCacheKey }, null, 2)}\n`);

  const receipts = purgeRejectedTakeCaches({
    artifacts: [{ id: "scene", cacheReceiptPath }],
    rejectedSegments: [{ segment: "scene", sourceKind: "BYO" }, "scene"],
    cacheDir,
  });

  expect(existsSync(unrelatedTtsTake)).toBe(true);
  expect(receipts).toEqual([{
    segment: "scene",
    status: "SKIP",
    evidence: "BYO source is not managed by the TTS frozen-take cache",
  }]);
});

test("D6d vendored TTS runner writes the cache key receipt even for no-cache rerolls", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "audio-dashboard-d6d-runner-receipt-"));
  const output = path.join(root, "scene.wav");
  const cacheKey = "7ec0c72a437210707fd0334f763b251b4360b0a49fb7eef582bb8b00dbb844dc";

  const receiptPath = await writeTakeCacheReceipt(output, cacheKey, { cacheEnabled: false });

  expect(receiptPath).toBe(`${output}.cache.json`);
  expect(JSON.parse(readFileSync(receiptPath, "utf8"))).toEqual({
    version: 1,
    cacheKey,
    cacheEnabled: false,
  });
});

test("D6d failed TTS attempt clears a stale cache binding without deleting the stale WAV", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "audio-dashboard-d6d-failed-reroll-"));
  const output = path.join(root, "scene.wav");
  const staleKey = "a".repeat(64);
  writeFileSync(output, "stale wav remains until a successful replacement");
  await writeTakeCacheReceipt(output, staleKey, { cacheEnabled: true });

  await clearTakeCacheReceipt(output);

  expect(existsSync(output)).toBe(true);
  expect(existsSync(`${output}.cache.json`)).toBe(false);
});

test("D6b matched raw transcript passes without repair masking", () => {
  const result = analyzeTranscriptFidelity({
    segments: [
      {
        id: "matched",
        script: "raw transcript matches the script",
        rawWords: ["raw", "transcript", "matches", "the", "script"].map((word, index) => ({
          word,
          start: index * 0.2,
          end: index * 0.2 + 0.15,
        })),
      },
    ],
  });

  expect(result.verdict).toBe("PASS");
  expect(result.violations).toEqual([]);
});

test("D6b adjacent material substitutions cannot erase each other's rejection", () => {
  const result = analyzeTranscriptFidelity({
    segments: [{
      id: "adjacent-material-errors",
      script: "before overnight websocket after",
      rawWords: ["before", "Overtime,", "WebSeaCut", "after"].map((word, index) => ({
        index,
        word,
        start: index * 0.5,
        end: index * 0.5 + 0.4,
      })),
    }],
  });

  expect(result.verdict).toBe("REJECTED");
  expect(result.violations.map((violation) => violation.metric)).toEqual(["PHONEME_CRITICAL_SUBSTITUTION"]);
  expect(result.violations[0].evidence).toContain('raw="Overtime,"');
  expect(result.violations[0].evidence).toContain('raw="WebSeaCut"');
});

test("D6b calibration summary treats an absent expected incident as missed", async () => {
  const { summarizeCalibrationRows } = await import("./generate-transcript-fidelity-calibration.mjs");
  const summary = summarizeCalibrationRows(
    [
      { id: "clean", classification: "CLEAN", verdict: "PASS" },
      { id: "s9q", classification: "INCIDENT", verdict: "REJECTED" },
    ],
    ["s9q", "s13a"],
  );

  expect(summary).toEqual({
    sceneCount: 2,
    cleanExpected: 1,
    pass: 1,
    rejected: 1,
    unexpectedRejects: [],
    missedIncidents: ["s13a"],
  });
});

test("D6b 33-scene real-decode calibration receipt passes 31 clean scenes and rejects only the incidents", () => {
  const receipt = JSON.parse(readFileSync(transcriptCalibrationPath, "utf8"));
  const expectedSceneIds = [
    "s1q", "s1a", "s2q", "s2a", "s3q", "s3a", "s4q", "s4a", "s5q", "s5a", "s6q",
    "s6a", "s7q", "s7a", "s8q", "s8a", "s9q", "s9a", "s10q", "s10a", "s11q", "s11a",
    "s11b", "s12q", "s12a", "s12m", "s12b", "s13q", "s13a", "s13b", "s14q", "s14a", "s14b",
  ];
  const incidentFixtures = new Map(
    transcriptReds.map((fixture) => [fixture.source.segment, fixture.source.rawWordsSha256]),
  );
  const incidentEvidence = new Map([
    ["s9q", 'raw="Overtime," expected="overnight" editDistance=4 editRatio=0.444 lengthRatio=0.889 exactAnchors=2'],
    ["s13a", 'raw="WebSeaCut" expected="websocket" editDistance=4 editRatio=0.444 lengthRatio=1.000 exactAnchors=2'],
  ]);

  expect(receipt.kind).toBe("TRANSCRIPT_FIDELITY_CALIBRATION");
  expect(receipt.source.provenanceClass).toBe("REAL_DETERMINISTIC_DECODE");
  expect(receipt.source.jobId).toBe("fable-blind-weave-2026-07-15");
  expect(receipt.source.decoder).toBe("runWhisperCliWordTimings");
  expect(receipt.source.incidentRepeatCount).toBe(3);
  expect(receipt.source.whisperModel).toBe("ggml-large-v3-turbo.bin");
  expect(receipt.source.rawCorpusSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(receipt.gateConfig).toEqual(TRANSCRIPT_FIDELITY_DEFAULTS);
  expect(receipt.expectedIncidents).toEqual(["s9q", "s13a"]);
  expect(receipt.summary).toEqual({
    sceneCount: 33,
    cleanExpected: 31,
    pass: 31,
    rejected: 2,
    unexpectedRejects: [],
    missedIncidents: [],
  });
  expect(receipt.scenes.map((scene) => scene.id)).toEqual(expectedSceneIds);
  expect(new Set(receipt.scenes.map((scene) => scene.id)).size).toBe(expectedSceneIds.length);
  for (const scene of receipt.scenes) {
    expect(Object.keys(scene).sort()).toEqual([
      "classification", "id", "rawWordCount", "rawWordsSha256", "scriptWordCount", "verdict", "violations", "wavBasename",
    ]);
    expect(scene.wavBasename).toBe(`${scene.id}.wav`);
    expect(scene.scriptWordCount).toBeInteger();
    expect(scene.scriptWordCount).toBeGreaterThan(0);
    expect(scene.rawWordCount).toBeInteger();
    expect(scene.rawWordCount).toBeGreaterThan(0);
    expect(scene.rawWordsSha256).toMatch(/^[a-f0-9]{64}$/);
    const isIncident = incidentEvidence.has(scene.id);
    expect(scene.classification).toBe(isIncident ? "INCIDENT" : "CLEAN");
    if (!isIncident) {
      expect(scene.verdict).toBe("PASS");
      expect(scene.violations).toEqual([]);
    } else {
      expect(scene.verdict).toBe("REJECTED");
      expect(scene.violations).toEqual([
        {
          segment: scene.id,
          metric: "PHONEME_CRITICAL_SUBSTITUTION",
          value: 4,
          threshold: 4,
          evidence: incidentEvidence.get(scene.id),
        },
      ]);
    }
  }
  const recomputedCorpusSha256 = createHash("sha256")
    .update(JSON.stringify(receipt.scenes.map((scene) => [scene.id, scene.rawWordsSha256])))
    .digest("hex");
  expect(receipt.source.rawCorpusSha256).toBe(recomputedCorpusSha256);
  expect(receipt.scenes.filter((scene) => scene.verdict === "REJECTED").map((scene) => scene.id)).toEqual(["s9q", "s13a"]);
  for (const [segment, rawWordsSha256] of incidentFixtures) {
    const row = receipt.scenes.find((scene) => scene.id === segment);
    expect(row.rawWordsSha256).toBe(rawWordsSha256);
    expect(row.violations.map((violation) => violation.metric)).toEqual(["PHONEME_CRITICAL_SUBSTITUTION"]);
  }
  expect(JSON.stringify(receipt)).not.toMatch(/\/(?:Users|home|private|tmp)\//);
  expect(JSON.stringify(receipt)).not.toMatch(/[A-Za-z]:[\\/]/);
});

test("D6b script-less BYO scene rejects with its own metric and actionable runbook", () => {
  const result = analyzeTranscriptFidelity({
    segments: [
      {
        id: "scriptless-byo",
        rawWords: [{ index: 0, word: "recorded", start: 0.1, end: 0.4, confidence: 0.99 }],
      },
    ],
  });
  const report = formatTranscriptFidelityReport(result);

  expect(result.verdict).toBe("REJECTED");
  expect(result.violations.map((violation) => violation.metric)).toEqual(["SCRIPTLESS_SCENE_UNSUPPORTED"]);
  expect(report).toContain("add `script` to the scene");
  expect(report).toContain("NOT_APPLICABLE verdict class is filed as a spec question");
  expect(report).not.toContain("--resynth-scene scriptless-byo");
});

test("D6a persists raw Whisper words separately from repaired display words", () => {
  const segmentDir = mkdtempSync(path.join(tmpdir(), "audio-dashboard-d6a-raw-"));
  const rawWords = [{ index: 0, word: "overn", start: 0.1, end: 0.5, confidence: 0.72 }];
  const repairedWords = [{ index: 0, word: "overnight", start: 0.1, end: 0.5, confidence: 0.72 }];

  const paths = writeWordTimingArtifacts(segmentDir, { rawWords, repairedWords });

  expect(JSON.parse(readFileSync(paths.rawWordsPath, "utf8"))).toEqual(rawWords);
  expect(JSON.parse(readFileSync(paths.wordsPath, "utf8"))).toEqual(repairedWords);
  expect(paths.rawWordsPath).toBe(path.join(segmentDir, "words.raw.json"));
  expect(paths.wordsPath).toBe(path.join(segmentDir, "words.json"));
});

test("D6d BYO audio clears a stale TTS cache receipt before BUILD can purge the wrong take", () => {
  const root = mkdtempSync(path.join(tmpdir(), "audio-dashboard-d6d-byo-stale-receipt-"));
  const wavPath = path.join(root, "scene.wav");
  const receiptPath = `${wavPath}.cache.json`;
  writeFileSync(wavPath, "byo-audio");
  writeFileSync(receiptPath, `${JSON.stringify({ version: 1, cacheKey: "a".repeat(64) })}\n`);

  clearTakeCacheReceiptForByo(wavPath);

  expect(existsSync(receiptPath)).toBe(false);
});

test("receipts report an invalid narration vendor manifest as unstamped", () => {
  const root = mkdtempSync(path.join(tmpdir(), "audio-dashboard-invalid-vendor-stamp-"));
  const vendorDir = path.join(root, "vendor", "narrationlayer");
  mkdirSync(vendorDir, { recursive: true });
  writeFileSync(
    path.join(vendorDir, "VENDOR-VERSION"),
    `${JSON.stringify({
      schemaVersion: 1,
      vendor: "narrationlayer",
      upstream: { repository: "EtanHey/narrationlayer", commit: "a".repeat(40) },
      pairs: [],
    })}\n`,
  );
  try {
    expect(readNarrationVendorStamp(root)).toBe("unstamped");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("receipts convention: PASS build emits portable schema-v1 rows for all four BUILD gates", () => {
  const root = mkdtempSync(path.join(tmpdir(), "audio-dashboard-receipts-pass-"));
  const jobDir = path.join(root, "job");
  const words = [
    { word: "alpha", start: 0.05, end: 0.42 },
    { word: "beta", start: 0.45, end: 0.80 },
  ];
  writeSegment(jobDir, "scene-a", words);

  const { result, outputPath } = buildDashboard({
    id: "receipts-pass",
    title: "Receipts PASS",
    scenes: [{ id: "scene-a", role: "host", audioWav: "fixture.wav", script: "alpha beta" }],
  }, jobDir, "receipts-pass");

  expect(result.status).toBe(0);
  const receiptsPath = outputPath.replace(/\.html$/, ".receipts.json");
  expect(existsSync(receiptsPath)).toBe(true);
  const html = readFileSync(outputPath, "utf8");
  const receipts = JSON.parse(readFileSync(receiptsPath, "utf8"));
  expect(receipts.version).toBe(1);
  expect(receipts.artifact).toBe(path.basename(outputPath));
  expect(receipts.artifactSha256).toBe(createHash("sha256").update(html).digest("hex"));
  expect(receipts.jobId).toBe("receipts-pass");
  expect(receipts.pipeline).toEqual({
    name: "audio-dashboard",
    vendorStamp: readNarrationVendorStamp(skillRoot),
  });
  expect(receipts.engine.substrate).toBe("byo-wav");
  expect(path.posix.isAbsolute(receipts.engine.whisperModel) || path.win32.isAbsolute(receipts.engine.whisperModel)).toBe(false);
  expect(receipts.gates.map((row) => `${row.gate}:${row.stage}:${row.verdict}`)).toEqual([
    "voice-role:BUILD:PASS",
    "transcript-fidelity:BUILD:PASS",
    "acoustic:BUILD:PASS",
    "onset-energy:BUILD:PASS",
    "teleprompter-drift:BUILD:PASS",
  ]);
  expect(receipts.gates.every((row) => row.violations.length === 0 && Number.isFinite(Date.parse(row.ranAt)))).toBe(true);
  expect(receipts.purges).toEqual([]);
  const portableStrings = [];
  JSON.stringify(receipts, (_key, value) => {
    if (typeof value === "string") portableStrings.push(value);
    return value;
  });
  expect(portableStrings.filter((value) => path.posix.isAbsolute(value) || path.win32.isAbsolute(value))).toEqual([]);
});

test("ruled scene deferral is visible beside response notes and portable in BUILD receipts without a fake gate PASS", () => {
  const root = mkdtempSync(path.join(tmpdir(), "audio-dashboard-ruled-deferral-"));
  const jobDir = path.join(root, "job");
  const words = [
    { word: "alpha", start: 0.05, end: 0.42 },
    { word: "beta", start: 0.45, end: 0.80 },
  ];
  writeSegment(jobDir, "scene-a", words);

  const deferral = {
    id: "s11a",
    status: "DEFERRED",
    reason: "31 of 31 raw tails are complete; rate-normalized D6c refinement is pending.",
    ruling: "laneD-ruling-2026-07-18",
  };
  const shippedScenes = [{ id: "scene-a", role: "host", audioWav: "fixture.wav", script: "alpha beta" }];
  expect(shippedScenes.map((scene) => scene.id)).not.toContain(deferral.id);
  const { result, outputPath } = buildDashboard({
    id: "ruled-deferral",
    title: "Ruled deferral",
    scenes: shippedScenes,
    deferredScenes: [deferral],
  }, jobDir, "ruled-deferral");

  expect(result.status).toBe(0);
  const html = readFileSync(outputPath, "utf8");
  expect(html).toContain('data-deferred-scene="s11a"');
  expect(html).toContain("31 of 31 raw tails are complete; rate-normalized D6c refinement is pending.");
  expect(html).toContain("laneD-ruling-2026-07-18");
  expect(html).toContain('var LS_KEY = "dbx:ruled-deferral.notes";');
  expect(html).toContain('var RATE_KEY = "dbx:ruled-deferral.rate";');
  expect((html.match(/\blocalStorage\b/g) || []).length).toBe(
    (html.match(/\blocalStorage\.(?:getItem|setItem|removeItem)\b/g) || []).length,
  );
  expect((html.match(/<script\b/gi) || []).length).toBe(
    (html.match(/<\/script\s*>/gi) || []).length,
  );
  expect(html).toContain(".pa-bar select#pa-speed{font-size:16px");
  expect(html).toContain(".note-area{width:100%;min-height:64px;resize:vertical;background:#060d18;color:var(--txt);border:1px solid var(--line);border-radius:10px;\n    padding:10px 11px;font:16px/1.55 inherit");

  const receipts = JSON.parse(readFileSync(outputPath.replace(/\.html$/, ".receipts.json"), "utf8"));
  expect(receipts.deferrals).toEqual([deferral]);
  expect(receipts.gates.map((row) => `${row.gate}:${row.stage}:${row.verdict}`)).toEqual([
    "voice-role:BUILD:PASS",
    "transcript-fidelity:BUILD:PASS",
    "acoustic:BUILD:PASS",
    "onset-energy:BUILD:PASS",
    "teleprompter-drift:BUILD:PASS",
  ]);
  expect(JSON.stringify(receipts.gates)).not.toContain("s11a");
});

test("BUILD rejects non-string deferred scene fields before rendering", () => {
  const baseDeferral = {
    id: "s11a",
    status: "DEFERRED",
    reason: "D6c refinement is pending.",
    ruling: "laneD-ruling-2026-07-18",
  };
  for (const field of ["id", "status", "reason", "ruling"]) {
    const { result } = buildDashboard({
      id: `invalid-deferral-${field}`,
      title: "Invalid deferral",
      scenes: [{ id: "scene-a", role: "host", audioWav: "fixture.wav", script: "alpha beta" }],
      deferredScenes: [{ ...baseDeferral, [field]: 7 }],
    }, mkdtempSync(path.join(tmpdir(), "audio-dashboard-invalid-deferral-job-")));

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`spec.deferredScenes[0].${field} must be a string`);
  }
});

test("render-v4 rejects a provided non-array deferredScenes value", () => {
  expect(() => renderV4({
    title: "Invalid direct render deferral",
    scenes: [{ id: "scene-a", title: "Scene A", script: "alpha beta" }],
    deferredScenes: { id: "s11a", status: "DEFERRED", reason: "pending", ruling: "D6c" },
  })).toThrow("deferredScenes must be an array");
});

test("B13 BUILD maps approved synth timings to authored display tokens", () => {
  const root = mkdtempSync(path.join(tmpdir(), "audio-dashboard-b13-build-alias-"));
  const jobDir = path.join(root, "job");
  const rawWords = [
    { word: "pull", start: 0.05, end: 0.4 },
    { word: "request", start: 0.42, end: 0.85 },
  ];
  const displayWords = [
    { word: "P", start: 0.05, end: 0.4 },
    { word: "R", start: 0.42, end: 0.85 },
  ];
  writeSegment(jobDir, "expanded", displayWords, placeholderMp3, rawWords);
  writeFileSync(
    path.join(jobDir, "segments", "expanded", "expanded.wav.spoken.txt"),
    "pull request",
  );

  const { result, outputPath } = buildDashboard({
    id: "b13-build-alias",
    title: "B13 build alias",
    scenes: [{ id: "expanded", title: "Expanded", script: "P R" }],
  }, jobDir, "b13-build-alias");

  expect(result.status).toBe(0);
  const cue = tpdataFromHtml(readFileSync(outputPath, "utf8")).expanded.cues[0];
  expect(cue.text).toBe("P R");
  expect(cue.words).toEqual(displayWords);
  const receipts = JSON.parse(readFileSync(outputPath.replace(/\.html$/, ".receipts.json"), "utf8"));
  expect(receipts.gates.map((gate) => `${gate.gate}:${gate.verdict}`)).toEqual([
    "voice-role:PASS",
    "transcript-fidelity:PASS",
    "acoustic:PASS",
    "onset-energy:PASS",
    "teleprompter-drift:PASS",
  ]);
  expect(receipts.gates.find((gate) => gate.gate === "teleprompter-drift")?.derivedAliases).toEqual([
    { segment: "expanded", term: "P R", spoken: "pull request" },
  ]);
});

test("B13 BUILD rejects stale synth provenance before aliases can absorb the real s9q substitution", () => {
  const fixture = reds.find((item) => item.file === "08-transcript-overtime-substitution.json");
  const segment = fixture.transcriptFidelity.segments[0];
  const root = mkdtempSync(path.join(tmpdir(), "audio-dashboard-b13-stale-spoken-"));
  const jobDir = path.join(root, "job");
  const displayWords = segment.script.split(/\s+/).map((word, index, all) => ({
    word,
    start: Number((0.02 + index * (0.82 / all.length)).toFixed(3)),
    end: Number((0.02 + (index + 0.7) * (0.82 / all.length)).toFixed(3)),
  }));
  writeSegment(jobDir, segment.id, displayWords, placeholderMp3, segment.rawWords);
  writeFileSync(
    path.join(jobDir, "segments", segment.id, `${segment.id}.wav.spoken.txt`),
    fixture.staleSynthProvenance.sidecarText,
  );

  const { result, outputPath } = buildDashboard({
    id: "b13-stale-spoken",
    title: fixture.specimen,
    scenes: [{ id: segment.id, title: segment.id, script: segment.script }],
  }, jobDir, "b13-stale-spoken");

  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain(`metric=${fixture.staleSynthProvenance.expectedMetric}`);
  expect(result.stderr).toContain(fixture.staleSynthProvenance.runbook);
  expect(existsSync(outputPath)).toBe(false);
  const receiptsPath = outputPath.replace(/\.html$/, ".receipts.json");
  expect(existsSync(receiptsPath)).toBe(true);
  const receipts = JSON.parse(readFileSync(receiptsPath, "utf8"));
  expect(receipts.gates.map((row) => `${row.gate}:${row.verdict}`)).toEqual([
    "voice-role:PASS",
    "transcript-fidelity:REJECT",
  ]);
  expect(receipts.gates.find((row) => row.gate === "transcript-fidelity")).toMatchObject({
    gate: "transcript-fidelity",
    stage: "BUILD",
    verdict: "REJECT",
    runbook: expect.stringContaining(fixture.staleSynthProvenance.runbook),
  });
  expect(receipts.gates.find((row) => row.gate === "transcript-fidelity").violations[0]).toMatchObject({
    segment: segment.id,
    metric: fixture.staleSynthProvenance.expectedMetric,
    value: 0,
    threshold: 1,
  });
  expect(receipts.gates.find((row) => row.gate === "transcript-fidelity").violations[0].evidence).toContain("byteEqual=false");
});

test("B13 BUILD rejects pronunciation rule drift after synthesis", () => {
  const root = mkdtempSync(path.join(tmpdir(), "audio-dashboard-b13-rule-drift-"));
  const jobDir = path.join(root, "job");
  const displayWords = [
    { word: "P", start: 0.05, end: 0.4 },
    { word: "R", start: 0.42, end: 0.85 },
  ];
  const rawWords = [
    { word: "pull", start: 0.05, end: 0.4 },
    { word: "request", start: 0.42, end: 0.85 },
  ];
  writeSegment(jobDir, "rule-drift", displayWords, placeholderMp3, rawWords);
  writeFileSync(
    path.join(jobDir, "segments", "rule-drift", "rule-drift.wav.spoken.txt"),
    "pull request",
  );
  const changedRules = path.join(root, "changed-pronunciation.yaml");
  writeFileSync(changedRules, "acronyms:\n  PR: \"peer review\"\n");

  const { result, outputPath } = buildDashboard({
    id: "b13-rule-drift",
    title: "B13 rule drift",
    scenes: [{ id: "rule-drift", title: "Rule drift", script: "P R" }],
  }, jobDir, "b13-rule-drift", { NARRATIONLAYER_PRONUNCIATION_FILE: changedRules });

  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("metric=SYNTH_PROVENANCE_STALE");
  expect(result.stderr).toContain("rerun synth-segments");
  const receipts = JSON.parse(readFileSync(outputPath.replace(/\.html$/, ".receipts.json"), "utf8"));
  expect(receipts.gates.find((row) => row.gate === "transcript-fidelity").violations[0]).toMatchObject({
    segment: "rule-drift",
    metric: "SYNTH_PROVENANCE_STALE",
    value: 0,
    threshold: 1,
  });
});

test("B13 BUILD rejects a synthesized scene without synth provenance", () => {
  const root = mkdtempSync(path.join(tmpdir(), "audio-dashboard-b13-missing-spoken-"));
  const jobDir = path.join(root, "job");
  const words = [
    { word: "alpha", start: 0.05, end: 0.4 },
    { word: "beta", start: 0.42, end: 0.85 },
  ];
  writeSegment(jobDir, "missing-spoken", words);

  const { result, outputPath } = buildDashboard({
    id: "b13-missing-spoken",
    title: "B13 missing spoken",
    scenes: [{ id: "missing-spoken", title: "Missing", script: "alpha beta" }],
  }, jobDir, "b13-missing-spoken", {}, { omitSynthSidecars: true });

  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("required synth-input sidecar is missing");
  expect(result.stderr).toContain("metric=MISSING_SYNTH_PROVENANCE_SERIES");
  expect(result.stderr).toContain("rerun synth-segments");
  const receiptsPath = outputPath.replace(/\.html$/, ".receipts.json");
  expect(existsSync(receiptsPath)).toBe(true);
  const receipts = JSON.parse(readFileSync(receiptsPath, "utf8"));
  expect(receipts.gates.map((row) => `${row.gate}:${row.verdict}`)).toEqual([
    "voice-role:PASS",
    "transcript-fidelity:REJECT",
  ]);
  expect(receipts.gates.find((row) => row.gate === "transcript-fidelity")).toMatchObject({
    gate: "transcript-fidelity",
    stage: "BUILD",
    verdict: "REJECT",
    runbook: expect.stringContaining("rerun synth-segments"),
  });
  expect(receipts.gates.find((row) => row.gate === "transcript-fidelity").violations[0]).toMatchObject({
    segment: "missing-spoken",
    metric: "MISSING_SYNTH_PROVENANCE_SERIES",
    value: 0,
    threshold: 1,
  });
  expect(receipts.gates.find((row) => row.gate === "transcript-fidelity").violations[0].evidence).toContain("sidecarPresent=false");
  expect(receipts.gates.find((row) => row.gate === "transcript-fidelity").violations[0].evidence).toContain("expectedBytes=10 actualBytes=0");
  expect(receipts.gates.find((row) => row.gate === "transcript-fidelity").violations[0].evidence).toMatch(/expectedSha256=[a-f0-9]{64}/);
  expect(receipts.gates.find((row) => row.gate === "transcript-fidelity").violations[0].evidence).toContain("actualSha256=ABSENT");
});

test("audio-dashboard BUILD tests ignore ambient pronunciation overlays", () => {
  const root = mkdtempSync(path.join(tmpdir(), "audio-dashboard-b13-ambient-overlay-"));
  const jobDir = path.join(root, "job");
  const changedRules = path.join(root, "ambient-pronunciation.yaml");
  writeFileSync(changedRules, "acronyms:\n  PR: \"peer review\"\n");
  writeSegment(jobDir, "ambient-overlay", [
    { word: "pull", start: 0.05, end: 0.4 },
    { word: "request", start: 0.42, end: 0.85 },
  ]);
  const previousOverlay = process.env.NARRATIONLAYER_PRONUNCIATION_FILE;
  process.env.NARRATIONLAYER_PRONUNCIATION_FILE = changedRules;

  try {
    const { result } = buildDashboard({
      id: "b13-ambient-overlay",
      title: "B13 ambient overlay isolation",
      scenes: [{ id: "ambient-overlay", title: "Ambient overlay", script: "P R" }],
    }, jobDir, "b13-ambient-overlay");
    expect(result.status).toBe(0);
  } finally {
    if (previousOverlay === undefined) delete process.env.NARRATIONLAYER_PRONUNCIATION_FILE;
    else process.env.NARRATIONLAYER_PRONUNCIATION_FILE = previousOverlay;
  }
});

test("B14 BUILD rejection writes the onset row, purges the frozen take, and withholds HTML", () => {
  const fixture = onsetEnergyReds.find((item) => item.case === "quiet-onset-real-voice-ask");
  const root = mkdtempSync(path.join(tmpdir(), "audio-dashboard-b14-build-"));
  const jobDir = path.join(root, "job");
  const timingWords = [
    { word: "next", start: 0.05, end: 0.20 },
    { word: "item", start: 0.22, end: 0.38 },
    { word: "one", start: 0.40, end: 0.58 },
    { word: "today", start: 0.60, end: 0.82 },
  ];
  writeSegment(jobDir, "quiet-onset", timingWords);
  copyFileSync(
    path.join(redDir, fixture.audioFile),
    path.join(jobDir, "segments", "quiet-onset", "quiet-onset.wav"),
  );

  const cacheKey = "b".repeat(64);
  const home = path.join(root, "home");
  const cacheDir = path.join(home, ".narrationlayer", "tts-cache");
  mkdirSync(cacheDir, { recursive: true });
  const cachedTakePath = path.join(cacheDir, `${cacheKey}.wav`);
  writeFileSync(cachedTakePath, "frozen quiet-onset take");
  writeFileSync(
    path.join(jobDir, "segments", "quiet-onset", "quiet-onset.wav.cache.json"),
    `${JSON.stringify({ version: 1, cacheKey }, null, 2)}\n`,
  );

  const staleOutputPath = path.join(root, "repo", "docs.local", "dashboards", "b14-quiet-onset.html");
  mkdirSync(path.dirname(staleOutputPath), { recursive: true });
  writeFileSync(staleOutputPath, "stale previously published dashboard");

  const { result, outputPath } = buildDashboard({
    id: "b14-quiet-onset",
    title: "B14 quiet onset",
    outputPath: staleOutputPath,
    scenes: [{
      id: "quiet-onset",
      role: "narrator",
      reference: "narrator-profile",
      script: "next item one today",
    }],
  }, jobDir, "b14-quiet-onset", { HOME: home });

  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("ONSET_ENERGY");
  expect(result.stderr).toContain("ONSET_ENERGY_ABSOLUTE_RMS_DBFS");
  expect(result.stderr).toContain("ONSET_ENERGY_PEAK_DELTA_DB");
  expect(result.stderr).toContain("--resynth-scene quiet-onset --no-cache");
  expect(result.stderr).toContain("CACHE_PURGE segment=quiet-onset status=PURGED");
  expect(existsSync(cachedTakePath)).toBe(false);
  expect(existsSync(outputPath)).toBe(false);

  const receiptsPath = outputPath.replace(/\.html$/, ".receipts.json");
  const receipts = JSON.parse(readFileSync(receiptsPath, "utf8"));
  expect(receipts.gates.map((row) => `${row.gate}:${row.verdict}`)).toEqual([
    "voice-role:PASS",
    "transcript-fidelity:PASS",
    "acoustic:PASS",
    "onset-energy:REJECT",
  ]);
  const onsetRow = receipts.gates.at(-1);
  expect(onsetRow.stage).toBe("BUILD");
  expect(onsetRow.config).toEqual({ windowSeconds: 0.75, minRmsDbfs: -35, maxPeakDeltaDb: 26 });
  expect(onsetRow.violations.map((violation) => violation.metric)).toEqual(fixture.expectedMetrics);
  expect(onsetRow.runbook).toContain("--resynth-scene quiet-onset --no-cache");
  expect(receipts.purges).toEqual([{
    cacheKey,
    segment: "quiet-onset",
    reason: "onset-energy REJECT",
    purgedAt: expect.any(String),
  }]);
});

test("B14 BYO onset rejection instructs replacing the source instead of rerolling a cache", () => {
  const fixture = onsetEnergyReds.find((item) => item.case === "quiet-onset-real-voice-ask");
  const root = mkdtempSync(path.join(tmpdir(), "audio-dashboard-b14-byo-"));
  const jobDir = path.join(root, "job");
  const timingWords = [
    { word: "next", start: 0.05, end: 0.20 },
    { word: "item", start: 0.22, end: 0.38 },
    { word: "one", start: 0.40, end: 0.58 },
    { word: "today", start: 0.60, end: 0.82 },
  ];
  writeSegment(jobDir, "quiet-onset-byo", timingWords);
  copyFileSync(
    path.join(redDir, fixture.audioFile),
    path.join(jobDir, "segments", "quiet-onset-byo", "quiet-onset-byo.wav"),
  );

  const staleCacheKey = "c".repeat(64);
  const home = path.join(root, "home");
  const cacheDir = path.join(home, ".narrationlayer", "tts-cache");
  mkdirSync(cacheDir, { recursive: true });
  const unrelatedTtsTake = path.join(cacheDir, `${staleCacheKey}.wav`);
  writeFileSync(unrelatedTtsTake, "unrelated prior TTS take");
  writeFileSync(
    path.join(jobDir, "segments", "quiet-onset-byo", "quiet-onset-byo.wav.cache.json"),
    `${JSON.stringify({ version: 1, cacheKey: staleCacheKey }, null, 2)}\n`,
  );

  const { result, outputPath } = buildDashboard({
    id: "b14-quiet-onset-byo",
    title: "B14 quiet onset BYO",
    scenes: [{
      id: "quiet-onset-byo",
      role: "narrator",
      audioWav: "quiet-onset-source.wav",
      script: "next item one today",
    }],
  }, jobDir, "b14-quiet-onset-byo", { HOME: home });

  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("Replace or edit the scene audioWav source for quiet-onset-byo");
  expect(result.stderr).not.toContain("--resynth-scene quiet-onset-byo --no-cache");
  expect(result.stderr).not.toContain("CACHE_PURGE segment=quiet-onset-byo status=PURGED");
  expect(existsSync(unrelatedTtsTake)).toBe(true);
  expect(existsSync(outputPath)).toBe(false);

  const receipts = JSON.parse(readFileSync(outputPath.replace(/\.html$/, ".receipts.json"), "utf8"));
  const onsetRow = receipts.gates.at(-1);
  expect(onsetRow).toMatchObject({ gate: "onset-energy", stage: "BUILD", verdict: "REJECT" });
  expect(onsetRow.runbook).toContain("Replace or edit the scene audioWav source for quiet-onset-byo");
  expect(onsetRow.runbook).not.toContain("--no-cache");
  expect(receipts.purges).toEqual([]);
});

test("receipts convention rejects direct and embedded machine-local paths on every platform", () => {
  const root = mkdtempSync(path.join(tmpdir(), "audio-dashboard-receipts-paths-"));
  const outputPath = path.join(root, "portable.html");
  const forbiddenValues = [
    "/srv/audio/take.wav",
    "C:\\repo\\audio\\take.wav",
    "\\\\host\\share\\take.wav",
    "file:///Users/operator/take.wav",
    "input=/home/operator/take.wav",
    "input=C:\\repo\\audio\\take.wav",
    "input:/home/operator/take.wav",
    "input,/home/operator/take.wav",
    "input:C:\\repo\\audio\\take.wav",
    "input,C:\\repo\\audio\\take.wav",
  ];

  for (const evidence of forbiddenValues) {
    const receipts = createBuildReceipts({
      outputPath,
      jobId: "portable",
      spec: { scenes: [{ id: "s1", audioWav: "fixture.wav" }] },
      vendorStamp: "unstamped",
      whisperModel: "ggml-base.bin",
    });
    receipts.gates.push({
      gate: "transcript-fidelity",
      stage: "BUILD",
      verdict: "REJECT",
      config: {},
      violations: [{ segment: "s1", metric: "TAIL_TRUNCATION", value: 1, threshold: 0, evidence }],
      runbook: "rerun the segment",
      ranAt: "2026-07-16T21:00:00Z",
    });
    expect(() => writeBuildReceipts(outputPath, receipts, "candidate")).toThrow("forbidden absolute path");
  }
});

test("missing raw timing removes stale HTML and replaces its PASS sidecar with a typed transcript REJECT", () => {
  const root = mkdtempSync(path.join(tmpdir(), "audio-dashboard-missing-raw-receipt-"));
  const jobDir = path.join(root, "job");
  const outputPath = path.join(root, "repo", "docs.local", "dashboards", "missing-raw.html");
  const words = [
    { word: "alpha", start: 0.05, end: 0.42 },
    { word: "beta", start: 0.45, end: 0.8 },
  ];
  writeSegment(jobDir, "scene-a", words);
  const spec = {
    id: "missing-raw",
    title: "Missing raw",
    outputPath,
    scenes: [{ id: "scene-a", role: "host", audioWav: "fixture.wav", script: "alpha beta" }],
  };
  const first = buildDashboard(spec, jobDir, "missing-raw");
  expect(first.result.status).toBe(0);
  rmSync(path.join(jobDir, "segments", "scene-a", "words.raw.json"));

  const second = buildDashboard(spec, jobDir, "missing-raw");

  expect(second.result.status).not.toBe(0);
  expect(second.result.stderr).toContain("MISSING_RAW_TRANSCRIPT_SERIES");
  const receipts = JSON.parse(readFileSync(outputPath.replace(/\.html$/, ".receipts.json"), "utf8"));
  expect(receipts.gates.map((row) => `${row.gate}:${row.verdict}`)).toEqual([
    "voice-role:PASS",
    "transcript-fidelity:REJECT",
  ]);
  const transcriptRow = receipts.gates.find((row) => row.gate === "transcript-fidelity");
  expect(transcriptRow).toMatchObject({ gate: "transcript-fidelity", stage: "BUILD", verdict: "REJECT" });
  expect(transcriptRow.violations[0]).toMatchObject({ segment: "scene-a", metric: "MISSING_RAW_TRANSCRIPT_SERIES" });
  expect(receipts.artifactSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(existsSync(outputPath)).toBe(false);

  writeFileSync(path.join(jobDir, "segments", "scene-a", "words.raw.json"), "{not-json");
  const invalid = buildDashboard(spec, jobDir, "missing-raw");
  expect(invalid.result.status).not.toBe(0);
  expect(invalid.result.stderr).toContain("MISSING_RAW_TRANSCRIPT_SERIES");
  expect(existsSync(outputPath)).toBe(false);
});

test("teleprompter drift accepts timing-equivalent contraction split and merge blocks", () => {
  const result = analyzeTeleprompterDrift({
    segments: [{
      id: "split-merge",
      transcript: "I'm ready",
      sourceWords: [
        { word: "I'm", start: 0.1, end: 0.4 },
        { word: "ready", start: 0.5, end: 0.9 },
      ],
      renderedWords: [
        { word: "I", start: 0.1, end: 0.2 },
        { word: "am", start: 0.21, end: 0.4 },
        { word: "ready", start: 0.5, end: 0.9 },
      ],
    }],
  });

  expect(result.verdict).toBe("PASS");
  expect(result.violations).toEqual([]);
  expect(result.stats[0].alignedBlockCount).toBe(2);
});

test("teleprompter drift coalesces contraction units after lexical fallback", () => {
  const result = analyzeTeleprompterDrift({
    segments: [{
      id: "lexical-contraction",
      transcript: "lead I'm",
      sourceWords: [
        { word: "lead", start: 0.05, end: 0.4 },
        { word: "I'm", start: 0.5, end: 1.4 },
      ],
      renderedWords: [
        { word: "led", start: 0.05, end: 0.4 },
        { word: "I", start: 0.5, end: 0.8 },
        { word: "am", start: 0.8, end: 1.4 },
      ],
    }],
  }, { minWords: 0, maxUnalignedTokenRatio: 0.5 });

  expect(result.verdict).toBe("PASS");
  expect(result.violations).toEqual([]);
  expect(result.stats[0].alignedBlockCount).toBe(2);
});

test("teleprompter drift measures a tolerated substituted tail word", () => {
  const sourceWords = Array.from({ length: 10 }, (_, index) => ({
    word: index === 9 ? "colour" : `word${index}`,
    start: index * 0.5,
    end: index * 0.5 + 0.4,
  }));
  const renderedWords = sourceWords.map((word, index) => ({
    ...word,
    word: index === 9 ? "color" : word.word,
    ...(index === 9 ? { start: 9, end: 9.4 } : {}),
  }));
  const result = analyzeTeleprompterDrift({
    segments: [{ id: "tail-substitute", transcript: sourceWords.map((word) => word.word).join(" "), sourceWords, renderedWords }],
  }, { minWords: 0 });

  expect(result.verdict).toBe("REJECTED");
  expect(result.violations.map((violation) => violation.code)).toContain("TAIL_WORD_TIMING_DRIFT");
  expect(result.stats[0].maxTailDelta).toBeGreaterThan(4);
});

test("D6c BUILD rejects the shipped s11a raw-vs-rendered drift specimen before HTML emission", () => {
  const fixture = publishDriftReds[0];
  const segment = fixture.teleprompterDrift.segments[0];
  const root = mkdtempSync(path.join(tmpdir(), "audio-dashboard-d6c-drift-"));
  const jobDir = path.join(root, "job");
  writeSegment(jobDir, segment.id, segment.renderedWords, placeholderMp3, segment.sourceWords);

  const { result, outputPath } = buildDashboard({
    id: "d6c-s11a-drift",
    title: fixture.specimen,
    scenes: [{ id: segment.id, role: "theo", audioWav: "s11a.wav", script: segment.transcript }],
  }, jobDir, "d6c-s11a-drift");

  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("TELEPROMPTER_DRIFT");
  expect(result.stderr).toContain("segment=s11a");
  expect(result.stderr).toContain("metric=TAIL_WORD_TIMING_DRIFT");
  expect(result.stderr).toContain(`value=${fixture.expectedAlignedTailDeltaSeconds}`);
  expect(result.stderr).toContain("threshold=0.35");
  expect(result.stderr).toContain("evidence=");
  expect(result.stderr).toContain("runbook=");
  expect(existsSync(outputPath)).toBe(false);
  const receipts = JSON.parse(readFileSync(outputPath.replace(/\.html$/, ".receipts.json"), "utf8"));
  expect(receipts.gates.at(-1)).toMatchObject({ gate: "teleprompter-drift", stage: "BUILD", verdict: "REJECT" });
  expect(receipts.gates.at(-1).violations[0]).toMatchObject({
    segment: "s11a",
    metric: "TAIL_WORD_TIMING_DRIFT",
    value: fixture.expectedAlignedTailDeltaSeconds,
    threshold: 0.35,
  });
  expect(receipts.gates.at(-1).violations[0].evidence).toContain(
    `tailMaxDelta=${fixture.expectedAlignedTailDeltaSeconds.toFixed(3)}s`,
  );
});

for (const fixture of transcriptReds) {
  test(`D6b BUILD rejects repaired words that mask ${fixture.violation}`, () => {
    const root = mkdtempSync(path.join(tmpdir(), `audio-dashboard-d6b-${fixture.violation.toLowerCase()}-`));
    const jobDir = path.join(root, "job");
    const segment = fixture.transcriptFidelity.segments[0];
    const repairedWords = segment.script.split(/\s+/).map((word, index, all) => ({
      word,
      start: Number((0.02 + index * (0.82 / all.length)).toFixed(3)),
      end: Number((0.02 + (index + 0.7) * (0.82 / all.length)).toFixed(3)),
    }));
    writeSegment(jobDir, segment.id, repairedWords, placeholderMp3, segment.rawWords);
    const cacheFixture = reds.find((item) => item.file === "11-poisoned-take-cache.json");
    const home = path.join(root, "home");
    const cacheDir = path.join(home, ".narrationlayer", "tts-cache");
    mkdirSync(cacheDir, { recursive: true });
    const poisonedPath = path.join(cacheDir, `${cacheFixture.cacheKey}.wav`);
    writeFileSync(poisonedPath, Buffer.from(cacheFixture.portableExtraction.base64, "base64"));
    writeFileSync(
      path.join(jobDir, "segments", segment.id, `${segment.id}.wav.cache.json`),
      `${JSON.stringify({ version: 1, cacheKey: cacheFixture.cacheKey }, null, 2)}\n`,
    );

    const { result, outputPath } = buildDashboard({
      id: `d6b-${segment.id}`,
      title: fixture.specimen,
      scenes: [{ id: segment.id, title: segment.id, script: segment.script }],
    }, jobDir, `d6b-${segment.id}`, { HOME: home });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("TRANSCRIPT_FIDELITY");
    expect(result.stderr).toContain(`segment=${segment.id}`);
    expect(result.stderr).toContain(`metric=${fixture.violation}`);
    expect(result.stderr).toContain("value=");
    expect(result.stderr).toContain("threshold=");
    expect(result.stderr).toContain("evidence=");
    expect(result.stderr).toContain("runbook=");
    expect(result.stderr).toContain(`CACHE_PURGE segment=${segment.id} status=PURGED`);
    expect(existsSync(poisonedPath)).toBe(false);
    expect(existsSync(outputPath)).toBe(false);
    const receipts = JSON.parse(readFileSync(outputPath.replace(/\.html$/, ".receipts.json"), "utf8"));
    expect(receipts.artifactSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(receipts.artifactSha256).not.toBe(createHash("sha256").update("").digest("hex"));
    expect(receipts.gates.at(-1)).toMatchObject({ gate: "transcript-fidelity", stage: "BUILD", verdict: "REJECT" });
    expect(receipts.purges).toHaveLength(1);
    expect(receipts.purges[0]).toMatchObject({
      cacheKey: cacheFixture.cacheKey,
      segment: segment.id,
      reason: "transcript-fidelity REJECT",
    });
    expect(Object.keys(receipts.purges[0]).sort()).toEqual(["cacheKey", "purgedAt", "reason", "segment"]);
  });
}

test("BYO transcript-fidelity rejection preserves a stale TTS take and requires source replacement", () => {
  const fixture = transcriptReds.find((item) => item.source.segment === "s9q");
  const segment = fixture.transcriptFidelity.segments[0];
  const root = mkdtempSync(path.join(tmpdir(), "audio-dashboard-transcript-byo-"));
  const jobDir = path.join(root, "job");
  const repairedWords = segment.script.split(/\s+/).map((word, index, all) => ({
    word,
    start: Number((0.02 + index * (0.82 / all.length)).toFixed(3)),
    end: Number((0.02 + (index + 0.7) * (0.82 / all.length)).toFixed(3)),
  }));
  writeSegment(jobDir, segment.id, repairedWords, placeholderMp3, segment.rawWords);

  const staleCacheKey = "e".repeat(64);
  const home = path.join(root, "home");
  const cacheDir = path.join(home, ".narrationlayer", "tts-cache");
  mkdirSync(cacheDir, { recursive: true });
  const unrelatedTtsTake = path.join(cacheDir, `${staleCacheKey}.wav`);
  writeFileSync(unrelatedTtsTake, "unrelated prior TTS take");
  writeFileSync(
    path.join(jobDir, "segments", segment.id, `${segment.id}.wav.cache.json`),
    `${JSON.stringify({ version: 1, cacheKey: staleCacheKey }, null, 2)}\n`,
  );

  const { result, outputPath } = buildDashboard({
    id: "transcript-byo",
    title: "Transcript BYO",
    scenes: [{ id: segment.id, title: segment.id, audioWav: "operator-source.wav", script: segment.script }],
  }, jobDir, "transcript-byo", { HOME: home });

  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("TRANSCRIPT_FIDELITY");
  expect(result.stderr).toContain("PHONEME_CRITICAL_SUBSTITUTION");
  expect(result.stderr).toContain(`Replace or edit the scene audioWav source for ${segment.id}`);
  expect(result.stderr).not.toContain(`--resynth-scene ${segment.id} --no-cache`);
  expect(result.stderr).toContain(`CACHE_PURGE segment=${segment.id} status=SKIP`);
  expect(result.stderr).not.toContain(`CACHE_PURGE segment=${segment.id} status=PURGED`);
  expect(existsSync(unrelatedTtsTake)).toBe(true);

  const receipts = JSON.parse(readFileSync(outputPath.replace(/\.html$/, ".receipts.json"), "utf8"));
  const transcriptRow = receipts.gates.at(-1);
  expect(transcriptRow).toMatchObject({ gate: "transcript-fidelity", stage: "BUILD", verdict: "REJECT" });
  expect(transcriptRow.runbook).toContain(`Replace or edit the scene audioWav source for ${segment.id}`);
  expect(transcriptRow.runbook).not.toContain("--no-cache");
  expect(receipts.purges).toEqual([]);
});

test("D6b BUILD receipt gives script-less BYO its distinct metric and runbook", () => {
  const root = mkdtempSync(path.join(tmpdir(), "audio-dashboard-d6b-scriptless-byo-"));
  const jobDir = path.join(root, "job");
  const words = [{ index: 0, word: "recorded", start: 0.05, end: 0.42, confidence: 0.99 }];
  writeSegment(jobDir, "scriptless-byo", words, placeholderMp3, words);

  const { result, outputPath } = buildDashboard({
    id: "d6b-scriptless-byo",
    title: "Script-less BYO",
    scenes: [{ id: "scriptless-byo", title: "Script-less BYO", audioWav: "scriptless-byo.wav" }],
  }, jobDir, "d6b-scriptless-byo");

  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("metric=SCRIPTLESS_SCENE_UNSUPPORTED");
  expect(result.stderr).toContain("add `script` to the scene");
  const receipts = JSON.parse(readFileSync(outputPath.replace(/\.html$/, ".receipts.json"), "utf8"));
  expect(receipts.gates.at(-1)).toMatchObject({
    gate: "transcript-fidelity",
    stage: "BUILD",
    verdict: "REJECT",
  });
  expect(receipts.gates.at(-1).violations[0].metric).toBe("SCRIPTLESS_SCENE_UNSUPPORTED");
  expect(receipts.gates.at(-1).runbook).toContain("add `script` to the scene");
  expect(receipts.gates.at(-1).runbook).toContain("NOT_APPLICABLE verdict class is filed as a spec question");
});

for (const fx of evidenceGreens) {
  test(`GREEN ${fx.file} (${fx.specimen}) -> PASS`, () => {
    const result = validateAudioDashboardEvidence(fx.evidence);
    expect(result.verdict).toBe("PASS");
    expect(result.violations.length).toBe(0);
    expect(result.wordClickSeek).toBe(true);
    expect(result.realTranscript).toBe(true);
    expect(result.realWordTiming).toBe(true);
  });
}

for (const fx of evidenceReds) {
  test(`RED ${fx.file} (${fx.specimen}) -> REJECTED ${fx.violation}`, () => {
    const result = validateAudioDashboardEvidence(fx.evidence);
    expect(result.verdict).toBe("REJECTED");
    expect(result.violations.map((v) => v.code)).toContain(fx.violation);
  });
}

test("GREEN teleprompter drift fixture from the banked in-sync dashboard passes tail alignment", () => {
  expect(driftGreens.map((fx) => fx.file)).toEqual(["03-teleprompter-drift-insync.json"]);
  const result = analyzeTeleprompterDrift(driftGreens[0].teleprompterDrift);

  expect(result.verdict).toBe("PASS");
  expect(result.violations).toEqual([]);
  expect(result.stats[0].tailWordCount).toBeGreaterThan(50);
  expect(result.stats[0].transcriptChars).toBeGreaterThan(1500);
  expect(result.stats[0].maxTailStartDelta).toBeLessThanOrEqual(0.001);
});

test("RED teleprompter drift fixture fires on tail-only accumulated drift", () => {
  expect(driftReds.map((fx) => fx.file)).toContain("04-teleprompter-tail-drift.json");
  const fixture = driftReds.find((fx) => fx.file === "04-teleprompter-tail-drift.json");
  const result = analyzeTeleprompterDrift(fixture.teleprompterDrift);
  const report = formatTeleprompterDriftReport(result);

  expect(result.verdict).toBe("REJECTED");
  expect(result.violations.map((v) => v.code)).toContain("TAIL_WORD_TIMING_DRIFT");
  expect(result.stats[0].maxHeadStartDelta).toBeLessThanOrEqual(0.001);
  expect(result.stats[0].maxTailStartDelta).toBeGreaterThan(result.thresholds.maxWordDeltaSeconds);
  expect(report).toContain("Align rendered teleprompter words to words.raw.json through the tail");
  expect(report).toContain("rerun the drift gate");
});

test("teleprompter drift gate runs under the stop-class latency budget", () => {
  const start = performance.now();
  const result = analyzeTeleprompterDrift(driftGreens[0].teleprompterDrift);
  const elapsedMs = performance.now() - start;

  expect(result.verdict).toBe("PASS");
  expect(elapsedMs).toBeLessThan(5000);
});

test("a dashboard with WPM timing cannot be rescued by real transcript text", () => {
  const evidence = {
    generator: "agent-html/host/build-aftercode-tonight.mjs",
    outputPath: "/opt/private/skill-tools/docs.local/dashboards/example.html",
    tailnetSync: true,
    wordsJson: [
      { word: "real", start: 0.12, end: 0.28 },
      { word: "timing", start: 0.32, end: 0.72 }
    ],
    html: `
      <script id="tpdata" type="application/json">
        [{"realWordTiming":false,"timingSource":"wpm-estimated","script":"real timing","words":[{"word":"real","start":0,"end":0.5},{"word":"timing","start":0.5,"end":1}]}]
      </script>
      <section class="transcript">real timing</section>
      <script>word.addEventListener('click', () => { audio.currentTime = Number(word.dataset.ws); });</script>
    `
  };

  const result = validateAudioDashboardEvidence(evidence);
  expect(result.verdict).toBe("REJECTED");
  expect(result.violations.map((v) => v.code)).toContain("ESTIMATED_OR_WPM_TIMING");
});

test("evidence accepts decision-flow data-word-start click seeking", () => {
  const words = [
    { word: "real", start: 0.12, end: 0.28 },
    { word: "timing", start: 0.32, end: 0.72 }
  ];
  const result = validateAudioDashboardEvidence({
    generator: "agent-html/lib/render-v4.mjs",
    outputPath: "/opt/private/coordination/docs.local/dashboards/decision-flow.html",
    tailnetSync: true,
    wordsJson: words,
    timingData: { realWordTiming: true, script: "real timing", words },
    html: `<button data-word-start="0.12">real</button><script>word.addEventListener("click",function(){audio.currentTime = Number(word.dataset.wordStart);});</script>`
  });

  expect(result.wordClickSeek).toBe(true);
  expect(result.violations.map((v) => v.code)).not.toContain("MISSING_WORD_CLICK_SEEK");
});

test("a direct dashboards-serve output path is rejected because sync rebuilds that tree", () => {
  const evidence = {
    generator: "agent-html/host/build-aftercode-tonight.mjs",
    outputPath: "/opt/private/coordination/docs.local/dashboards-serve/dashboards/skill-creator/example.html",
    wordsJson: [
      { word: "real", start: 0.12, end: 0.28 },
      { word: "timing", start: 0.32, end: 0.72 }
    ],
    html: `
      <script id="tpdata" type="application/json">
        [{"realWordTiming":true,"script":"real timing","words":[{"word":"real","start":0.12,"end":0.28},{"word":"timing","start":0.32,"end":0.72}]}]
      </script>
      <section class="transcript"><span data-ws="0.12">real</span> <span data-ws="0.32">timing</span></section>
      <script>word.addEventListener('click', () => { audio.currentTime = Number(word.dataset.ws); });</script>
    `
  };

  const result = validateAudioDashboardEvidence(evidence);
  expect(result.verdict).toBe("REJECTED");
  expect(result.violations.map((v) => v.code)).toContain("WRONG_PUBLISH_TARGET");
});

test("missing generator or output path is rejected fail-closed", () => {
  const evidence = {
    wordsJson: [
      { word: "real", start: 0.12, end: 0.28 },
      { word: "timing", start: 0.32, end: 0.72 }
    ],
    html: `
      <script id="tpdata" type="application/json">
        [{"realWordTiming":true,"script":"real timing","words":[{"word":"real","start":0.12,"end":0.28},{"word":"timing","start":0.32,"end":0.72}]}]
      </script>
      <section class="transcript"><span data-ws="0.12">real</span> <span data-ws="0.32">timing</span></section>
      <script>word.addEventListener('click', () => { audio.currentTime = Number(word.dataset.ws); });</script>
    `
  };

  const result = validateAudioDashboardEvidence(evidence);
  expect(result.verdict).toBe("REJECTED");
  expect(result.violations.map((v) => v.code)).toContain("NON_CANONICAL_GENERATOR");
  expect(result.violations.map((v) => v.code)).toContain("WRONG_PUBLISH_TARGET");
});

test("word-click seek must use the clicked word timestamp in the click handler", () => {
  const evidence = {
    generator: "agent-html/host/build-aftercode-tonight.mjs",
    outputPath: "/opt/private/skill-tools/docs.local/dashboards/example.html",
    tailnetSync: true,
    wordsJson: [
      { word: "real", start: 0.12, end: 0.28 },
      { word: "timing", start: 0.32, end: 0.72 }
    ],
    html: `
      <script id="tpdata" type="application/json">
        [{"realWordTiming":true,"script":"real timing","words":[{"word":"real","start":0.12,"end":0.28},{"word":"timing","start":0.32,"end":0.72}]}]
      </script>
      <section class="transcript"><span data-ws="0.12">real</span> <span data-ws="0.32">timing</span></section>
      <button id="restart">Restart</button>
      <script>restart.addEventListener('click', () => { audio.currentTime = 0; });</script>
    `
  };

  const result = validateAudioDashboardEvidence(evidence);
  expect(result.verdict).toBe("REJECTED");
  expect(result.violations.map((v) => v.code)).toContain("MISSING_WORD_CLICK_SEEK");
});

test("docs.local output without tailnet sync evidence is rejected", () => {
  const evidence = {
    generator: "agent-html/host/build-aftercode-tonight.mjs",
    outputPath: "/opt/private/skill-tools/docs.local/dashboards/example.html",
    wordsJson: [
      { word: "real", start: 0.12, end: 0.28 },
      { word: "timing", start: 0.32, end: 0.72 }
    ],
    html: `
      <script id="tpdata" type="application/json">
        [{"realWordTiming":true,"script":"real timing","words":[{"word":"real","start":0.12,"end":0.28},{"word":"timing","start":0.32,"end":0.72}]}]
      </script>
      <section class="transcript"><span data-ws="0.12">real</span> <span data-ws="0.32">timing</span></section>
      <script>word.addEventListener('click', () => { audio.currentTime = Number(word.dataset.ws); });</script>
    `
  };

  const result = validateAudioDashboardEvidence(evidence);
  expect(result.verdict).toBe("REJECTED");
  expect(result.violations.map((v) => v.code)).toContain("MISSING_TAILNET_SYNC");
});

test("overlapping or backward word timings are rejected", () => {
  const evidence = {
    generator: "agent-html/host/build-aftercode-tonight.mjs",
    outputPath: "/opt/private/skill-tools/docs.local/dashboards/example.html",
    wordsJson: [
      { word: "real", start: 0.40, end: 0.90 },
      { word: "timing", start: 0.70, end: 1.10 }
    ],
    html: `
      <script id="tpdata" type="application/json">
        [{"realWordTiming":true,"script":"real timing","words":[{"word":"real","start":0.40,"end":0.90},{"word":"timing","start":0.70,"end":1.10}]}]
      </script>
      <section class="transcript"><span data-ws="0.40">real</span> <span data-ws="0.70">timing</span></section>
      <script>word.addEventListener('click', () => { audio.currentTime = Number(word.dataset.ws); });</script>
    `
  };

  const result = validateAudioDashboardEvidence(evidence);
  expect(result.verdict).toBe("REJECTED");
  expect(result.violations.map((v) => v.code)).toContain("NON_MONOTONIC_WORD_TIMING");
});

test("render-v4 preserves already-aligned words.json timings without a second tokenizer remap", () => {
  const wordsJson = [
    { word: "Hello,", start: 0.05, end: 0.18 },
    { word: "aligned", start: 0.21, end: 0.42 },
    { word: "scene.", start: 0.45, end: 0.72 }
  ];
  const html = renderV4({
    title: "Tokenizer Regression",
    scenes: [
      {
        id: "frozen",
        title: "Frozen scene",
        script: "Hello, aligned -- scene.",
        words: wordsJson,
        audioUrl: "data:audio/mpeg;base64,ZmFrZQ=="
      }
    ]
  });

  const tpdata = tpdataFromHtml(html);
  const renderedWords = tpdata.frozen.cues[0].words;

  expect(renderedWords.length).toBe(wordsJson.length);
  for (const [index, word] of renderedWords.entries()) {
    expect(word.word).toBe(wordsJson[index].word);
    expect(word.start).toBeCloseTo(wordsJson[index].start, 3);
    expect(word.end).toBeCloseTo(wordsJson[index].end, 3);
    if (index > 0) {
      expect(word.start).toBeGreaterThanOrEqual(renderedWords[index - 1].end - 0.001);
    }
  }
});

test("render-v4 ships an immediate cold-load state that clears on cinema boot", () => {
  const html = renderV4({
    title: "Cold Load",
    scenes: [
      {
        id: "loader",
        title: "Loader scene",
        script: "Loading state appears before embedded audio.",
        words: [
          { word: "Loading", start: 0.02, end: 0.12 },
          { word: "state", start: 0.14, end: 0.24 },
          { word: "appears", start: 0.26, end: 0.38 },
          { word: "before", start: 0.40, end: 0.50 },
          { word: "embedded", start: 0.52, end: 0.64 },
          { word: "audio.", start: 0.66, end: 0.78 }
        ],
        audioUrl: "data:audio/mpeg;base64,ZmFrZQ=="
      }
    ]
  });

  expect(html).toContain('<body class="golem-booting">');
  expect(html).toContain('id="golem-coldload"');
  expect(html).toContain("Loading audio brief");
  expect(html.indexOf('id="golem-coldload"')).toBeGreaterThan(html.indexOf("<body"));
  expect(html.indexOf('id="golem-coldload"')).toBeLessThan(html.indexOf("data:audio/mpeg;base64,"));
  expect(html).toContain("__golemDashboardReady");
  expect(html).toContain("cinema-boot");
  expect(html).toContain("window-load-fallback");
  expect(html).toContain('setAttribute("hidden", "hidden")');
});

test("build-dashboard fails when final tpdata words overlap", () => {
  const root = mkdtempSync(path.join(tmpdir(), "audio-dashboard-overlap-"));
  const jobDir = path.join(root, "job");
  writeSegment(jobDir, "scene-a", [
    { word: "alpha", start: 0.05, end: 0.45 },
    { word: "beta", start: 0.30, end: 0.60 }
  ]);

  const { result } = buildDashboard({
    id: "overlap",
    title: "Overlap",
    scenes: [{ id: "scene-a", title: "Scene A", script: "alpha beta" }]
  }, jobDir, "overlap");

  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("non-overlapping");
});

test("build-dashboard fails when tpdata duration disagrees with the embedded mp3", () => {
  const root = mkdtempSync(path.join(tmpdir(), "audio-dashboard-duration-"));
  const jobDir = path.join(root, "job");
  writeSegment(jobDir, "scene-a", [
    { word: "alpha", start: 0.05, end: 3.00 },
    { word: "beta", start: 3.02, end: 4.00 }
  ]);

  const { result } = buildDashboard({
    id: "duration",
    title: "Duration",
    scenes: [{ id: "scene-a", title: "Scene A", script: "alpha beta" }]
  }, jobDir, "duration");

  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("ffprobe");
});

test("build-dashboard fails when any scene is missing mp3 or words.json artifacts", () => {
  const root = mkdtempSync(path.join(tmpdir(), "audio-dashboard-missing-"));
  const jobDir = path.join(root, "job");
  writeSegment(jobDir, "scene-a", [
    { word: "alpha", start: 0.05, end: 0.20 },
    { word: "beta", start: 0.22, end: 0.40 }
  ]);

  const { result } = buildDashboard({
    id: "missing",
    title: "Missing",
    scenes: [
      { id: "scene-a", title: "Scene A", script: "alpha beta" },
      { id: "scene-b", title: "Scene B", script: "gamma delta" }
    ]
  }, jobDir, "missing");

  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("MISSING_RAW_TRANSCRIPT_SERIES");
});

test("build-dashboard renders native decision boxes from spec.decisions with a copyable answer round-trip", () => {
  const root = mkdtempSync(path.join(tmpdir(), "audio-dashboard-decisions-"));
  const jobDir = path.join(root, "job");
  writeSegment(jobDir, "scene-a", [
    { word: "alpha", start: 0.05, end: 0.42 },
    { word: "beta", start: 0.45, end: 0.80 }
  ]);
  const decisions = [
    {
      id: "ship-path",
      title: "Ship path",
      deadline: "today",
      body: "Choose whether the decision surface ships natively. Literal $& tokens survive insertion.",
      options: ["Native render", "Post-inject"]
    },
    {
      id: "handoff",
      title: "Handoff",
      body: "Record what dashboardLead should review.",
      options: ["Ready for review", "Blocked"]
    }
  ];

  const { result, outputPath } = buildDashboard({
    id: "native-decisions",
    title: "Native Decisions",
    answerSink: "http://127.0.0.1:8765/answers",
    scenes: [{ id: "scene-a", title: "Scene A", script: "alpha beta" }],
    decisions
  }, jobDir, "native-decisions");

  expect(result.status).toBe(0);
  const html = readFileSync(outputPath, "utf8");
  expect(html).toContain('id="decision-boxes"');
  expect(html).toContain('data-storage-key="dbx:native-decisions"');
  expect(html).toContain('data-answer-sink="http://127.0.0.1:8765/answers"');
  expect(html).toContain("Literal $&amp; tokens survive insertion.");
  expect(html).not.toContain("Literal </body>amp; tokens");
  expect((html.match(/<section class="dbx-card"/g) || []).length).toBe(2);
  expect((html.match(/<input type="radio"/g) || []).length).toBe(4);
  expect(html).toContain('class="note-area dbx-free"');
  expect(html).toContain('id="dbx-copy"');
  expect(html).toContain(">Copy answers<");
  expect((html.match(/DECISION-BOXES:BEGIN/g) || []).length).toBe(1);

  const markdown = answersMarkdown(decisions, {
    "ship-path": "Native render",
    "ship-path-free": "Keep the round-trip skill-local.",
    "handoff-free": "dashboardLead reviews and merges."
  }, "dbx:native-decisions");
  expect(markdown).toContain("## Decision answers - native-decisions");
  expect(markdown).toContain("### Ship path");
  expect(markdown).toContain("- picked: Native render");
  expect(markdown).toContain("- in your words: Keep the round-trip skill-local.");
  expect(markdown).toContain("### Handoff");
  expect(markdown).toContain("- picked: (no option picked)");
  expect(markdown).toContain("- in your words: dashboardLead reviews and merges.");

  const baseHtml = "<!doctype html><html><body><main>Audio dashboard</main></body></html>";
  const once = injectDecisionSurfaceIntoHtml(baseHtml, decisions, { storageKey: "dbx:native-decisions" });
  const twice = injectDecisionSurfaceIntoHtml(once.html, decisions, { storageKey: "dbx:native-decisions" });
  expect((twice.html.match(/DECISION-BOXES:BEGIN/g) || []).length).toBe(1);
  expect(twice.stats.cards).toBe(2);
  expect(twice.stats.radios).toBe(4);
  expect(twice.stats.copy).toBe(true);
});

test("build-dashboard renders decision-flow as a distinct card-local audio type", () => {
  const root = mkdtempSync(path.join(tmpdir(), "audio-dashboard-decision-flow-"));
  const jobDir = path.join(root, "job");
  for (const sceneId of ["intro", "decision-a", "decision-b"]) {
    writeSegment(jobDir, sceneId, [
      { word: `${sceneId}-alpha`, start: 0.05, end: 0.42 },
      { word: `${sceneId}-beta`, start: 0.45, end: 0.80 }
    ]);
  }

  const { result, outputPath } = buildDashboard({
    type: "decision-flow",
    id: "decision-flow-contract",
    title: "Decision flow",
    kicker: "Six calls · one clean pass",
    scenes: [
      { id: "intro", title: "Context", script: "intro-alpha intro-beta" },
      { id: "decision-a", title: "Decision A", script: "decision-a-alpha decision-a-beta" },
      { id: "decision-b", title: "Decision B", script: "Play All decision-b-alpha decision-b-beta" }
    ],
    decisions: [
      {
        id: "path-a",
        rank: 1,
        title: "Path $& costs $$",
        status: "OPEN",
        body: "Choose the first path.",
        summary: "The first decision owns the context and its answer clip.",
        options: ["Keep", "Change"],
        sceneIds: ["intro", "decision-a"],
        rail: [{ label: "Owner", value: "Etan" }]
      },
      {
        id: "path-b",
        rank: 2,
        title: "Path B",
        status: "READY",
        body: "Choose the second path.",
        options: ["One", "Two"],
        sceneIds: ["decision-b"]
      }
    ]
  }, jobDir, "decision-flow-contract");

  expect(result.status).toBe(0);
  const html = readFileSync(outputPath, "utf8");
  expect(html).toContain('data-dashboard-type="decision-flow"');
  expect(html).not.toContain('id="cinema"');
  expect(html).not.toContain('id="pa-bar"');
  expect((html.match(/<article class="df-card/g) || []).length).toBe(2);
  expect((html.match(/class="df-play"/g) || []).length).toBe(2);
  expect((html.match(/data-audio-scene=/g) || []).length).toBe(3);
  expect(html).toContain('data-audio-scene="intro"');
  expect(html).toContain("Path $&amp; costs $$");
  expect(html).toContain('class="df-teleprompter"');
  expect(html).toContain('data-word-start="0.05"');
  expect(html).toContain("audios[audioIndex].currentTime=Number(word.dataset.wordStart)");
  expect(html).toContain('class="note-area df-free"');
  expect(html).toContain('class="df-next"');
  expect(html).toContain('class="df-skip"');
  expect(html).toContain('id="df-copy"');
  expect(html).toContain("localStorage.setItem");
  expect(html).toContain('"realWordTiming":true');
  expect(html).toContain('card.querySelector(".df-teleprompter").hidden=true');
  expect(html).toContain("audio.onended=function(){clearHighlights(card,audio.dataset.audioScene);playAt(card,audioIndex+1);}");
  expect(html).toContain('class="df-restart"');
  expect(html).toContain('button.classList.add("is-acknowledged")');
  expect(html).toContain('id="df-storage-state"');
  expect(html).toContain("Storage unavailable · use Copy answers");
  expect(html).toContain('class="df-player-state" aria-live="polite"');
  expect(html).toContain('<fieldset class="df-options">');
  expect(html).toContain('<legend class="df-sr-only">Path $&amp; costs $$ options</legend>');

  const qa = spawnSync("bun", ["vendor/qa/verify-decision-flow.mjs", outputPath], {
    cwd: skillRoot,
    encoding: "utf8",
  });
  expect(qa.status).toBe(0);
  const qaReport = JSON.parse(qa.stdout);
  expect(qaReport.pass).toBe(true);
  expect(qaReport.cards).toBe(2);
  expect(qaReport.audioDataUris).toBe(3);
  expect(qaReport.scenesWithWords).toBe("3/3");
});

test("decision-flow defaults omitted options to a free-text-only answer", () => {
  const root = mkdtempSync(path.join(tmpdir(), "audio-dashboard-decision-flow-free-text-"));
  const jobDir = path.join(root, "job");
  writeSegment(jobDir, "only", [
    { word: "alpha", start: 0.05, end: 0.42 },
    { word: "beta", start: 0.45, end: 0.80 }
  ]);
  const { result, outputPath } = buildDashboard({
    type: "decision-flow",
    id: "free-text-only",
    scenes: [{ id: "only", script: "alpha beta" }],
    decisions: [{ id: "free", title: "Free text", sceneIds: ["only"] }]
  }, jobDir, "free-text-only");

  expect(result.status).toBe(0);
  const html = readFileSync(outputPath, "utf8");
  expect(html).toContain('<fieldset class="df-options">');
  expect(html).toContain('class="note-area df-free"');
  expect((html.match(/<input type="radio"/g) || []).length).toBe(0);
});

test("decision-flow fails closed when a scene is not owned by exactly one decision", () => {
  const root = mkdtempSync(path.join(tmpdir(), "audio-dashboard-decision-flow-ownership-"));
  const jobDir = path.join(root, "job");
  for (const sceneId of ["owned", "orphan"]) {
    writeSegment(jobDir, sceneId, [
      { word: "alpha", start: 0.05, end: 0.42 },
      { word: "beta", start: 0.45, end: 0.80 }
    ]);
  }

  const { result } = buildDashboard({
    type: "decision-flow",
    id: "decision-flow-ownership",
    title: "Decision flow ownership",
    scenes: [
      { id: "owned", title: "Owned", script: "alpha beta" },
      { id: "orphan", title: "Orphan", script: "alpha beta" }
    ],
    decisions: [
      { id: "only", title: "Only", body: "Pick.", options: ["A", "B"], sceneIds: ["owned"] }
    ]
  }, jobDir, "decision-flow-ownership");

  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("decision-flow scene ownership");
  expect(result.stderr).toContain("orphan");
});

test("decision-flow rejects duplicate decision ids before render", () => {
  const root = mkdtempSync(path.join(tmpdir(), "audio-dashboard-decision-flow-duplicate-"));
  const jobDir = path.join(root, "job");
  for (const sceneId of ["first", "second"]) {
    writeSegment(jobDir, sceneId, [
      { word: "alpha", start: 0.05, end: 0.42 },
      { word: "beta", start: 0.45, end: 0.80 }
    ]);
  }

  const { result } = buildDashboard({
    type: "decision-flow",
    id: "duplicate-decisions",
    scenes: [
      { id: "first", script: "alpha beta" },
      { id: "second", script: "alpha beta" }
    ],
    decisions: [
      { id: "same", title: "First", options: ["A"], sceneIds: ["first"] },
      { id: "same", title: "Second", options: ["B"], sceneIds: ["second"] }
    ]
  }, jobDir, "duplicate-decisions");

  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("duplicate decision id: same");
});

test("decision-flow rejects duplicate scene ids before render", () => {
  const root = mkdtempSync(path.join(tmpdir(), "audio-dashboard-decision-flow-duplicate-scenes-"));
  const jobDir = path.join(root, "job");
  writeSegment(jobDir, "same", [
    { word: "alpha", start: 0.05, end: 0.42 },
    { word: "beta", start: 0.45, end: 0.80 }
  ]);

  const { result } = buildDashboard({
    type: "decision-flow",
    id: "duplicate-scenes",
    scenes: [
      { id: "same", script: "alpha beta" },
      { id: "same", script: "different content" }
    ],
    decisions: [{ id: "only", title: "Only", options: ["A"], sceneIds: ["same"] }]
  }, jobDir, "duplicate-scenes");

  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("duplicate scene.id: same");
});

test("decision-flow rejects a missing decision id before render", () => {
  const root = mkdtempSync(path.join(tmpdir(), "audio-dashboard-decision-flow-missing-id-"));
  const jobDir = path.join(root, "job");
  writeSegment(jobDir, "only", [
    { word: "alpha", start: 0.05, end: 0.42 },
    { word: "beta", start: 0.45, end: 0.80 }
  ]);

  const { result } = buildDashboard({
    type: "decision-flow",
    id: "missing-decision-id",
    scenes: [{ id: "only", script: "alpha beta" }],
    decisions: [{ title: "Missing id", options: ["A"], sceneIds: ["only"] }]
  }, jobDir, "missing-decision-id");

  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("decision 0 needs a slug-safe id");
});

test("decision-flow QA reports unreadable inputs as structured JSON", () => {
  const missing = path.join(tmpdir(), "missing-decision-flow-dashboard.html");
  const qa = spawnSync("bun", ["vendor/qa/verify-decision-flow.mjs", missing], {
    cwd: skillRoot,
    encoding: "utf8",
  });

  expect(qa.status).toBe(1);
  const report = JSON.parse(qa.stderr);
  expect(report.pass).toBe(false);
  expect(report.error).toContain("cannot read file");
});

test("build-dashboard fails when a same-role segment has inflated duration per word", () => {
  const root = mkdtempSync(path.join(tmpdir(), "audio-dashboard-acoustic-ratio-"));
  const jobDir = path.join(root, "job");
  const scenes = [
    writeAcousticSegment(jobDir, "host-a", { seconds: 4, words: 10, role: "host" }),
    writeAcousticSegment(jobDir, "host-b", { seconds: 4.2, words: 10, role: "host" }),
    writeAcousticSegment(jobDir, "host-glitch", { seconds: 5.6, words: 10, role: "host" }),
  ];
  const cacheFixture = reds.find((item) => item.file === "11-poisoned-take-cache.json");
  const home = path.join(root, "home");
  const cacheDir = path.join(home, ".narrationlayer", "tts-cache");
  mkdirSync(cacheDir, { recursive: true });
  const poisonedPath = path.join(cacheDir, `${cacheFixture.cacheKey}.wav`);
  writeFileSync(poisonedPath, Buffer.from(cacheFixture.portableExtraction.base64, "base64"));
  writeFileSync(
    path.join(jobDir, "segments", "host-glitch", "host-glitch.wav.cache.json"),
    `${JSON.stringify({ version: 1, cacheKey: cacheFixture.cacheKey }, null, 2)}\n`,
  );

  const { result, outputPath } = buildDashboard({
    id: "acoustic-ratio",
    title: "Acoustic Ratio",
    scenes
  }, jobDir, "acoustic-ratio", { HOME: home });

  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("ACOUSTIC_ARTIFACT");
  expect(result.stderr).toContain("host-glitch");
  expect(result.stderr).toContain("DURATION_WORD_SIBLING_RATIO");
  expect(result.stderr).toContain("--resynth-scene host-glitch");
  expect(result.stderr).toContain("--no-cache");
  expect(result.stderr).toContain("CACHE_PURGE segment=host-glitch status=PURGED");
  expect(existsSync(poisonedPath)).toBe(false);
  const receipts = JSON.parse(readFileSync(outputPath.replace(/\.html$/, ".receipts.json"), "utf8"));
  expect(receipts.gates.map((row) => `${row.gate}:${row.verdict}`)).toEqual([
    "voice-role:PASS",
    "transcript-fidelity:PASS",
    "acoustic:REJECT",
  ]);
  expect(receipts.purges).toHaveLength(1);
  expect(receipts.purges[0]).toMatchObject({
    cacheKey: cacheFixture.cacheKey,
    segment: "host-glitch",
    reason: "acoustic-gate REJECT",
  });
});

test("BYO acoustic rejection preserves a stale TTS take and requires source replacement", () => {
  const root = mkdtempSync(path.join(tmpdir(), "audio-dashboard-acoustic-byo-"));
  const jobDir = path.join(root, "job");
  const scenes = [
    writeAcousticSegment(jobDir, "host-a", { seconds: 4, words: 10, role: "host" }),
    writeAcousticSegment(jobDir, "host-b", { seconds: 4.2, words: 10, role: "host" }),
    {
      ...writeAcousticSegment(jobDir, "host-byo-glitch", { seconds: 5.6, words: 10, role: "host" }),
      audioWav: "host-byo-source.wav",
    },
  ];
  const staleCacheKey = "d".repeat(64);
  const home = path.join(root, "home");
  const cacheDir = path.join(home, ".narrationlayer", "tts-cache");
  mkdirSync(cacheDir, { recursive: true });
  const unrelatedTtsTake = path.join(cacheDir, `${staleCacheKey}.wav`);
  writeFileSync(unrelatedTtsTake, "unrelated prior TTS take");
  writeFileSync(
    path.join(jobDir, "segments", "host-byo-glitch", "host-byo-glitch.wav.cache.json"),
    `${JSON.stringify({ version: 1, cacheKey: staleCacheKey }, null, 2)}\n`,
  );

  const { result, outputPath } = buildDashboard({
    id: "acoustic-byo",
    title: "Acoustic BYO",
    scenes,
  }, jobDir, "acoustic-byo", { HOME: home });

  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("ACOUSTIC_ARTIFACT");
  expect(result.stderr).toContain("DURATION_WORD_SIBLING_RATIO");
  expect(result.stderr).toContain("Replace or edit the scene audioWav source for host-byo-glitch");
  expect(result.stderr).not.toContain("--resynth-scene host-byo-glitch --no-cache");
  expect(result.stderr).toContain("CACHE_PURGE segment=host-byo-glitch status=SKIP");
  expect(result.stderr).not.toContain("CACHE_PURGE segment=host-byo-glitch status=PURGED");
  expect(existsSync(unrelatedTtsTake)).toBe(true);

  const receipts = JSON.parse(readFileSync(outputPath.replace(/\.html$/, ".receipts.json"), "utf8"));
  const acousticRow = receipts.gates.at(-1);
  expect(acousticRow).toMatchObject({ gate: "acoustic", stage: "BUILD", verdict: "REJECT" });
  expect(acousticRow.runbook).toContain("Replace or edit the scene audioWav source for host-byo-glitch");
  expect(acousticRow.runbook).not.toContain("--no-cache");
  expect(receipts.purges).toEqual([]);
});

test("build-dashboard fails on voiced-frame high-f0 burst count but not s3a-like stable outliers", () => {
  const root = mkdtempSync(path.join(tmpdir(), "audio-dashboard-acoustic-pitch-"));
  const cleanJobDir = path.join(root, "clean-job");
  const cleanScenes = [
    writeAcousticSegment(cleanJobDir, "clean-a", { seconds: 7, words: 20, role: "expert" }),
    writeAcousticSegment(cleanJobDir, "stable-outlier", {
      seconds: 7,
      words: 20,
      role: "expert",
      highBursts: [{ start: 1.0, end: 3.1, hz: 520 }],
    }),
    writeAcousticSegment(cleanJobDir, "clean-b", { seconds: 7, words: 20, role: "expert" }),
  ];
  const clean = buildDashboard({
    id: "acoustic-clean",
    title: "Acoustic Clean",
    scenes: cleanScenes
  }, cleanJobDir, "acoustic-clean");
  expect(clean.result.status).toBe(0);

  const glitchJobDir = path.join(root, "glitch-job");
  const glitchScenes = [
    writeAcousticSegment(glitchJobDir, "clean-a", { seconds: 7, words: 20, role: "expert" }),
    writeAcousticSegment(glitchJobDir, "pitch-glitch", {
      seconds: 7,
      words: 20,
      role: "expert",
      highBursts: [{ start: 1.0, end: 3.36, hz: 520 }],
    }),
    writeAcousticSegment(glitchJobDir, "clean-b", { seconds: 7, words: 20, role: "expert" }),
  ];
  const glitch = buildDashboard({
    id: "acoustic-glitch",
    title: "Acoustic Glitch",
    scenes: glitchScenes
  }, glitchJobDir, "acoustic-glitch");

  expect(glitch.result.status).not.toBe(0);
  expect(glitch.result.stderr).toContain("ACOUSTIC_ARTIFACT");
  expect(glitch.result.stderr).toContain("pitch-glitch");
  expect(glitch.result.stderr).toContain("HIGH_F0_VOICED_FRAME_COUNT");
  expect(glitch.result.stderr).toContain("threshold=112");
});

test("RED acoustic fixture #1 rejects a repeated-token-loop long-drag segment", () => {
  const fixture = acousticReds.find((fx) => fx.case === "repeated-token-loop");
  expect(fixture).toBeDefined();

  const result = analyzeAcousticArtifacts(acousticFixtureSegments(fixture));

  expect(result.verdict).toBe("REJECTED");
  expect(result.violations.map((v) => v.metric)).toContain("DURATION_WORD_SIBLING_RATIO");
  expect(result.violations.map((v) => v.segment)).toContain("loop-drag");
});

test("RED acoustic fixture #2 rejects multi-incident duration artifacts after the absolute backstop", () => {
  const fixture = acousticReds.find((fx) => fx.case === "multi-incident-poisoned-median");
  expect(fixture).toBeDefined();

  const result = analyzeAcousticArtifacts(acousticFixtureSegments(fixture));

  expect(result.verdict).toBe("REJECTED");
  expect(result.violations.map((v) => v.metric)).toContain("DURATION_WORD_ABSOLUTE_BACKSTOP");
  for (const id of ["artifact-a", "artifact-b", "artifact-c"]) {
    expect(result.violations.map((v) => v.segment)).toContain(id);
  }
});

test("RED acoustic high-f0 multi-incident fixture rejects after the absolute backstop", () => {
  const fixture = acousticReds.find((fx) => fx.case === "high-f0-poisoned-median");
  expect(fixture).toBeDefined();

  const result = analyzeAcousticArtifacts(acousticFixtureSegments(fixture));

  expect(result.verdict).toBe("REJECTED");
  expect(result.violations.map((v) => v.metric)).toContain("HIGH_F0_VOICED_FRAME_ABSOLUTE_BACKSTOP");
  for (const id of ["artifact-a", "artifact-b", "artifact-c"]) {
    expect(result.violations.map((v) => v.segment)).toContain(id);
  }
});

test("acoustic analyzer clamps overstated WAV data chunks and skips zero-word duration ratios", () => {
  const root = mkdtempSync(path.join(tmpdir(), "audio-dashboard-acoustic-clamp-"));
  const wavA = path.join(root, "a.wav");
  const wavB = path.join(root, "b.wav");
  writeToneWav(wavA, { seconds: 1, baseHz: 140 });
  writeToneWav(wavB, { seconds: 1, baseHz: 140 });
  const overstated = Buffer.from(readFileSync(wavA));
  overstated.writeUInt32LE(999999, 40);

  const result = analyzeAcousticArtifacts([
    { id: "zero-words", role: "host", wavPath: wavA, wavBytes: overstated, wordCount: 0 },
    { id: "normal", role: "host", wavPath: wavB, wavBytes: readFileSync(wavB), wordCount: 10 },
  ]);

  expect(result.verdict).toBe("PASS");
  expect(result.stats.find((stat) => stat.id === "zero-words").durationPerWord).toBe(null);
});

test("resynth mode fails before rerolling when untouched sibling artifacts are absent", () => {
  const root = mkdtempSync(path.join(tmpdir(), "audio-dashboard-resynth-preflight-"));
  const wav = path.join(root, "source.wav");
  writeToneWav(wav, { seconds: 1, baseHz: 140 });
  const specPath = path.join(root, "job.json");
  const jobDir = path.join(root, "job");
  writeFileSync(specPath, `${JSON.stringify({
    id: "resynth-preflight",
    scenes: [
      { id: "scene-a", script: "alpha beta", audioWav: wav },
      { id: "scene-b", script: "gamma delta", audioWav: wav }
    ]
  }, null, 2)}\n`);

  const result = spawnSync(
    "bun",
    ["scripts/synth-segments.mjs", "--spec", specPath, "--job-dir", jobDir, "--resynth-scene", "scene-a"],
    { cwd: skillRoot, encoding: "utf8" },
  );

  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("--resynth-scene requires an existing prior run");
  expect(result.stderr).toContain("scene-b");
});

test("partial re-render must preserve word-sync in untouched scenes", () => {
  const root = mkdtempSync(path.join(tmpdir(), "audio-dashboard-partial-"));
  const jobDir = path.join(root, "job");
  const mp3Duration = placeholderMp3Duration;
  const finalEnd = Number(Math.max(0.15, mp3Duration - 0.05).toFixed(3));
  const frozenWords = [
    { word: "Hello,", start: 0.02, end: Number((finalEnd * 0.30).toFixed(3)) },
    { word: "frozen", start: Number((finalEnd * 0.34).toFixed(3)), end: Number((finalEnd * 0.62).toFixed(3)) },
    { word: "scene.", start: Number((finalEnd * 0.66).toFixed(3)), end: finalEnd }
  ];
  const changedWords = [
    { word: "changed", start: 0.02, end: Number((finalEnd * 0.45).toFixed(3)) },
    { word: "scene", start: Number((finalEnd * 0.50).toFixed(3)), end: finalEnd }
  ];
  const appendedWords = [
    { word: "new", start: 0.02, end: Number((finalEnd * 0.45).toFixed(3)) },
    { word: "scene", start: Number((finalEnd * 0.50).toFixed(3)), end: finalEnd }
  ];

  writeSegment(jobDir, "frozen", frozenWords);
  const frozenWordsBefore = readFileSync(path.join(jobDir, "segments", "frozen", "words.json"), "utf8");
  const frozenMp3Before = readFileSync(path.join(jobDir, "segments", "frozen", "frozen.mp3"));

  writeSegment(jobDir, "changed", changedWords);
  writeSegment(jobDir, "appended", appendedWords);

  const { result, outputPath } = buildDashboard({
    id: "partial",
    title: "Partial",
    scenes: [
      { id: "frozen", title: "Frozen", script: "Hello, frozen -- scene." },
      { id: "changed", title: "Changed", script: "changed scene" },
      { id: "appended", title: "Appended", script: "new scene" }
    ]
  }, jobDir, "partial");

  expect(result.status).toBe(0);
  const tpdata = tpdataFromHtml(readFileSync(outputPath, "utf8"));
  for (const scene of ["frozen", "changed", "appended"]) {
    const words = tpdata[scene].cues[0].words;
    expect(Math.abs(tpdata[scene].total - mp3Duration)).toBeLessThanOrEqual(0.50);
    for (let index = 1; index < words.length; index += 1) {
      expect(words[index].start).toBeGreaterThanOrEqual(words[index - 1].end - 0.001);
    }
  }
  for (const scene of [
    ["changed", changedWords],
    ["appended", appendedWords]
  ]) {
    const renderedWords = tpdata[scene[0]].cues[0].words;
    expect(renderedWords.length).toBe(scene[1].length);
    for (const [index, word] of renderedWords.entries()) {
      expect(word.start).toBeCloseTo(scene[1][index].start, 3);
      expect(word.end).toBeCloseTo(scene[1][index].end, 3);
    }
  }
  expect(readFileSync(path.join(jobDir, "segments", "frozen", "words.json"), "utf8")).toBe(frozenWordsBefore);
  expect(readFileSync(path.join(jobDir, "segments", "frozen", "frozen.mp3"))).toEqual(frozenMp3Before);
});

test("nested timing metadata is inherited by child word payloads", () => {
  const evidence = {
    generator: "agent-html/host/build-aftercode-tonight.mjs",
    outputPath: "/opt/private/skill-tools/docs.local/dashboards/example.html",
    tailnetSync: true,
    wordsJson: [
      { word: "real", start: 0.12, end: 0.28 },
      { word: "timing", start: 0.32, end: 0.72 }
    ],
    timingData: {
      realWordTiming: true,
      script: "real timing",
      cues: [
        {
          words: [
            { word: "real", start: 0.12, end: 0.28 },
            { word: "timing", start: 0.32, end: 0.72 }
          ]
        }
      ]
    },
    html: `
      <section class="transcript"><span data-ws="0.12">real</span> <span data-ws="0.32">timing</span></section>
      <script>word.addEventListener('click', () => { audio.currentTime = Number(word.dataset.ws); });</script>
    `
  };

  const result = validateAudioDashboardEvidence(evidence);
  expect(result.verdict).toBe("PASS");
  expect(result.realWordTiming).toBe(true);
  expect(result.realTranscript).toBe(true);
});

test("narrationlayer timing.status available with nonempty words is accepted", () => {
  const evidence = {
    generator: "narrationlayer/src/dashboard.ts",
    outputPath: "/Users/example/Gits/narrationlayer/docs.local/dashboards/example.html",
    publish: {
      tailnetSync: {
        status: "completed"
      }
    },
    wordsJson: [
      { word: "real", start: 0.12, end: 0.28 },
      { word: "timing", start: 0.32, end: 0.72 }
    ],
    timingData: {
      timing: { status: "available" },
      script: "real timing",
      words: [
        { word: "real", start: 0.12, end: 0.28 },
        { word: "timing", start: 0.32, end: 0.72 }
      ]
    },
    html: `
      <section class="transcript"><span data-ws="0.12">real</span> <span data-ws="0.32">timing</span></section>
      <script>word.addEventListener('click', () => { audio.currentTime = Number(word.dataset.ws); });</script>
    `
  };

  const result = validateAudioDashboardEvidence(evidence);
  expect(result.verdict).toBe("PASS");
  expect(result.realWordTiming).toBe(true);
});

test("historical terms in transcript text do not trigger old-generator rejection", () => {
  const evidence = {
    generator: "agent-html/host/build-aftercode-tonight.mjs",
    outputPath: "/opt/private/skill-tools/docs.local/dashboards/example.html",
    publishCommand: "node /opt/private/coordination/scripts/sync-tailnet-dashboards.mjs",
    wordsJson: [
      { word: "gen16", start: 0.12, end: 0.28 },
      { word: "cue", start: 0.32, end: 0.72 }
    ],
    html: `
      <script id="tpdata" type="application/json">
        [{"realWordTiming":true,"script":"gen16 cue","words":[{"word":"gen16","start":0.12,"end":0.28},{"word":"cue","start":0.32,"end":0.72}]}]
      </script>
      <section class="transcript"><span data-ws="0.12">gen16</span> <span data-ws="0.32">cue</span></section>
      <script>word.addEventListener('click', () => { audio.currentTime = Number(word.dataset.ws); });</script>
    `
  };

  const result = validateAudioDashboardEvidence(evidence);
  expect(result.verdict).toBe("PASS");
  expect(result.violations.map((v) => v.code)).not.toContain("OLD_GOLEMPLAYLIST_V1");
});

test("AfterCode wrapper emits the SKILL-LOCAL command chain and no external-repo delegation", () => {
  const skillRoot = "/opt/skills/audio-dashboard";
  const plan = buildAfterCodeDashboardPlan({
    skillRoot,
    env: { HOME: "/Users/tester", GITS_ROOT: "/tmp/Gits" }
  });
  const commands = plan.steps.map((step) => step.command).join("\n");

  expect(plan.workflow).toBe("aftercode");
  // Every engine step runs against skill-local scripts + vendor, not ~/Gits repos.
  expect(commands).toContain(`cd ${skillRoot} && bun scripts/bootstrap.mjs`);
  expect(commands).toContain(`cd ${skillRoot} && bun scripts/synth-segments.mjs --spec`);
  expect(commands).toContain(`cd ${skillRoot} && bun scripts/build-dashboard.mjs --spec`);
  expect(commands).toContain(`cd ${skillRoot} && bun vendor/qa/verify-cinema.mjs`);
  expect(commands).toContain(`cd ${skillRoot} && bun scripts/verify-tailnet-publish.mjs --spec`);
  // The old external one-off scripts must be GONE from the plan.
  expect(commands).not.toContain("bin/aftercode-tonight-synth.ts");
  expect(commands).not.toContain("regen-aftercode-tonight-real-word-timings.ts");
  expect(commands).not.toContain("agent-html/host");
  expect(commands).not.toContain("build-aftercode-tonight.mjs");
  // The default spec is skill-local, not a /opt/private/skill-tools doc.
  expect(commands).toContain(`${skillRoot}/examples/job.json`);
  // Publish is the one env-specific step; it resolves from the env and must be probed.
  expect(commands).toContain("/tmp/Gits/orchestrator/scripts/sync-tailnet-dashboards.mjs");
  expect(plan.steps.at(-2).name).toBe("publish-tailnet");
  expect(plan.steps.at(-1).name).toBe("verify-tailnet-http-200");
  expect(plan.steps.some((step) => step.optional)).toBe(false);
  expect(commands).not.toContain("cp ");
  expect(commands).not.toContain("dashboards-serve/");
  expect(plan.notes.join("\n")).toContain("local-tts-runner.ts");
  expect(plan.notes.join("\n")).toContain("splitForBreathing");
  expect(plan.notes.join("\n")).toContain("HTTP 200");
  for (const step of plan.steps) {
    expect(step.cwd).toBeString();
    expect(step.command).toBeString();
    expect(step.args).toBeArray();
  }
});

test("AfterCode wrapper display commands are shell-safe for paths with spaces", () => {
  const plan = buildAfterCodeDashboardPlan({
    skillRoot: "/opt/skills/audio dashboard",
    specPath: "/opt/skills/audio dashboard/examples/job.json",
    env: { HOME: "/Users/example", GITS_ROOT: "/tmp/Gits" }
  });

  expect(plan.steps[0].command).toContain("cd '/opt/skills/audio dashboard'");
  const synth = plan.steps.find((s) => s.name === "synth-and-time-segments");
  expect(synth.command).toContain("'/opt/skills/audio dashboard/examples/job.json'");
});

test("tailnet publish verifier derives the dashboard URL from docs.local output paths", () => {
  const plan = buildAfterCodeDashboardPlan({
    skillRoot: "/opt/skills/audio-dashboard",
    specPath: "/tmp/job.json",
    env: {
      HOME: "/Users/tester",
      GITS_ROOT: "/tmp/Gits",
      AUDIO_DASHBOARD_TAILNET_BASE_URL: "https://tailnet.example/dashboards"
    }
  });
  const verify = plan.steps.find((step) => step.name === "verify-tailnet-http-200");

  expect(verify).toBeDefined();
  expect(verify.command).toContain("scripts/verify-tailnet-publish.mjs --spec /tmp/job.json");
  expect(verify.command).toContain("--base-url https://tailnet.example/dashboards");
});

test("SKILL.md exposes the canonical trigger language and consolidation boundaries", () => {
  const skill = readFileSync(skillPath, "utf8");

  expect(skill).toContain("STT-after-TTS exact word-timing");
  expect(skill).toContain("real word-click-seek read-along dashboard");
  expect(skill).toContain("AfterCode workflow");
  expect(skill).toContain("publish-to-tailnet");
  expect(skill).toContain("## AfterCode Workflow");
  expect(skill).toContain("## Supersedes");
  // Canonical path is now SKILL-LOCAL (vendored engine), not external one-offs.
  expect(skill).toContain("scripts/synth-segments.mjs");
  expect(skill).toContain("scripts/build-dashboard.mjs");
  expect(skill).toContain("scripts/bootstrap.mjs");
  expect(skill).toContain("NARRATIONLAYER_PROFILES_FILE");
  expect(skill).toContain("persistent session");
  expect(skill).toContain("vendor/");
  expect(skill).toContain("Transcript Fidelity and Teleprompter Drift BUILD Gates");
  expect(skill).toContain("src/teleprompter-drift-gate.mjs");
  // Portability + invariants must be documented.
  expect(skill).toContain("## Bootstrap");
  expect(skill).toContain("## Transfer");
  // Standing invariants (unchanged).
  expect(skill).toContain("build-aftercode-cinema.mjs");
  expect(skill).toContain("dashboards-serve");
  expect(skill).toContain("Acoustic Artifact Gate");
  expect(skill).toContain("DURATION_WORD_ABSOLUTE_BACKSTOP");
  expect(skill).toContain("HIGH_F0_VOICED_FRAME_ABSOLUTE_BACKSTOP");
  expect(skill).toContain("Onset Energy BUILD Gate");
  expect(skill).toContain("ONSET_ENERGY_ABSOLUTE_RMS_DBFS");
  expect(skill).toContain("ONSET_ENERGY_PEAK_DELTA_DB");
  expect(skill).toContain("generate-onset-energy-calibration.mjs");
  expect(skill).toContain("fourth additive BUILD row");
  expect(skill).toContain("cache-hit re-synth returns the identical glitched take");
  expect(skill).toContain("BUILD Receipts Sidecar");
  expect(skill).toContain("words.raw.json");
  expect(skill).toContain("CACHE_PURGE");
  expect(skill).toContain("--resynth-scene");
  expect(skill).toContain("--no-cache");
  expect(skill).toContain("## Dashboard Types");
  expect(skill).toContain("Type: `decision-flow`");
  expect(skill).toContain("Type: `cinema`");
  expect(skill).toContain("templates/decision-flow/");
  expect(skill).toContain('"type": "decision-flow"');
  expect(skill).toContain("assume the listener has zero prior context");
  expect(skill).toContain("define every internal term, codename, and agent-coined label");
});

test("evals.json canonical case names the full shipping contract", () => {
  const evals = JSON.parse(readFileSync(path.join(here, "evals.json"), "utf8"));
  expect(evals.skill_name).toBe("audio-dashboard");
  expect(evals.evals).toBeArray();
  const canonical = evals.evals.find((item) => item.name === "canonical-readalong-passes");
  expect(canonical).toBeDefined();
  const names = canonical.assertions.map((assertion) => assertion.name);

  expect(names).toContain("requires-real-words-json");
  expect(names).toContain("requires-raw-words-json");
  expect(names).toContain("requires-nonempty-words");
  expect(names).toContain("requires-real-timing-status");
  expect(names).toContain("requires-word-click-seek");
  expect(names).toContain("requires-real-transcript");
  expect(names).toContain("requires-docslocal-publish-source");
  expect(names).toContain("requires-build-receipts");
  expect(names).toContain("requires-tailnet-sync");
  const acoustic = evals.evals.find((item) => item.name === "synthesized-audio-acoustic-artifact-gate");
  expect(acoustic).toBeDefined();
  expect(acoustic.description).toContain("acoustic-artifact invariants");
  expect(acoustic.assertions.map((assertion) => assertion.name)).toContain("flags-duration-word-sibling-ratio");
  expect(acoustic.assertions.map((assertion) => assertion.name)).toContain("flags-high-f0-voiced-frame-count");
  expect(acoustic.assertions.map((assertion) => assertion.name)).toContain("flags-repeated-token-loop-long-drag");
  expect(acoustic.assertions.map((assertion) => assertion.name)).toContain("flags-multi-incident-poisoned-median");
  expect(acoustic.assertions.map((assertion) => assertion.name)).toContain("flags-high-f0-absolute-backstop");
  expect(acoustic.assertions.map((assertion) => assertion.name)).toContain("passes-s3a-like-stable-outlier");
  expect(acoustic.assertions.map((assertion) => assertion.name)).toContain("resynth-busts-tts-cache");
  expect(acoustic.assertions.map((assertion) => assertion.name)).toContain("flags-quiet-onset-absolute-floor");
  expect(acoustic.assertions.map((assertion) => assertion.name)).toContain("flags-quiet-onset-relative-delta");
  expect(acoustic.assertions.map((assertion) => assertion.name)).toContain("calibrates-33-clean-onsets");
  const drift = evals.evals.find((item) => item.name === "teleprompter-tail-drift-gate");
  expect(drift).toBeDefined();
  expect(drift.assertions.map((assertion) => assertion.name)).toContain("passes-banked-in-sync-green-fixture");
  expect(drift.assertions.map((assertion) => assertion.name)).toContain("rejects-tail-only-accumulated-drift");
  expect(drift.assertions.map((assertion) => assertion.name)).toContain("checks-the-tail");
  expect(drift.assertions.map((assertion) => assertion.name)).toContain("runs-under-stop-class-budget");
  const decisions = evals.evals.find((item) => item.name === "native-decision-surface-round-trip");
  expect(decisions).toBeDefined();
  expect(decisions.assertions.map((assertion) => assertion.name)).toContain("renders-spec-decisions");
  expect(decisions.assertions.map((assertion) => assertion.name)).toContain("exports-copy-answers-markdown");
  expect(decisions.assertions.map((assertion) => assertion.name)).toContain("idempotent-injection");
  const decisionFlow = evals.evals.find((item) => item.name === "decision-flow-card-local-audio");
  expect(decisionFlow).toBeDefined();
  expect(decisionFlow.assertions.map((assertion) => assertion.name)).toContain("distinct-from-cinema");
  expect(decisionFlow.assertions.map((assertion) => assertion.name)).toContain("card-local-full-section-audio");
  expect(decisionFlow.assertions.map((assertion) => assertion.name)).toContain("collapses-teleprompter-when-ready");
  expect(decisionFlow.assertions.map((assertion) => assertion.name)).toContain("advances-or-skips");
  const zeroContextNarration = evals.evals.find((item) => item.name === "decision-flow-zero-context-narration");
  expect(zeroContextNarration).toBeDefined();
  expect(zeroContextNarration.assertions.map((assertion) => assertion.name)).toContain("defines-internal-terms-inline");
  expect(zeroContextNarration.assertions.map((assertion) => assertion.name)).toContain("explains-decision-consequences");
  expect(zeroContextNarration.assertions.map((assertion) => assertion.name)).toContain("forbids-unexplained-agent-jargon");
});
