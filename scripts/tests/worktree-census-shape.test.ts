import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import schema from '../lib/contracts/cmux-current-census/v1/schema.json';
import { validateCensusShape } from '../lib/worktree-census-shape';

const root = new URL('../lib/contracts/cmux-current-census/v1/', import.meta.url);
const read = (name: string) => readFileSync(new URL(name, root));
const fixture = (name: string): any => JSON.parse(read(`fixtures/${name}.json`).toString());
const partial = () => fixture('16-partial-kernel-identity');
const cap = schema.$defs.policy.properties.max_records_per_array.const;
function check(value: unknown, valid: boolean) {
  const before = JSON.stringify(value), result = validateCensusShape(value);
  expect(result.valid).toBe(valid);
  expect(result.scope).toBe('shape-resource');
  expect(result.digestVerification).toBe('UNVERIFIED');
  expect(Object.keys(result).sort()).toEqual(['digestVerification', 'issues', 'scope', 'valid']);
  expect(result.issues.length === 0).toBe(valid);
  expect(JSON.stringify(value)).toBe(before);
  return result;
}

const cases = JSON.parse(read('fixtures/index.json').toString()).cases;
for (const entry of cases.filter((entry: any) => entry.schema !== 'NOT_REACHED')) {
  test(`frozen ${entry.file}: ${entry.schema}, independent of semantic disposition`, () => {
    check(JSON.parse(read(entry.file).toString()), entry.schema === 'ACCEPT');
  });
}
for (const value of [null, true, false, 0, 'text', []]) {
  test(`parsed non-object root ${JSON.stringify(value)} refuses`, () => check(value, false));
}
for (const target of ['root', 'policy', 'attempt', 'partial-identity']) {
  test(`unknown member at ${target} refuses without property removal`, () => {
    const value = partial();
    const object = target === 'root' ? value : target === 'policy' ? value.collection_policy :
      target === 'attempt' ? value.coverage.attempts[0] : value.processes[0].kernel_identity_observation;
    object.unapproved = 'retain';
    const result = check(value, false);
    expect(result.issues.some(issue => issue.keyword === 'additionalProperties')).toBe(true);
    expect(object.unapproved).toBe('retain');
  });
}
for (const target of ['process', 'registration']) {
  test(`verified ${target} with unavailable launch refuses`, () => {
    const value = partial();
    if (target === 'process') value.processes[0].binding = 'VERIFIED';
    else value.registration_dispositions[0].disposition = 'VERIFIED_CURRENT';
    check(value, false);
  });
}
for (const [field, value] of Object.entries({ max_rounds: 3, elapsed_budget_us: '10000001',
  max_wire_bytes: 16_777_217, max_records_per_array: cap + 1 })) {
  test(`policy ${field} cannot change frozen resource limits`, () => {
    const input = partial(); input.collection_policy[field] = value;
    check(input, false);
  });
}
test('validation neither coerces a PID nor fills a missing field', () => {
  const input = partial(); input.processes[0].pid = String(input.processes[0].pid);
  check(input, false);
  delete input.format; check(input, false); expect(input).not.toHaveProperty('format');
});
test('COMPLETE and zero digest remain unverified shape claims', () => {
  const input = partial(); input.status = 'COMPLETE';
  check(input, true);
});
test('diagnostics copy stable paths and keywords without retaining AJV state or input values', () => {
  const input = partial(); input.format = 'private-invalid-value';
  const first = check(input, false), saved = JSON.stringify(first);
  expect(first.issues).toEqual([{ code: 'SCHEMA', path: '/format', keyword: 'const',
    schemaPath: '#/properties/format/const' }]);
  expect(saved).not.toContain(input.format);
  check(partial(), true);
  const second = check(input, false);
  expect(JSON.stringify(first)).toBe(saved);
  expect(first.issues).not.toBe(second.issues);
  expect(first.issues[0]).not.toBe(second.issues[0]);
  first.issues[0].path = '/changed'; first.issues.length = 0;
  expect(second.issues[0].path).toBe('/format');
  expect(check(input, false).issues[0].path).toBe('/format');
});

// Shape-only derivative: existing frozen records, no producer golden or semantic claim.
function arrayInput() {
  const value = partial(); value.coverage = fixture('14-esrch-pid-reuse').coverage;
  value.surfaces = [{ surface_record_id: 'sr', diagnostic_id: 'terminal', window_id: 'window',
    workspace_id: 'workspace', pane_id: 'pane', surface_id: 'surface', mapping: 'MAPPED',
    lifecycle: 'READY', visible: true, runtime_created_us: '0', process_refs: [], display_path: null,
    provenance: value.coverage.attempts[0].provenance }];
  return value;
}
const arrayPaths = [
  ...['source_versions', 'surfaces', 'processes', 'registration_dispositions', 'blockers', 'missing_evidence'],
  ...['attempts', 'membership_observations', 'resolutions', 'process_observation_refs',
    'final_process_refs', 'final_surface_refs', 'final_registration_refs'].map(key => `coverage/${key}`),
  ...['identity_recheck_attempt_refs', 'native_reread_observation_refs', 'surviving_process_refs',
    'replacement_process_refs'].map(key => `coverage/resolutions/0/${key}`),
  'surfaces/0/process_refs', 'processes/0/protected_paths', 'registration_dispositions/0/protected_paths',
];
for (const path of arrayPaths) {
  test(`array cap refuses ${path}`, () => {
    const value = arrayInput(); check(value, true);
    const keys = path.split('/'), key = keys.pop()!;
    const parent = keys.reduce((object: any, key) => object[key], value);
    // One bounded array of shared primitives; no 100,001 record constructions.
    parent[key] = Array(cap + 1).fill(null);
    expect(check(value, false).issues.some(issue => issue.keyword === 'maxItems' && issue.path === `/${path}`)).toBe(true);
  });
}
for (const scope of ['OWNER_PID', 'OWNER_LAUNCH', 'WINDOW', 'WORKSPACE', 'PANE', 'SURFACE', 'TERMINAL']) {
  for (const field of ['members', 'observed_members']) {
    test(`membership ${scope}/${field} obeys frozen cap`, () => {
      const value = arrayInput(), membership = value.coverage.membership_observations[0];
      Object.assign(membership, { scope, members: [], observed_members: [] });
      check(value, true);
      membership[field] = Array(cap + 1).fill(null);
      expect(check(value, false).issues.some(issue => issue.keyword === 'maxItems' &&
        issue.path === `/coverage/membership_observations/0/${field}`)).toBe(true);
    });
  }
}
test('exact record cap accepts a bounded primitive inventory; cap plus one refuses', () => {
  const value = arrayInput(), membership = value.coverage.membership_observations[0];
  Object.assign(membership, { scope: 'OWNER_PID', members: [],
    observed_members: Array.from({ length: cap }, (_, i) => i + 1) });
  check(value, true);
  membership.observed_members.push(cap + 1); check(value, false);
});
test('frozen manifest and all 24 imported files remain unchanged', () => {
  const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
  expect(hash(read('manifest.json'))).toBe('c5ebed07725b7e6a5ba985fd1aec58c2fbe42fa0eaeeb2c9f4e3e3422e4ae6d7');
  const manifest = JSON.parse(read('manifest.json').toString());
  for (const entry of manifest.files) {
    expect(hash(read(entry.file))).toBe(entry.sha256);
    expect(read(entry.file).length).toBe(entry.bytes);
  }
  expect(readdirSync(root, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile()).length).toBe(24);
});
