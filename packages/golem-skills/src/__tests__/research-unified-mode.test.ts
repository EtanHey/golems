import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..");
const SKILL = join(
  REPO_ROOT,
  "skills",
  "golem-powers",
  "research",
  "SKILL.md",
);
const ARCHIVED_SCRIPT = join(
  REPO_ROOT,
  "skills",
  "golem-powers",
  "_archive",
  "research",
  "scripts",
  "unified-dispatch.sh",
);
const CLAUDE_DESKTOP_SKILL = join(
  REPO_ROOT,
  "skills",
  "golem-powers",
  "claude-desktop-research",
  "SKILL.md",
);

describe("research unified mode", () => {
  test("dedicated research router is retired", () => {
    expect(existsSync(SKILL)).toBe(false);
  });

  test("active docs describe manual paired Claude/Gemini research", async () => {
    const content = await readFile(CLAUDE_DESKTOP_SKILL, "utf8");

    expect(content).toContain("Run this skill plus `/gemini-research`");
    expect(content).toContain("Drive/Research/<project>/context/");
    expect(content).toContain("R{NN}-claude-desktop-result.md");
  });

  test("retired unified dispatch script remains archived", async () => {
    const content = await readFile(ARCHIVED_SCRIPT, "utf8");
    expect(content).toContain("unified_dispatch.py");
  });
});
