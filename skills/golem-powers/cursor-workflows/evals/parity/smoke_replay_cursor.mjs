#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

async function fileExists(candidate) {
  if (!candidate) return false;
  try {
    await readFile(candidate, "utf8");
    return true;
  } catch {
    return false;
  }
}

function parseArgs(argv) {
  const args = { spec: "replay/cursor-smoke-spec.json" };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--spec") {
      args.spec = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const here = path.dirname(fileURLToPath(import.meta.url));
const specPath = path.resolve(here, args.spec);
const spec = JSON.parse(await readFile(specPath, "utf8"));
const specDir = path.dirname(specPath);

const smokeHarnessCandidates = [
  process.env.SMOKE_HARNESS_JS,
  process.env.SKILL_CREATOR_ROOT
    ? path.join(process.env.SKILL_CREATOR_ROOT, "src", "smoke-harness.js")
    : null,
  path.resolve(here, "../../../../../../skill-creator/src/smoke-harness.js"),
  path.resolve(here, "../../../../../../../skill-creator/src/smoke-harness.js"),
];

let smokeHarnessPath = null;
for (const candidate of smokeHarnessCandidates) {
  if (await fileExists(candidate)) {
    smokeHarnessPath = candidate;
    break;
  }
}
if (!smokeHarnessPath) {
  console.error(
    "Cannot find smoke-harness.js. Set SMOKE_HARNESS_JS to the module exporting replaySmoke.",
  );
  process.exit(1);
}

const { replaySmoke } = await import(pathToFileURL(smokeHarnessPath).href);

async function loadTranscript(relPath) {
  const text = await readFile(path.join(specDir, relPath), "utf8");
  return { result: text, is_error: false };
}

const report = replaySmoke({
  skill: spec.skill,
  assertions: spec.assertions,
  withoutTranscript: await loadTranscript(spec.without),
  withTranscript: await loadTranscript(spec.with),
});

const compliance = report.with.byCategory.compliance;
if (compliance.total !== 0 && compliance.score !== 1) {
  console.error(
    `with replay failed compliance: ${compliance.passed}/${compliance.total}`,
  );
  process.exit(1);
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
