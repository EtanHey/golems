import { expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// W6 catalog cap. Every skill description is catalog-visible at every Claude boot,
// so its length is a per-boot token cost. Cap it at 120 chars.
//
// A description IS the skill's routing trigger. It may never be truncated blindly:
// every literal trigger phrase, every "NOT for" exclusion, and the one-line
// what-it-does must survive. Anything else (feature lists, platform lists,
// doctrine) belongs in the SKILL.md body under `## Scope`.
//
// Some skills carry more literal trigger phrases than fit in 120 chars. Those are
// listed below, PINNED to their current length: they may shrink, never grow. A
// pinned skill that drops to <= 120 must be removed from this list, so the list
// can only ever get shorter.
const CAP = 120;

const EXCEPTIONS = {
  "adversarial-council": 234,
  "audio-dashboard": 163,
  "budget-usage-lint": 244,
  "codex-workflows": 142,
  "collab-monitor": 185,
  "conference-recruiting": 240,
  "convention-audit": 237,
  "crash-resume-index": 181,
  "cursor-multitask": 222,
  "drive-usage": 250,
  eli5: 138,
  "grill-me": 158,
  "i-have-adhd": 144,
  "install-runbook-linter": 178,
  "judge-fleet": 202,
  "launchd-secret-linter": 151,
  "pane-liveness-check": 170,
  "plan-council": 302,
  "pr-loop": 165,
  "pr-queue-gate": 162,
  "surface-sweep": 375,
  "tmp-block": 223,
  unslop: 251,
};

const here = path.dirname(fileURLToPath(import.meta.url));
const skillsDir = path.join(here, "..", "..", "skills", "golem-powers");

function parseDescription(skillMdPath) {
  const src = readFileSync(skillMdPath, "utf8");
  const frontmatter = src.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!frontmatter) return null;
  const field = frontmatter[1].match(
    /^description:\s*([\s\S]*?)(?=\n[A-Za-z_][A-Za-z0-9_-]*:|$)/m,
  );
  if (!field) return null;
  let value = field[1].replace(/\n\s+/g, " ").trim();
  const quoted =
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"));
  if (quoted) value = value.slice(1, -1).replace(/\\"/g, '"');
  return value;
}

function catalog() {
  return readdirSync(skillsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("_"))
    .map((e) => ({ name: e.name, file: path.join(skillsDir, e.name, "SKILL.md") }))
    .filter((s) => existsSync(s.file))
    .map((s) => ({ ...s, description: parseDescription(s.file) }))
    .filter((s) => s.description !== null);
}

test("every catalog-visible skill description parses", () => {
  const skills = catalog();
  expect(skills.length).toBeGreaterThan(0);
  const unparsed = readdirSync(skillsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("_"))
    .map((e) => path.join(skillsDir, e.name, "SKILL.md"))
    .filter((f) => existsSync(f) && parseDescription(f) === null);
  expect(unparsed).toEqual([]);
});

test(`unpinned skill descriptions are <= ${CAP} chars`, () => {
  const over = catalog()
    .filter((s) => !(s.name in EXCEPTIONS) && s.description.length > CAP)
    .map((s) => `${s.name}: ${s.description.length} chars (cap ${CAP})`);
  expect(over).toEqual([]);
});

test("pinned exceptions never grow", () => {
  const grown = catalog()
    .filter((s) => s.name in EXCEPTIONS && s.description.length > EXCEPTIONS[s.name])
    .map((s) => `${s.name}: ${s.description.length} chars (pinned ${EXCEPTIONS[s.name]})`);
  expect(grown).toEqual([]);
});

test("pinned exceptions that now fit the cap are removed from the list", () => {
  const promotable = catalog()
    .filter((s) => s.name in EXCEPTIONS && s.description.length <= CAP)
    .map((s) => `${s.name}: ${s.description.length} chars — delete its EXCEPTIONS entry`);
  expect(promotable).toEqual([]);
});

test("every pinned exception names a real skill", () => {
  const names = new Set(catalog().map((s) => s.name));
  const stale = Object.keys(EXCEPTIONS).filter((n) => !names.has(n));
  expect(stale).toEqual([]);
});
