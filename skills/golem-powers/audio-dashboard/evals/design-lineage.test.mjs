import { test, expect } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadPublishedDesign, recordPublishedDesign, designHash } from '../src/design-history.mjs';
import { checkPublishedDesign, checkDesignPreservation } from '../src/design-preservation.mjs';
import { hostedEvidence } from './hosted-fixture.mjs';
import { designTestCell } from './design-test-cell.mjs';
const cell = designTestCell(), options = cell.options;
const html = readFileSync(new URL('./fixtures/design-preservation/previous.html', import.meta.url), 'utf8');
const output = path.join(cell.root, 'page.html');
const accept = spec => recordPublishedDesign(spec, output, html, { ...options, acceptedBy: 'fixture-owner' });
test('new series cannot first-build past the accepted default briefing lineage', async () => {
  accept({ series: 'eod' });
  expect(loadPublishedDesign({ series: 'commute' }, output, options).previousHtml).toBe(html);
  const result = await checkPublishedDesign({ series: 'commute' }, output, html, { ...options, firstBuild: 'New series' });
  expect(result.violations.map(v => v.code)).toContain('DESIGN_LINEAGE_RESET_REFUSED');
});
test('explicit new lineage permits FIRST_IN_LINEAGE and does not change the default', async () => {
  const spec = { design: { lineage: 'new-product', firstInLineage: { reason: 'Approved isolated fixture lineage', approvedBy: 'fixture-owner' } }, series: 'one' };
  const prior = loadPublishedDesign(spec, output, { ...options, firstBuild: 'Initial product' });
  expect(prior.lineage).toBe('new-product'); expect(prior.previousHtml).toBeNull();
  expect(() => loadPublishedDesign({ design: { lineage: '../escape' } }, output, options)).toThrow();
});
test('acceptance requires a delivery or an explicit approver', () => {
  expect(() => recordPublishedDesign({ design: { lineage: 'unaccepted' } }, output, html, options)).toThrow('DESIGN_ACCEPTANCE_REQUIRED');
});
test('lineage-loss migration needs the accepted served copy and cannot first-build over it', () => {
  const dir = path.join(cell.root, 'migration'); mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'served.html'), html);
  const spec = { design: { lineage: 'migrated' }, designPreservation: { previousPublished: 'served.html' } };
  expect(loadPublishedDesign(spec, path.join(dir, 'next.html'), options).previousHtml).toBe(html);
  expect(() => loadPublishedDesign(spec, path.join(dir, 'next.html'), { ...options, firstBuild: 'reset' })).toThrow('DESIGN_LINEAGE_RESET_REFUSED');
  expect(() => loadPublishedDesign({ design: { lineage: 'lost' } }, output, options)).toThrow('previous build missing');
});
test('missing or UNRECORDED redesign approver rejects before browser work', async () => {
  for (const approvedBy of [undefined, '', 'UNRECORDED']) {
    const result = await checkDesignPreservation({ html, previousHtml: html, redesign: { reason: 'Ruling', from: designHash(html), invariants: ['LAYOUT'], approvedBy } });
    expect(result.verdict).toBe('REJECTED'); expect(result.violations[0].code).toBe('REDESIGN_SCOPE_MISMATCH');
  }
});
test('conflicting prepare/delivery flags reject before reading a spec or writing sidecars', () => {
  const result = Bun.spawnSync(cell.command(new URL('../scripts/validate-evidence.mjs', import.meta.url).pathname,
    ['--spec', path.join(cell.root, 'absent.json'), '--prepare-publish', '--delivery', 'absent.json']));
  expect(result.stderr.toString()).toContain('--prepare-publish and --delivery are mutually exclusive');
  expect(result.stderr.toString()).not.toContain('spec not found');
});

