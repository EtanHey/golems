#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const COMPLETION_RECEIPT = '.stalker-completion.json';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function stageFailure(stage, reason) {
  return Object.assign(new Error(`Stalker FAILED at stage ${stage}: ${reason}`), { stage });
}

async function requiredFile(runDir, name, stage) {
  const bytes = await readFile(join(runDir, name)).catch(() => null);
  if (!bytes?.toString('utf8').trim()) throw stageFailure(stage, `${name} missing or empty`);
  return bytes;
}

// These are delivery artifacts; legacy processing/notification markers are not evidence.
export async function artifactHashes(runDir) {
  const gems = await requiredFile(runDir, 'gems.md', 6);
  const digest = await requiredFile(runDir, 'digest.md', 6);
  const dashboard = await requiredFile(runDir, 'dashboard.html', 7);
  const text = digest.toString('utf8').replace(/\r\n/g, '\n');
  for (const heading of ['What was discussed', 'Top highlights', 'Claims worth checking']) {
    const section = text.split(`## ${heading}\n`)[1]?.split('\n## ')[0]?.trim();
    if (!section || !/\[\d+:\d{2}(?::\d{2})?\]/.test(section)) {
      throw stageFailure(6, `digest missing timestamped ${heading}`);
    }
  }
  const highlights = text.split('## Top highlights\n')[1].split('\n## ')[0];
  const count = highlights.split('\n').filter(line =>
    /^(?:- |\d+\. |### ).*\[\d+:\d{2}(?::\d{2})?\].*\S/.test(line)).length;
  if (count < 5 || count > 10) throw stageFailure(6, 'digest must contain 5–10 highlights');
  if (!/<html\b|<!doctype html/i.test(dashboard.toString('utf8'))) throw stageFailure(7, 'dashboard is not HTML');
  return { gems: sha256(gems), digest: sha256(digest), dashboard: sha256(dashboard) };
}

export async function verifyRunDelivery(runDir, { receipt, fetchImpl = fetch, requireNotification = true } = {}) {
  const hashes = await artifactHashes(runDir);
  receipt ??= await readFile(join(runDir, COMPLETION_RECEIPT), 'utf8').then(JSON.parse).catch(() => null);
  if (receipt?.version !== 1 || receipt.runName !== basename(resolve(runDir))) {
    throw stageFailure(7, 'missing or wrong-run completion receipt');
  }
  if (Object.keys(hashes).some(key => hashes[key] !== receipt.artifacts?.[key])) {
    throw stageFailure(7, 'artifact hash mismatch; regenerate delivery after input changes');
  }
  const publication = receipt.publication;
  let url, manifestUrl;
  try {
    url = new URL(publication.url);
    manifestUrl = new URL(publication.manifestUrl);
    if (!['http:', 'https:'].includes(url.protocol) || manifestUrl.origin !== url.origin
      || url.pathname !== `/${publication.linkPath}` || manifestUrl.pathname !== '/manifest.json'
      || !publication.sourceRelative || !publication.linkPath.startsWith('dashboards/')) throw new Error();
  } catch { throw stageFailure(7, 'invalid publication URL or manifest location'); }
  try {
    const response = await fetchImpl(url.href, { signal: AbortSignal.timeout(10000), redirect: 'error' });
    const bytes = Buffer.from(await response.arrayBuffer());
    if (response.status !== 200 || sha256(bytes) !== hashes.dashboard) {
      throw new Error(`dashboard HTTP ${response.status} or content hash mismatch`);
    }
    const manifestResponse = await fetchImpl(manifestUrl.href, { signal: AbortSignal.timeout(10000), redirect: 'error' });
    const manifest = await manifestResponse.json();
    if (manifestResponse.status !== 200 || !manifest.included?.some(row =>
      row.linkPath === publication.linkPath && row.sourceRelative === publication.sourceRelative)) {
      throw new Error('dashboard absent from hub manifest');
    }
  } catch (error) { throw stageFailure(7, error.message); }
  if (requireNotification && (receipt.status !== 'complete' || receipt.notification?.accepted !== true
    || !Number.isSafeInteger(receipt.notification.messageId) || receipt.notification.messageId <= 0
    || receipt.notification.url !== url.href || !receipt.notification.body?.includes(url.href))) {
    throw stageFailure(8, 'successful completion notification must carry dashboard URL');
  }
  return { status: requireNotification ? 'complete' : 'published', runName: receipt.runName, dashboardUrl: url.href };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyRunDelivery(process.argv[2] ?? '').then(result => console.log(JSON.stringify(result))).catch(error => {
    console.error(error.message);
    process.exitCode = 75;
  });
}
