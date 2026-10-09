import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020';
import { validateCensusCoreRelations } from '../lib/worktree-census-core';
import { validateCensusEsrchWitnesses } from '../lib/worktree-census-esrch';
const root = new URL('../lib/contracts/cmux-current-census/v1/', import.meta.url);
const read = (name: string) => JSON.parse(readFileSync(new URL(name, root), 'utf8'));
const fixture = (n = '08') => read(`fixtures/${({ '08': '08-esrch-disappearance', '09': '09-esrch-invented-history',
  '10': '10-esrch-missing-native-reread', '14': '14-esrch-pid-reuse' } as any)[n]}.json`);
const shape = new Ajv2020({ strictTypes: false }).compile(read('schema.json'));
function check(v: any) {
  expect(shape(v), JSON.stringify(shape.errors)).toBe(true);
  expect(validateCensusCoreRelations(v).issues).toEqual([]);
  const before = JSON.stringify(v), result = validateCensusEsrchWitnesses(v);
  expect(JSON.stringify(v)).toBe(before);
  expect(result.digestVerification).toBe('UNVERIFIED');
  for (const field of ['status', 'eligible', 'complete', 'removal']) expect(result).not.toHaveProperty(field);
  expect(result.unverified.map(x => x.code)).toContain('SURFACE_CAPTURE_ASSOCIATION');
  return result;
}
const resolution = (v: any) => v.coverage.resolutions[0];
function reject(v: any, code: string) { expect(check(v).issues.map(x => x.code)).toContain(code); }
function unknown(v: any, object: any, key: string, path: string) {
  object[key] = null; v.missing_evidence.push({ field_path: path, reason_code: 'UNKNOWN', reason: 'Synthetic unknown' });
}
function surface(v = fixture()) {
  v.surfaces = [{ surface_record_id: 'sr', diagnostic_id: 'terminal-native', window_id: 'window-native',
    workspace_id: 'workspace-native', pane_id: 'pane-native', surface_id: 'surface-native', mapping: 'MAPPED',
    lifecycle: 'READY', visible: true, runtime_created_us: '0', process_refs: ['pnew'], display_path: null,
    provenance: { ...v.coverage.attempts[3].provenance, observed_us: '3' } }];
  v.coverage.final_surface_refs = ['sr'];
  v.missing_evidence.push({ field_path: '/surfaces/0/display_path', reason_code: 'NOT_APPLICABLE', reason: 'Synthetic' });
  const fields: any = { WINDOW: 'window_id', WORKSPACE: 'workspace_id', PANE: 'pane_id', SURFACE: 'surface_id', TERMINAL: 'diagnostic_id' };
  for (const m of v.coverage.membership_observations) if (fields[m.scope])
    m.members = m.observed_members = [v.surfaces[0][fields[m.scope]]];
  return v;
}
for (const n of ['08', '14']) test(`frozen ${n} stays structurally consistent and unverified`, () => {
  const v = fixture(n), result = check(v); expect(result.issues).toEqual([]);
  expect(result.resolutions[0].claimedInterval).toEqual({ started_us: '3', completed_us: '4' });
  expect(v.status).toBe('INCOMPLETE');
});
test('09 invented history stays a core rejection', () => {
  expect(validateCensusCoreRelations(fixture('09')).issues.map(x => x.code)).toContain('HISTORICAL_IDENTITY');
});
test('10 cannot borrow uncited coverage observations', () => reject(fixture('10'), 'REREAD_MATRIX'));
for (const pair of ['NATIVE_TREE/WINDOW', 'NATIVE_TREE/WORKSPACE', 'NATIVE_TREE/PANE', 'NATIVE_TREE/SURFACE',
  'NATIVE_INDEPENDENT/WINDOW', 'NATIVE_INDEPENDENT/WORKSPACE', 'NATIVE_INDEPENDENT/PANE', 'NATIVE_INDEPENDENT/SURFACE', 'NATIVE_DEBUG/TERMINAL'])
  test(`missing explicit ${pair} category rejects`, () => {
    const v = fixture(); resolution(v).native_reread_observation_refs = resolution(v).native_reread_observation_refs
      .filter((id: string) => { const m = v.coverage.membership_observations.find((x: any) => x.observation_id === id); return `${m.source}/${m.scope}` !== pair; });
    reject(v, 'REREAD_MATRIX');
  });
