#!/usr/bin/env bun
/**
 * Regenerate the portable word-end-truncation calibration receipt from a real
 * narration job. Deterministic and offline — it decodes the WAVs already on disk
 * and records every render boundary the gate measured, so the true-positive and
 * false-positive counts in SKILL.md can be re-derived by anyone with the corpus.
 *
 *   bun evals/generate-word-end-truncation-calibration.mjs \
 *     --job ~/.narrationlayer/jobs/<jobId>/job.json \
 *     --out evals/fixtures/calibration/<date>-<job>-word-end-truncation.json
 *
 * `--labels <file.json>` optionally attaches externally established ground truth
 * (e.g. the fresh-take A/B in docs) as `{ "<segment>@<boundarySeconds>": "TRUNCATED" | "CLEAN" }`.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  analyzeWordEndTruncation,
  WORD_END_TRUNCATION_DEFAULTS,
} from "../src/word-end-truncation-gate.mjs";

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--job") args.job = argv[++index];
    else if (value === "--out") args.out = argv[++index];
    else if (value === "--labels") args.labels = argv[++index];
    else throw new Error(`unknown argument: ${value}`);
  }
  if (!args.job) throw new Error("--job <job.json> is required");
  if (!args.out) throw new Error("--out <receipt.json> is required");
  return args;
}

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function pieceLastWordsFromSynthScript(synthScript) {
  return String(synthScript ?? "")
    .split(/(?<=[.?!]["'”’)\]}»]*)\s+/u)
    .map((piece) => piece.trim())
    .filter(Boolean)
    .map((piece) => {
      const words = piece.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? [];
      return words[words.length - 1] ?? "";
    });
}

export function summarizeWordEndCalibration(units, labels) {
  const flagged = units.filter((unit) => unit.flagged);
  const labelled = units.filter((unit) => unit.groundTruth);
  return {
    segmentCount: new Set(units.map((unit) => unit.segment)).size,
    renderBoundaryCount: units.length,
    flaggedCount: flagged.length,
    cleanCount: units.length - flagged.length,
    labelledCount: labelled.length,
    truePositives: labelled.filter((u) => u.flagged && u.groundTruth === "TRUNCATED").length,
    falsePositives: labelled.filter((u) => u.flagged && u.groundTruth === "CLEAN").length,
    falseNegatives: labelled.filter((u) => !u.flagged && u.groundTruth === "TRUNCATED").length,
    trueNegatives: labelled.filter((u) => !u.flagged && u.groundTruth === "CLEAN").length,
    labelSource: labels ? "EXTERNAL_FRESH_TAKE_AB" : "NONE",
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const jobPath = path.resolve(args.job);
  const job = JSON.parse(readFileSync(jobPath, "utf8"));
  const jobDir = job.jobDir ? path.resolve(job.jobDir) : path.dirname(jobPath);
  const labels = args.labels ? JSON.parse(readFileSync(path.resolve(args.labels), "utf8")) : null;

  const segments = [];
  const wavHashes = [];
  for (const scene of job.scenes ?? []) {
    const segDir = path.join(jobDir, "segments", scene.id);
    const wavPath = path.join(segDir, `${scene.id}.wav`);
    if (!existsSync(wavPath)) continue;
    const wavBytes = readFileSync(wavPath);
    const spokenPath = `${wavPath}.spoken.txt`;
    const rawPath = path.join(segDir, "words.raw.json");
    wavHashes.push(sha256(wavBytes));
    segments.push({
      id: scene.id,
      role: scene.role ?? "default",
      sourceKind: scene.audioWav ? "BYO" : "TTS",
      wavPath,
      wavBytes,
      wavSha256: wavHashes[wavHashes.length - 1],
      rawWords: existsSync(rawPath) ? JSON.parse(readFileSync(rawPath, "utf8")) : [],
      pieceLastWords: existsSync(spokenPath)
        ? pieceLastWordsFromSynthScript(readFileSync(spokenPath, "utf8"))
        : undefined,
    });
  }
  if (!segments.length) throw new Error(`no segment WAVs found under ${jobDir}/segments`);

  const result = analyzeWordEndTruncation(segments);
  const thresholds = result.thresholds;
  const units = result.stats.flatMap((stat) =>
    stat.units.map((unit) => {
      const key = `${stat.id}@${unit.boundarySeconds}`;
      return {
        segment: stat.id,
        role: stat.role,
        sourceKind: stat.sourceKind,
        wavBasename: path.basename(stat.wavPath),
        boundarySeconds: unit.boundarySeconds,
        word: unit.word,
        attribution: unit.attribution,
        offsetRmsDbfs: unit.offsetRmsDbfs,
        speechRmsDbfs: stat.speechRmsDbfs,
        offsetRelDb: unit.offsetRelDb,
        flagged:
          unit.offsetRmsDbfs >= thresholds.offsetMaxRmsDbfs &&
          unit.offsetRelDb >= thresholds.offsetMaxRelDb,
        ...(labels?.[key] ? { groundTruth: labels[key] } : {}),
      };
    }),
  );

  const receipt = {
    version: 1,
    kind: "WORD_END_TRUNCATION_CALIBRATION",
    calibrationDate: new Date().toISOString().slice(0, 10),
    source: {
      provenanceClass: "REAL_NARRATION_CORPUS",
      jobId: String(job.id ?? path.basename(jobDir)),
      analyzer: "analyzeWordEndTruncation",
      wavCorpusSha256: sha256(wavHashes.join("\n")),
    },
    gateConfig: { ...WORD_END_TRUNCATION_DEFAULTS, ...thresholds },
    summary: summarizeWordEndCalibration(units, labels),
    units,
  };

  const outPath = path.resolve(args.out);
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.error(
    `[word-end-truncation-calibration] ${receipt.summary.segmentCount} segments, ` +
      `${receipt.summary.renderBoundaryCount} render boundaries, ` +
      `${receipt.summary.flaggedCount} flagged -> ${outPath}`,
  );
}

if (import.meta.main) await main();
