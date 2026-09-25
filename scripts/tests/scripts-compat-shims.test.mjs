// AIDEV-NOTE: GO-6 grouped scripts/ into subfolders. Old paths that live callers
// (fleet briefs, the pr-loop skill text agents already hold, other machines) still
// run keep a 2-line shim. Each shim must forward args, output and exit code.
// Remove a row here when its shim is removed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const run = (cmd, args) => spawnSync(cmd, args, { cwd: repoRoot, encoding: "utf8" });

const SHIMS = [
  { old: "scripts/check-skill-library.mjs", moved: "scripts/ci/check-skill-library.mjs", cmd: "node", args: [] },
  { old: "scripts/release-gate.mjs", moved: "scripts/ci/release-gate.mjs", cmd: "node", args: [".", "--release-only"] },
  { old: "scripts/pr-size-labels.sh", moved: "scripts/ci/pr-size-labels.sh", cmd: "bash", args: ["classify", "151"] },
];

for (const { old, moved, cmd, args } of SHIMS) {
  test(`${old} forwards to ${moved}`, () => {
    const viaMoved = run(cmd, [moved, ...args]);
    const viaShim = run(cmd, [old, ...args]);
    assert.equal(viaShim.status, viaMoved.status, viaShim.stderr);
    assert.equal(viaShim.stdout, viaMoved.stdout);
  });
}

test("shim forwards a failing exit code", () => {
  const viaMoved = run("bash", ["scripts/ci/pr-size-labels.sh", "no-such-command"]);
  const viaShim = run("bash", ["scripts/pr-size-labels.sh", "no-such-command"]);
  assert.notEqual(viaMoved.status, 0);
  assert.equal(viaShim.status, viaMoved.status);
});
