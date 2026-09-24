#!/usr/bin/env node
import { spawnSync } from "node:child_process";
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

// An explicitly configured harness must resolve; a typo is an error, not a skip.
function explicitHarness() {
  if (process.env.SMOKE_HARNESS_JS) {
    return ["SMOKE_HARNESS_JS", process.env.SMOKE_HARNESS_JS];
  }
  if (process.env.SKILL_CREATOR_ROOT) {
    return [
      "SKILL_CREATOR_ROOT",
      path.join(process.env.SKILL_CREATOR_ROOT, "src", "smoke-harness.js"),
    ];
  }
  return null;
}

// skill-creator is checked out next to golems. From a linked worktree
// (golems/.worktrees/<name>) the main checkout is the parent of the git
// common dir, not a fixed number of ../ hops away.
function siblingHarnessCandidates() {
  const candidates = [];
  const common = spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
    cwd: here,
    encoding: "utf8",
  });
  if (common.status === 0 && common.stdout.trim()) {
    const mainCheckout = path.dirname(common.stdout.trim());
    candidates.push(path.join(path.dirname(mainCheckout), "skill-creator", "src", "smoke-harness.js"));
  }
  // No git (e.g. a tarball): the repo root is six levels up from this file.
  candidates.push(path.resolve(here, "../../../../../../skill-creator/src/smoke-harness.js"));
  return candidates;
}

let smokeHarnessPath = null;
const explicit = explicitHarness();
if (explicit) {
  const [name, candidate] = explicit;
  if (!(await fileExists(candidate))) {
    console.error(`${name} is set but ${candidate} does not exist.`);
    process.exit(1);
  }
  smokeHarnessPath = candidate;
} else {
  for (const candidate of siblingHarnessCandidates()) {
    if (await fileExists(candidate)) {
      smokeHarnessPath = candidate;
      break;
    }
  }
}
// smoke-harness.js ships in the private skill-creator repo, so an outside
// cloner has none: skip with a reason instead of failing.
if (!smokeHarnessPath) {
  process.stdout.write(
    "SKIP smoke replay: skill-creator's smoke-harness.js is not available (private repo). " +
      "Set SMOKE_HARNESS_JS to the module exporting replaySmoke to run it.\n",
  );
  process.exit(0);
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
