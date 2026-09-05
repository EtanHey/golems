import { expect, test } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.join(here, "..");
const skillPath = path.join(skillDir, "SKILL.md");

test("skill is discoverable and routes the recorded liveness symptoms", () => {
  expect(existsSync(skillPath)).toBe(true);
  const skill = readFileSync(skillPath, "utf8");
  expect(skill).toMatch(/^---\nname: pane-liveness-check\n/);
  expect(skill).toMatch(/description: "Use when [^"]*(idle workers|dead shells)[^"]*"/);
  expect(skill).toContain("execute: scripts/run.sh");
  expect(skill).toContain("NOT for");
});

test("skill pins UUID identity, fail-closed verdicts, and read-only boundaries", () => {
  const skill = readFileSync(skillPath, "utf8");
  for (const required of [
    "verbose:true",
    "stable UUID",
    "STALE-REF — re-enumerate",
    "verdict: null",
    "owner=UNKNOWN",
    "KEEP-unpushed",
    "DEAD-shell",
    "CLOSE-CANDIDATE",
    "never closes",
    "omits cost entirely",
  ]) {
    expect(skill).toContain(required);
  }
});

test("skill stays concise and executable wrapper is installed in-package", () => {
  const skill = readFileSync(skillPath, "utf8");
  expect(skill.trim().split(/\s+/).length).toBeLessThan(500);
  const wrapper = path.join(skillDir, "scripts", "run.sh");
  expect(existsSync(wrapper)).toBe(true);
  expect(statSync(wrapper).mode & 0o111).not.toBe(0);
});
