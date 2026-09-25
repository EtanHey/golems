#!/usr/bin/env bun
// Repoint skill links from the stale ~/.golems/skills copy to a real golems clone (GO-5 PR-7).
//
//   bun repoint-skills.mjs --source <golems clone>/skills/golem-powers [--link-missing] [--apply]
//
// Walks ~/.claude/skills, ~/.agents/skills, ~/.codex/skills and ~/.gemini/antigravity/skills
// (the Antigravity CLI's root); a missing root is skipped with a one-line note. For each entry:
//   ok       a link that resolves into --source
//   repoint  a link into ~/.golems/skills/<name> whose <name> exists in --source
//   dangling a link whose target is gone and whose name is not in --source (removed with --apply);
//            a dangling link whose name IS in --source is a repoint (repaired, never deleted)
//   other    anything else (real dirs, links elsewhere, retired names), left alone
// Dry-run is the default; --apply rewrites repoint links and removes dangling ones.
//
// --link-missing (#272): for each --source skill (a dir with SKILL.md) whose ~/.agents/skills
// link is a golems link (ok, or a repoint that --apply fixes first) but has no
// ~/.gemini/antigravity/skills entry, create
// ~/.gemini/antigravity/skills/<name> -> ../../../.agents/skills/<name>. Never overwrites an
// existing entry; skipped when ~/.gemini/antigravity is missing. Reports linked=N.
import { existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, realpathSync, symlinkSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const SKILL_ROOTS = [".claude/skills", ".agents/skills", ".codex/skills", ".gemini/antigravity/skills"];

function parseArgs(argv) {
  const options = { apply: false, linkMissing: false, source: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--apply") options.apply = true;
    else if (argv[i] === "--link-missing") options.linkMissing = true;
    else if (argv[i] === "--source" && argv[i + 1]) options.source = argv[++i];
    else throw new Error(`unknown or incomplete argument: ${argv[i]}`);
  }
  return options;
}

function classify(entry, sourceReal, staleRoot) {
  const stat = lstatSync(entry);
  if (!stat.isSymbolicLink()) return { kind: "other" };
  const target = path.resolve(path.dirname(entry), readlinkSync(entry));
  if (!existsSync(entry)) {
    // r7 on #232: a dangling link whose NAME exists in the clone is repaired,
    // never deleted (the MBP's collab-monitor pointed into a deleted worktree).
    const byName = path.join(sourceReal, path.basename(entry));
    return existsSync(byName) ? { kind: "repoint", replacement: byName } : { kind: "dangling" };
  }
  if (realpathSync(entry).startsWith(`${sourceReal}${path.sep}`)) return { kind: "ok" };
  const replacement = path.join(sourceReal, path.basename(target));
  if (target.startsWith(`${staleRoot}${path.sep}`) && existsSync(replacement)) {
    return { kind: "repoint", replacement };
  }
  return { kind: "other" };
}

function lexists(entry) {
  try {
    lstatSync(entry);
    return true;
  } catch {
    return false;
  }
}

export function linkMissing({ home, sourceReal, apply }) {
  const staleRoot = path.join(home, ".golems", "skills");
  const antigravityHome = path.join(home, ".gemini", "antigravity");
  if (!existsSync(antigravityHome)) return { missing: true };
  const agents = path.join(home, ".agents", "skills");
  const antigravity = path.join(antigravityHome, "skills");
  let linked = 0;
  for (const name of readdirSync(sourceReal).sort()) {
    if (name.startsWith(".") || !existsSync(path.join(sourceReal, name, "SKILL.md"))) continue;
    const agentsEntry = path.join(agents, name);
    // Only mirror golems links: ok (resolves into --source) or repoint (the walk's --apply
    // already fixed it, so dry-run and --apply report the same linked=N).
    if (!lexists(agentsEntry)) continue;
    if (!["ok", "repoint"].includes(classify(agentsEntry, sourceReal, staleRoot).kind)) continue;
    const entry = path.join(antigravity, name);
    if (lexists(entry)) continue;
    linked += 1;
    if (!apply) continue;
    mkdirSync(antigravity, { recursive: true });
    symlinkSync(path.join("..", "..", "..", ".agents", "skills", name), entry);
  }
  return { linked };
}

export function repointSkills({ home = homedir(), source, apply = false }) {
  if (!source || path.basename(source) !== "golem-powers" || !existsSync(source)) {
    throw new Error(`--source ${source} is not a golem-powers skills directory`);
  }
  const sourceReal = realpathSync(source);
  const staleRoot = path.join(home, ".golems", "skills");
  const report = [];
  for (const root of SKILL_ROOTS) {
    const dir = path.join(home, root);
    if (!existsSync(dir)) {
      report.push({ root, missing: true });
      continue;
    }
    const counts = { ok: 0, repoint: 0, dangling: 0, other: 0 };
    for (const name of readdirSync(dir)) {
      if (name.startsWith(".")) continue;
      const entry = path.join(dir, name);
      const verdict = classify(entry, sourceReal, staleRoot);
      counts[verdict.kind] += 1;
      if (!apply) continue;
      if (verdict.kind === "dangling") unlinkSync(entry);
      if (verdict.kind === "repoint") {
        unlinkSync(entry);
        symlinkSync(verdict.replacement, entry);
      }
    }
    report.push({ root, ...counts });
  }
  return report;
}

if (import.meta.main) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const home = homedir();
    for (const row of repointSkills({ ...options, home })) {
      if (row.missing) {
        console.log(`~/${row.root}: skipped (missing)`);
        continue;
      }
      console.log(`~/${row.root}: ok=${row.ok} repoint=${row.repoint} dangling=${row.dangling} other=${row.other}`);
    }
    if (options.linkMissing) {
      const result = linkMissing({ home, sourceReal: realpathSync(options.source), apply: options.apply });
      if (result.missing) console.log("~/.gemini/antigravity: link-missing skipped (missing)");
      else console.log(`~/.gemini/antigravity/skills: linked=${result.linked}`);
    }
    console.log(options.apply ? "applied" : "dry-run: nothing changed (pass --apply)");
  } catch (error) {
    console.error(`repoint-skills: ${error.message}`);
    process.exit(1);
  }
}
