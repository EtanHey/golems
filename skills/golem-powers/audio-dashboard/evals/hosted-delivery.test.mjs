import { test, expect, afterAll } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { validateAudioDashboardEvidence } from '../src/audio-dashboard-evidence.mjs';
import { hostedEvidence } from './hosted-fixture.mjs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const root = mkdtempSync(path.join(tmpdir(), 'hosted-unit-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
function withDesignEvidence(evidence) {
  const outputPath = path.join(root, 'docs.local/dashboards/example.html');
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath.replace('.html', '.design.json'), JSON.stringify({ verdict: 'PASS', artifactSha256: sha(evidence.html) }));
  return { ...evidence, outputPath };
}
const sha = value => createHash('sha256').update(value).digest('hex');
const fixture = () => hostedEvidence(withDesignEvidence(JSON.parse(readFileSync(new URL('./fixtures/green/01-canonical-readalong.json', import.meta.url))).evidence));
for (const [name, change, code] of [
  ['tailnet only', e => { delete e.delivery; e.tailnetSync = true; }, 'MISSING_HOSTED_DELIVERY'],
  ['off allowlist', e => { e.delivery.url = 'https://other.example/?d=example'; }, 'UNAPPROVED_DELIVERY_ORIGIN'],
  ['id mismatch', e => { e.delivery.dashboardId = 'other'; }, 'DELIVERY_ID_MISMATCH'],
  ['sha mismatch', e => { e.delivery.sourceHtmlSha256 = 'c'.repeat(64); }, 'DELIVERY_SHA_MISMATCH'],
  ['missing account proof', e => { delete e.delivery.accountProof; }, 'MISSING_ACCOUNT_SYNC_PROOF'],
  ['malformed config', e => { e.approvedDeliveryOrigins = ['https://example.com/path']; }, 'MISSING_DELIVERY_CONFIG'],
  ['missing config', e => { delete e.approvedDeliveryOrigins; }, 'MISSING_DELIVERY_CONFIG'],
  ['different promoted candidate', e => { e.delivery.staging.servedShellSha256 = 'c'.repeat(64); }, 'DELIVERY_SHA_MISMATCH'],
]) test(`hosted delivery refuses ${name}`, () => {
  const evidence = fixture(); change(evidence);
  const result = validateAudioDashboardEvidence(evidence);
  expect(result.verdict).toBe('REJECTED');
  expect(result.violations.map(v => v.code)).toContain(code);
});
test('hosted delivery accepts a complete bound account receipt', () => {
  expect(validateAudioDashboardEvidence(fixture()).verdict).toBe('PASS');
});
for (const mode of ['unlisted-candiate', undefined, null, '', 42]) test(`hosted delivery refuses staging mode ${mode}`, () => {
  const e = fixture(); e.delivery.staging.mode = mode;
  const result = validateAudioDashboardEvidence(e);
  expect(result.verdict).toBe('REJECTED');
  expect(result.violations.map(v => v.code)).toContain('INVALID_STAGING_MODE');
});
test('hosted delivery refuses missing staging', () => {
  const e = fixture(); delete e.delivery.staging;
  expect(validateAudioDashboardEvidence(e).violations.map(v => v.code)).toContain('INVALID_STAGING_MODE');
});
const maintenance = () => {
  const e = fixture(); Object.assign(e.delivery.staging, { mode: 'in-place-maintenance', previousServedShellSha256: 'c'.repeat(64) }); return e;
};
for (const previousServedShellSha256 of [undefined, 'bad', 'c'.repeat(63), 'g'.repeat(64), 42]) test(`maintenance refuses rollback hash ${previousServedShellSha256}`, () => {
  const e = maintenance(); e.delivery.staging.previousServedShellSha256 = previousServedShellSha256;
  const result = validateAudioDashboardEvidence(e);
  expect(result.verdict).toBe('REJECTED');
  expect(result.violations.map(v => v.code)).not.toContain('INVALID_STAGING_MODE');
  expect(result.violations).toContainEqual({ code: 'MAINTENANCE_PREVIOUS_SHELL', evidence: expect.stringContaining('previousServedShellSha256') });
});
for (const [deliveryDesign, handoffDesign] of [
  ['FIRST_IN_LINEAGE', 'FIRST_IN_LINEAGE'], ['FIRST_IN_LINEAGE', 'COMPARED'], ['COMPARED', 'FIRST_IN_LINEAGE'], ['OTHER', 'COMPARED'], ['COMPARED', undefined],
]) test(`maintenance refuses design ${deliveryDesign}/${handoffDesign}`, () => {
  const e = maintenance(); e.delivery.admission.design = deliveryDesign; e.handoff.design.admission = handoffDesign;
  const result = validateAudioDashboardEvidence(e);
  expect(result.verdict).toBe('REJECTED');
  expect(result.violations.map(v => v.code)).not.toContain('INVALID_STAGING_MODE');
  expect(result.violations).toContainEqual({ code: 'MAINTENANCE_DESIGN', evidence: expect.stringContaining('COMPARED or REDESIGN_APPROVED') });
});
for (const design of ['COMPARED', 'REDESIGN_APPROVED']) test(`maintenance accepts ${design} with a rollback hash`, () => {
  const e = maintenance(); e.delivery.admission.design = design; e.handoff.design.admission = design;
  if (design === 'REDESIGN_APPROVED') Object.assign(e.handoff.design, redesign().handoff.design);
  expect(validateAudioDashboardEvidence(e).verdict).toBe('PASS');
});
for (const field of ['signedIn', 'independentClient', 'serverAck', 'markerSaved', 'restoredAfterLocalKeysCleared', 'cleanedUp', 'disposableRecord']) {
  test(`hosted delivery refuses accountProof.${field}=false`, () => {
    const evidence = fixture(); evidence.delivery.accountProof[field] = false;
    expect(validateAudioDashboardEvidence(evidence).violations.map(v => v.code)).toContain('MISSING_ACCOUNT_SYNC_PROOF');
  });
}