test('only a current, validated delivery advances acceptance; stale receipts cannot roll it back', () => {
  const spec = { id: 'example', design: { lineage: 'receipt-product', firstInLineage: { reason: 'Approved isolated fixture lineage', approvedBy: 'fixture-owner' } } }, e = hostedEvidence({ html });
  Object.assign(e.handoff.design, { admission: 'FIRST_IN_LINEAGE', lineage: 'receipt-product', predecessorSha256: null, firstInLineage: spec.design.firstInLineage });
  e.delivery.admission.design = 'FIRST_IN_LINEAGE';
  const record = () => recordPublishedDesign(spec, output, html, { ...e, ...options });
  for (const mutation of [x => { x.delivery.accountProof.serverAck = false; }, x => { x.delivery.admission.answerRuntime = 'deprecated'; }, x => { x.delivery.backfilled = true; }]) {
    const invalid = structuredClone(e); mutation(invalid);
    expect(() => recordPublishedDesign(spec, output, html, { ...invalid, ...options })).toThrow('DESIGN_ACCEPTANCE_REQUIRED');
  }
  const changedApproval = structuredClone(e); changedApproval.handoff.design.firstInLineage.approvedBy = 'other-owner';
  expect(() => recordPublishedDesign(spec, output, html, { ...changedApproval, ...options })).toThrow('DESIGN_NEW_LINEAGE_APPROVAL_MISMATCH');
  const missingApproval = structuredClone(e); delete missingApproval.handoff.design.firstInLineage;
  expect(() => recordPublishedDesign(spec, output, html, { ...missingApproval, ...options })).toThrow('DESIGN_ACCEPTANCE_REQUIRED');
  expect(() => recordPublishedDesign(spec, output, html, { ...missingApproval, ...options, acceptedBy: 'fixture-owner' })).toThrow('FIRST_IN_LINEAGE_UNAPPROVED');
  expect(() => loadPublishedDesign(spec, output, options)).toThrow('previous build missing');
  record(); record();
  expect(loadPublishedDesign({ ...spec, series: 'new-series' }, output, options).previousHtml).toBe(html);
  const next = html.replace('Host', 'Presenter');
  recordPublishedDesign(spec, output, next, { ...options, acceptedBy: 'fixture-owner' });
  expect(record).toThrow('DESIGN_PREDECESSOR_CHANGED');
  expect(loadPublishedDesign(spec, output, options).previousHtml).toBe(next);
});
test('real comparison reports FIRST_IN_LINEAGE, COMPARED and an approved scoped redesign', async () => {
  const { chromium } = await import('playwright'), browser = await chromium.launch();
  const spec = { design: { lineage: 'admissions', firstInLineage: { reason: 'Approved isolated fixture lineage', approvedBy: 'fixture-owner' } }, series: 'eod' };
  try {
    const first = await checkPublishedDesign(spec, output, html, { ...options, browser, firstBuild: 'Initial product' });
    expect([first.verdict, first.admission, first.lineage, first.predecessorSha256]).toEqual(['PASS', 'FIRST_IN_LINEAGE', 'admissions', null]);
    accept(spec);
    const compared = await checkPublishedDesign({ ...spec, series: 'commute' }, output, html, { ...options, browser });
    expect([compared.verdict, compared.admission, compared.predecessorSha256]).toEqual(['PASS', 'COMPARED', designHash(html)]);
    const redesign = { reason: 'Owner requested wider reading column', approvedBy: 'fixture-owner', from: designHash(html), invariants: ['LAYOUT'] };
    const changed = html.replace('max-width:920px', 'max-width:1100px');
    const result = await checkPublishedDesign({ ...spec, redesign }, output, changed, { ...options, browser });
    expect([result.verdict, result.admission, result.redesign.approvedBy]).toEqual(['PASS', 'REDESIGN_APPROVED', 'fixture-owner']);
  } finally { await browser.close(); }
}, 15000);

test('explicit accept CLI records a predecessor, then refuses a new-series reset', () => {
  const outputPath = path.join(cell.root, 'accepted.html'), specPath = path.join(cell.root, 'accept-job.json');
  const spec = { outputPath, design: { lineage: 'explicit-accept', firstInLineage: { reason: 'Approved isolated fixture lineage', approvedBy: 'fixture-owner' } }, series: 'eod' };
  writeFileSync(outputPath, html); writeFileSync(specPath, JSON.stringify(spec));
  const run = flags => Bun.spawnSync(cell.command(new URL('../scripts/check-design-preservation.mjs', import.meta.url).pathname, ['--spec', specPath, ...flags]));
  writeFileSync(specPath, JSON.stringify({ ...spec, design: { lineage: spec.design.lineage } }));
  const unapproved = run(['--first-build', 'Unapproved product', '--accept', 'fixture-owner']);
  expect(unapproved.exitCode).toBe(3); expect(unapproved.stdout.toString()).toContain('FIRST_IN_LINEAGE_UNAPPROVED');
  writeFileSync(specPath, JSON.stringify(spec));
  expect(run(['--first-build', 'Owner accepted initial product', '--accept', 'fixture-owner']).exitCode).toBe(0);
  expect(loadPublishedDesign(spec, outputPath, options).previousHtml).toBe(html);
  writeFileSync(specPath, JSON.stringify({ ...spec, series: 'commute' }));
  expect(run(['--first-build', 'New series']).stdout.toString()).toContain('DESIGN_LINEAGE_RESET_REFUSED');
}, 10000);

