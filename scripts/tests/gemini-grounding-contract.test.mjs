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
  for (const t of ["## Research grounding folder contract", "R{NN}-grounding", "00-GROUNDING-MANIFEST.md", "After harvest"])
    assert.ok(d.includes(t), `drive-filing missing ${t}`);
  assert.match(gemini(), /\/drive-filing.*Research grounding folder contract/);
  assert.match(lifecycle(), /\/drive-filing.*Research grounding folder contract/);
});

test("rule 3: admission table with a hard stop, plus the plan-repair sentence", () => {
  const t = template();
  assert.match(t, /readable \(yes\/no\)/);
  assert.match(t, /output only this table and a MISSING FILES\s+list, and stop/);
  assert.match(gemini(), /output only the read-check table and a MISSING FILES list, and stop/);
});

test("r2 B1: no path grounds on the shared corpus; all point at the research's own folder", () => {
  assert.doesNotMatch(gemini(), /exact document names from `Brain Drive\/03_RESEARCH\/Active\/<project>\/context\//);
  assert.match(gemini(), /own curated folder .*R\{NN\}-grounding/);
  assert.doesNotMatch(template(), /<canonical Drive project folder>/);
  assert.match(template(), /own curated folder/);
});

test("r2 B2: stop fires on any non-affirmative row, in template and plan-repair sentence", () => {
  for (const t of [template(), gemini()])
    for (const w of ["readable: no", "blank", "missing", "empty", "truncated", "unreadable"])
      assert.ok(t.includes(w), `missing ${w}`);
  assert.match(gemini(), /not an affirmative verified read/);
  assert.match(template(), /Only an affirmative, verified read passes/);
});

test("r2 a: admission table is scoped to project-grounded runs", () => {
  assert.match(template(), /project-grounded runs only/);
  assert.match(gemini(), /web-only research keeps its own/);
});

test("r2 b/c: after-harvest is a choice; manifest keyed by file id plus revision id", () => {
  assert.match(drive(), /Keep it as that record, or consolidate/);
  assert.doesNotMatch(drive(), /Never leave a grounding folder in `Active\/`/);
  assert.match(drive(), /drive_file_id \| revision_id/);
  assert.match(drive(), /`title\|drive_file_id\|revision_id`/);
});

test("rule 4: harvest record carries model, settings, prompt hash, manifest hash", () => {
  const g = gemini();
  assert.match(g, /model, the settings/);
  assert.match(g, /prompt sha256/);
  assert.match(g, /manifest_sha256/);
  assert.match(lifecycle(), /model, settings, prompt hash and manifest hash/);
});
