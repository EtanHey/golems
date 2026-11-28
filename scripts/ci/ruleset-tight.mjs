#!/usr/bin/env node
// Is master's merge gate still tight? Ruleset 23948189 must have no bypass actors and strict (up-to-date) required
// checks. AIDEV-NOTE: docs/architecture/merge-gate.md. GitHub returns `bypass_actors` only to a caller who can edit
// the ruleset (an Actions run showed GITHUB_TOKEN gets no such key), so a missing field is "cannot see", never
// "empty". Default mode fails closed on it (lead's admin token; planned live row `ruleset-tight`). `--visible`
// (planned CI row `ruleset-strict`) checks every field the token can see and says the bypass check was not made.
// AIDEV-TODO: add both rows once ruleset 23948189 is tightened (docs/architecture/merge-gate.md, change 3).
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const RULESET_ID = 23948189;

export function checkRuleset(ruleset, { visibleOnly = false } = {}) {
  const problems = [], notes = [];
  if (!ruleset || typeof ruleset !== 'object') return { ok: false, problems: ['ruleset response is not an object'], notes };
  if (ruleset.enforcement !== 'active') problems.push(`enforcement is ${JSON.stringify(ruleset.enforcement)}, not "active"`);
  const hidden = !Object.hasOwn(ruleset, 'bypass_actors');
  if (hidden && visibleOnly) notes.push('bypass_actors hidden from this token: NOT checked here (live row ruleset-tight checks it)');
  else if (hidden) problems.push('cannot see bypass_actors: this token cannot edit the ruleset, so emptiness is unproven');
  else if (!Array.isArray(ruleset.bypass_actors) || ruleset.bypass_actors.length) {
    problems.push(`bypass_actors is not empty: ${JSON.stringify(ruleset.bypass_actors)}`);
  }
  const checks = (ruleset.rules ?? []).find(rule => rule?.type === 'required_status_checks');
  if (!checks) problems.push('no required_status_checks rule');
  else {
    if (checks.parameters?.strict_required_status_checks_policy !== true) problems.push('strict_required_status_checks_policy is not true');
    if (!checks.parameters?.required_status_checks?.some(check => check?.context === 'ratchet')) problems.push('ratchet is not a required check');
  }
  return { ok: problems.length === 0, problems, notes };
}

export function main(args = process.argv.slice(2)) {
  if (args.some(arg => arg !== '--visible')) { console.error('usage: ruleset-tight.mjs [--visible]'); return 2; }
  const visibleOnly = args.includes('--visible');
  const response = spawnSync('gh', ['api', `repos/EtanHey/golems/rulesets/${RULESET_ID}`], { encoding: 'utf8', timeout: 60000 });
  if (response.status !== 0) {
    console.error(`ruleset-tight FAIL: gh api failed: ${(response.stderr || response.error || response.signal || '').toString().trim()}`);
    return 1;
  }
  let result;
  try { result = checkRuleset(JSON.parse(response.stdout), { visibleOnly }); }
  catch (error) { console.error(`ruleset-tight FAIL: ${error.message}`); return 1; }
  for (const note of result.notes) console.log(`ruleset-tight NOTE: ${note}`);
  if (result.ok) {
    console.log(`ruleset-tight PASS: ruleset ${RULESET_ID} ${result.notes.length ? 'is active with strict required checks incl. ratchet' : 'has no bypass actors, is active, and has strict required checks incl. ratchet'}`);
    return 0;
  }
  for (const problem of result.problems) console.error(`ruleset-tight FAIL: ${problem}`);
  return 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main();