test('pre-publish checks cannot return delivery PASS', () => {
  const evidence = fixture(); delete evidence.delivery; evidence.stage = 'pre-publish';
  expect(validateAudioDashboardEvidence(evidence).verdict).toBe('READY_FOR_HOSTED_PUBLISH');
});

for (const field of ['servedShellSha256', 'artifactSha256']) for (const value of [undefined, 'bad']) test(`v2 refuses ${field}=${value}`, () => {
  const e = fixture(); e.delivery[field] = value; expect(validateAudioDashboardEvidence(e).violations.map(v => v.code)).toContain('DELIVERY_SHA_MISMATCH');
});
for (const field of ['mutationDelta', 'existingRowsPreserved']) for (const value of [undefined, -1, 0.5]) test(`v2 refuses ${field}=${value}`, () => {
  const e = fixture(); e.delivery.accountProof[field] = value; expect(validateAudioDashboardEvidence(e).violations.map(v => v.code)).toContain('MISSING_ACCOUNT_SYNC_PROOF');
});
for (const [field, value] of [['design', 'OTHER'], ['design', undefined], ['answerIdentity', 'REJECT'], ['answerIdentity', undefined], ['providerReady', false], ['providerReady', undefined], ['gateVersion', ''], ['gateVersion', undefined]]) test(`v2 refuses admission.${field}`, () => {
  const e = fixture(); e.delivery.admission[field] = value; expect(validateAudioDashboardEvidence(e).violations.map(v => v.code)).toContain('DELIVERY_ADMISSION_MISMATCH');
});
const backfill = () => { const e = fixture(); delete e.handoff; Object.assign(e.delivery, { backfilled: true, staging: { mode: 'none-backfill', servedShellSha256: e.delivery.servedShellSha256 } }); e.delivery.admission.design = 'UNKNOWN_BACKFILL'; return e; };
test('backfill proves account only, never PASS, without a handoff', () => { const e = backfill(); e.outputPath = '/missing/docs.local/dashboards/backfill.html'; expect(validateAudioDashboardEvidence(e).verdict).toBe('BACKFILL_ACCOUNT_PROVEN'); });
for (const [name, change] of [
  ['absent flag', e => { delete e.delivery.backfilled; }], ['false flag', e => { e.delivery.backfilled = false; }],
  ['staging claim', e => { e.delivery.staging.mode = 'unlisted-candidate'; }], ['design claim', e => { e.delivery.admission.design = 'COMPARED'; }],
]) test(`backfill refuses mixed ${name}`, () => { const e = backfill(); change(e); expect(validateAudioDashboardEvidence(e).violations.map(v => v.code)).toContain('BACKFILL_MARKERS_MISMATCH'); });

