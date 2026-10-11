import { expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020';
import { validateCensusCoreRelations } from '../lib/worktree-census-core';

const root = new URL('../lib/contracts/cmux-current-census/v1/', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root));
const fixture = (name: string) => JSON.parse(read(`fixtures/${name}.json`).toString());
// strictTypes is linting of conditional subschemas, not input validation.
const ajv = new Ajv2020({ strictTypes: false, allErrors: true });
const shape = ajv.compile(JSON.parse(read('schema.json').toString()));
function core(value: any) {
  expect(shape(value), JSON.stringify(shape.errors)).toBe(true);
  return validateCensusCoreRelations(value);
}
function rejects(value: any, code: string) {
  const result = core(value);
  expect(result.valid).toBe(false);
  expect(result.issues.map(issue => issue.code)).toContain(code);
}
const repeated = () => fixture('03-repeated-observation');
const partial = () => fixture('16-partial-kernel-identity');

test('import preserves the frozen bytes and exact inventory, independent of checkout modes', () => {
  const manifest = JSON.parse(read('manifest.json').toString());
  const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
  expect(hash(read('manifest.json'))).toBe('c5ebed07725b7e6a5ba985fd1aec58c2fbe42fa0eaeeb2c9f4e3e3422e4ae6d7');
  for (const entry of manifest.files) {
    expect(hash(read(entry.file))).toBe(entry.sha256);
    expect(read(entry.file).length).toBe(entry.bytes);
  }
  const files = readdirSync(root, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile());
  expect(files.length).toBe(24);
});
for (const name of ['01-unavailable', '02-observed-empty', '03-repeated-observation',
  '06-unreadable-raw-registration', '08-esrch-disappearance', '14-esrch-pid-reuse', '16-partial-kernel-identity']) {
  test(`${name} has valid scoped relations, with digest still unverified`, () => {
    const result = core(fixture(name));
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.scope).toBe('core-relations');
    expect(result.digestVerification).toBe('UNVERIFIED');
    expect(result).not.toHaveProperty('eligible');
    expect(result).not.toHaveProperty('status');
  });
}
for (const [name, code] of [
  ['04-duplicate-final-identity', 'FINAL_IDENTITY'], ['05-dangling-reference', 'REFERENCE'],
  ['07-duplicate-registration-reference', 'RAW_ROW'], ['09-esrch-invented-history', 'HISTORICAL_IDENTITY'],
  ['15-duplicate-record-id', 'RECORD_ID'],
]) test(`${name} rejects its specific broken relation`, () => rejects(fixture(name), code));

