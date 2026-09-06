// Etan ruling 2026-09-06: "they should be gates, not skills" — render-done-gate
// is a GATE OF audio-dashboard, invoked by the parent's workflow, not a
// catalog-hidden skill of its own. This test pins the placement so a future
// re-promotion to a standalone SKILL.md is caught by the suite, not by a grill.

import { test, expect } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(here, "..");
const powersRoot = path.resolve(skillRoot, "..");

test("render-done-gate is not installed as a standalone skill", () => {
  expect(existsSync(path.join(powersRoot, "render-done-gate"))).toBe(false);
});

test("the gate's executable logic lives inside audio-dashboard", () => {
  for (const rel of [
    "src/render-done-gate.mjs",
    "scripts/render-done-gate-cli.mjs",
    "lib/transcript.mjs",
    "evals/render-done-gate.test.mjs",
  ]) {
    expect(existsSync(path.join(skillRoot, rel))).toBe(true);
  }
});

test("audio-dashboard/SKILL.md points at the gate script", () => {
  const skill = readFileSync(path.join(skillRoot, "SKILL.md"), "utf8");
  expect(skill).toContain("scripts/render-done-gate-cli.mjs");
  // ...and no longer at the retired standalone-skill path.
  expect(skill).not.toContain("golem-powers/render-done-gate/");
});
