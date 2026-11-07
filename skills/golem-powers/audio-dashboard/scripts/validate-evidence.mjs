#!/usr/bin/env bun
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

import { deliveryOrigins, handoffPath, sha256 } from "../src/hosted-delivery.mjs";
import { checkPublishedDesign, writeDesignReport } from "../src/design-preservation.mjs";
import { validateAudioDashboardEvidence, formatReport } from "../src/audio-dashboard-evidence.mjs";

const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function expandHome(v) {
  if (v === "~") return os.homedir();
  if (v?.startsWith?.("~/")) return path.join(os.homedir(), v.slice(2));
  return v;
}
function fail(m) { console.error(`[validate-evidence] FATAL: ${m}`); process.exit(1); }

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i += 1) {
    const x = argv[i];
    if (x === "--spec") a.spec = argv[++i];
    else if (x === "--first-build") a.firstBuild = argv[++i];
    else if (x === "--job-dir") a.jobDir = argv[++i];
    else if (x === "--out") a.out = argv[++i];
    else if (x === "--delivery") a.delivery = argv[++i];
    else if (x === "--source-dir") a.sourceDir = argv[++i];
    else if (x === "--published") a.published = argv[++i];
    else if (x === "--json") a.json = true;
    else if (x === "-h" || x === "--help") a.help = true;
    else fail(`unknown argument: ${x}`);
  }
  return a;
}

function loadWords(p) {
  if (!existsSync(p)) return [];
  return JSON.parse(readFileSync(p, "utf8"))
    .map((w) => ({ word: String(w.word ?? w.text ?? "").trim(), start: Number(w.start), end: Number(w.end) }))
    .filter((w) => w.word && Number.isFinite(w.start) && Number.isFinite(w.end));
}

const args = parseArgs(process.argv.slice(2));
if (args.help) { console.log("usage: bun scripts/validate-evidence.mjs --spec <job.json> [--first-build <reason>] [--job-dir <dir>] [--out <html>] [--delivery <receipt.json>] [--source-dir <prepared directory>] [--json]"); process.exit(0); }
if (!args.spec) fail("--spec is required");
const specPath = path.resolve(expandHome(args.spec));
if (!existsSync(specPath)) fail(`spec not found: ${specPath}`);
const spec = JSON.parse(readFileSync(specPath, "utf8"));

const jobId = spec.id || "audio-dashboard-job";
const jobDir = path.resolve(expandHome(args.jobDir || path.join(os.homedir(), ".narrationlayer", "jobs", jobId)));
const outPath = path.resolve(expandHome(args.out || spec.outputPath || ""));
if (!existsSync(outPath)) fail(`rendered dashboard not found: ${outPath} (run build-dashboard.mjs first)`);

const html = readFileSync(outPath, "utf8");
const perScene = [];
for (const s of spec.scenes) {
  const words = loadWords(path.join(jobDir, "segments", s.id, "words.json"));
  perScene.push({ id: s.id, script: s.script, words });
}
const first = perScene.find((s) => s.words.length) || perScene[0];

const handoff = existsSync(handoffPath(outPath)) ? JSON.parse(readFileSync(handoffPath(outPath), "utf8")) : null;
const sourceDir = args.sourceDir ? path.resolve(expandHome(args.sourceDir)) : handoff?.sourcePath ? path.resolve(path.dirname(outPath), handoff.sourcePath) : null;
const sourceFile = sourceDir && path.join(sourceDir, 'index.html');
const sourceHtml = sourceFile && existsSync(sourceFile) ? readFileSync(sourceFile, 'utf8') : null;
const evidence = {
  generator: `skills/golem-powers/audio-dashboard/vendor/agent-html/lib/render-v4.mjs (via build-dashboard.mjs)`,
  outputPath: outPath,
  wordsJson: first.words,
  timingData: {
    realWordTiming: true,
    script: perScene.map((s) => s.script).join(" "),
    scenes: perScene.map((s) => ({ realWordTiming: true, script: s.script, words: s.words })),
  },
  html,
  dashboardId: spec.id,
  stage: "delivery", sourceHtml,
  approvedDeliveryOrigins: deliveryOrigins(),
  delivery: args.delivery ? JSON.parse(readFileSync(expandHome(args.delivery), "utf8")) : null,
  handoff,
};

const backfilled = evidence.delivery?.backfilled === true;
const preservation = backfilled ? { verdict: "NOT_RUN", status: "BACKFILL" } : await checkPublishedDesign(spec, outPath, html, { firstBuild: args.firstBuild });
if (!backfilled) writeDesignReport(outPath, html, preservation);
const result = validateAudioDashboardEvidence(evidence);
if (sha256(readFileSync(outPath)) !== sha256(html) || sourceFile && sourceHtml !== null && sha256(readFileSync(sourceFile)) !== sha256(sourceHtml)) {
  result.verdict = "REJECTED"; result.violations.push({ code: "EVIDENCE_SOURCE_CHANGED", evidence: "HTML changed during design verification; rerun evidence." });
}
result.designPreservation = preservation;
if (!backfilled && preservation.verdict !== "PASS") { result.verdict = "REJECTED"; result.violations.push(...preservation.violations); }
if (["PASS", "PASS_DEPRECATED_RUNTIME"].includes(result.verdict)) {
  const receipts = readFileSync(outPath.replace(/\.html$/i, '') + '.receipts.json');
  if (evidence.handoff?.buildReceiptsSha256 !== sha256(receipts)) {
    result.verdict = "REJECTED"; result.violations.push({ code: "BUILD_RECEIPTS_SHA_MISMATCH", evidence: "BUILD receipts changed after the handoff." });
  }
}
if (args.json) console.log(JSON.stringify(result, null, 2));
else {
  console.log(formatReport(result));
  console.log(`\nflags: realWordTiming=${result.realWordTiming} realTranscript=${result.realTranscript} wordClickSeek=${result.wordClickSeek} hostedDelivery=${result.hostedDelivery}`);
  console.log(`scenes validated: ${perScene.length} (words: ${perScene.map((s) => `${s.id}=${s.words.length}`).join(", ")})`);
}
process.exit(result.verdict === "PASS_DEPRECATED_RUNTIME" ? 5 : result.verdict === "BACKFILL_ACCOUNT_PROVEN" ? 4 : ["PASS", "READY_FOR_HOSTED_PUBLISH"].includes(result.verdict) ? 0 : 3);
