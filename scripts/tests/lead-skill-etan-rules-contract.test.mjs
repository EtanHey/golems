import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveModelRole } from "../model-roles.mjs";

// CONTRACT-PRESENCE TEST, not an agent-behavior measurement. It checks the
// skill TEXT for Etan's three 2026-10-19 rulings (via orc): the required
// instruction is present where a lead reads it, the contrary instruction is
// absent from every lead-skill file, and each behavior eval carries real
// assertions. Live behavior evals (with/without skill) are run by the lead
// after merge. The mutant tests at the bottom prove each check fails when the
// text is reversed, so a check that passes on any text cannot hide here.
// The executable root fast-forward proof is pr-loop-root-ff.test.mjs.
//
// LIMIT (lead ruling, #811 r2; same as #803/#804): this is a presence/absence
// lint. Sentence-level negation can fool it (a reversed rule phrased with an
// unrelated "not" or "never" passes), and an eval assertion is checked for
// presence, not correctness. Do not harden the negation heuristics further:
// semantic correctness is gated by the lead's live behavior evals after merge.
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");
const skillsDir = path.join(root, "skills", "golem-powers");
const SKILLS = ["pr-loop", "large-plan", "agent-routing"];

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "results" ? [] : walk(full);
    return full.endsWith(".md") ? [full] : [];
  });
}
function loadCorpus() {
  const docs = {};
  for (const skill of SKILLS) {
    for (const file of walk(path.join(skillsDir, skill))) docs[path.relative(skillsDir, file)] = readFileSync(file, "utf8");
  }
  const evals = {};
  for (const skill of SKILLS) {
    evals[skill] = JSON.parse(readFileSync(path.join(skillsDir, skill, "evals", "evals.json"), "utf8")).evals;
  }
  return { docs, evals };
}
const flat = (text) => text.replace(/\s+/g, " ");
// Raw-text section: from a heading line to the next heading of the same or higher level.
function section(text, heading) {
  const at = text.indexOf(`${heading}\n`);
  if (at < 0) return "";
  const level = heading.match(/^#+/)[0].length;
  const rest = text.slice(at + heading.length + 1);
  const next = rest.search(new RegExp(`^#{1,${level}} `, "m"));
  return next < 0 ? rest : rest.slice(0, next);
}
// Clauses: sentence ends, semicolons and table cells bound an instruction.
const clauses = (text) => flat(text).split(/(?<=[.!?;])\s+|\s\|\s/).filter(Boolean);
const NEGATION = /\b(?:never|without|not|no|nothing|only|except|instead)\b|n't\b|\bWRONG\b/i;

const RULE_1 =
  "Nothing waits on Etan except true one-way doors: deleting data/creds/accounts, money, messaging people. Tags, releases, installs, deploys, upgrades ship without asking.";
const RULE_2 =
  "Leads never do ops themselves: deploy hops go to the `deploy-local-prod` sub-agent; mechanical checks and waits go to Haiku or gpt-6-luna.";
const RULE_3 = "Leads keep the root checkout ff-only current after each merge.";
const SOURCE = "(Etan 2026-10-19, via orc";

function rule1({ docs }) {
  const errors = [];
  const gates = flat(section(docs["pr-loop/SKILL.md"], "## Hard Gates"));
  if (!gates.includes(RULE_1) || !gates.includes(SOURCE)) errors.push("pr-loop Hard Gates lacks the canonical rule-1 quote");
  if (!/human-confirm-gate[^.]*\bone-way door/.test(gates)) errors.push("Hard Gates must keep the human-confirm-gate token as a one-way door");
  for (const rel of ["pr-loop/references/pr-creation.md", "large-plan/workflows/collab.md",
    "agent-routing/references/delegation-operations.md", "agent-routing/SKILL.md"]) {
    if (!flat(docs[rel]).includes("2026-10-19, via orc")) errors.push(`${rel}: rule-1 pointer missing`);
  }
  // Contrary instruction: asking or waiting for Etan before a ship step.
  const ask = /\b(?:ask\w*|approv\w*|confirm\w*|wait\w*|stop\w*|permission|sign-off|go-ahead|blocked on)\b/i;
  const ship = /\b(?:tag|tags|tagging|release\w*|install\w*|deploy\w*|upgrade\w*)\b/i;
  for (const [rel, text] of Object.entries(docs)) {
    for (const raw of clauses(text)) {
      const c = raw.replace(/\(Etan \d{4}-\d\d-\d\d[^)]*\)/g, ""); // a dated citation is not an ask
      if (/\bEtan\b/.test(c) && ask.test(c) && ship.test(c) && !NEGATION.test(c)) errors.push(`${rel}: asks Etan before shipping: ${c}`);
    }
  }
  return errors;
}

