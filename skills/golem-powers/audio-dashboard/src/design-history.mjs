import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
export const designHash = value => createHash('sha256').update(value).digest('hex');
export const designReportPath = output => output.replace(/\.html$/i, '') + '.design.json';
function location(spec) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(spec.series || '')) throw new Error('previous build missing: explicit slug-safe series required');
  const directory = path.join(os.homedir(), '.local', 'share', 'audio-dashboard', 'design-history', spec.series);
  return { directory, index: path.join(directory, 'published.json') };
}
export function recordPublishedDesign(spec, outputPath, html) {
  const { directory, index } = location(spec), sha256 = designHash(html), filename = `${sha256}.html`;
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, filename), html);
  writeFileSync(`${index}.new-${process.pid}`, JSON.stringify({ series: spec.series, filename, sha256 }));
  renameSync(`${index}.new-${process.pid}`, index);
}
export function loadPublishedDesign(spec, outputPath) {
  const { directory, index } = location(spec);
  try {
    if (existsSync(index)) {
      const record = JSON.parse(readFileSync(index, 'utf8'));
      if (record.series !== spec.series || !/^[a-f0-9]{64}\.html$/.test(record.filename)) throw Error();
      const previousPath = path.join(directory, record.filename), previousHtml = readFileSync(previousPath, 'utf8');
      if (designHash(previousHtml) !== record.sha256) throw Error();
      return { series: spec.series, previousHtml, previousPath };
    }
    if (existsSync(directory)) throw Error();
    const previous = spec.designPreservation?.previousPublished;
    if (previous !== undefined) {
      if (typeof previous !== 'string' || !previous.trim()) throw Error();
      const previousPath = path.resolve(path.dirname(outputPath), previous), previousHtml = readFileSync(previousPath, 'utf8');
      if (!previousHtml.trim()) throw Error();
      return { series: spec.series, previousHtml, previousPath };
    }
    const reason = spec.designPreservation?.baseline?.reason;
    if (typeof reason !== 'string' || !reason.trim() || /[\r\n]/.test(reason)) throw Error();
    return { series: spec.series, previousHtml: null, baseline: { reason } };
  } catch { throw new Error('previous build missing: declare first-build baseline or supply a published predecessor'); }
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