test('backfill still binds source bytes and full account proof', () => {
  const e = backfill(); e.delivery.sourceHtmlSha256 = '0'.repeat(64);
  expect(validateAudioDashboardEvidence(e).violations.map(v => v.code)).toContain('DELIVERY_SHA_MISMATCH');
  e.delivery.accountProof.serverAck = false;
  expect(validateAudioDashboardEvidence(e).verdict).toBe('REJECTED');
});
for (const marker of ['staging', 'design']) test(`a lone ${marker} backfill marker cannot claim ordinary admission`, () => {
  const e = fixture(); if (marker === 'staging') e.delivery.staging.mode = 'none-backfill'; else e.delivery.admission.design = 'UNKNOWN_BACKFILL';
  expect(validateAudioDashboardEvidence(e).violations.map(v => v.code)).toContain('BACKFILL_MARKERS_MISMATCH');
});

for (const value of [undefined, 'unknown']) test(`probe=${value} fails closed`, () => {
  const e = fixture(); e.delivery.accountProof.probe = value;
  expect(validateAudioDashboardEvidence(e).violations.map(v => v.code)).toContain('MISSING_ACCOUNT_SYNC_PROOF');
});
test('built and prepared hashes have separate custody', () => {
  const e = fixture(); expect(validateAudioDashboardEvidence(e).verdict).toBe('PASS');
  e.handoff.builtHtmlSha256 = e.delivery.sourceHtmlSha256;
  expect(validateAudioDashboardEvidence(e).violations.map(v => v.code)).toContain('DELIVERY_SHA_MISMATCH');
});
test('backfill cannot substitute the built file for missing prepared source', () => {
  const e = backfill(); delete e.sourceHtml;
  expect(validateAudioDashboardEvidence(e).violations.map(v => v.code)).toContain('MISSING_PREPARED_SOURCE');
});

test('the existing-empty-field probe is valid', () => { const e = fixture(); e.delivery.accountProof.probe = 'existing-empty-field'; expect(validateAudioDashboardEvidence(e).verdict).toBe('PASS'); });

test('deprecated runtime cannot return acceptance PASS', () => { const e = fixture(); e.delivery.admission.answerRuntime = 'deprecated'; expect(validateAudioDashboardEvidence(e).verdict).toBe('PASS_DEPRECATED_RUNTIME'); });
for (const answerRuntime of [undefined, 'other']) test(`invalid runtime admission ${answerRuntime}`, () => { const e = fixture(); e.delivery.admission.answerRuntime = answerRuntime; expect(validateAudioDashboardEvidence(e).violations.map(v => v.code)).toContain('DELIVERY_ADMISSION_MISMATCH'); });

