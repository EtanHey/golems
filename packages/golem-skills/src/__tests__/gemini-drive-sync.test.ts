import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..");
const SKILL = join(
  REPO_ROOT,
  "skills",
  "golem-powers",
  "gemini-research",
  "SKILL.md",
);
const SCRIPT = join(
  REPO_ROOT,
  "skills",
  "golem-powers",
  "gemini-research",
  "scripts",
  "drive-sync.sh",
);

describe("gemini drive sync", () => {
  test("defaults to Gemini and confines notebook setup to the opt-in reference", async () => {
    const content = await readFile(SKILL, "utf8");
    expect(content).toContain("Default workflow: Gemini Deep Research");
    expect(content).toContain("gemini.google.com");
    expect(content.match(/^.*notebook.*$/gim)).toHaveLength(1);
    expect(content).toContain("NotebookLM on request");
    expect(content).not.toContain("research_start");
    expect(content).not.toContain("drive-sync.sh");
    expect(content).toContain("prompt-preflight.mjs --emit");
    expect(content).toContain("drive-grounding-gate.sh");
    const reference = await readFile(join(REPO_ROOT, "skills/golem-powers/gemini-research/references/notebooklm-workflows.md"), "utf8");
    expect(reference).toContain("# Opt-in: only when the user asks for NotebookLM");
    expect(reference).toContain("~/.golems/research-state.json");
    expect(reference).toContain("drive-sync.sh");
    expect(reference).toContain('artifact_type="audio"');
  });

  test("drive sync script exists", async () => {
    const content = await readFile(SCRIPT, "utf8");
    expect(content).toContain("drive_sync.py");
  });
});
