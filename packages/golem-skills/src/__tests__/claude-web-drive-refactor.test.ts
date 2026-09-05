import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..");
const SKILL = join(
  REPO_ROOT,
  "skills",
  "golem-powers",
  "claude-desktop-research",
  "SKILL.md",
);
const MIGRATE_SCRIPT = join(
  REPO_ROOT,
  "skills",
  "golem-powers",
  "claude-desktop-research",
  "scripts",
  "migrate-obsidian-to-drive.sh",
);
const MIGRATE_WORKFLOW = join(
  REPO_ROOT,
  "skills",
  "golem-powers",
  "claude-desktop-research",
  "workflows",
  "migrate.md",
);

describe("claude web drive refactor", () => {
  test("documents Drive as the primary storage location", async () => {
    const content = await readFile(SKILL, "utf8");

    expect(content).toContain("Brain Drive/Research/<project>/");
    expect(content).toContain("Local cache");
    expect(content).toContain("Step 0 — Verify active account");
    expect(content).toContain("_shared/research/verify-account.sh");
    expect(content).toContain("Drive/Research/<project>/prompts/");
    expect(content).toContain("Drive/Research/<project>/context/");
    expect(content).not.toContain("Primary (Obsidian");
    expect(content).not.toContain("cp \"$HOME/Library/Mobile Documents");
  });

  test("migration assets exist", async () => {
    expect(await readFile(MIGRATE_SCRIPT, "utf8")).toContain("migrate_obsidian_to_drive.py");
    expect(await readFile(MIGRATE_WORKFLOW, "utf8")).toContain("migrate-obsidian-to-drive.sh");
  });
});