const redesign = () => {
  const e = fixture();
  e.handoff.design.admission = e.delivery.admission.design = 'REDESIGN_APPROVED';
  Object.assign(e.handoff.design, { predecessorSha256: 'c'.repeat(64), redesign: { reason: 'Owner requested a redesign', from: 'c'.repeat(64), approvedBy: 'Design owner' } });
  return e;
};
for (const admission of ['COMPARED', 'REDESIGN_APPROVED']) {
  test(`handoff ${admission === 'REDESIGN_APPROVED' ? 'accepts' : 'refuses'} a bound, approved redesign under ${admission}`, () => {
    const e = redesign(); e.handoff.design.admission = e.delivery.admission.design = admission;
    const result = validateAudioDashboardEvidence(e);
    expect(result.verdict).toBe(admission === 'REDESIGN_APPROVED' ? 'PASS' : 'REJECTED');
    if (admission !== 'REDESIGN_APPROVED') expect(result.violations.map(v => v.code)).toContain('REDESIGN_UNAPPROVED');
  });
  for (const [name, change] of [
    ['wrong predecessor', d => { d.redesign.from = 'd'.repeat(64); }],
    ['missing from', d => { delete d.redesign.from; }],
    ...(admission === 'REDESIGN_APPROVED' ? [['missing redesign', d => { delete d.redesign; }]] : []),
    ...[undefined, null, '', ' ', 'Reason\nOther', 'Reason\rOther', 42, {}, []].map(reason =>
      [`reason ${JSON.stringify(reason)}`, d => { d.redesign.reason = reason; }]),
    ...[undefined, null, '', ' ', 'UNRECORDED', ' unrecorded ', 'Owner\nOther', 'Owner\rOther', 42].map(approvedBy =>
      [`approver ${JSON.stringify(approvedBy)}`, d => { d.redesign.approvedBy = approvedBy; }]),
    ...[undefined, null, false, {}].map(value => [`redesign ${JSON.stringify(value)}`, d => { d.redesign = value; }]),
  ]) test(`handoff refuses ${admission} redesign with ${name}`, () => {
    const e = redesign(); e.handoff.design.admission = e.delivery.admission.design = admission; change(e.handoff.design);
    const result = validateAudioDashboardEvidence(e);
    expect(result.verdict).toBe('REJECTED');
    expect(result.violations.map(v => v.code)).toContain('REDESIGN_UNAPPROVED');
  });
}
for (const admission of ['COMPARED', 'REDESIGN_APPROVED']) for (const firstInLineage of [null, false, {}, { reason: 'New lineage', approvedBy: 'Design owner' }]) {
  test(`handoff refuses misplaced firstInLineage ${JSON.stringify(firstInLineage)} under ${admission}`, () => {
    const e = admission === 'REDESIGN_APPROVED' ? redesign() : fixture(); e.handoff.design.admission = e.delivery.admission.design = admission;
    e.handoff.design.firstInLineage = firstInLineage;
    const result = validateAudioDashboardEvidence(e);
    expect(result.verdict).toBe('REJECTED');
    expect(result.violations.map(v => v.code)).toContain('HANDOFF_FIRST_LINEAGE_MISPLACED');
  });
}
const firstLineage = () => {
  const e = fixture(); e.handoff.design.admission = e.delivery.admission.design = 'FIRST_IN_LINEAGE';
  Object.assign(e.handoff.design, { predecessorSha256: null, firstInLineage: { reason: 'New lineage', approvedBy: 'Design owner' } });
  return e;
};
test('handoff accepts approved FIRST_IN_LINEAGE', () => {
  expect(validateAudioDashboardEvidence(firstLineage()).verdict).toBe('PASS');
});
for (const [name, change] of [
  ['missing approval', d => { delete d.firstInLineage; }],
  ['null approval', d => { d.firstInLineage = null; }],
  ...[undefined, '', ' ', 'New\nlineage', 'New\rlineage', 42].map(reason =>
    [`reason ${JSON.stringify(reason)}`, d => { d.firstInLineage.reason = reason; }]),
  ...[undefined, '', ' ', 'UNRECORDED', ' unrecorded ', 'Owner\nOther', 'Owner\rOther', 42].map(approvedBy =>
    [`approver ${JSON.stringify(approvedBy)}`, d => { d.firstInLineage.approvedBy = approvedBy; }]),
]) test(`handoff refuses FIRST_IN_LINEAGE with ${name}`, () => {
  const e = firstLineage(); change(e.handoff.design);
  const result = validateAudioDashboardEvidence(e);
  expect(result.verdict).toBe('REJECTED');
  expect(result.violations.map(v => v.code)).toContain('FIRST_IN_LINEAGE_UNAPPROVED');
});

for (const admission of ['COMPARED', 'FIRST_IN_LINEAGE', 'OTHER', undefined]) for (const value of [undefined, null, false, {}, { reason: 'Owner requested a redesign', from: 'c'.repeat(64), approvedBy: 'Design owner' }]) {
  test(`handoff refuses present redesign ${JSON.stringify(value)} outside REDESIGN_APPROVED (${admission})`, () => {
    const e = admission === 'FIRST_IN_LINEAGE' ? firstLineage() : fixture();
    e.handoff.design.admission = e.delivery.admission.design = admission;
    e.handoff.design.redesign = value;
    const result = validateAudioDashboardEvidence(e);
    expect(result.verdict).toBe('REJECTED');
    expect(result.violations.map(v => v.code)).toContain('REDESIGN_UNAPPROVED');
  });
}
test('handoff accepts a nonblank one-line redesign reason with surrounding spaces', () => {
  const e = redesign(); e.handoff.design.redesign.reason = '  Owner requested a redesign  ';
  expect(validateAudioDashboardEvidence(e).verdict).toBe('PASS');
});
