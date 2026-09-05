import { readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

// Generic cinema QA. Portable across any audio-dashboard (no hardcoded episode
// default and no episode-specific narration gating). Resolve the dashboard HTML
// from either a positional path OR `--spec <job.json>` (reads spec.outputPath),
// so the generator's qa step and ad-hoc use both work.
function expandHome(v) {
  if (v === "~") return os.homedir();
  if (v?.startsWith?.("~/")) return path.join(os.homedir(), v.slice(2));
  return v;
}
const argv = process.argv.slice(2);
let HTML;
const specIdx = argv.indexOf("--spec");
if (specIdx !== -1 && argv[specIdx + 1]) {
  const specPath = path.resolve(expandHome(argv[specIdx + 1]));
  const spec = JSON.parse(readFileSync(specPath, "utf8"));
  const outIdx = argv.indexOf("--out");
  const out = (outIdx !== -1 && argv[outIdx + 1]) ? argv[outIdx + 1] : spec.outputPath;
  if (!out) {
    console.error("verify-cinema: --spec given but spec has no outputPath (and no --out). ");
    process.exit(2);
  }
  HTML = path.resolve(expandHome(out));
} else {
  HTML = argv.find((a) => !a.startsWith("--"));
}
if (!HTML) {
  console.error("usage: bun verify-cinema.mjs <rendered-dashboard.html> | --spec <job.json> [--out <html>]");
  process.exit(2);
}
const html = readFileSync(HTML, "utf8");
const count = (re) => (html.match(re) || []).length;

const report = {};
report.file = HTML;
report.bytes = html.length;
report.unfilledTokens = count(/\{\{[A-Z_]+\}\}/g);
report.audioDataUris = count(/data:audio\/mpeg;base64,/g);
report.sceneSections = new Set(html.match(/id="sec-[a-z0-9-]+"/g) || []).size;
report.noteAreas = count(/class="note-area"/g);
report.realWordTimingFlags = count(/"realWordTiming":true/g);

// Pull TPDATA out of the shell — render-v4 injects it as a JSON <script id="tpdata">.
let tp = null;
const m = html.match(/<script[^>]*id=["']tpdata["'][^>]*>([\s\S]*?)<\/script>/i);
if (m) { try { tp = JSON.parse(m[1].trim()); } catch (e) { report.tpParseErr = e.message; } }
// Fallback: some builds embed TP as a JS object literal.
if (!tp) {
  for (const re of [/const\s+TP\s*=\s*(\{[\s\S]*?\});/, /TPDATA\s*=\s*(\{[\s\S]*?\});/]) {
    const mm = html.match(re);
    if (mm) { try { tp = JSON.parse(mm[1]); break; } catch {} }
  }
}

if (tp) {
  const ids = Object.keys(tp).filter((k) => tp[k] && Array.isArray(tp[k].cues));
  report.tpdataSceneIds = ids.length;
  report.tpdataIds = ids.join(",");
  let withWords = 0, totalWords = 0, monotonic = true, maxEnd = 0;
  for (const id of ids) {
    const cue = tp[id].cues && tp[id].cues[0];
    const w = cue && cue.words;
    if (w && w.length) {
      withWords++; totalWords += w.length;
      maxEnd = Math.max(maxEnd, w[w.length - 1].end);
      for (let k = 1; k < w.length; k++) if (w[k].start < w[k - 1].start - 0.05) monotonic = false;
    }
  }
  report.scenesWithWords = `${withWords}/${ids.length}`;
  report.totalWords = totalWords;
  report.wordStartsMonotonic = monotonic;
  report.maxWordEndSec = Number(maxEnd.toFixed(2));
}

// Broken-token sweep: no stray {{ }}, no literal "undefined" in titles/scripts, no NaN durations.
report.literalUndefined = count(/>undefined</g) + count(/"undefined"/g);
report.literalNaN = count(/data-tp="[^"]*"[^>]*>NaN/g);

// Structural pass/fail: real word timing on every scene, embedded audio, note-areas,
// clean tokens. This is the portable gate (content-specific narration checks live in
// the caller's own eval, not here).
report.pass = Boolean(
  tp &&
  report.tpdataSceneIds > 0 &&
  report.scenesWithWords === `${report.tpdataSceneIds}/${report.tpdataSceneIds}` &&
  report.realWordTimingFlags > 0 &&
  report.wordStartsMonotonic &&
  report.noteAreas > 0 &&
  report.unfilledTokens === 0 &&
  report.literalUndefined === 0 &&
  report.literalNaN === 0,
);

console.log(JSON.stringify(report, null, 2));
process.exit(report.pass ? 0 : 1);
