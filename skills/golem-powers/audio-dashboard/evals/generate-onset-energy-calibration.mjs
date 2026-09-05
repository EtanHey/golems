#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  analyzeOnsetEnergy,
  ONSET_ENERGY_DEFAULTS,
} from "../src/acoustic-artifact-gate.mjs";

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--job") args.job = argv[++index];
    else if (value === "--out") args.out = argv[++index];
    else throw new Error(`unknown argument: ${value}`);
  }
  if (!args.job) throw new Error("--job <job.json> is required");
  if (!args.out) throw new Error("--out <receipt.json> is required");
  return args;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function rounded(value) {
  return Number(value.toFixed(6));
}

function portableViolation(violation) {
  return {
    segment: String(violation.segment),
    ...(violation.role == null ? {} : { role: String(violation.role) }),
    metric: String(violation.metric),
    value: violation.value ?? null,
    threshold: violation.threshold ?? null,
    evidence: String(violation.evidence),
  };
}

export function summarizeOnsetCalibrationRows(rows) {
  return {
    sceneCount: rows.length,
    pass: rows.filter((row) => row.verdict === "PASS").length,
    rejected: rows.filter((row) => row.verdict !== "PASS").length,
    unexpectedRejects: rows.filter((row) => row.verdict !== "PASS").map((row) => row.id),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const jobPath = path.resolve(args.job);
  const outputPath = path.resolve(args.out);
  const job = await Bun.file(jobPath).json();
  if (!Array.isArray(job.scenes) || !job.scenes.length) throw new Error("job.scenes must be a non-empty array");
  const jobDir = path.resolve(job.jobDir || path.dirname(jobPath));
  const rows = [];

  for (const [index, scene] of job.scenes.entries()) {
    const sceneId = String(scene.id);
    const wavBasename = `${sceneId}.wav`;
    const wavPath = path.join(jobDir, "segments", sceneId, wavBasename);
    const wavBytes = readFileSync(wavPath);
    const result = analyzeOnsetEnergy([{
      id: sceneId,
      role: scene.role || "default",
      wavPath,
      wavBytes,
    }]);
    const stat = result.stats[0];
    rows.push({
      id: sceneId,
      classification: "CLEAN",
      wavBasename,
      wavSha256: sha256(wavBytes),
      onsetWindowSeconds: rounded(stat.onsetWindowSeconds),
      onsetRmsDbfs: rounded(stat.onsetRmsDbfs),
      segmentPeakDbfs: rounded(stat.segmentPeakDbfs),
      onsetPeakDeltaDb: rounded(stat.onsetPeakDeltaDb),
      verdict: result.verdict,
      violations: result.violations.map(portableViolation),
    });
    console.log(
      `[calibration] ${index + 1}/${job.scenes.length} ${sceneId} ${result.verdict} ` +
      `onset=${stat.onsetRmsDbfs.toFixed(3)}dBFS delta=${stat.onsetPeakDeltaDb.toFixed(3)}dB`,
    );
  }

  const summary = summarizeOnsetCalibrationRows(rows);
  const receipt = {
    version: 1,
    kind: "ONSET_ENERGY_CALIBRATION",
    calibrationDate: "2026-07-17",
    source: {
      provenanceClass: "REAL_NARRATION_CORPUS",
      jobId: String(job.id),
      analyzer: "analyzeOnsetEnergy",
      wavCorpusSha256: sha256(JSON.stringify(rows.map((row) => [row.id, row.wavSha256]))),
    },
    gateConfig: { ...ONSET_ENERGY_DEFAULTS },
    summary,
    scenes: rows,
  };

  mkdirSync(path.dirname(outputPath), { recursive: true });
  await Bun.write(outputPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(
    `[calibration] receipt=${path.basename(outputPath)} pass=${summary.pass} rejected=${summary.rejected}`,
  );
  if (summary.unexpectedRejects.length) process.exitCode = 1;
}

if (import.meta.main) await main();
