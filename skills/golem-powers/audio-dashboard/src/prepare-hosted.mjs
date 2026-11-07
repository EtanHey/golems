import { readFileSync, writeFileSync, renameSync, mkdirSync, copyFileSync, existsSync, cpSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { parse } from 'parse5';
import path from 'node:path';
import { sha256, handoffPath } from './hosted-delivery.mjs';
import { loadPublishedDesign, designReportPath, validApprover } from './design-history.mjs';
import { buildReceiptsPath } from './build-receipts.mjs';
import { analyzeAnswerPersistence, extractAnswerRuntime } from './answer-persistence.mjs';
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function writePublishHandoff({ spec, specPath, outputPath, segmentsDir, html, firstBuild }) {
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
  if (report.lineage !== previous.lineage || report.predecessorSha256 !== (previous.previousHtml === null ? null : sha256(previous.previousHtml)) || (report.status === 'BASELINE') !== (previous.previousHtml === null)) throw Error('PUBLISH_HANDOFF_DESIGN_CHANGED');
  const design = { admission: { BASELINE: 'FIRST_IN_LINEAGE', COMPARED: 'COMPARED', REDESIGN: 'REDESIGN_APPROVED' }[report.status],
    lineage: previous.lineage, predecessorSha256: previous.previousHtml === null ? null : sha256(previous.previousHtml) };
  if (report.status === 'REDESIGN') {
    if (!validApprover(report.redesign?.approvedBy) || report.redesign.from !== design.predecessorSha256 || JSON.stringify(report.redesign) !== JSON.stringify(spec.redesign)) throw Error('PUBLISH_HANDOFF_REDESIGN_APPROVAL_REQUIRED');
    design.redesign = { reason: report.redesign.reason, approvedBy: report.redesign.approvedBy, from: report.redesign.from };
  }
  const { sourcePath, sourceHtmlSha256, media } = prepareHostedInput({ spec, html, segmentsDir, outputPath });
  const handoff = { schema: 'audio-dashboard.publish-handoff.v2', dashboardId: spec.id, type: spec.type || 'cinema',
    sourcePath, builtHtmlSha256: sha256(html), answerRuntimeSha256: sha256(extractAnswerRuntime(html)), answerKeys: persistedAnswerKeys(html), sourceHtmlSha256, buildReceiptsSha256: sha256(receiptsBytes), answerPersistence: 'PASS', design,
    jobPath: path.relative(path.dirname(outputPath), specPath), mediaManifest: media.map(({ file, size, sha256 }) => ({ file, size, sha256 })), createdAt: new Date().toISOString() };
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

export function prepareHostedInput({ spec, html, segmentsDir, outputPath }) {
  if (!segmentsDir) throw Error('SEGMENTS_DIR_REQUIRED');
  let prepared = html;
  const sourcePath = path.basename(outputPath).replace(/\.html$/i, '') + '.publish-source/' + sha256(html), sourceDir = path.join(path.dirname(outputPath), sourcePath);
  mkdirSync(path.join(sourceDir, 'assets'), { recursive: true });
  const media = spec.scenes.map(scene => {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(scene.id)) throw Error('PREPARE_SCENE_ID_INVALID');
    const dir = path.join(segmentsDir, scene.id), mp3 = path.join(dir, `${scene.id}.mp3`), bytes = readFileSync(mp3);
    const uri = 'data:audio/mpeg;base64,' + bytes.toString('base64'), file = `assets/${scene.id}.mp3`;
    if (!bytes.length || !prepared.includes(uri)) throw Error('PREPARE_EMBEDDED_CLIP_MISSING: ' + scene.id);
    prepared = prepared.replaceAll(uri, file); writeFileSync(path.join(sourceDir, file), bytes);
    const duration = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp3], { encoding: 'utf8' }).trim());
    if (!Number.isFinite(duration) || duration <= 0) throw Error('PREPARE_DURATION_INVALID');
    return { file, size: bytes.length, sha256: sha256(bytes), duration, wordsSha256: sha256(readFileSync(path.join(dir, 'words.json'))), rawWordsSha256: sha256(readFileSync(path.join(dir, 'words.raw.json'))) };
  });
  if (/data:audio\//i.test(prepared)) throw Error('PREPARE_EMBEDDED_MEDIA_REMAINS');
  prepared = prepared.replace(/<a\b[^>]*>/gi, tag => /\bhref\s*=\s*["']?https?:\/\//i.test(tag)
    ? tag.replace(/\s+target\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '').replace(/>$/, ' target="_blank">') : tag);
  writeFileSync(path.join(sourceDir, 'index.html'), prepared);
  for (const suffix of ['receipts.json', 'design.json']) copyFileSync(outputPath.replace(/html$/i, suffix), path.join(sourceDir, 'index.' + suffix));
  const visuals = path.join(path.dirname(outputPath), 'visuals');
  if (existsSync(visuals)) cpSync(visuals, path.join(sourceDir, 'visuals'), { recursive: true });
  const manifest = { builtHtmlSha256: sha256(html), sourceHtmlSha256: sha256(prepared), assets: media };
  writeFileSync(path.join(sourceDir, 'asset-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return { sourcePath, sourceHtmlSha256: sha256(prepared), media };
}