for (const mutation of ['missing', 'duplicate', 'ancestor', 'nonnull', 'noncanonical']) {
  test(`null reasons reject ${mutation} pointers`, () => {
    const value = repeated();
    const entry = value.missing_evidence.find((x: any) => x.field_path === '/processes/0/session_id');
    if (mutation === 'missing') value.missing_evidence.splice(value.missing_evidence.indexOf(entry), 1);
    if (mutation === 'duplicate') value.missing_evidence.push({ ...entry });
    if (mutation === 'ancestor') entry.field_path = '/processes/0';
    if (mutation === 'nonnull') entry.field_path = '/processes/0/pid';
    if (mutation === 'noncanonical') entry.field_path = '/processes/00/session_id';
    rejects(value, 'NULL_REASON');
  });
}
test('a pointer to an unknown value cannot substitute for a missing null reason', () => {
  const value = partial();
  value.missing_evidence.find((x: any) => x.field_path === '/host_id').field_path = '/nonexistent';
  rejects(value, 'NULL_REASON');
});
test('references retain their record kind, not just an existing identifier', () => {
  const value = repeated(); value.processes[0].attempt_ref = 'm1'; rejects(value, 'REFERENCE');
});
test('observation union cannot omit or duplicate a retained process record', () => {
  const value = repeated(); value.coverage.process_observation_refs = ['p1']; rejects(value, 'OBSERVATION_UNION');
});
test('two distinct starts at one PID cannot both be final members', () => {
  const value = repeated(); value.processes[1].launch.start_microseconds = '2';
  value.coverage.final_process_refs = ['p1', 'p2']; rejects(value, 'FINAL_IDENTITY');
});
for (const field of ['host_id', 'os_boot_id', 'pid']) {
  test(`a launch cannot disagree with its ${field} context`, () => {
    const value = repeated(); value.processes[0].launch[field] = field === 'pid' ? 900000002 : 'different';
    rejects(value, 'IDENTITY_COMPONENT');
  });
}
test('known process UID must match the envelope owner', () => {
  const value = repeated(); value.processes[0].uid = 900000002; rejects(value, 'IDENTITY_COMPONENT');
});
test('known partial components cannot disagree with the process PID', () => {
  const value = partial(); value.processes[0].kernel_identity_observation.pid = 900000002;
  rejects(value, 'IDENTITY_COMPONENT');
});
test('partial observation and a complete tuple cannot disagree', () => {
  const value = repeated();
  value.processes[0].kernel_identity_observation = { ...value.processes[0].launch,
    start_microseconds: '2', uid: value.owner_uid, provenance: value.processes[0].identity_provenance };
  rejects(value, 'IDENTITY_COMPONENT');
});
test('partial evidence cannot become final authoritative process identity', () => {
  const value = partial(); value.coverage.final_process_refs = ['p_partial']; rejects(value, 'FINAL_IDENTITY');
});
test('partial attempt evidence cannot establish historical binding', () => {
  const value = partial(); value.coverage.resolutions = [{ resolution_id: 'z_partial', failed_attempt_ref: 'a1',
    disposition: 'UNRESOLVED', historical_launch: null, historical_binding_known: true,
    final_owner_membership_ref: null, identity_recheck_attempt_refs: [], native_reread_observation_refs: [],
    surviving_process_refs: [], replacement_process_refs: [] }];
  value.missing_evidence.push(...['historical_launch', 'final_owner_membership_ref'].map(field => ({
    field_path: `/coverage/resolutions/0/${field}`, reason_code: 'UNKNOWN', reason: 'Synthetic unknown' })));
  rejects(value, 'HISTORICAL_IDENTITY');
});
test('verified-with-null substitutions are stopped by the frozen shape boundary', () => {
  const process = partial(); process.processes[0].binding = 'VERIFIED'; expect(shape(process)).toBe(false);
  const registration = partial(); registration.registration_dispositions[0].disposition = 'VERIFIED_CURRENT';
  expect(shape(registration)).toBe(false);
});
test('provenance references a declared source component', () => {
  const value = repeated(); value.processes[0].identity_provenance.source_component = 'absent'; rejects(value, 'REFERENCE');
});
test('owner membership launch identity must agree with the envelope host', () => {
  const value = repeated(); value.coverage.membership_observations[0].members[0].host_id = 'different';
  rejects(value, 'IDENTITY_COMPONENT');
});
test('authoritative owner membership cannot contain two starts at one PID', () => {
  const value = repeated(), members = value.coverage.membership_observations[0].members;
  members.push({ ...members[0], start_microseconds: '2' }); rejects(value, 'FINAL_IDENTITY');
});
test('a process observation cannot disagree with its read attempt', () => {
  const value = repeated(); value.processes[0].launch.start_microseconds = '2';
  rejects(value, 'IDENTITY_COMPONENT');
});
test('partial attempt components must match their subject PID', () => {
  const value = partial(); value.coverage.attempts[1].kernel_identity_observation.pid = 900000002;
  rejects(value, 'IDENTITY_COMPONENT');
});
test('partial registration components must match the known owner UID', () => {
  const value = partial(); value.registration_dispositions[0].kernel_identity_observation.uid = 900000002;
  rejects(value, 'IDENTITY_COMPONENT');
});
