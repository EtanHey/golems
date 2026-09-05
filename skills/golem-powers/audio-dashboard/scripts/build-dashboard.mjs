#!/usr/bin/env bun
/**
 * build-dashboard — SKILL-LOCAL, PORTABLE replacement for agent-html's one-off
 * `host/build-aftercode-tonight.mjs`. Renders the canonical v4 story-mode CINEMA
 * (Q/A sections, Play-All, read-along teleprompter, per-section `.note-area`
 * response boxes) using the VENDORED render-v4 engine — no dependency on
 * $HOME/Gits/agent-html.
 *
 * It reads the per-segment artifacts produced by synth-segments.mjs
 * (<jobDir>/segments/<id>/words.raw.json + words.json + <id>.wav + <id>.mp3) and the same job spec, then:
 *   - loads separate raw gate timing and repaired display timing per scene,
 *   - runs transcript-fidelity, acoustic-artifact, and onset-energy gates,
 *   - embeds the mp3 as a base64 data URI,
 *   - renders via vendored renderV4 (realWordTiming:true when words present),
 *   - runs raw-vs-rendered teleprompter drift and validates words.json + ffprobe(mp3),
 *   - writes the self-contained HTML plus the schema-v1 receipts sidecar.
 *
 * Usage:
 *   bun scripts/build-dashboard.mjs --spec <job.json> [--job-dir <dir>] [--out <html>]
 *
 * The output path MUST be a repo docs.local/dashboards/*.html source file
 * (publish happens via tailnet sync, never a direct dashboards-serve write) —
 * build-dashboard warns loudly if the path is off-contract.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

import { renderV4 } from "../vendor/agent-html/lib/render-v4.mjs";
import { loadPronunciationRules } from "../vendor/narrationlayer/pronunciation-config.ts";
import { deriveSpeechAliases, normalizeForSpeech } from "../vendor/narrationlayer/text-normalize.ts";
import {
  analyzeAcousticArtifacts,
  analyzeOnsetEnergy,
  acousticArtifactRunbook,
  formatAcousticArtifactReport,
  formatOnsetEnergyReport,
  onsetEnergyRunbook,
} from "../src/acoustic-artifact-gate.mjs";
import {
  analyzeVoiceRoles,
  formatVoiceRoleReport,
  voiceRoleRunbook,
} from "../src/voice-role-gate.mjs";
import {
  analyzeTranscriptFidelity,
  formatTranscriptFidelityReport,
  transcriptFidelityRunbook,
} from "../src/transcript-fidelity-gate.mjs";
import { formatCachePurgeReceipt, purgeRejectedTakeCaches } from "../src/take-cache.mjs";
import {
  appendCompletedPurges,
  buildReceiptsPath,
  createBuildReceipts,
  readNarrationVendorStamp,
  resolveWhisperModelBasename,
  upsertBuildGate,
  writeBuildReceipts,
} from "../src/build-receipts.mjs";
import { analyzeTeleprompterDrift, formatTeleprompterDriftReport } from "../src/teleprompter-drift-gate.mjs";
import { injectDecisionSurfaceIntoHtml } from "../src/decision-surface.mjs";
import { renderDecisionFlow } from "../src/decision-flow.mjs";

const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function expandHome(value) {
  if (value === "~") return os.homedir();
  if (value?.startsWith?.("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

function fail(message) {
  console.error(`[build-dashboard] FATAL: ${message}`);
  process.exit(1);
}

function rejectSynthProvenance({ buildReceipts, outPath, sceneId, metric, evidence, message }) {
  const result = {
    verdict: "REJECTED",
    thresholds: { byteEquality: 1 },
    stats: [],
    violations: [{
      segment: sceneId,
      metric,
      value: 0,
      threshold: 1,
      evidence,
    }],
  };
  upsertBuildGate(buildReceipts, {
    gate: "transcript-fidelity",
    result,
    config: result.thresholds,
    runbook: transcriptFidelityRunbook(result),
  });
  writeBuildReceipts(outPath, buildReceipts, "");
  fail(`${message}\n${formatTranscriptFidelityReport(result)}`);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--spec") args.spec = argv[++i];
    else if (a === "--job-dir") args.jobDir = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "-h" || a === "--help") args.help = true;
    else fail(`unknown argument: ${a}`);
  }
  return args;
}

function safePathId(value, label) {
  const id = String(value ?? "");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) {
    fail(`${label} must be a slug-safe path segment: ${id || "<empty>"}`);
  }
  return id;
}

function normalizeDeferredScenes(value, shippedSceneIds) {
  if (value == null) return [];
  if (!Array.isArray(value)) fail("spec.deferredScenes must be an array");
  const seen = new Set();
  return value.map((row, index) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      fail(`spec.deferredScenes[${index}] must be an object`);
    }
    for (const field of ["id", "status", "reason", "ruling"]) {
      if (typeof row[field] !== "string") {
        fail(`spec.deferredScenes[${index}].${field} must be a string`);
      }
    }
    const id = safePathId(row.id.trim(), `spec.deferredScenes[${index}].id`);
    if (seen.has(id)) fail(`duplicate deferred scene id: ${id}`);
    if (shippedSceneIds.has(id)) fail(`deferred scene ${id} must not also appear in spec.scenes`);
    seen.add(id);
    const status = row.status.trim();
    const reason = row.reason.trim();
    const ruling = row.ruling.trim();
    if (status !== "DEFERRED") fail(`deferred scene ${id} status must be DEFERRED`);
    if (!reason) fail(`deferred scene ${id} requires a reason`);
    if (!ruling) fail(`deferred scene ${id} requires a ruling`);
    return { id, status, reason, ruling };
  });
}

function loadWords(wordsPath) {
  if (!existsSync(wordsPath)) return [];
  const raw = JSON.parse(readFileSync(wordsPath, "utf8"));
  if (!Array.isArray(raw)) throw new Error(`word timing file must be an array: ${wordsPath}`);
  return raw.map((w, index) => {
    const word = String(w.word ?? w.text ?? "").trim();
    const start = Number(w.start);
    const end = Number(w.end);
    if (!word || !Number.isFinite(start) || !Number.isFinite(end)) {
      throw new Error(`invalid word timing at ${wordsPath}[${index}]`);
    }
    return { word, start, end };
  });
}

function ffprobeDurationSeconds(mp3Path) {
  const result = spawnSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", mp3Path],
    { encoding: "utf8" },
  );
  if (result.error) fail(`ffprobe not runnable (${result.error.message}). Run scripts/bootstrap.mjs.`);
  if (result.status !== 0) fail(`ffprobe failed for ${mp3Path} (exit ${result.status})`);
  const duration = Number((result.stdout || "").trim());
  if (!Number.isFinite(duration) || duration <= 0) fail(`ffprobe returned invalid duration for ${mp3Path}`);
  return duration;
}

function parseTpdata(html) {
  const match = html.match(/<script[^>]*id=["']tpdata["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) fail("rendered HTML is missing <script id=\"tpdata\">");
  try {
    return JSON.parse(match[1].trim());
  } catch (err) {
    fail(`rendered tpdata is not valid JSON: ${err?.message || err}`);
  }
}

function assertWordsPreserved(sceneId, renderedWords, sourceWords) {
  if (!Array.isArray(renderedWords) || renderedWords.length === 0) {
    fail(`scene ${sceneId}: final tpdata has no word timings`);
  }
  if (renderedWords.length !== sourceWords.length) {
    fail(`scene ${sceneId}: final tpdata word count ${renderedWords.length} does not match words.json ${sourceWords.length}`);
  }
  for (let index = 0; index < renderedWords.length; index += 1) {
    const rendered = renderedWords[index];
    const source = sourceWords[index];
    const start = Number(rendered.start);
    const end = Number(rendered.end);
    if (!rendered.word || !Number.isFinite(start) || !Number.isFinite(end)) {
      fail(`scene ${sceneId}: final tpdata word ${index} is missing finite word/start/end`);
    }
    if (end <= start) {
      fail(`scene ${sceneId}: final tpdata word ${index} must have positive duration`);
    }
    if (index > 0 && start < Number(renderedWords[index - 1].end) - 0.001) {
      fail(`scene ${sceneId}: final tpdata words must be monotonic and non-overlapping at word ${index}`);
    }
    if (Math.abs(start - source.start) > 0.001 || Math.abs(end - source.end) > 0.001) {
      fail(`scene ${sceneId}: final tpdata word ${index} timing changed from words.json`);
    }
  }
}

function assertRenderedTiming(html, artifacts) {
  const tpdata = parseTpdata(html);
  for (const artifact of artifacts) {
    const sceneTiming = tpdata[artifact.id];
    const cue = sceneTiming?.cues?.[0];
    assertWordsPreserved(artifact.id, cue?.words, artifact.words);

    const total = Number(sceneTiming.total);
    if (!Number.isFinite(total)) fail(`scene ${artifact.id}: final tpdata.total is not finite`);
    const mp3Duration = ffprobeDurationSeconds(artifact.mp3);
    const delta = Math.abs(total - mp3Duration);
    if (delta > 0.5) {
      fail(
        `scene ${artifact.id}: final tpdata.total ${total.toFixed(3)}s disagrees with ffprobe(${path.basename(artifact.mp3)}) ${mp3Duration.toFixed(3)}s by ${delta.toFixed(3)}s`,
      );
    }
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("usage: bun scripts/build-dashboard.mjs --spec <job.json> [--job-dir <dir>] [--out <html>]");
    process.exit(0);
  }
  if (!args.spec) fail("--spec <job.json> is required");
  const specPath = path.resolve(expandHome(args.spec));
  if (!existsSync(specPath)) fail(`spec not found: ${specPath}`);
  const spec = JSON.parse(readFileSync(specPath, "utf8"));
  if (!Array.isArray(spec.scenes) || spec.scenes.length === 0) fail("spec.scenes must be a non-empty array");
  const dashboardType = spec.type || "cinema";
  if (!["cinema", "decision-flow"].includes(dashboardType)) {
    fail(`unsupported spec.type: ${dashboardType}`);
  }

  const jobId = safePathId(spec.id || "audio-dashboard-job", "spec.id");
  const jobDir = path.resolve(
    expandHome(args.jobDir || path.join(os.homedir(), ".narrationlayer", "jobs", jobId)),
  );
  const outPath = path.resolve(expandHome(args.out || spec.outputPath || ""));
  if (!args.out && !spec.outputPath) fail("no output path: pass --out or set spec.outputPath");
  if (!/\/docs\.local\/dashboards\/.+\.html$/i.test(outPath)) {
    console.error(`[build-dashboard] WARN: output path is off-contract (expected a repo docs.local/dashboards/*.html source): ${outPath}`);
  }
  if (/\/dashboards-serve\/dashboards\//i.test(outPath)) {
    fail(`refusing to write directly into a dashboards-serve tree: ${outPath}. Write the docs.local source and publish via tailnet sync.`);
  }
  const shippedSceneIds = new Set(spec.scenes.map((scene) => safePathId(scene.id, "scene.id")));
  const deferredScenes = normalizeDeferredScenes(spec.deferredScenes, shippedSceneIds);
  if (dashboardType !== "cinema" && deferredScenes.length) {
    fail("spec.deferredScenes is currently supported only for cinema dashboards");
  }
  const normalizedSpec = { ...spec, deferredScenes };
  const buildReceipts = createBuildReceipts({
    outputPath: outPath,
    jobId,
    spec: normalizedSpec,
    vendorStamp: readNarrationVendorStamp(SKILL_ROOT),
    whisperModel: resolveWhisperModelBasename(),
  });
  // Once input and output preflight succeeds, a failed replacement build must
  // not leave an earlier dashboard or all-PASS sidecar eligible for publication.
  // Later handled rejects write a fresh sidecar after this replacement cleanup.
  rmSync(outPath, { force: true });
  rmSync(buildReceiptsPath(outPath), { force: true });

  // VOICE-ROLE gate (Etan's ruling 2026-08-04: Ben is the HOST, Theo is the EXPERT).
  // Runs on the SPEC, before any synthesis: a role/voice inversion is knowable from
  // the job file alone, so there is no reason to spend a full TTS render discovering
  // it. Fail-closed — a contradiction rejects, it does not warn.
  const voiceRoles = analyzeVoiceRoles(spec.scenes, { overrides: spec.voiceRoleOverrides ?? {} });
  upsertBuildGate(buildReceipts, {
    gate: "voice-role",
    result: voiceRoles,
    config: voiceRoles.thresholds,
    runbook: voiceRoleRunbook(voiceRoles),
  });
  if (voiceRoles.verdict !== "PASS") {
    writeBuildReceipts(outPath, buildReceipts, "");
    fail(formatVoiceRoleReport(voiceRoles));
  }

  const scenes = [];
  const artifacts = [];
  let pronunciationRules;
  let withWords = 0;
  const missing = [];
  let hasMissingRawWords = false;
  let hasMissingScript = false;
  const seenSceneIds = new Set();
  for (const s of spec.scenes) {
    const sceneId = safePathId(s.id, "scene.id");
    if (seenSceneIds.has(sceneId)) fail(`duplicate scene.id: ${sceneId}`);
    seenSceneIds.add(sceneId);
    const segDir = path.join(jobDir, "segments", sceneId);
    const rawWordsPath = path.join(segDir, "words.raw.json");
    const wordsPath = path.join(segDir, "words.json");
    let rawWords = [];
    try {
      rawWords = loadWords(rawWordsPath);
    } catch {
      // The typed transcript gate below owns invalid raw input; receipt evidence
      // stays portable and does not copy the machine-local path.
    }
    let words;
    try {
      words = loadWords(wordsPath);
    } catch (error) {
      fail(error?.message || error);
    }
    if (!rawWords.length) {
      missing.push(`words.raw:${sceneId}`);
      hasMissingRawWords = true;
    }
    if (typeof s.script !== "string" || !s.script.trim()) hasMissingScript = true;
    if (words.length) withWords += 1;
    else missing.push(`words:${sceneId}`);

    const mp3 = path.join(segDir, `${sceneId}.mp3`);
    const wav = path.join(segDir, `${sceneId}.wav`);
    const spokenPath = `${wav}.spoken.txt`;
    let spokenText = "";
    if (!s.audioWav) {
      let expectedSpokenBytes;
      let expectedSha256 = "UNAVAILABLE";
      if (typeof s.script === "string") {
        pronunciationRules ??= loadPronunciationRules();
        const expectedSpokenText = normalizeForSpeech(s.script, pronunciationRules);
        expectedSpokenBytes = Buffer.from(expectedSpokenText, "utf8");
        expectedSha256 = createHash("sha256").update(expectedSpokenBytes).digest("hex");
      }
      if (!existsSync(spokenPath)) {
        rejectSynthProvenance({
          buildReceipts,
          outPath,
          sceneId,
          metric: "MISSING_SYNTH_PROVENANCE_SERIES",
          evidence:
            `sidecarPresent=false byteEqual=false expectedBytes=${expectedSpokenBytes?.length ?? 0} ` +
            `actualBytes=0 expectedSha256=${expectedSha256} actualSha256=ABSENT`,
          message: `scene ${sceneId}: required synth-input sidecar is missing; rerun synth-segments`,
        });
      }
      const spokenBytes = readFileSync(spokenPath);
      spokenText = spokenBytes.toString("utf8");
      if (expectedSpokenBytes) {
        if (!spokenBytes.equals(expectedSpokenBytes)) {
          const actualSha256 = createHash("sha256").update(spokenBytes).digest("hex");
          rejectSynthProvenance({
            buildReceipts,
            outPath,
            sceneId,
            metric: "SYNTH_PROVENANCE_STALE",
            evidence:
              `byteEqual=false expectedBytes=${expectedSpokenBytes.length} actualBytes=${spokenBytes.length} ` +
              `expectedSha256=${expectedSha256} actualSha256=${actualSha256}`,
            message: spokenBytes.length
              ? `scene ${sceneId}: synth-input sidecar is stale; rerun synth-segments`
              : `scene ${sceneId}: synth-input sidecar is empty; rerun synth-segments`,
          });
        }
      }
    }
    const speechAliases = spokenText
      ? deriveSpeechAliases(s.script, spokenText)
      : [];
    let audioUrl;
    if (existsSync(mp3)) audioUrl = `data:audio/mpeg;base64,${readFileSync(mp3).toString("base64")}`;
    else missing.push(`audio:${sceneId}`);
    if (!existsSync(wav)) missing.push(`wav:${sceneId}`);

    scenes.push({
      id: sceneId,
      domain: s.domain || "overview",
      ...(s.domainLabel ? { domainLabel: s.domainLabel } : {}),
      title: s.title || sceneId,
      script: s.script,
      words,
      ...(existsSync(mp3) ? { duration: ffprobeDurationSeconds(mp3) } : {}),
      ...(audioUrl ? { audioUrl } : {}),
    });
    artifacts.push({
      id: sceneId,
      role: s.role || "default",
      script: s.script,
      synthScript: spokenText || s.script,
      speechAliases,
      rawWords,
      rawWordsPath,
      words,
      wordsPath,
      cacheReceiptPath: `${wav}.cache.json`,
      sourceKind: s.audioWav ? "BYO" : "TTS",
      mp3,
      wav,
    });
  }

  if (hasMissingRawWords || hasMissingScript) {
    const transcriptFidelity = analyzeTranscriptFidelity({
      segments: artifacts.map((artifact) => ({
        id: artifact.id,
        script: artifact.synthScript,
        rawWords: artifact.rawWords,
        sourceKind: artifact.sourceKind,
      })),
    });
    upsertBuildGate(buildReceipts, {
      gate: "transcript-fidelity",
      result: transcriptFidelity,
      config: transcriptFidelity.thresholds,
      runbook: transcriptFidelityRunbook(transcriptFidelity),
    });
    const purgeResults = purgeRejectedTakeCaches({
      artifacts,
      rejectedSegments: transcriptFidelity.violations
        .filter((violation) => violation.metric !== "SCRIPTLESS_SCENE_UNSUPPORTED"),
    });
    for (const receipt of purgeResults) {
      console.error(`[build-dashboard] ${formatCachePurgeReceipt(receipt)}`);
    }
    appendCompletedPurges(buildReceipts, purgeResults, "transcript-fidelity REJECT");
    writeBuildReceipts(outPath, buildReceipts, "");
    fail(formatTranscriptFidelityReport(transcriptFidelity));
  }

  // A read-along dashboard's contract is real words.json + real audio PER
  // segment. Fail before rendering so callers do not pick up a partial HTML.
  if (missing.length) {
    fail(`per-segment artifacts missing: ${missing.join(", ")}. Every scene needs real words.raw.json + words.json + wav + mp3 (re-run synth-segments).`);
  }

  let html;
  if (dashboardType === "decision-flow") {
    try {
      html = renderDecisionFlow({
        title: spec.title || "Decision flow",
        kicker: spec.kicker || "Decision flow",
        heading: spec.heading || spec.title || "Decisions",
        subtitle: spec.subtitle || undefined,
        scenes,
        decisions: spec.decisions,
        storageKey: spec.decisionSurface?.storageKey || spec.decisionStorageKey || `dbx:${jobId}`,
        cinemaUrl: spec.cinemaUrl || spec.decisionCinemaUrl,
      });
    } catch (error) {
      fail(error?.message || error);
    }
  } else {
    html = renderV4({
      id: spec.id,
      title: spec.title || "Audio Dashboard",
      kicker: spec.kicker || "Story Mode · V4",
      heading: spec.heading || spec.title || "Audio Dashboard",
      subtitle: spec.subtitle || undefined,
      railLabel: spec.railLabel || undefined,
      visibility: spec.visibility || "public",
      scenes,
      deferredScenes,
      storageKey: `dbx:${jobId}`,
    });
  }

  if (dashboardType === "cinema" && Array.isArray(spec.decisions)) {
    const decisionSurface = spec.decisionSurface || {};
    html = injectDecisionSurfaceIntoHtml(html, spec.decisions, {
      storageKey: decisionSurface.storageKey || spec.decisionStorageKey || `dbx:${jobId}`,
      title: decisionSurface.title || spec.decisionTitle || "Your answers",
      lede: decisionSurface.lede || spec.decisionLede,
      answerSink: decisionSurface.answerSink || spec.answerSink || spec.decisionAnswerSink,
    }).html;
  }

  const transcriptFidelity = analyzeTranscriptFidelity({
    segments: artifacts.map((artifact) => ({
      id: artifact.id,
      script: artifact.synthScript,
      rawWords: artifact.rawWords,
      sourceKind: artifact.sourceKind,
    })),
  });
  upsertBuildGate(buildReceipts, {
    gate: "transcript-fidelity",
    result: transcriptFidelity,
    config: transcriptFidelity.thresholds,
    runbook: transcriptFidelityRunbook(transcriptFidelity),
  });
  if (transcriptFidelity.verdict !== "PASS") {
    const purgeResults = purgeRejectedTakeCaches({
      artifacts,
      rejectedSegments: transcriptFidelity.violations,
    });
    for (const receipt of purgeResults) {
      console.error(`[build-dashboard] ${formatCachePurgeReceipt(receipt)}`);
    }
    appendCompletedPurges(buildReceipts, purgeResults, "transcript-fidelity REJECT");
    writeBuildReceipts(outPath, buildReceipts, html);
    fail(formatTranscriptFidelityReport(transcriptFidelity));
  }
  writeBuildReceipts(outPath, buildReceipts, html);

  const acoustic = analyzeAcousticArtifacts(
    artifacts.map((artifact) => ({
      id: artifact.id,
      role: artifact.role,
      wavPath: artifact.wav,
      wavBytes: readFileSync(artifact.wav),
      wordCount: artifact.words.length,
      sourceKind: artifact.sourceKind,
    })),
  );
  upsertBuildGate(buildReceipts, {
    gate: "acoustic",
    result: acoustic,
    config: acoustic.thresholds,
    runbook: acousticArtifactRunbook(acoustic),
  });
  if (acoustic.verdict !== "PASS") {
    const purgeResults = purgeRejectedTakeCaches({
      artifacts,
      rejectedSegments: acoustic.violations,
    });
    for (const receipt of purgeResults) {
      console.error(`[build-dashboard] ${formatCachePurgeReceipt(receipt)}`);
    }
    appendCompletedPurges(buildReceipts, purgeResults, "acoustic-gate REJECT");
    writeBuildReceipts(outPath, buildReceipts, html);
    fail(formatAcousticArtifactReport(acoustic));
  }
  writeBuildReceipts(outPath, buildReceipts, html);

  const onsetEnergy = analyzeOnsetEnergy(
    artifacts.map((artifact) => ({
      id: artifact.id,
      role: artifact.role,
      wavPath: artifact.wav,
      wavBytes: readFileSync(artifact.wav),
      sourceKind: artifact.sourceKind,
    })),
  );
  upsertBuildGate(buildReceipts, {
    gate: "onset-energy",
    result: onsetEnergy,
    config: onsetEnergy.thresholds,
    runbook: onsetEnergyRunbook(onsetEnergy),
  });
  if (onsetEnergy.verdict !== "PASS") {
    const purgeResults = purgeRejectedTakeCaches({
      artifacts,
      rejectedSegments: onsetEnergy.violations,
    });
    for (const receipt of purgeResults) {
      console.error(`[build-dashboard] ${formatCachePurgeReceipt(receipt)}`);
    }
    appendCompletedPurges(buildReceipts, purgeResults, "onset-energy REJECT");
    writeBuildReceipts(outPath, buildReceipts, html);
    fail(formatOnsetEnergyReport(onsetEnergy));
  }
  writeBuildReceipts(outPath, buildReceipts, html);

  const tpdata = parseTpdata(html);
  const teleprompterDrift = analyzeTeleprompterDrift({
    segments: artifacts.map((artifact) => ({
      id: artifact.id,
      transcript: artifact.script,
      sourceWords: artifact.rawWords,
      renderedWords: tpdata[artifact.id]?.cues?.[0]?.words,
      aliases: artifact.speechAliases,
    })),
  });
  upsertBuildGate(buildReceipts, {
    gate: "teleprompter-drift",
    result: teleprompterDrift,
    config: teleprompterDrift.thresholds,
    runbook: "Re-roll rejected segments from raw Whisper timing, rebuild, then rerun the drift gate.",
    derivedAliases: artifacts.flatMap((artifact) => artifact.speechAliases.map((alias) => ({
      segment: artifact.id,
      term: alias.term,
      spoken: alias.spoken,
    }))),
  });
  writeBuildReceipts(outPath, buildReceipts, html);
  if (teleprompterDrift.verdict !== "PASS") {
    fail(formatTeleprompterDriftReport(teleprompterDrift));
  }

  assertRenderedTiming(html, artifacts);

  const hasData = html.includes("data:audio/mpeg;base64,");
  const hasRealFlag = html.includes('"realWordTiming":true');
  const hasNoteArea = /class=["'][^"']*\bnote-area\b[^"']*["']/i.test(html);
  if (!hasData) fail("rendered HTML has no embedded data:audio mp3");
  if (!hasRealFlag) fail("rendered HTML has no realWordTiming:true — words.json missing or empty for every scene");
  if (!hasNoteArea) fail("rendered HTML has no .note-area response boxes");

  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, html);
  writeBuildReceipts(outPath, buildReceipts, html);

  console.error(
    `[build-dashboard] BUILT ${outPath}\n` +
      `  scenes: ${scenes.length}  with-words: ${withWords}/${scenes.length}\n` +
      `  embedded data:audio: ${hasData}  realWordTiming: ${hasRealFlag}  note-area: ${hasNoteArea}\n` +
      `  bytes: ${html.length}  missing: ${missing.length ? missing.join(", ") : "none"}`,
  );
}

main();
