#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";

import {
  analyzeTranscriptFidelity,
  TRANSCRIPT_FIDELITY_DEFAULTS,
} from "../src/transcript-fidelity-gate.mjs";
import { resolveWhisperModelBasename } from "../src/build-receipts.mjs";
import { runWhisperCliWordTimings } from "../vendor/narrationlayer/word-timings.ts";

function parseArgs(argv) {
  const args = { incidentRepeatCount: 3, incidentIds: ["s9q", "s13a"] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--job") args.job = argv[++index];
    else if (value === "--out") args.out = argv[++index];
    else if (value === "--incidents") args.incidentIds = String(argv[++index] ?? "").split(",").filter(Boolean);
    else if (value === "--incident-repeats") args.incidentRepeatCount = Number(argv[++index]);
    else throw new Error(`unknown argument: ${value}`);
  }
  if (!args.job) throw new Error("--job <job.json> is required");
  if (!args.out) throw new Error("--out <receipt.json> is required");
  if (!Number.isInteger(args.incidentRepeatCount) || args.incidentRepeatCount < 1) {
    throw new Error("--incident-repeats must be a positive integer");
  }
  return args;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function portableViolation(violation) {
  return {
    segment: String(violation.segment),
    metric: String(violation.metric),
    value: violation.value ?? null,
    threshold: violation.threshold ?? null,
    evidence: String(violation.evidence),
  };
}

export function summarizeCalibrationRows(rows, incidentIds) {
  const incidents = new Set(incidentIds);
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  return {
    sceneCount: rows.length,
    cleanExpected: rows.filter((row) => !incidents.has(row.id)).length,
    pass: rows.filter((row) => row.verdict === "PASS").length,
    rejected: rows.filter((row) => row.verdict !== "PASS").length,
    unexpectedRejects: rows
      .filter((row) => !incidents.has(row.id) && row.verdict !== "PASS")
      .map((row) => row.id),
    missedIncidents: [...incidents].filter((id) => !rowsById.has(id) || rowsById.get(id).verdict === "PASS"),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const jobPath = path.resolve(args.job);
  const outputPath = path.resolve(args.out);
  const job = await Bun.file(jobPath).json();
  if (!Array.isArray(job.scenes) || !job.scenes.length) throw new Error("job.scenes must be a non-empty array");
  const jobDir = path.resolve(job.jobDir || path.dirname(jobPath));
  const incidents = new Set(args.incidentIds);
  const rows = [];

  for (const [index, scene] of job.scenes.entries()) {
    const sceneId = String(scene.id);
    const wavPath = path.join(jobDir, "segments", sceneId, `${sceneId}.wav`);
    const first = await runWhisperCliWordTimings(wavPath);
    const encoded = JSON.stringify(first.words);
    if (incidents.has(sceneId)) {
      for (let repeat = 1; repeat < args.incidentRepeatCount; repeat += 1) {
        const replay = await runWhisperCliWordTimings(wavPath);
        if (JSON.stringify(replay.words) !== encoded) {
          throw new Error(`${sceneId} decode ${repeat + 1} differed from the first complete word array`);
        }
      }
    }
    const result = analyzeTranscriptFidelity({
      segments: [{ id: sceneId, script: scene.script, rawWords: first.words }],
    });
    const stat = result.stats[0];
    rows.push({
      id: sceneId,
      classification: incidents.has(sceneId) ? "INCIDENT" : "CLEAN",
      wavBasename: `${sceneId}.wav`,
      scriptWordCount: stat.scriptWordCount,
      rawWordCount: stat.rawWordCount,
      rawWordsSha256: sha256(encoded),
      verdict: result.verdict,
      violations: result.violations.map(portableViolation),
    });
    console.log(
      `[calibration] ${index + 1}/${job.scenes.length} ${sceneId} ${result.verdict} words=${first.words.length}`,
    );
  }

  const summary = summarizeCalibrationRows(rows, args.incidentIds);
  const rawCorpusSha256 = sha256(JSON.stringify(rows.map((row) => [row.id, row.rawWordsSha256])));
  const receipt = {
    version: 1,
    kind: "TRANSCRIPT_FIDELITY_CALIBRATION",
    calibrationDate: "2026-07-17",
    source: {
      provenanceClass: "REAL_DETERMINISTIC_DECODE",
      jobId: String(job.id),
      decoder: "runWhisperCliWordTimings",
      whisperModel: resolveWhisperModelBasename(),
      incidentRepeatCount: args.incidentRepeatCount,
      rawCorpusSha256,
    },
    gateConfig: { ...TRANSCRIPT_FIDELITY_DEFAULTS },
    expectedIncidents: [...incidents],
    summary,
    scenes: rows,
  };

  mkdirSync(path.dirname(outputPath), { recursive: true });
  await Bun.write(outputPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(
    `[calibration] receipt=${path.basename(outputPath)} pass=${receipt.summary.pass} rejected=${receipt.summary.rejected}`,
  );
  if (summary.unexpectedRejects.length || summary.missedIncidents.length) process.exitCode = 1;
}

if (import.meta.main) await main();
