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
  test("documents Drive-sync as the default workflow", async () => {
    const content = await readFile(SKILL, "utf8");

    expect(content).toContain("Default Workflow: Drive-Sync Research");
    expect(content).toContain("_shared/research/verify-account.sh");
    expect(content).toContain("_shared/research/drive-paths.py ensure-project-folders");
    expect(content).toContain("~/.golems/research-state.json");
    expect(content).toContain("Drive/Research/<project>/results/R{NN}-gemini-result.md");
    expect(content).toContain("source=\"drive\"");
  });

  test("drive sync script exists", async () => {
    const content = await readFile(SCRIPT, "utf8");
    expect(content).toContain("drive_sync.py");
  });
});
