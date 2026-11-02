#!/usr/bin/env node
// The guarded set: repo paths whose changes need Mac rows before merge and a live receipt after it.
// AIDEV-NOTE: single source of truth for guarded-paths.sh and live-freshness.mjs. It is the static prefixes plus
// every dir the hook installer loads (hookDriftPaths). FV3's TLA+ model (NoFalseFresh, 2026-11-02) found 13 of 17
// hook-loaded dirs outside the old hand-written list: a merge there skipped the live receipt and freshness stayed
// green on a stale hook. Never add a second hand-written list.
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { hookDriftPaths } from '../hooks/hook-paths.mjs';

export const STATIC_GUARDED = [
  'scripts/hooks/', 'skills/golem-powers/human-confirm-gate/', 'skills/golem-powers/git-guardian/',
  'skills/golem-powers/tmp-block/', 'scripts/repogolem/', 'scripts/ratchet/',
];

export function guardedPrefixes(manifests) {
  const prefixes = new Set(STATIC_GUARDED);
  for (const manifest of manifests) for (const dir of hookDriftPaths(manifest)) prefixes.add(dir);
  return [...prefixes].sort();
}

const gitIn = (cwd) => (args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 });

// The manifest at each ref: a change that adds OR removes a hook path is guarded. Every git failure throws (the
// caller cannot tell: fail closed). Only a successful tree query that finds NO manifest entry means "no hook-loaded
// dirs at this ref" (static set only); an entry that exists must read and parse (Codex review r1, B2).
export function manifestsAt(refs, cwd = process.cwd()) {
  const git = gitIn(cwd);
  const manifests = [];
  for (const ref of refs) {
    try { git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]); }
    catch { throw new Error(`unknown ref ${ref}`); }
    if (!git(['ls-tree', `${ref}^{commit}`, '--', 'scripts/hooks/manifest.json']).trim()) continue;
    manifests.push(JSON.parse(git(['show', `${ref}:scripts/hooks/manifest.json`])));
  }
  return manifests;
}

// Literal prefix matching, never a generated regex: a manifest source can hold any character (Codex review r1, B1).
export function firstGuardedChange(base, head, cwd = process.cwd()) {
  const prefixes = guardedPrefixes(manifestsAt([base, head], cwd));
  const changed = gitIn(cwd)(['diff', '--name-only', '-z', `${base}...${head}`]).split('\0').filter(Boolean);
  return changed.find(path => prefixes.some(prefix => path.startsWith(prefix))) ?? null;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  try {
    if (args[0] === '--check') {
      // Internal contract: exit 0 = guarded, 3 = not guarded, anything else = cannot tell. "Not guarded" is 3, not 1,
      // because node itself exits 1 on a syntax error or a missing import, before this code runs (Codex r2, B3).
      // guarded-paths.sh maps 0 → 0, 3 → 1 and everything else → 2.
      if (args.length !== 3) throw new Error('usage: guarded-set.mjs --check <base> <head>');
      const hit = firstGuardedChange(args[1], args[2]);
      console.log(hit ? 'guarded path touched: Mac rows required' : 'no guarded path touched: Mac rows not required');
      process.exit(hit ? 0 : 3);
    }
    if (!args.length) throw new Error('usage: guarded-set.mjs <ref>... | --check <base> <head>');
    console.log(guardedPrefixes(manifestsAt(args)).join('\n'));
  } catch (error) {
    console.error(`guarded-set: ${error.message.split('\n')[0]}: cannot tell, FAIL`);
    process.exit(2);
  }
}
