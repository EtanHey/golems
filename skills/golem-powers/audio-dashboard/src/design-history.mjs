import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hostedDeliveryViolations } from './hosted-delivery.mjs';
export const designHash = value => createHash('sha256').update(value).digest('hex');
export const designReportPath = output => output.replace(/\.html$/i, '') + '.design.json';
const defaultRegistryRoot = path.join(os.homedir(), '.local', 'share', 'audio-dashboard', 'design-history');
function location(spec, { registryRoot = defaultRegistryRoot } = {}) {
  const lineage = spec.design?.lineage ?? 'briefings';
  if (typeof lineage !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(lineage)) throw new Error('DESIGN_LINEAGE_INVALID');
  const directory = path.resolve(registryRoot, 'lineages', lineage);
  return { lineage, registryRoot, directory, index: path.join(directory, 'accepted.json') };
}
export const validApprover = value => typeof value === 'string' && !!value.trim() && !/[\r\n]/.test(value) && value.trim().toUpperCase() !== 'UNRECORDED';
export function firstInLineageApproval(value) {
  if (!value || typeof value.reason !== 'string' || !value.reason.trim() || /[\r\n]/.test(value.reason) || !validApprover(value.approvedBy))
    throw Object.assign(new Error('FIRST_IN_LINEAGE_UNAPPROVED'), { code: 'FIRST_IN_LINEAGE_UNAPPROVED' });
  return { reason: value.reason, approvedBy: value.approvedBy };
}
export function recordPublishedDesign(spec, outputPath, html, options = {}) {
  const { lineage, directory, index } = location(spec, options), sha256 = designHash(html), filename = `${sha256}.html`;
  const approver = options.acceptedBy;
  if (!validApprover(approver)) {
    if (!options.delivery || options.delivery.backfilled || options.delivery.admission?.answerRuntime !== 'current' ||
        hostedDeliveryViolations({ ...options, html, dashboardId: spec.id }).length) throw new Error('DESIGN_ACCEPTANCE_REQUIRED');
  }
  const expected = options.handoff?.design || options.design;
  if (expected) {
    if (!['FIRST_IN_LINEAGE', 'COMPARED', 'REDESIGN_APPROVED'].includes(expected.admission) ||
        (expected.admission === 'FIRST_IN_LINEAGE' ? expected.predecessorSha256 !== null : !/^[a-f0-9]{64}$/.test(expected.predecessorSha256)) ||
        (expected.admission === 'REDESIGN_APPROVED' && (!validApprover(expected.redesign?.approvedBy) || expected.redesign.from !== expected.predecessorSha256))) throw new Error('DESIGN_ADMISSION_INVALID');
    if (expected.admission === 'FIRST_IN_LINEAGE' && JSON.stringify(firstInLineageApproval(expected.firstInLineage)) !== JSON.stringify(firstInLineageApproval(spec.design?.firstInLineage))) throw new Error('DESIGN_NEW_LINEAGE_APPROVAL_MISMATCH');
    if (expected.lineage !== lineage) throw new Error('DESIGN_LINEAGE_MISMATCH');
    // Replaying the same delivery is idempotent; a different delivery cannot replace a newer head.
    const receiptSha256 = options.delivery && designHash(JSON.stringify(options.delivery));
    const existing = existsSync(index) && JSON.parse(readFileSync(index, 'utf8'));
    const repeated = receiptSha256 && existing?.sha256 === sha256 && existing.deliverySha256 === receiptSha256;
    const comparisonSpec = repeated ? { ...spec, designPreservation: undefined } : spec;
    const current = loadPublishedDesign(comparisonSpec, outputPath, { ...options, firstBuild: existsSync(index) || spec.designPreservation?.previousPublished !== undefined ? undefined : 'Delivered initial lineage' });
    if (!repeated &&
        (expected.predecessorSha256 !== (current.previousHtml === null ? null : designHash(current.previousHtml)))) throw new Error('DESIGN_PREDECESSOR_CHANGED');
  }

  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, filename), html);
  writeFileSync(`${index}.new-${process.pid}`, JSON.stringify({ lineage, series: spec.series, filename, sha256, ...(options.delivery ? { deliverySha256: designHash(JSON.stringify(options.delivery)) } : { acceptedBy: approver }) }));
  renameSync(`${index}.new-${process.pid}`, index);
}
export function loadPublishedDesign(spec, outputPath, options = {}) {
  const { lineage, registryRoot, directory, index } = location(spec, options);
  const refuseReset = () => { if (options.firstBuild !== undefined) throw Object.assign(new Error('DESIGN_LINEAGE_RESET_REFUSED'), { code: 'DESIGN_LINEAGE_RESET_REFUSED' }); };
  try {
    if (existsSync(index)) {
      const record = JSON.parse(readFileSync(index, 'utf8'));
      if (record.lineage !== lineage || !/^[a-f0-9]{64}\.html$/.test(record.filename)) throw Error();
      const previousPath = path.join(directory, record.filename), previousHtml = readFileSync(previousPath, 'utf8');
      if (designHash(previousHtml) !== record.sha256) throw Error();
      refuseReset();
      const supplied = spec.designPreservation?.previousPublished;
      if (supplied !== undefined) {
        let matches = false;
        try { matches = typeof supplied === 'string' && !!supplied.trim() && designHash(readFileSync(path.resolve(path.dirname(outputPath), supplied))) === record.sha256; } catch {}
        if (!matches) throw Object.assign(new Error('DESIGN_PREDECESSOR_CONFLICT'), { code: 'DESIGN_PREDECESSOR_CONFLICT' });
      }
      return { lineage, series: spec.series, previousHtml, previousPath };
    }
    if (existsSync(directory)) throw Error();
    const previous = spec.designPreservation?.previousPublished;
    if (previous !== undefined) {
      if (typeof previous !== 'string' || !previous.trim()) throw Error();
      const previousPath = path.resolve(path.dirname(outputPath), previous), previousHtml = readFileSync(previousPath, 'utf8');
      if (!previousHtml.trim()) throw Error();
      refuseReset();
      return { lineage, series: spec.series, previousHtml, previousPath };
    }
    // Old series history is acceptance evidence requiring migration, never a fresh briefing lineage.
    if (lineage === 'briefings' && existsSync(registryRoot) && readdirSync(registryRoot).some(name => existsSync(path.join(registryRoot, name, 'published.json')))) throw Error();
    const reason = options.firstBuild;
    if (typeof reason !== 'string' || !reason.trim() || /[\r\n]/.test(reason)) throw Error();
    return { lineage, series: spec.series, previousHtml: null, baseline: { reason }, firstInLineage: firstInLineageApproval(spec.design?.firstInLineage) };
  } catch (error) { if (['DESIGN_LINEAGE_RESET_REFUSED', 'FIRST_IN_LINEAGE_UNAPPROVED', 'DESIGN_PREDECESSOR_CONFLICT'].includes(error.code)) throw error; throw new Error('previous build missing: migrate the served predecessor with previousPublished; approved initial publication alone may use --first-build'); }
}
export function writeDesignReport(outputPath, html, result) {
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(designReportPath(outputPath), JSON.stringify({ artifactSha256: designHash(html), ...result }, null, 2) + '\n');
}
export function designReportFailure(outputPath, html) {
  let report;
  try { report = JSON.parse(readFileSync(designReportPath(outputPath), 'utf8')); }
  catch { return 'DESIGN_PRESERVATION_MISSING'; }
  return report.verdict === 'PASS' && report.artifactSha256 === designHash(html) ? null : 'DESIGN_PRESERVATION_REJECTED';
}
