// w13 eval driver (golems gemini-research admission key format). A/B smoke record:
// RED = merge-base(HEAD, origin/master) SKILL.md + prompt-template.md, GREEN = this checkout's.
// Each arm's skill file bundles SKILL.md with its prompt template, because the admission wording
// lives in the template. Pinned semantic judge via rejudgeSpec. api-key via createCell.
// usage: node run.mjs <case-id|all> <rep-from> <rep-to> [--dry]
// env: SKILL_CREATOR_REPO (default $HOME/Gits/skill-creator), API_KEY_FILE (required), OUT_DIR (default <repo>/docs.local/w13-eval)
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.resolve(here, "../..");
const git = (...a) => execFileSync("git", a, { cwd: here, encoding: "utf8" });
const top = git("rev-parse", "--show-toplevel").trim();
const SC = process.env.SKILL_CREATOR_REPO ?? path.join(process.env.HOME, "Gits", "skill-creator");
const API_KEY_FILE = process.env.API_KEY_FILE;
if (!API_KEY_FILE || !existsSync(API_KEY_FILE)) throw new Error("API_KEY_FILE must name an existing key file");
const OUT = process.env.OUT_DIR ?? path.join(top, "docs.local", "w13-eval");
const { recordSmoke, rejudgeSpec, createAuthedCleanCell } = await import(path.join(SC, "src/smoke-harness.js"));
const { costOf } = await import(path.join(SC, "src/cost.js"));

const MODEL = "claude-sonnet-5-5";
const EFFORT = "medium";
const rel = path.relative(top, skillDir);
const base = git("merge-base", "HEAD", "origin/master").trim();
const bundle = (skill, template) => `${skill}\n\n---\n\n# references/prompt-template.md\n\n${template}`;
mkdirSync(OUT, { recursive: true });
const redFile = path.join(OUT, "RED-bundle.md"), greenFile = path.join(OUT, "GREEN-bundle.md");
writeFileSync(redFile, bundle(git("show", `${base}:${rel}/SKILL.md`), git("show", `${base}:${rel}/references/prompt-template.md`)));
writeFileSync(greenFile, bundle(readFileSync(path.join(skillDir, "SKILL.md"), "utf8"), readFileSync(path.join(skillDir, "references/prompt-template.md"), "utf8")));
console.error(`RED base ${base}; GREEN head ${git("rev-parse", "HEAD").trim()} (worktree files)`);

const spec = JSON.parse(readFileSync(path.join(here, "cases.json"), "utf8"));
const [which = "all", from = "1", to = "3", dry] = process.argv.slice(2);
const createCell = (opts) => createAuthedCleanCell({ ...opts, apiKeyFile: API_KEY_FILE });

for (const c of spec.cases.filter((c) => which === "all" || c.id === which)) {
  for (let rep = Number(from); rep <= Number(to); rep++) {
    const outDir = path.join(OUT, "runs", c.id, `r${rep}`);
    const specPath = path.join(outDir, "spec.json");
    if (existsSync(specPath)) { console.error(`skip ${c.id} r${rep}: exists`); continue; }
    if (dry) { console.error(`would record ${c.id} r${rep}`); continue; }
    console.error(`record ${c.id} r${rep}`);
    await recordSmoke({
      skill: spec.skill, prompt: c.prompt,
      skillFile: greenFile, baselineSkillFile: redFile,
      allowedTools: [], baselineAllowedTools: [], declaredTools: [],
      outDir, model: MODEL, effort: EFFORT, maxBudgetUsd: 0.5, auth: "api-key", createCell,
    });
    writeFileSync(specPath, JSON.stringify({
      skill: spec.skill, baselineSkill: `gemini-research@${base.slice(0, 9)}`, prompt: c.prompt,
      note: "w13 A/B: without = master SKILL.md+template, with = branch SKILL.md+template",
      without: `${spec.skill}.without.json`, with: `${spec.skill}.with.json`,
      assertions: spec.assertions[c.category],
    }, null, 2));
    const { judged } = await rejudgeSpec(specPath, { allowedTools: [], auth: "api-key", createCell, maxBudgetUsd: 0.5 });
    console.table(judged);
  }
}

let usd = 0;
const rows = [];
for (const c of spec.cases) {
  for (let rep = 1; rep <= 9; rep++) {
    const dir = path.join(OUT, "runs", c.id, `r${rep}`);
    if (!existsSync(path.join(dir, "spec.json"))) continue;
    for (const [arm, file] of [["RED(master)", "without"], ["GREEN(branch)", "with"]]) {
      const leg = JSON.parse(readFileSync(path.join(dir, `${spec.skill}.${file}.json`), "utf8"));
      usd += costOf(leg.modelUsage).usd;
      for (const a of spec.assertions[c.category]) {
        const j = leg.semantic_judgments?.[a.id];
        if (j?.usage?.modelUsage) usd += costOf(j.usage.modelUsage).usd;
        rows.push({ case: c.id, rep, arm, assertion: a.id, pass: j?.verdict === true,
          trusted: j?.trusted ?? null, models: Object.keys(leg.modelUsage ?? {}).join(","),
          judge_models: Object.keys(j?.usage?.modelUsage ?? {}).join(",") });
      }
    }
  }
}
const summary = {}, reps = {};
for (const r of rows) {
  const k = `${r.case} | ${r.arm}`;
  summary[k] ??= [0, 0]; summary[k][1]++; if (r.pass) summary[k][0]++;
  const rk = `${k} | r${r.rep}`; reps[rk] ??= true; if (!r.pass) reps[rk] = false;
}
const out = { base, head: git("rev-parse", "HEAD").trim(), model: MODEL, effort: EFFORT, rows,
  summary: Object.fromEntries(Object.entries(summary).map(([k, [p, n]]) => [k, `${p}/${n}`])),
  repsAllPass: reps, usd_list: Number(usd.toFixed(4)) };
writeFileSync(path.join(OUT, "tally.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify({ summary: out.summary, usd_list: out.usd_list }, null, 2));
