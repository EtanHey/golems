#!/usr/bin/env bun
// Repoint skill links from the stale ~/.golems/skills copy to a real golems clone (GO-5 PR-7).
//
//   bun repoint-skills.mjs --source ~/Gits/golems/skills/golem-powers [--apply]
//
// Walks ~/.claude/skills, ~/.agents/skills and ~/.codex/skills. For each entry:
//   ok       a link that resolves into --source
//   repoint  a link into ~/.golems/skills/<name> whose <name> exists in --source
//   dangling a link whose target is gone (removed with --apply)
//   other    anything else (real dirs, links elsewhere, retired names), left alone
// Dry-run is the default; --apply rewrites repoint links and removes dangling ones.
import { existsSync, lstatSync, readdirSync, readlinkSync, realpathSync, symlinkSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

function parseArgs(argv) {
  const options = { apply: false, source: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--apply") options.apply = true;
    else if (argv[i] === "--source" && argv[i + 1]) options.source = argv[++i];
    else throw new Error(`unknown or incomplete argument: ${argv[i]}`);
  }
  return options;
}

function classify(entry, sourceReal, staleRoot) {
  const stat = lstatSync(entry);
  if (!stat.isSymbolicLink()) return { kind: "other" };
  const target = path.resolve(path.dirname(entry), readlinkSync(entry));
  if (!existsSync(entry)) return { kind: "dangling" };
  if (realpathSync(entry).startsWith(`${sourceReal}${path.sep}`)) return { kind: "ok" };
  const replacement = path.join(sourceReal, path.basename(target));
  if (target.startsWith(`${staleRoot}${path.sep}`) && existsSync(replacement)) {
    return { kind: "repoint", replacement };
  }
  return { kind: "other" };
}

export function repointSkills({ home = homedir(), source, apply = false }) {
  if (!source || path.basename(source) !== "golem-powers" || !existsSync(source)) {
    throw new Error(`--source ${source} is not a golem-powers skills directory`);
  }
  const sourceReal = realpathSync(source);
  const staleRoot = path.join(home, ".golems", "skills");
  const report = [];
  for (const root of [".claude/skills", ".agents/skills", ".codex/skills"]) {
    const dir = path.join(home, root);
    const counts = { ok: 0, repoint: 0, dangling: 0, other: 0 };
    if (existsSync(dir)) {
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
    }
    report.push({ root, ...counts });
  }
  return report;
}

if (import.meta.main) {
  try {
    const options = parseArgs(process.argv.slice(2));
    for (const row of repointSkills(options)) {
      console.log(`~/${row.root}: ok=${row.ok} repoint=${row.repoint} dangling=${row.dangling} other=${row.other}`);
    }
    console.log(options.apply ? "applied" : "dry-run: nothing changed (pass --apply)");
  } catch (error) {
    console.error(`repoint-skills: ${error.message}`);
    process.exit(1);
  }
}
