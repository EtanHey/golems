import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { parse } from 'parse5';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { loadPublishedDesign, designReportPath } from './design-history.mjs';
import { buildReceiptsPath } from './build-receipts.mjs';
import { analyzeAnswerPersistence } from './answer-persistence.mjs';
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const handoffPath = output => output.replace(/\.html$/i, '') + '.publish-handoff.json';
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const httpsUrl = value => { try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password ? u : null; } catch { return null; } };
export function deliveryOrigins(env = process.env) {
  try {
    return env.AUDIO_DASHBOARD_DELIVERY_ORIGINS !== undefined ? JSON.parse(env.AUDIO_DASHBOARD_DELIVERY_ORIGINS)
      : JSON.parse(readFileSync(path.join(env.HOME || os.homedir(), '.config/golems/audio-dashboard.json'), 'utf8')).approvedDeliveryOrigins;
  } catch { return null; }
}
export function hostedDeliveryViolations({ delivery: d, handoff: h, html, dashboardId, approvedDeliveryOrigins: origins }) {
  const violations = [], fail = (code, evidence) => violations.push({ code, evidence });
  if (!Array.isArray(origins) || !origins.length || !origins.every(o => httpsUrl(o)?.origin === o))
    fail('MISSING_DELIVERY_CONFIG', 'Configure approvedDeliveryOrigins locally; no default delivery origin is trusted.');
  if (!d) { fail('MISSING_HOSTED_DELIVERY', 'tailnet is media fallback only; publish via the NarrationLayer Lakebed handoff'); return violations; }
  if (d.schema !== 'audio-dashboard.delivery.v2' || d.host !== 'lakebed')
    fail('INVALID_DELIVERY_RECEIPT', 'Expected audio-dashboard.delivery.v2 from the Lakebed publisher.');
  const url = httpsUrl(d.url);
  if (!url || !Array.isArray(origins) || !origins.includes(url.origin)) fail('UNAPPROVED_DELIVERY_ORIGIN', 'Delivery URL must use an approved HTTPS origin.');
  const backfilled = d.backfilled === true;
  if (backfilled ? d.staging?.mode !== 'none-backfill' || d.admission?.design !== 'UNKNOWN_BACKFILL'
    : d.staging?.mode === 'none-backfill' || d.admission?.design === 'UNKNOWN_BACKFILL') fail('BACKFILL_MARKERS_MISMATCH', 'Backfill flag, none-backfill staging and UNKNOWN_BACKFILL must occur together.');
  if (!backfilled && (!h || h.schema !== 'audio-dashboard.publish-handoff.v2')) fail('MISSING_PUBLISH_HANDOFF', 'Delivery requires the original publish handoff.');
  if (!dashboardId || d.dashboardId !== dashboardId || (h && h.dashboardId !== dashboardId) || url?.searchParams.get('d') !== dashboardId)
    fail('DELIVERY_ID_MISMATCH', 'Receipt, handoff, route and spec.id must identify the same dashboard.');
  if (d.sourceHtmlSha256 !== sha256(html) || (h && h.sourceHtmlSha256 !== sha256(html)) || !hash(d.servedShellSha256) || !hash(d.artifactSha256) ||
      d.staging?.servedShellSha256 !== d.servedShellSha256)
    fail('DELIVERY_SHA_MISMATCH', 'Built HTML must match both source hashes; staging and promotion must bind the same artifact.');
  const p = d.accountProof;
  if (!p || p.method !== 'note-roundtrip' || !['mutationDelta', 'existingRowsPreserved'].every(k => Number.isInteger(p[k]) && p[k] >= 0) ||
      !['signedIn', 'independentClient', 'serverAck', 'markerSaved', 'restoredAfterLocalKeysCleared', 'cleanedUp', 'disposableRecord'].every(k => p[k] === true))
    fail('MISSING_ACCOUNT_SYNC_PROOF', 'Require a signed-in disposable note save, restore after local pending keys are cleared, and cleanup.');
  const a = d.admission;
  if (!a || (backfilled ? a.design !== 'UNKNOWN_BACKFILL' : !['COMPARED', 'REDESIGN_APPROVED', 'FIRST_IN_LINEAGE'].includes(a.design) || a.design !== h?.design?.admission) ||
      a.answerIdentity !== 'PASS' || a.providerReady !== true || typeof a.gateVersion !== 'string' || !a.gateVersion.trim())
    fail('DELIVERY_ADMISSION_MISMATCH', 'Require the design echo, PASS answer identity, ready provider and a nonempty gate version.');
  return violations;
}
export function writePublishHandoff({ spec, specPath, outputPath, jobDir, html, firstBuild }) {
  if (typeof spec.id !== 'string' || !spec.id.trim() || !['decision-flow', 'cinema'].includes(spec.type) || !spec.scenes?.length) throw Error('PUBLISH_HANDOFF_ID_TYPE_REQUIRED');
  const baseline = spec.acceptedBaseline;
  if (!baseline?.path || !hash(baseline.sha256) || sha256(readFileSync(path.resolve(path.dirname(specPath), baseline.path))) !== baseline.sha256)
    throw Error('ACCEPTED_BASELINE_RECEIPT_REQUIRED');
  if (sha256(readFileSync(outputPath)) !== sha256(html)) throw Error('PUBLISH_HANDOFF_SOURCE_CHANGED');
  const receiptsBytes = readFileSync(buildReceiptsPath(outputPath)), receipts = JSON.parse(receiptsBytes);
  const report = JSON.parse(readFileSync(designReportPath(outputPath), 'utf8'));
  if (receipts.artifactSha256 !== sha256(html) || !receipts.gates?.length || receipts.gates.some(g => g.stage === 'BUILD' && g.verdict !== 'PASS') ||
      !receipts.gates.some(g => g.stage === 'BUILD' && g.gate === 'answer-persistence' && g.verdict === 'PASS') ||
      analyzeAnswerPersistence(html, spec.id).verdict !== 'PASS') throw Error('PUBLISH_HANDOFF_BUILD_REJECTED');
  if (report.verdict !== 'PASS' || report.artifactSha256 !== sha256(html) || !['BASELINE', 'COMPARED', 'REDESIGN'].includes(report.status))
    throw Error('PUBLISH_HANDOFF_DESIGN_REJECTED');
  const previous = loadPublishedDesign(spec, outputPath, { firstBuild });
  if ((report.status === 'BASELINE') !== (previous.previousHtml === null)) throw Error('PUBLISH_HANDOFF_DESIGN_CHANGED');
  const design = { admission: { BASELINE: 'FIRST_IN_LINEAGE', COMPARED: 'COMPARED', REDESIGN: 'REDESIGN_APPROVED' }[report.status],
    lineage: previous.series, predecessorSha256: previous.previousHtml === null ? null : sha256(previous.previousHtml) };
  if (report.redesign) design.redesign = { reason: report.redesign.reason, approvedBy: spec.redesign?.approvedBy || 'UNRECORDED', from: report.redesign.from };
  const sourcePath = path.basename(outputPath).replace(/\.html$/i, '') + '.publish-source', sourceDir = path.join(path.dirname(outputPath), sourcePath);
  mkdirSync(path.join(sourceDir, 'assets'), { recursive: true }); writeFileSync(path.join(sourceDir, 'index.html'), html);
  const media = spec.scenes.map(s => {
    const file = path.join(jobDir, 'segments', s.id, `${s.id}.mp3`), bytes = readFileSync(file);
    if (!bytes.length) throw Error('PUBLISH_HANDOFF_EMPTY_MEDIA');
    const relative = `assets/${s.id}.mp3`; writeFileSync(path.join(sourceDir, relative), bytes);
    return { file: relative, size: bytes.length, sha256: sha256(bytes) };
  });
  const handoff = { schema: 'audio-dashboard.publish-handoff.v2', dashboardId: spec.id, type: spec.type || 'cinema',
    sourcePath, answerKeys: persistedAnswerKeys(html), sourceHtmlSha256: sha256(html), buildReceiptsSha256: sha256(receiptsBytes), answerPersistence: 'PASS', design,
    jobPath: path.relative(path.dirname(outputPath), specPath), mediaManifest: media, createdAt: new Date().toISOString() };
  for (const [file, value] of [[handoffPath(outputPath), handoff]]) {
    const temporary = `${file}.new-${process.pid}`; writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n'); renameSync(temporary, file);
  }
  return handoff;
}

