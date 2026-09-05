import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..");
const EVALS = join(
  REPO_ROOT,
  "skills",
  "golem-powers",
  "_archive",
  "research",
  "evals",
  "evals.json",
);
const HARNESS = join(
  REPO_ROOT,
  "skills",
  "golem-powers",
  "_archive",
  "research",
  "evals",
  "run_eval_harness.py",
);

describe("research eval harness", () => {
  test("preserves the retired 10-case research-skills-v2 eval pack", async () => {
    const evals = JSON.parse(await readFile(EVALS, "utf8"));

    expect(evals.skill ?? evals.skill_name).toBe("research-skills-v2");
    expect(evals.cases).toHaveLength(10);
    expect(evals.target_with_skill_score).toBe(">80%");
    expect(evals.minimum_delta).toBe(25);
  });

  test("preserves the retired eval harness script", async () => {
    const content = await readFile(HARNESS, "utf8");

    expect(content).toContain("baseline");
    expect(content).toContain("with-skill");
    expect(content).toContain("delta");
  });
});
