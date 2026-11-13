import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// w91: curated grounding folder, Drive contract, hard admission stop, provenance.
// GROUNDING_ROOT lets the same rows run against master's text (RED proof).
const here = path.dirname(fileURLToPath(import.meta.url));
const root = process.env.GROUNDING_ROOT ?? path.join(here, "..", "..");
const read = (...p) =>
  readFileSync(path.join(root, "skills", "golem-powers", ...p), "utf8");
const gemini = () => read("gemini-research", "SKILL.md");
const template = () => read("gemini-research", "references", "prompt-template.md");
const drive = () => read("drive-filing", "SKILL.md");
const lifecycle = () => read("research-lifecycle", "SKILL.md");

test("rule 1: each research gets its own bounded folder, agents prepare it, ONLY those docs", () => {
  assert.match(gemini(), /own Drive folder of only the documents it needs/);
  assert.match(gemini(), /Agents prepare it, never Etan/);
  assert.match(gemini(), /use ONLY them/);
});

test("rule 2: drive-filing owns the folder contract; both skills point at it", () => {
  const d = drive();
  for (const t of ["## Research grounding folder contract", "R{NN}-grounding", "00-GROUNDING-MANIFEST.md", "After harvest", "06_ARCHIVE/research"])
    assert.ok(d.includes(t), `drive-filing missing ${t}`);
  assert.match(gemini(), /\/drive-filing.*Research grounding folder contract/);
  assert.match(lifecycle(), /\/drive-filing.*Research grounding folder contract/);
});

test("rule 3: admission table with a hard stop, plus the plan-repair sentence", () => {
  const t = template();
  assert.match(t, /readable \(yes\/no\)/);
  assert.match(t, /output only this table and a MISSING FILES list, and stop/);
  assert.match(gemini(), /output only the read-check table and a MISSING FILES list, and stop/);
});

test("rule 4: harvest record carries model, settings, prompt hash, manifest hash", () => {
  const g = gemini();
  assert.match(g, /model, the settings/);
  assert.match(g, /prompt sha256/);
  assert.match(g, /manifest_sha256/);
  assert.match(lifecycle(), /model, settings, prompt hash and manifest hash/);
});