export function persistedAnswerKeys(html) {
  const rows = new Map(), nodes = [], attr = (n, k) => n.attrs?.find(a => a.name === k)?.value;
  const cls = (n, k) => (attr(n, 'class') || '').split(/\s+/).includes(k);
  const walk = n => { nodes.push(n); for (const c of n.childNodes || []) walk(c); }; walk(parse(html));
  const ancestor = (n, predicate) => { for (; n; n = n.parentNode) if (predicate(n)) return n; };
  const add = (key, kind, option) => {
    if (!key) throw Error('PERSISTED_ANSWER_KEY_REQUIRED');
    const row = rows.get(key) || { key, kind, ...(kind === 'text' ? {} : { options: [] }) };
    if (row.kind !== kind) throw Error('PERSISTED_ANSWER_KIND_CONFLICT');
    if (option !== undefined && !row.options.includes(option)) row.options.push(option); rows.set(key, row);
  };
  const cinemaNotes = nodes.some(n => attr(n, 'data-answer-consumer') === 'notes');
  for (const n of nodes) {
    const card = ancestor(n, p => cls(p, 'df-card') || cls(p, 'dbx-card'));
    if (n.tagName === 'textarea' && cls(n, 'note-area')) {
      const key = attr(n, 'data-note'); if (!key) throw Error('PERSISTED_ANSWER_KEY_REQUIRED');
      if (cls(n, 'df-free') || cls(n, 'dbx-free')) add(key, 'text');
      if (cinemaNotes) add('_notes:' + key, 'text');
    }
    if (n.tagName === 'input' && attr(n, 'type') === 'radio' && card) add(attr(n, 'name'), 'radio', attr(n, 'value') || 'on');
    if (n.tagName === 'input' && cls(n, 'df-check-input') && card) add(attr(card, 'data-decision') + '-checks', 'checkbox', attr(n, 'data-check-index'));
    if (cls(n, 'df-card-note') && card) add(attr(card, 'data-decision') + '-notes', 'text');
  }
  return [...rows.values()];
}
