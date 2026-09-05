#!/usr/bin/env bun
/**
 * validate-evidence — run the shipped evidence gate (src/audio-dashboard-evidence.mjs)
 * against a REAL rendered dashboard + its job dir. This closes the acceptance loop:
 * the same validator the eval unit-tests with fixtures is here pointed at actual
 * on-disk artifacts, so "it passed the gate" is a runnable claim, not a fixture.
 *
 * It assembles the evidence record the validator expects from the real artifacts:
 *   - wordsJson    : first scene's real words.json (monotonic {word,start,end})
 *   - timingData   : per-scene {realWordTiming, script, words} from every words.json
 *   - html         : the rendered dashboard (for word-click-seek detection)
 *   - generator    : the skill-local render-v4 path (canonical)
 *   - outputPath   : the docs.local/dashboards/*.html source
 *   - tailnetSync  : ONLY when --published is passed (publish is the env-specific,
 *                    optional last step; without it the gate correctly REJECTS with
 *                    MISSING_TAILNET_SYNC, proving the gate is live).
 *
 * Usage:
 *   bun scripts/validate-evidence.mjs --spec <job.json> [--job-dir <dir>] [--out <html>] \
 *        [--published "<sync command or log line>"] [--json]
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

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
    else if (x === "--job-dir") a.jobDir = argv[++i];
    else if (x === "--out") a.out = argv[++i];
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
if (args.help) { console.log("usage: bun scripts/validate-evidence.mjs --spec <job.json> [--job-dir <dir>] [--out <html>] [--published \"<cmd>\"] [--json]"); process.exit(0); }
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
  ...(args.published ? { publishCommand: args.published } : {}),
};

const result = validateAudioDashboardEvidence(evidence);
if (args.json) console.log(JSON.stringify(result, null, 2));
else {
  console.log(formatReport(result));
  console.log(`\nflags: realWordTiming=${result.realWordTiming} realTranscript=${result.realTranscript} wordClickSeek=${result.wordClickSeek} tailnetSync=${result.tailnetSync}`);
  console.log(`scenes validated: ${perScene.length} (words: ${perScene.map((s) => `${s.id}=${s.words.length}`).join(", ")})`);
}
process.exit(result.verdict === "PASS" ? 0 : 3);
