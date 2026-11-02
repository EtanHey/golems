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

// The manifest at each ref: a change that adds OR removes a hook path is guarded. A ref that does not exist is an
// error (the caller cannot tell: fail closed). A ref without a manifest has no hook-loaded dirs: static set only.
export function manifestsAt(refs, cwd = process.cwd()) {
  const git = (args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const manifests = [];
  for (const ref of refs) {
    try { git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]); }
    catch { throw new Error(`unknown ref ${ref}`); }
    try { git(['cat-file', '-e', `${ref}:scripts/hooks/manifest.json`]); }
    catch { continue; }
    manifests.push(JSON.parse(git(['show', `${ref}:scripts/hooks/manifest.json`])));
  }
  return manifests;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const refs = process.argv.slice(2);
  if (!refs.length) { console.error('usage: guarded-set.mjs <ref>...'); process.exit(2); }
  try { console.log(guardedPrefixes(manifestsAt(refs)).join('\n')); }
  catch (error) { console.error(`guarded-set: ${error.message}`); process.exit(2); }
}