for (const change of ['round', 'operation', 'result']) test(`native attempt wrong ${change} rejects`, () => {
  const v = fixture(); v.coverage.attempts[3][change] = ({ round: 1, operation: 'RAW_REGISTRATION', result: 'EPERM' } as any)[change];
  reject(v, 'FRESH_ATTEMPT');
});
test('wrong ref kind stops at core boundary', () => {
  const v = fixture(); resolution(v).native_reread_observation_refs = ['a3'];
  expect(validateCensusCoreRelations(v).issues.map(x => x.code)).toContain('REFERENCE');
});
for (const change of ['round', 'result', 'subject_pid']) test(`failed anchor wrong ${change} rejects`, () => {
  const v = fixture(); v.coverage.attempts[0][change] = ({ round: 2, result: 'EPERM', subject_pid: null } as any)[change];
  if (change === 'subject_pid') v.missing_evidence.push({ field_path: '/coverage/attempts/0/subject_pid', reason_code: 'UNKNOWN', reason: 'Synthetic' });
  reject(v, 'FAILURE_ANCHOR');
});
for (const target of ['owner', 'identity', 'accounting', 'disappearance', 'replacement']) test(`${target} strict launch accounting rejects`, () => {
  const v = fixture(target === 'disappearance' || target === 'replacement' ? '14' : '08');
  if (target === 'owner') v.coverage.membership_observations[0].source = 'NATIVE_TREE';
  if (target === 'identity') resolution(v).identity_recheck_attempt_refs = [];
  if (target === 'accounting') resolution(v).surviving_process_refs = [];
  if (target === 'disappearance') resolution(v).disposition = 'DISAPPEARANCE_RECONCILED';
  if (target === 'replacement') { resolution(v).surviving_process_refs = ['pnew']; resolution(v).replacement_process_refs = []; }
  reject(v, ({ owner: 'FINAL_OWNER', identity: 'IDENTITY_REREAD', accounting: 'FINAL_ACCOUNTING', disappearance: 'DISAPPEARANCE', replacement: 'PID_REUSE' } as any)[target]);
});
for (const change of ['reversed', 'collection', 'failure', 'provenance']) test(`known ${change} timing contradiction rejects`, () => {
  const v = fixture();
  if (change === 'reversed') v.coverage.attempts[2].started_us = '5';
  if (change === 'collection') v.collection_completed_us = '3';
  if (change === 'failure') v.coverage.attempts[0].completed_us = '4';
  if (change === 'provenance') v.processes[0].identity_provenance.observed_us = '2';
  reject(v, 'TIME_ORDER');
});
test('unknown endpoint preserves null/reason and suppresses hull', () => {
  const v = fixture(); unknown(v, v.coverage.attempts[2], 'started_us', '/coverage/attempts/2/started_us');
  const r = check(v); expect(r.issues).toEqual([]); expect(r.resolutions[0].claimedInterval).toBeNull();
  expect(r.unverified.map(x => x.code)).toContain('TIMING');
});
test('exact decimals beyond safe integer catch adjacent reversed times', () => {
  const v = fixture();
  const shift = (x: any): any => { if (!x || typeof x !== 'object') return;
    for (const k of Object.keys(x)) { if (/_us$/.test(k) && k !== 'elapsed_budget_us' && x[k] !== null) x[k] = (9007199254740992n + BigInt(x[k])).toString(); else shift(x[k]); } };
  shift(v); expect(check(v).issues).toEqual([]);
  v.coverage.attempts[2].started_us = '9007199254740997'; reject(v, 'TIME_ORDER');
});
test('inclusive equal times require no global barrier or overlap', () => {
  const v = fixture(); v.coverage.attempts[0].completed_us = '3';
  for (const a of v.coverage.attempts.slice(1)) a.completed_us = '3';
  expect(check(v).issues).toEqual([]);
});
test('explicit same-source/scope BEFORE/AFTER order cannot reverse', () => {
  const v = fixture(), m = v.coverage.membership_observations;
  m[1].phase = 'BEFORE'; m[6].phase = 'AFTER';
  const a = structuredClone(v.coverage.attempts[3]); a.attempt_id = 'a5'; a.provenance.observed_us = '4';
  v.coverage.attempts.push(a);
  v.missing_evidence.push(...v.missing_evidence.filter((x: any) => x.field_path.startsWith('/coverage/attempts/3/'))
    .map((x: any) => ({ ...x, field_path: x.field_path.replace('/coverage/attempts/3/', '/coverage/attempts/4/') })));
  m[1].attempt_ref = 'a5'; reject(v, 'TIME_ORDER');
});
test('duplicate observations under distinct IDs remain retained', () => {
  const v = fixture(), m = structuredClone(v.coverage.membership_observations[1]); m.observation_id = 'duplicate_read';
  v.coverage.membership_observations.push(m); resolution(v).native_reread_observation_refs.push(m.observation_id);
  expect(check(v).issues).toEqual([]);
});
test('matching surface IDs/time still cannot prove capture association', () => expect(check(surface()).issues).toEqual([]));
for (const scope of ['WINDOW', 'WORKSPACE', 'PANE', 'SURFACE', 'TERMINAL']) test(`${scope} native namespace mismatch rejects`, () => {
  const v = surface(), m = v.coverage.membership_observations.find((x: any) => x.scope === scope);
  m.members = m.observed_members = ['sr']; reject(v, 'NATIVE_INVENTORY');
});
test('stale surface time rejects even with current creation telemetry', () => {
  const v = surface(); v.surfaces[0].provenance.observed_us = '2'; v.surfaces[0].runtime_created_us = '3'; reject(v, 'TIME_ORDER');
});
test('unknown binding time never substitutes creation time', () => {
  const v = surface(); unknown(v, v.surfaces[0].provenance, 'observed_us', '/surfaces/0/provenance/observed_us');
  expect(check(v).unverified.map(x => x.code)).toContain('TIMING');
});
test('surface process ref must select a final process', () => {
  const v = surface(), p = structuredClone(v.processes[0]); p.process_record_id = 'historical';
  v.processes.push(p); v.coverage.process_observation_refs.push('historical');
  v.missing_evidence.push(...v.missing_evidence.filter((x: any) => x.field_path.startsWith('/processes/0/'))
    .map((x: any) => ({ ...x, field_path: x.field_path.replace('/processes/0/', '/processes/1/') })));
  v.surfaces[0].process_refs = ['historical']; reject(v, 'SURFACE_PROCESS');
});
for (const edge of ['collection', 'failure']) test(`known ${edge} contradiction survives unknown intermediate time`, () => {
  const v = fixture(), a = v.coverage.attempts[2];
  unknown(v, a, 'started_us', '/coverage/attempts/2/started_us');
  unknown(v, a.provenance, 'observed_us', '/coverage/attempts/2/provenance/observed_us');
  unknown(v, v.processes[0], 'identity_provenance', '/processes/0/identity_provenance');
  a.completed_us = edge === 'collection' ? '0' : '1'; reject(v, 'TIME_ORDER');
});
test('round-two attempts need no intersection or temporal adjacency', () => {
  const v = fixture(); v.collection_completed_us = '1000';
  v.coverage.attempts[3].started_us = v.coverage.attempts[3].completed_us = v.coverage.attempts[3].provenance.observed_us = '1000';
  expect(check(v).issues).toEqual([]);
});
for (const field of ['source', 'scope', 'authoritative']) test(`final owner wrong ${field} rejects`, () => {
  const v = fixture(), m = v.coverage.membership_observations[0];
  if (field === 'source') m.source = 'NATIVE_INDEPENDENT';
  if (field === 'scope') { m.scope = 'OWNER_PID'; m.members = m.observed_members = [900000002]; }
  if (field === 'authoritative') { m.authoritative = false; unknown(v, m, 'members', '/coverage/membership_observations/0/members'); }
  reject(v, 'FINAL_OWNER');
});
test('retained positives cannot contradict authoritative empty reread', () => {
  const v = fixture(); v.coverage.membership_observations[1].observed_members = ['unrepresented-native']; reject(v, 'REREAD_MEMBERSHIP');
});
test('unknown surface mapping and binding remain explicit gaps', () => {
  const v = surface(), s = v.surfaces[0]; s.mapping = 'UNMAPPED'; s.lifecycle = 'UNKNOWN';
  unknown(v, s, 'surface_id', '/surfaces/0/surface_id'); unknown(v, s, 'process_refs', '/surfaces/0/process_refs');
  const r = check(v); expect(r.issues).toEqual([]);
  expect(r.unverified.map(x => x.code)).toContain('SURFACE_BINDING');
  expect(r.unverified.map(x => x.code)).toContain('NATIVE_INVENTORY');
});
test('different resolutions cannot borrow one another identity rereads', () => {
  const v = fixture(), r = structuredClone(resolution(v)); r.resolution_id = 'z2'; r.identity_recheck_attempt_refs = [];
  v.coverage.resolutions.push(r); v.missing_evidence.push({ field_path: '/coverage/resolutions/1/historical_launch', reason_code: 'UNKNOWN', reason: 'Synthetic' });
  reject(v, 'IDENTITY_REREAD');
});
test('unresolved round-two ESRCH grants no reconciliation claim', () => {
  const v = fixture(); v.coverage.attempts[0].round = 2; resolution(v).disposition = 'UNRESOLVED';
  const r = check(v); expect(r.issues).toEqual([]); expect(r.resolutions[0].claimedInterval).toBeNull();
  expect(r.unverified.map(x => x.code)).toContain('UNRESOLVED');
});