function rule2({ docs }) {
  const errors = [];
  const routing = docs["agent-routing/SKILL.md"];
  if (!flat(routing).includes(RULE_2)) errors.push("agent-routing lacks the verbatim rule-2 quote");
  const cheap = flat(section(routing, "## Cheap sub-agents"));
  if (!cheap.includes('subagent_type: "deploy-local-prod"')) errors.push("Cheap sub-agents must dispatch deploy-local-prod");
  if (!cheap.includes("node scripts/model-roles.mjs claude.subagent.mechanical --field alias")) errors.push("checks/waits must resolve claude.subagent.mechanical");
  if (!cheap.includes("node scripts/model-roles.mjs codex.subagent.mechanical --use watcher")) errors.push("checks/waits must name the Codex watcher route");
  const gate = flat(section(docs["pr-loop/references/merge-and-verification.md"], "## Feature-Batch Gate"));
  if (!gate.includes("`deploy-local-prod` sub-agent and verifies the artifact it reports; it does not run the hop itself")) errors.push("batch gate must route the deploy hop");
  for (const rel of ["pr-loop/SKILL.md", "large-plan/SKILL.md"]) {
    const body = flat(docs[rel]);
    if (!body.includes("Leads never do ops themselves** (Etan 2026-10-19, via orc)") || !body.includes("`/agent-routing` § Lead Topology #7")) errors.push(`${rel}: rule-2 pointer missing`);
  }
  // Contrary instruction: the lead runs ops, or checks/waits are handed to the lead or the cheap tier.
  for (const [rel, text] of Object.entries(docs)) {
    for (const c of clauses(text)) {
      if (NEGATION.test(c)) continue;
      if (/\b(?:the )?leads?\b[^.]*\b(?:runs?|running|does|performs?|executes?|handles?)\b[^.]*\b(?:deploy\w*|install\w*|hop|probe|restart|reconnect|wait\w*|checks?)\b/i.test(c)) errors.push(`${rel}: lead runs ops: ${c}`);
      if (/\b(?:checks?|waits?)\b[^.]*\b(?:go|goes|routed?|belong)\b[^.]*\bto (?:the lead|`?claude\.subagent\.cheap`?)/i.test(c)) errors.push(`${rel}: checks/waits misrouted: ${c}`);
    }
  }
  return errors;
}

