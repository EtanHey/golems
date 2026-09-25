import { expect, test, setDefaultTimeout } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

// These tests spawn node/bun; a cold CI runner can exceed bun's 5s default.
setDefaultTimeout(15_000);

// Claude Code sets stop_hook_active when this stop already follows a Stop-hook
// block. A gate that blocks again makes the model retry in a loop (up to 7
// consecutive blocks observed), so every gate must allow that stop.
const here = path.dirname(fileURLToPath(import.meta.url));
const powersRoot = path.resolve(here, "../../..");

// One would-block red fixture per gate (each blocks when stop_hook_active is unset).
// GO-5 E2: false-green, fleet-wrap and qa-verdict flag as advisories, never blocks.
const ADVISORY = new Set(["false-green-gate", "fleet-wrap-gate", "qa-verdict-gate"]);
const GATES = [
  ["false-green-gate", "01-stale-app-stamp.json"],
  ["fleet-wrap-gate", "01-healthwatch-cron-left-armed.json"],
  ["idle-dwell-gate", "09-done-workers-unharvested.json"],
  ["monitor-law-gate", "01-monitor-absent.json"],
  ["qa-verdict-gate", "01-fail-page-never-loaded.json"],
];

function runHook(gate, payload) {
  const hook = path.join(powersRoot, gate, "scripts", `${gate}-hook.mjs`);
  return spawnSync(process.execPath, [hook], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    timeout: 5_000,
  });
}

for (const [gate, fixtureName] of GATES) {
  const fixture = JSON.parse(
    readFileSync(path.join(powersRoot, gate, "evals", "fixtures", "red", fixtureName), "utf8"),
  );

  test(`${gate} flags ${fixtureName} on a first stop`, () => {
    for (const payload of [fixture, { ...fixture, stop_hook_active: false }]) {
      const result = runHook(gate, payload);
      expect(result.status, result.stderr).toBe(0);
      const output = JSON.parse(result.stdout);
      if (ADVISORY.has(gate)) expect(output.systemMessage).toStartWith(`${gate.toUpperCase()} advisory`);
      else expect(output.decision).toBe("block");
    }
  });

  test(`${gate} allows the same stop when stop_hook_active is true`, () => {
    const result = runHook(gate, { ...fixture, stop_hook_active: true });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({});
  });
}
