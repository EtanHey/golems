import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..");
const SKILL = join(
  REPO_ROOT,
  "skills",
  "golem-powers",
  "research-ab-test",
  "SKILL.md",
);
const CLAUDE_DESKTOP_SKILL = join(
  REPO_ROOT,
  "skills",
  "golem-powers",
  "claude-desktop-research",
  "SKILL.md",
);
const GEMINI_SKILL = join(
  REPO_ROOT,
  "skills",
  "golem-powers",
  "gemini-research",
  "SKILL.md",
);

describe("research ab-test unified mode", () => {
  test("dedicated research-ab-test skill is retired", () => {
    expect(existsSync(SKILL)).toBe(false);
  });

  test("paired research is documented by active Claude and Gemini skills", async () => {
    const claudeDesktop = await readFile(CLAUDE_DESKTOP_SKILL, "utf8");
    const gemini = await readFile(GEMINI_SKILL, "utf8");

    expect(claudeDesktop).toContain("Run this skill plus `/gemini-research`");
    expect(claudeDesktop).toContain("R{NN}-claude-desktop-result.md");
    expect(gemini).toContain("Drive/Research/<project>/context/");
    expect(gemini).toContain("R{NN}-gemini-result.md");
  });

  test("active skills reference shared numbering instead of duplicating the scheme", async () => {
    const gemini = await readFile(GEMINI_SKILL, "utf8");

    expect(gemini).toContain("context-numbering.md");
    expect(gemini).not.toContain("| `00` | Code map |");
    expect(gemini).not.toContain("| `01-19` |");
    expect(gemini).not.toContain("| `.py` | `.py.txt` |");
  });
});
