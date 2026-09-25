import { expect, setDefaultTimeout, test } from "bun:test";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readFixture } from "./helpers.mjs";

// These tests spawn node; a cold CI runner can exceed bun's 5s default.
setDefaultTimeout(15_000);

// GO-5 E2: a Stop block makes the model continue its turn ("a hook just makes
// them try again"). These three gates keep their signal as an advisory
// systemMessage and never emit `decision: block`.
const here = path.dirname(fileURLToPath(import.meta.url));
const powersRoot = path.resolve(here, "../../..");

const GATES = [
  ["false-green-gate", "01-stale-app-stamp.json"],
  ["fleet-wrap-gate", "01-healthwatch-cron-left-armed.json"],
  ["qa-verdict-gate", "01-fail-page-never-loaded.json"],
];

function runHook(gate, payload) {
  const hook = path.join(powersRoot, gate, "scripts", `${gate}-hook.mjs`);
  const result = spawnSync(process.execPath, [hook], { input: JSON.stringify(payload), encoding: "utf8" });
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout);
}

for (const [gate, fixtureName] of GATES) {
  test(`${gate} turns a flagged stop into an advisory, never a block`, () => {
    const fixture = readFixture(path.join(powersRoot, gate, "evals", "fixtures", "red", fixtureName));
    const output = runHook(gate, fixture);
    expect(output.decision).toBeUndefined();
    expect(output.systemMessage).toStartWith(`${gate.toUpperCase()} advisory`);
  });
}

test("r7's FP #7 (a review summary, no dashboard claim) does not block the turn end", () => {
  const fixture = readFixture(path.join(here, "fixtures", "fp7-review-summary-no-dashboard-claim.json"));
  const output = runHook("false-green-gate", fixture);
  expect(output.decision).toBeUndefined();
});
