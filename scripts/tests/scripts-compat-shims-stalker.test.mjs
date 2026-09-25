// AIDEV-NOTE: GO-6 moved the Stalker pipeline into scripts/stalker/. The installed
// com.golems.stream-watcher and com.golems.stalker-live-guard LaunchAgents run the
// old paths, and a watcher started before the move launches the old post-stream.sh.
// Each keeps a shim until the plists are repointed and that watcher restarts.
// Only side-effect-free invocations (argument rejections) are exercised here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const run = (script, args) => spawnSync("bash", [script, ...args], { cwd: repoRoot, encoding: "utf8" });

const CASES = [
  { name: "stream-watcher.sh", args: [] },
  { name: "stream-watcher.sh", args: ["bad channel!"] },
  { name: "stalker-live-guard.sh", args: ["bad channel!"] },
  { name: "post-stream.sh", args: ["/nonexistent-go6-stream-dir", "video.ts", "chat.log", "somechannel"] },
];

for (const { name, args } of CASES) {
  test(`scripts/${name} ${JSON.stringify(args)} forwards to scripts/stalker/${name}`, () => {
    const moved = run(`scripts/stalker/${name}`, args);
    const shim = run(`scripts/${name}`, args);
    assert.notEqual(moved.status, 0, "case must be a side-effect-free rejection");
    assert.equal(shim.status, moved.status, shim.stderr);
    assert.equal(shim.stdout, moved.stdout);
    assert.equal(shim.stderr, moved.stderr);
  });
}
