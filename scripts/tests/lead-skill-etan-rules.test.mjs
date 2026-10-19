import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Etan's three 2026-10-19 rulings (via orc) must stay baked into the lead
// skills: (1) only one-way doors wait on Etan, (2) leads route ops to
// deploy-local-prod and the mechanical tier, (3) leads fast-forward the root
// checkout after each merge. Each rule pins the text a lead acts on.
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");
const read = (rel) =>
  readFileSync(path.join(root, "skills", "golem-powers", rel), "utf8").replace(/\s+/g, " ");
const evals = (rel) => JSON.parse(readFileSync(path.join(root, "skills", "golem-powers", rel), "utf8"));

const RULE_1 =
  "Nothing waits on Etan except true one-way doors: deleting data/creds/accounts, money, messaging people. Tags, releases, installs, deploys, upgrades ship without asking.";
const RULE_2 =
  "Leads never do ops themselves: deploy hops go to the `deploy-local-prod` sub-agent; mechanical checks and waits go to Haiku or gpt-6-luna.";
const RULE_3 = "Leads keep the root checkout ff-only current after each merge.";
const SOURCE = "(Etan 2026-10-19, via orc)";

test("rule 1: one-way doors only, and the confirm-gate token still guards deletes", () => {
  for (const rel of ["pr-loop/SKILL.md", "pr-loop/references/pr-creation.md",
    "large-plan/workflows/collab.md", "agent-routing/references/delegation-operations.md"]) {
    const body = read(rel);
    expect(body).toContain(RULE_1);
    expect(body).toContain(SOURCE);
  }
  const hardGates = read("pr-loop/SKILL.md").split("## Hard Gates")[1].split("\n## ")[0];
  expect(hardGates).toContain("human-confirm-gate");
  expect(hardGates).toContain("one-way door");
  expect(read("pr-loop/references/merge-and-verification.md")).toContain("without asking Etan");
  expect(read("large-plan/SKILL.md")).toContain("for one-way doors only");
});

test("rule 2: deploy hops go to deploy-local-prod, checks and waits to the mechanical tier", () => {
  const routing = read("agent-routing/SKILL.md");
  expect(routing).toContain(RULE_2);
  const cheap = routing.split("## Cheap sub-agents")[1].split(" ## ")[0];
  expect(cheap).toContain('subagent_type: "deploy-local-prod"');
  expect(cheap).toContain("node scripts/model-roles.mjs codex.subagent.mechanical --use watcher");
  expect(cheap).toContain("claude.subagent.cheap");
  const batchGate = read("pr-loop/references/merge-and-verification.md").split("## Feature-Batch Gate")[1];
  expect(batchGate).toContain("`deploy-local-prod` sub-agent and verifies the artifact it reports; it does not run the hop itself");
  // Outside agent-routing the canon routing lint forbids model names, so the
  // other lead skills paraphrase rule 2 and point at its home.
  for (const rel of ["pr-loop/SKILL.md", "large-plan/SKILL.md"]) {
    const body = read(rel);
    expect(body).toContain("Leads never do ops themselves** (Etan 2026-10-19, via orc)");
    expect(body).toContain("`deploy-local-prod`");
    expect(body).toContain("`/agent-routing` § Lead Topology #7");
  }
});

test("rule 3: ff-only the root checkout after each merge, report on failure, re-read instructions", () => {
  const tracking = read("pr-loop/references/merge-and-verification.md")
    .split("### After Merge: Update Tracking (MANDATORY)")[1].split("## Feature-Batch Gate")[0];
  expect(tracking).toContain(RULE_3);
  expect(tracking).toContain("git -C <root> fetch && git -C <root> merge --ff-only origin/<default>");
  expect(tracking).toContain("report it");
  expect(tracking).toContain("Never force it");
  expect(tracking).toContain("re-read those files");
  const plan = read("large-plan/SKILL.md");
  expect(plan).toContain(RULE_3);
  expect(plan).toContain("re-read it before the next dispatch");
});

test("each rule ships a behavior eval and its trigger phrases", () => {
  const ids = (rel) => evals(rel).evals.map((e) => e.name);
  expect(ids("pr-loop/evals/evals.json")).toEqual(
    expect.arrayContaining(["release-install-ships-while-etan-away", "just-merged-ff-root-reread-instructions"]));
  expect(ids("agent-routing/evals/evals.json")).toContain("lead-routes-deploy-hop-and-mechanical-waits");
  expect(ids("large-plan/evals/evals.json")).toContain("etan-asks-only-for-one-way-doors");
  const triggers = (rel) => evals(rel).filter((e) => e.should_trigger).map((e) => e.query);
  expect(triggers("pr-loop/evals/trigger-evals.json")).toContain("should I ask Etan before tagging the release?");
  expect(triggers("agent-routing/evals/trigger-evals.json")).toContain("deploy 1.5.66 to both Macs");
  expect(triggers("large-plan/evals/trigger-evals.json")).toContain("merged #812, what now?");
});
