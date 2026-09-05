import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..");
const GEMINI_SKILL = join(
  REPO_ROOT,
  "skills",
  "golem-powers",
  "gemini-research",
  "SKILL.md",
);
const CLAUDE_DESKTOP_SKILL = join(
  REPO_ROOT,
  "skills",
  "golem-powers",
  "claude-desktop-research",
  "SKILL.md",
);
const ORC_SKILL = join(
  REPO_ROOT,
  "skills",
  "golem-powers",
  "orc",
  "SKILL.md",
);
const RETIRED_RESEARCH_SKILLS = [
  "notebooklm-research",
  "research",
  "research-ab-test",
  "claude-web-research",
];

describe("research skill rename", () => {
  test("gemini-research is the primary skill name", async () => {
    const content = await readFile(GEMINI_SKILL, "utf8");
    expect(content).toContain("name: gemini-research");
    expect(content).toContain("Gemini Deep Research");
    expect(content).toContain("Triggers on:");
    expect(content).toContain("gemini");
  });

  test("retired research aliases are inactive", () => {
    for (const skillName of RETIRED_RESEARCH_SKILLS) {
      expect(existsSync(join(REPO_ROOT, "skills", "golem-powers", skillName))).toBe(
        false,
      );
    }
  });

  test("cross-skill references point to active research surfaces", async () => {
    const claudeDesktop = await readFile(CLAUDE_DESKTOP_SKILL, "utf8");
    const orc = await readFile(ORC_SKILL, "utf8");

    expect(claudeDesktop).toContain("/gemini-research");
    expect(claudeDesktop).not.toContain("/notebooklm-research");

    expect(orc).toContain("Claude Desktop/Web or Gemini research path");
    expect(orc).not.toContain("/research-ab-test");
    expect(orc).not.toContain("/notebooklm-research");
  });
});
