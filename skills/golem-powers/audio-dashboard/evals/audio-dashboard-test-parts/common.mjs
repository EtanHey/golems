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

import { validateAudioDashboardEvidence } from "../../src/audio-dashboard-evidence.mjs";
import {
  analyzeAcousticArtifacts,
  analyzeOnsetEnergy,
  formatOnsetEnergyReport,
  ONSET_ENERGY_DEFAULTS,
} from "../../src/acoustic-artifact-gate.mjs";
import { analyzeTeleprompterDrift, formatTeleprompterDriftReport } from "../../src/teleprompter-drift-gate.mjs";
import {
  analyzeTranscriptFidelity,
  formatTranscriptFidelityReport,
  TRANSCRIPT_FIDELITY_DEFAULTS,
} from "../../src/transcript-fidelity-gate.mjs";
import { createBuildReceipts, readNarrationVendorStamp, writeBuildReceipts } from "../../src/build-receipts.mjs";
import { clearTakeCacheReceiptForByo, writeWordTimingArtifacts } from "../../src/word-timing-artifacts.mjs";
import { formatCachePurgeReceipt, purgeRejectedTakeCaches } from "../../src/take-cache.mjs";
import { answersMarkdown, injectDecisionSurfaceIntoHtml } from "../../src/decision-surface.mjs";
import { buildAfterCodeDashboardPlan } from "../../scripts/audio-dashboard-generator.mjs";
import { renderV4 } from "../../vendor/agent-html/lib/render-v4.mjs";
import { clearTakeCacheReceipt, writeTakeCacheReceipt } from "../../vendor/narrationlayer/local-tts-runner.ts";
import { loadPronunciationRules } from "../../vendor/narrationlayer/pronunciation-config.ts";
import { normalizeForSpeech } from "../../vendor/narrationlayer/text-normalize.ts";

const here = path.dirname(fileURLToPath(new URL("../audio-dashboard.test.mjs", import.meta.url).href));
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

export { test, expect, spawnSync, createHash, chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, tmpdir, fileURLToPath, path, performance, validateAudioDashboardEvidence, analyzeAcousticArtifacts, analyzeOnsetEnergy, formatOnsetEnergyReport, ONSET_ENERGY_DEFAULTS, analyzeTeleprompterDrift, formatTeleprompterDriftReport, analyzeTranscriptFidelity, formatTranscriptFidelityReport, TRANSCRIPT_FIDELITY_DEFAULTS, createBuildReceipts, readNarrationVendorStamp, writeBuildReceipts, clearTakeCacheReceiptForByo, writeWordTimingArtifacts, formatCachePurgeReceipt, purgeRejectedTakeCaches, answersMarkdown, injectDecisionSurfaceIntoHtml, buildAfterCodeDashboardPlan, renderV4, clearTakeCacheReceipt, writeTakeCacheReceipt, loadPronunciationRules, normalizeForSpeech, here, redDir, greenDir, transcriptCalibrationPath, onsetEnergyCalibrationPath, skillPath, skillRoot, placeholderMp3, placeholderMp3Duration, loadFixtures, reds, greens, evidenceReds, evidenceGreens, driftReds, driftGreens, acousticReds, onsetEnergyReds, transcriptReds, publishDriftReds, tpdataFromHtml, writeFixtureFfprobe, writeSegment, writeToneWav, writeStereoToneWav, wordsForDuration, writeAcousticSegment, acousticFixtureSegments, buildDashboard };