test('legacy series registry cannot masquerade as a fresh briefing lineage', () => {
  const registryRoot = path.join(cell.root, 'legacy-registry'), legacy = path.join(registryRoot, 'old-eod');
  mkdirSync(legacy, { recursive: true }); writeFileSync(path.join(legacy, 'published.json'), '{}');
  expect(() => loadPublishedDesign({ series: 'commute' }, output, { registryRoot, firstBuild: 'New series' })).toThrow('previous build missing');
  const served = path.join(cell.root, 'legacy-served.html'); writeFileSync(served, html);
  expect(loadPublishedDesign({ designPreservation: { previousPublished: served } }, output, { registryRoot }).previousHtml).toBe(html);
  expect(loadPublishedDesign({ design: { lineage: 'separate-product', firstInLineage: { reason: 'Approved isolated fixture lineage', approvedBy: 'fixture-owner' } } }, output, { registryRoot, firstBuild: 'New product' }).previousHtml).toBeNull();
});

for (const lineage of [undefined, 'commute-v2']) for (const [name, approval] of [
  ['missing', undefined], ['unrecorded', { reason: 'Separate product', approvedBy: 'UNRECORDED' }],
  ['blank reason', { reason: ' ', approvedBy: 'fixture-owner' }],
]) test(`new lineage approval required: ${lineage || 'briefings'} / ${name}`, () => {
  const spec = { design: { ...(lineage ? { lineage } : {}), firstInLineage: approval } };
  const registryRoot = path.join(cell.root, 'approval-' + (lineage || 'briefings') + '-' + name.replaceAll(' ', '-'));
  expect(() => loadPublishedDesign(spec, output, { registryRoot, firstBuild: 'Invented name' })).toThrow('FIRST_IN_LINEAGE_UNAPPROVED');
});
test('valid job approval is carried from a newly declared lineage', () => {
  const firstInLineage = { reason: 'Approved separate product', approvedBy: 'fixture-owner' };
  const prior = loadPublishedDesign({ design: { lineage: 'approved-product', firstInLineage } }, output, { ...options, firstBuild: 'Initial build' });
  expect(prior.previousHtml).toBeNull(); expect(prior.firstInLineage).toEqual(firstInLineage);
});

test('accepted lineage head refuses a conflicting supplied predecessor by name', () => {
  const spec = { design: { lineage: 'accepted-conflict' } }, supplied = path.join(cell.root, 'conflicting.html');
  accept(spec); writeFileSync(supplied, html + '<!-- other page -->');
  expect(loadPublishedDesign(spec, output, options).previousPath).toContain('/lineages/accepted-conflict/');
  expect(() => loadPublishedDesign({ ...spec, designPreservation: { previousPublished: supplied } }, output, options)).toThrow('DESIGN_PREDECESSOR_CONFLICT');
});
test('validated identical receipt replay stays idempotent after a served-copy migration', () => {
  const served = path.join(cell.root, 'migration-predecessor.html'); writeFileSync(served, html);
  const spec = { id: 'example', design: { lineage: 'migration-replay' }, designPreservation: { previousPublished: served } };
  const candidate = html + '<!-- delivered update -->', evidence = hostedEvidence({ html: candidate });
  Object.assign(evidence.handoff.design, { lineage: 'migration-replay', predecessorSha256: designHash(html) });
  const record = () => recordPublishedDesign(spec, output, candidate, { ...options, ...evidence });
  record(); expect(record).not.toThrow();
  expect(() => loadPublishedDesign(spec, output, options)).toThrow('DESIGN_PREDECESSOR_CONFLICT');
  expect(loadPublishedDesign({ design: spec.design }, output, options).previousHtml).toBe(candidate);
});
