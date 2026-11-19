import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// AIDEV-NOTE: Routing data must match what T3 actually offers on each Mac. The snapshot is the
// checked-in, dated catalog (ids and option names only). It tests JSON and template output, never prose.
const root = new URL('../../', import.meta.url).pathname;
const roles = JSON.parse(readFileSync(join(root, 'standards/model-roles.json'), 'utf8')).roles;
const snapshot = JSON.parse(readFileSync(join(root, 'standards/evidence/t3-catalogs-2026-11-19.json'), 'utf8'));
const macs = Object.entries(snapshot.macs);
const claudeCatalogs = macs.filter(([, mac]) => mac.claudeAgent).map(([name, mac]) => [name, mac.claudeAgent]);
const optionNames = new Set(macs.flatMap(([, mac]) => Object.values(mac.antigravity ?? {}).flat()));

test('snapshot covers both Macs and at least one Claude catalog', () => {
  assert.deepEqual(macs.map(([name]) => name).sort(), ['M1', 'M4']);
  for (const [, mac] of macs) assert.ok(Object.keys(mac.antigravity ?? {}).length);
  assert.ok(claudeCatalogs.length);
});

test('every gather role resolves an Antigravity model on every Mac, with no hard-coded option name', () => {
  const gather = Object.entries(roles).filter(([name]) => name.startsWith('gemini.gather.'));
  assert.ok(gather.length);
  for (const [name, role] of gather) {
    const t3 = role.t3_delegate;
    assert.equal(t3?.provider, 'antigravity', `${name}: t3_delegate.provider`);
    assert.ok(t3.models?.length, `${name}: t3_delegate.models`);
    assert.equal(t3.thinking, 'high', `${name}: thinking`);
    assert.match(t3.check, /orchestrator_capabilities/, `${name}: check names the live catalog call`);
    for (const id of t3.models) {
      assert.ok(macs.some(([, mac]) => Object.hasOwn(mac.antigravity, id)), `${name}: ${id} is in no Mac's catalog`);
    }
    for (const [mac, catalog] of macs) {
      assert.ok(t3.models.some(id => Object.hasOwn(catalog.antigravity, id)), `${name}: no listed model or fallback on ${mac}`);
    }
    for (const key of Object.keys(t3.options ?? {})) {
      assert.ok(!optionNames.has(key), `${name}: hard-codes catalog option ${key}; read it from that Mac's catalog`);
    }
  }
});

function assertClaudeOptions(where, model, options) {
  for (const [mac, catalog] of claudeCatalogs) {
    const offered = catalog[model];
    assert.ok(offered, `${where}: ${model} missing from ${mac} claudeAgent snapshot`);
    for (const key of Object.keys(options)) {
      assert.ok(offered.includes(key), `${where}: passes ${key} to ${model}, whose ${mac} options are ${offered.join(', ')}`);
    }
  }
}

test('every Claude role states its delegate options, and passes only options its model offers', () => {
  const claude = Object.entries(roles).filter(([, role]) => role.model.startsWith('claude-'));
  assert.ok(claude.length);
  for (const [name, role] of claude) {
    assert.equal(role.t3_delegate?.provider, 'claudeAgent', `${name}: t3_delegate.provider`);
    assert.ok(role.t3_delegate.options, `${name}: t3_delegate.options`);
    assertClaudeOptions(name, role.model, role.t3_delegate.options);
  }
  // The owner rule (never fast unless asked) holds wherever fastMode exists.
  for (const [name, role] of claude) {
    if (Object.hasOwn(role.t3_delegate.options, 'fastMode')) assert.equal(role.t3_delegate.options.fastMode, false, name);
  }
});

test('qa-video plan template passes only options each Claude model offers', () => {
  mkdirSync(join(root, 'docs.local/w244'), { recursive: true });
  const dir = mkdtempSync(join(root, 'docs.local/w244/plan-'));
  try {
    const plan = spawnSync('bash', [join(root, 'skills/golem-powers/qa-video/scripts/default.sh'), 'plan', join(dir, 'v.mp4'), dir, 'debrief'], { encoding: 'utf8' });
    assert.equal(plan.status, 0, plan.stderr);
    const calls = plan.stdout.split('\n').filter(line => line.includes('delegate_task(') && line.includes('"claudeAgent"'));
    assert.ok(calls.length >= 2, 'judge and reader delegate_task lines');
    for (const line of calls) {
      const model = line.match(/model: "([^"]+)"/)?.[1];
      assert.ok(model, line);
      const options = Object.fromEntries([...(line.match(/options: \{([^}]*)\}/)?.[1] ?? '').matchAll(/(\w+):\s*([^,\s]+)/g)].map(m => [m[1], m[2]]));
      assertClaudeOptions('qa-video default.sh plan', model, options);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
