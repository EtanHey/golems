import { expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Audit row 1 + 9 (skill-edits 2026-10-18): Claude T3 leads made 0 Skill calls
// Oct 16-18 although large-plan, agent-routing and pr-loop were in the catalog.
// Descriptions must carry the ordinary lead phrases, each body opens with a
// kickoff contract, and each skill ships trigger evals for those phrases.
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");
const skill = (name, file = "SKILL.md") =>
  path.join(root, "skills", "golem-powers", name, file);
const read = (p) => readFileSync(p, "utf8");
const description = (name) =>
  read(skill(name)).match(/^description:\s*"(.*)"\s*$/m)?.[1] ?? "";

const ORC_2350 =
  "Once its PRs land, invoke the updated skills at the start of each plan, dispatch or PR action.";

const PHRASES = {
  "large-plan": ["make a plan", "feature batch", "lead kickoff", "plan next steps", "Invoke before"],
  "agent-routing": ["dispatch a worker", "delegate_task", "hand off", "Invoke before",
    // literal triggers carried from the pinned description
    "who gathers", "gemini gatherer", "Codex model/effort", "/multitask", "fan out", "in parallel"],
  "pr-loop": ["Open a PR", "merge", "ship", "CI", "Invoke before", "golem-id", "Co-Authored-By"],
};

for (const [name, phrases] of Object.entries(PHRASES)) {
  test(`${name} description front-loads ordinary lead phrases`, () => {
    const d = description(name).toLowerCase();
    for (const p of phrases) expect(d).toContain(p.toLowerCase());
  });

  test(`${name} opens with a kickoff contract`, () => {
    const body = read(skill(name));
    const at = body.indexOf("## Kickoff contract");
    expect(at).toBeGreaterThan(0);
    // near the top: before every other level-2 section
    const firstH2 = body.search(/^## /m);
    expect(at).toBe(firstH2);
    const section = body.slice(at).split(/\n## /)[0];
    expect(section.split("\n").length).toBeLessThanOrEqual(10);
    expect(section).toContain("Skill tool");
    expect(section).toContain("Codex");
    expect(section).toContain("SKILL.md");
    expect(section).toContain("kickoff brief");
    expect(section).toContain(ORC_2350);
    expect(section).toContain("(Etan 2026-10-18, via orc collab)");
  });

  test(`${name} ships trigger evals with both polarities`, () => {
    const file = skill(name, "evals/trigger-evals.json");
    expect(existsSync(file)).toBe(true);
    const evals = JSON.parse(read(file));
    expect(Array.isArray(evals)).toBe(true);
    expect(evals.length).toBeGreaterThanOrEqual(8);
    expect(evals.length).toBeLessThanOrEqual(12);
    for (const e of evals) {
      expect(Object.keys(e).sort()).toEqual(["note", "query", "should_trigger"]);
      expect(typeof e.query).toBe("string");
      expect(typeof e.should_trigger).toBe("boolean");
      expect(e.note.length).toBeGreaterThan(0);
    }
    expect(evals.filter((e) => e.should_trigger).length).toBeGreaterThanOrEqual(4);
    expect(evals.filter((e) => !e.should_trigger).length).toBeGreaterThanOrEqual(4);
  });
}

test("cross-skill negatives: each skill rejects a sibling's ordinary phrase", () => {
  const negatives = (name) =>
    JSON.parse(read(skill(name, "evals/trigger-evals.json")))
      .filter((e) => !e.should_trigger)
      .map((e) => e.query.toLowerCase());
  expect(negatives("large-plan").some((q) => q.includes("open a pr"))).toBe(true);
  expect(negatives("pr-loop").some((q) => q.includes("plan"))).toBe(true);
  expect(negatives("agent-routing").some((q) => q.includes("merge"))).toBe(true);
});

test("kickoff-prompt checklist names the three Skill invocations", () => {
  const text = read(skill("cmux-agents", "workflows/prompt-audit.md"));
  expect(text).toContain("Lead kickoff (any harness)");
  for (const s of ["`/large-plan`", "`/agent-routing`", "`/pr-loop`"]) {
    expect(text.split("Lead kickoff (any harness)")[1].split("\n")[0]).toContain(s);
  }
});

// PR15 (orc 2026-10-19): live headless Claude sessions loaded agent-routing and
// pr-loop on 1/4 ordinary dispatch+PR phrases (large-plan 2/5 positives); every miss opened with a Bash
// git/gh orientation call. Descriptions name that competing first action.
const FIRST_ACTION = "invoke before any git/gh";
for (const name of ["large-plan", "agent-routing", "pr-loop"]) {
  test(`${name} description names the competing first action`, () => {
    expect(description(name).toLowerCase()).toContain(FIRST_ACTION);
  });
}

test("live trigger eval harness is committed, documented and opt-in only", () => {
  const harness = skill("skill-creator", "scripts/live-trigger-eval.py");
  expect(existsSync(harness)).toBe(true);
  const dry = spawnSync("python3", [harness, "--harness", "claude", "--dry-run"], { encoding: "utf8" });
  expect(dry.status).toBe(0);
  expect(dry.stdout).toMatch(/\d+ cases; harness=claude; candidates=installed/);
  const doc = read(skill("skill-creator", "workflows/live-eval.md"));
  expect(doc).toContain("scripts/live-trigger-eval.py");
  expect(doc).toContain("--candidates");
  expect(doc.toLowerCase()).toContain("never wire it into ci");
  const workflows = path.join(root, ".github", "workflows");
  for (const f of readdirSync(workflows)) {
    expect(read(path.join(workflows, f))).not.toContain("live-trigger-eval");
  }
});