function rule3({ docs }) {
  const errors = [];
  const tracking = section(docs["pr-loop/references/merge-and-verification.md"], "### After Merge: Update Tracking (MANDATORY)");
  if (!flat(tracking).includes(RULE_3)) errors.push("Update Tracking lacks the rule-3 quote");
  const block = tracking.match(/```bash\n([\s\S]*?)```/)?.[1] ?? "";
  if (!/set -eu/.test(block)) errors.push("root block must set -eu");
  if (!/if \[ "\$BRANCH" != "\$DEFAULT" \]; then[\s\S]*?exit [1-9]/.test(block)) errors.push("root block must exit when off the default branch");
  if (!/fetch[^\n]*\|\| \{[^}]*exit [1-9]/.test(block)) errors.push("root block must stop on a failed fetch");
  if (!/merge -q --ff-only[^\n]*\|\|\s*\{[^}]*exit [1-9]/.test(block)) errors.push("root block must stop on a failed ff-only merge");
  if (/\breset\b|--force|\bstash\b|\brebase\b/.test(block)) errors.push("root block must never force");
  if (!/Re-read those files/.test(flat(tracking))) errors.push("Update Tracking must re-read changed instructions");
  // One canonical block: no unguarded copy anywhere else in the lead skills.
  for (const [rel, text] of Object.entries(docs)) {
    const copies = text.match(/merge (?:-q )?--ff-only (?:"?origin)/g)?.length ?? 0;
    const allowed = rel === "pr-loop/references/merge-and-verification.md" ? 1 : 0;
    if (copies > allowed) errors.push(`${rel}: unguarded ff-only copy`);
  }
  const plan = flat(docs["large-plan/SKILL.md"]);
  if (!plan.includes(RULE_3) || !plan.includes("§ After Merge: Update Tracking, step 1")) errors.push("large-plan must point at the guarded block");
  return errors;
}

const EVALS = {
  "pr-loop": { "release-install-ships-while-etan-away": /human-confirm-gate/, "just-merged-ff-root-reread-instructions": /--ff-only/ },
  "agent-routing": { "lead-routes-deploy-hop-and-mechanical-waits": /claude\.subagent\.mechanical/ },
  "large-plan": { "etan-asks-only-for-one-way-doors": /@etan/ },
};
function behaviorEvals({ evals }) {
  const errors = [];
  for (const [skill, cases] of Object.entries(EVALS)) {
    for (const [name, key] of Object.entries(cases)) {
      const e = evals[skill].find((x) => x.name === name);
      const said = (a) => (a.description ?? a.text ?? "").trim();
      if (!e?.prompt?.trim() || !e.expected_output?.trim()) { errors.push(`${skill}/${name}: missing`); continue; }
      if (!Array.isArray(e.assertions) || e.assertions.length < 3 || e.assertions.some((a) => said(a).length < 20)) errors.push(`${skill}/${name}: needs >=3 non-empty assertions`);
      else if (!e.assertions.some((a) => key.test(said(a)))) errors.push(`${skill}/${name}: no assertion checks ${key}`);
    }
  }
  return errors;
}

const CHECKS = { rule1, rule2, rule3, behaviorEvals };
test("PR merge law forbids asking Etan to approve or merge", () => {
  const { docs } = loadCorpus();
  for (const rel of ["pr-loop/SKILL.md", "pr-loop/references/merge-and-verification.md"]) {
    expect(flat(docs[rel])).toContain("Never ask Etan to approve or merge a PR");
  }
  const merge = flat(section(docs["pr-loop/references/merge-and-verification.md"], "## Single-Account Review Verdicts"));
  expect(merge).toContain("[Merge Authority](pr-creation.md#merge-authority)");
  expect(merge).toContain("`gh pr merge <N> --merge --admin`");
  expect(merge).toContain("BLOCKED");
});

test("agent-routing states service tier and placement near the top", () => {
  const text = loadCorpus().docs["agent-routing/SKILL.md"];
  const rule = section(text, "## Service tier and placement");
  expect(rule.trim()).not.toBe("");
  expect(text.indexOf("## Service tier and placement")).toBeLessThan(text.indexOf("## Routing rules (SSOT)"));
  for (const instruction of [
    'Claude `fastMode:false`', 'Codex `serviceTier:"default"`',
    "Elevated service requires Etan's explicit request for that task.",
    "Harness examples do not authorize elevated service.", 'workspaceStrategy:{type:"root"}',
    "only worker threads bind worktrees", "Theo's official T3 Code nightly",
    "never build or install T3 from our fork", "Etan, 2026-10-26",
  ]) expect(rule).toContain(instruction);
});

for (const [name, check] of Object.entries(CHECKS)) {
  test(`contract ${name} holds on this tree`, () => expect(check(loadCorpus())).toEqual([]));
}

test("the mechanical role resolves through model-roles, apart from the cheap tier", () => {
  expect(resolveModelRole("claude.subagent.mechanical")).toBeTruthy();
  expect(resolveModelRole("claude.subagent.mechanical")).not.toBe(resolveModelRole("claude.subagent.cheap"));
});

test("trigger phrases for each rule are registered", () => {
  const triggers = (skill) =>
    JSON.parse(readFileSync(path.join(skillsDir, skill, "evals", "trigger-evals.json"), "utf8"))
      .filter((e) => e.should_trigger).map((e) => e.query);
  expect(triggers("pr-loop")).toContain("should I ask Etan before tagging the release?");
  expect(triggers("agent-routing")).toContain("deploy 1.5.66 to both Macs");
  expect(triggers("large-plan")).toContain("merged #812, what now?");
});

// Mutants: each reverses one rule in memory; its check must fail.
const append = (rel, line) => (c) => { c.docs[rel] += `\n\n${line}\n`; };
const replace = (rel, from, to) => (c) => {
  if (!c.docs[rel].includes(from)) throw new Error(`mutant anchor missing in ${rel}: ${from}`);
  c.docs[rel] = c.docs[rel].replace(from, to);
};
const MUTANTS = [
  ["rule1", "a release that waits for Etan", append("pr-loop/references/merge-and-verification.md", "Before the release, ask Etan for approval.")],
  ["rule1", "an install blocked on Etan", append("large-plan/SKILL.md", "Installs wait for Etan's go-ahead.")],
  ["rule1", "the canonical quote reversed", replace("pr-loop/SKILL.md", "upgrades ship without asking.", "upgrades need Etan's approval.")],
  ["rule2", "the lead runs the deploy itself", append("pr-loop/SKILL.md", "The lead runs the deploy hop itself.")],
  ["rule2", "checks and waits handed to the lead", append("agent-routing/SKILL.md", "Checks and waits go to the lead.")],
  ["rule2", "checks and waits handed to the cheap tier", replace("agent-routing/SKILL.md", "claude.subagent.mechanical --field alias", "claude.subagent.cheap --field alias")],
  ["rule3", "the branch guard removed", replace("pr-loop/references/merge-and-verification.md", 'if [ "$BRANCH" != "$DEFAULT" ]; then', 'if false; then')],
  ["rule3", "a failed merge no longer stops", replace("pr-loop/references/merge-and-verification.md", 'merge -q --ff-only "$BASE" ||', 'merge -q --ff-only "$BASE" ;')],
  ["rule3", "an unguarded copy in large-plan", append("large-plan/SKILL.md", "Run `git -C <root> merge --ff-only origin/<default>`.")],
  ["behaviorEvals", "a behavior eval emptied", (c) => { c.evals["pr-loop"].find((e) => e.name === "release-install-ships-while-etan-away").assertions = []; }],
  ["behaviorEvals", "assertions blanked", (c) => { for (const a of c.evals["large-plan"].find((e) => e.name === "etan-asks-only-for-one-way-doors").assertions) a.description = ""; }],
];
for (const [check, label, mutate] of MUTANTS) {
  test(`mutant caught by ${check}: ${label}`, () => {
    const corpus = loadCorpus();
    mutate(corpus);
    expect(CHECKS[check](corpus).length).toBeGreaterThan(0);
  });
}
