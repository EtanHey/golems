// Etan ruling 2026-09-06: "they should be gates, not skills" — tailnet-sync-gate
// is a GATE OF html-dashboard (the post-Write tailnet sync check the parent
// already describes), not a catalog-hidden skill of its own.

import { test, expect } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(here, "..");
const powersRoot = path.resolve(skillRoot, "..");

test("tailnet-sync-gate is not installed as a standalone skill", () => {
  expect(existsSync(path.join(powersRoot, "tailnet-sync-gate"))).toBe(false);
});

test("the gate's executable logic lives inside html-dashboard", () => {
  for (const rel of [
    "src/tailnet-sync-gate.mjs",
    "scripts/tailnet-sync-gate-cli.mjs",
    "lib/transcript.mjs",
    "evals/tailnet-sync-gate.test.mjs",
  ]) {
    expect(existsSync(path.join(skillRoot, rel))).toBe(true);
  }
});

test("html-dashboard/SKILL.md points at the gate script", () => {
  const skill = readFileSync(path.join(skillRoot, "SKILL.md"), "utf8");
  expect(skill).toContain("scripts/tailnet-sync-gate-cli.mjs");
  // ...and no longer at the retired standalone-skill path.
  expect(skill).not.toContain("golem-powers/tailnet-sync-gate/");
});
