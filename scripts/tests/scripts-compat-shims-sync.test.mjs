// AIDEV-NOTE: GO-6 moved the sync tools into scripts/sync/. golems-sync.sh is run
// by path from the lead's runbooks, and sync-config.sh is quoted by path in other
// fleet repos' docs, so both old paths keep a shim. Remove a row with its shim.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const run = (script, args) => spawnSync("bash", [script, ...args], { cwd: repoRoot, encoding: "utf8" });

const CASES = [
  { name: "golems-sync.sh", args: [] },
  { name: "golems-sync.sh", args: ["--help"] },
  { name: "golems-sync.sh", args: ["-bad-host"] },
  { name: "sync-config.sh", args: ["--help"] },
];

for (const { name, args } of CASES) {
  test(`scripts/${name} ${args.join(" ")} forwards to scripts/sync/${name}`, () => {
    const moved = run(`scripts/sync/${name}`, args);
    const shim = run(`scripts/${name}`, args);
    assert.equal(shim.status, moved.status, shim.stderr);
    assert.equal(shim.stdout, moved.stdout);
    assert.equal(shim.stderr, moved.stderr);
  });
}
