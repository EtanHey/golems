import { test, expect } from 'bun:test';
import { checkRuleset } from '../ci/ruleset-tight.mjs';

// Shape of GET /repos/{owner}/{repo}/rulesets/{id}; the "loose" form is master's ruleset before the merge-gate change.
const ruleset = ({ bypass = [], strict = true, checks = ['Loop-record', 'ratchet'] } = {}) => ({
  id: 1, name: 'fixture', target: 'branch', enforcement: 'active', bypass_actors: bypass,
  rules: [{ type: 'deletion' }, { type: 'required_status_checks', parameters: {
    strict_required_status_checks_policy: strict, required_status_checks: checks.map(context => ({ context })) } }],
});
const admin = [{ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' }];

test('tight ruleset passes', () => {
  expect(checkRuleset(ruleset())).toEqual({ ok: true, problems: [] });
});

test('the pre-change ruleset (admin bypass, non-strict) fails on both holes', () => {
  const result = checkRuleset(ruleset({ bypass: admin, strict: false }));
  expect(result.ok).toBe(false);
  expect(result.problems.some(p => p.startsWith('bypass_actors is not empty'))).toBe(true);
  expect(result.problems).toContain('strict_required_status_checks_policy is not true');
});

test('a hidden bypass_actors field is unproven, never empty', () => {
  const { bypass_actors, ...hidden } = ruleset();
  expect(bypass_actors).toEqual([]);
  const result = checkRuleset(hidden);
  expect(result.ok).toBe(false);
  expect(result.problems[0]).toContain('cannot see bypass_actors');
});

test('missing strict, missing ratchet check, disabled enforcement and junk all fail', () => {
  expect(checkRuleset(ruleset({ checks: ['Loop-record'] })).problems).toContain('ratchet is not a required check');
  expect(checkRuleset({ ...ruleset(), rules: [] }).problems).toContain('no required_status_checks rule');
  expect(checkRuleset({ ...ruleset(), enforcement: 'evaluate' }).ok).toBe(false);
  expect(checkRuleset(ruleset({ bypass: null })).ok).toBe(false);
  expect(checkRuleset(null).ok).toBe(false);
});
