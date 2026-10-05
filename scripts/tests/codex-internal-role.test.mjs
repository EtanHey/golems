import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveModelRole } from '../model-roles.mjs';
import { loadConfig } from '../ci/check-model-role-drift.mjs';
test('only mechanical Codex-internal use is exempt from the candidate gate', () => {
  const expected = loadConfig().roles['codex.subagent.mechanical'].model;
  assert.equal(resolveModelRole('codex.subagent.mechanical', undefined, { use: 'codex-internal-subagent' }), expected);
  for (const name of ['constructor', 'toString', 'missing', 'codex.subagent.mechanical']) assert.throws(() => resolveModelRole(name));
  assert.throws(() => resolveModelRole('codex.subagent.mechanical', undefined, { use: 'headless-worker' }));
});
