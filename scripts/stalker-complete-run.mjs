#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateHumanDigest } from './stalker-human-digest.mjs';
import { prepareCardMedia } from './stalker-card-media.mjs';
import { buildRunDashboard } from './stalker-dashboard.mjs';
import { parseGems } from './stalker-morning-digest.mjs';
import { atomicWrite, configuredHubOrigin, publishRunDashboard } from './stalker-publish.mjs';
import { artifactHashes, COMPLETION_RECEIPT, sha256, stageFailure, verifyRunDelivery } from './stalker-run-contract.mjs';
import { createDriveArchive } from './stalker-drive-archive.mjs';
import { retainRunMedia, verifyLocalMediaRetention } from './stalker-media-retention.mjs';

// Bump whenever the digest prompt, schema or grounding validator changes.
const DIGEST_CONTRACT_VERSION = 3;
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export async function notifyDelivery(title, body, priority = 'default') {
  if (process.env.STALKER_TELEGRAM_NOTIFY === '0' || process.env.STALKER_TELEGRAM_DRY_RUN === '1') {
    throw stageFailure(8, 'notifications disabled; completion cannot be certified');
  }
  const payload = { title, body: body.slice(0, 1900), source: 'stalker-golem', priority };
  if (Buffer.byteLength(JSON.stringify(payload)) >= 4096) throw stageFailure(8, 'notification payload exceeds transport budget');
  const response = await fetch(process.env.STALKER_TELEGRAM_NOTIFY_URL ?? 'http://127.0.0.1:3847/notify', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(15000),
  });
  const result = await response.json().catch(() => null);
  if (response.status !== 200 || result?.delivered !== true || !Number.isSafeInteger(result.message_id) || result.message_id <= 0) {
    throw stageFailure(8, `notification has no Telegram delivery receipt (HTTP ${response.status})`);
  }
  return { accepted: true, messageId: result.message_id, body: payload.body };
}

async function lockRun(runDir) {
  // Kernel-owned lock: releasing stdin or crashing releases it, with no stale PID marker.
  const code = 'import fcntl,sys\nf=open(sys.argv[1],"a")\ntry: fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)\nexcept BlockingIOError: sys.exit(75)\nprint("locked",flush=True)\nsys.stdin.read()';
  const child = spawn('python3', ['-c', code, join(runDir, '.completion.lock')], { stdio: ['pipe', 'pipe', 'ignore'] });
  const closed = new Promise(resolve => child.once('close', resolve));
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(stageFailure(6, 'delivery lock acquisition timed out')); }, 5000);
    child.once('error', error => { clearTimeout(timer); reject(stageFailure(6, `delivery lock unavailable: ${error.message}`)); });
    child.stdout.once('data', () => { clearTimeout(timer); resolve(); });
    child.once('close', () => { clearTimeout(timer); reject(stageFailure(6, 'delivery already running or run directory unavailable')); });
  });
  return async () => { child.stdin.end(); await closed; };
}

export async function completeRun(runDir, options = {}) {
  runDir = resolve(runDir);
  const unlock = await lockRun(runDir);
  const notify = options.notifyImpl ?? notifyDelivery;
  let stage = 6, receipt, preserveDeliveryReceipt = false;
  try {
    const name = basename(runDir), match = name.match(/^(.+)-(\d{4}-\d{2}-\d{2})(?:-\d{6})?$/);
    if (!match) throw stageFailure(6, 'run directory must be channel-YYYY-MM-DD[-HHMMSS]');
    const [, channel, date] = match;
    receipt = await readFile(join(runDir, COMPLETION_RECEIPT), 'utf8').then(JSON.parse).catch(() => null);
    let initialError;
    if (receipt?.status !== 'notified') {
      try { return { ...(await verifyRunDelivery(runDir, { receipt, fetchImpl: options.fetchImpl })), skipped: true }; }
      catch (error) { initialError = error; }
    }
    if (receipt?.version === 3 && receipt.status === 'complete' && initialError?.stage === 9) {
      // Survivors cannot reconstruct the custody evidence for deleted originals.
      preserveDeliveryReceipt = true;
      throw initialError;
    }
    let resumeRetention = false;
    if (receipt?.version === 3 && ['notified', 'complete'].includes(receipt.status)) {
      if (initialError?.liveVerificationFailure) {
        preserveDeliveryReceipt = true;
        throw initialError;
      }
      try {
        await verifyRunDelivery(runDir, { receipt, fetchImpl: options.fetchImpl, requireRetention: false });
        resumeRetention = true;
        preserveDeliveryReceipt = true;
      } catch (error) {
        if (error.liveVerificationFailure) {
          preserveDeliveryReceipt = true;
          throw error;
        }
        receipt = null;
      }
    }
    for (const file of ['.stage-complete-notify.done', '.stage-notified.done']) await rm(join(runDir, file), { force: true });
    const repoRoot = resolve(options.repoRoot ?? REPO_ROOT);
    const orchestratorRoot = resolve(options.orchestratorRoot ?? join(dirname(repoRoot), 'orchestrator'));
    const config = await readFile(join(repoRoot, 'docs.local/stalker-golem/delivery-config.json'), 'utf8').then(JSON.parse).catch(() => ({}));
    if (!resumeRetention) {
      await rm(join(runDir, COMPLETION_RECEIPT), { force: true });
      const hubOrigin = options.hubOrigin ?? ((process.env.TAILNET_HUB_HOST || process.env.STALKER_DASHBOARD_BASE)
        ? configuredHubOrigin() : config.hubOrigin ?? configuredHubOrigin());
      const dashboardUrl = `${new URL(hubOrigin).origin}/dashboards/${basename(repoRoot)}/stalker/${name}.html`;
      const gemsMarkdown = await readFile(join(runDir, 'gems.md'), 'utf8');
      if (!/Scored:|\*Scored \d+\/\d+ segments/.test(gemsMarkdown) || !parseGems(gemsMarkdown).length) throw stageFailure(6, 'completed gems are required');
      const inputHash = sha256(Buffer.concat([await readFile(join(runDir, 'transcript.md')), Buffer.from(gemsMarkdown)]));
      const cachePath = join(runDir, '.stalker-digest.json');
      let digest = await readFile(cachePath, 'utf8').then(JSON.parse).catch(() => null);
      if (digest?.contractVersion !== DIGEST_CONTRACT_VERSION || digest?.inputHash !== inputHash || digest?.dashboardUrl !== dashboardUrl) {
        digest = { ...(await (options.generateImpl ?? generateHumanDigest)({ runDir, date, channel, dashboardUrl })), inputHash, dashboardUrl, contractVersion: DIGEST_CONTRACT_VERSION };
        await atomicWrite(cachePath, JSON.stringify(digest));
      }
      await atomicWrite(join(runDir, 'digest.md'), digest.markdown);
      await atomicWrite(join(runDir, '.stage-6-digest.done'), new Date().toISOString());
      stage = 7;
      const { items: selected } = await (options.mediaImpl ?? prepareCardMedia)({ runDir, summary: digest.summary });
      const assets = selected.flatMap(gem => [gem.clip, gem.frame].filter(Boolean));
      const html = buildRunDashboard({ date, channel, runName: name, summary: digest.summary, cardMedia: selected });
      const publication = await publishRunDashboard({ runDir, repoRoot, orchestratorRoot, hubOrigin, html,
        assets, syncImpl: options.syncImpl });
      receipt = { version: 3, runName: name, status: 'published', artifacts: await artifactHashes(runDir), publication,
        retention: { keepPaths: assets } };
      await verifyRunDelivery(runDir, { receipt, fetchImpl: options.fetchImpl, requireNotification: false, requireRetention: false });
      await atomicWrite(join(runDir, '.stage-7-publish.done'), new Date().toISOString());
      stage = 8;
      const body = `Dashboard: ${publication.url}\n\n${digest.summary.highlights.slice(0, 3).map(item => `[${item.timestamp}] ${item.title}`).join('\n')}\n\n${digest.summary.highlights.length} highlights · ${digest.summary.claims.length} claims worth checking`;
      const notification = await notify(`Stalker dashboard ready — ${channel} ${date}`, body);
      receipt.notification = { ...notification, url: publication.url };
      receipt.status = 'notified';
      if (notification?.accepted !== true || !Number.isSafeInteger(notification.messageId) || notification.messageId <= 0
        || !notification.body?.includes(publication.url)) throw stageFailure(8, 'notification has no valid dashboard delivery receipt');
      // Preserve the real send before another fallible network verification.
      await atomicWrite(join(runDir, COMPLETION_RECEIPT), JSON.stringify(receipt, null, 2));
      preserveDeliveryReceipt = true;
      await verifyRunDelivery(runDir, { receipt, fetchImpl: options.fetchImpl, requireRetention: false });
    }
    stage = 9;
    const archiveImpl = options.archiveImpl ?? createDriveArchive({ parentId: options.driveArchiveParentId ?? config.driveArchiveParentId });
    await retainRunMedia({ runDir, archiveImpl, keepPaths: receipt.retention?.keepPaths ?? [] });
    await verifyLocalMediaRetention({ runDir });
    receipt.status = 'complete';
    const result = await verifyRunDelivery(runDir, { receipt, fetchImpl: options.fetchImpl });
    await atomicWrite(join(runDir, COMPLETION_RECEIPT), JSON.stringify(receipt, null, 2));
    for (const marker of ['.stage-complete-notify.done', '.stage-notified.done']) await atomicWrite(join(runDir, marker), new Date().toISOString());
    await rm(join(runDir, '.stalker-failure.json'), { force: true });
    console.log(`Stalker COMPLETE: ${receipt.publication.url}`);
    return result;
  } catch (error) {
    const failure = { status: 'failed', stage: error.stage ?? stage, reason: error.message, ts: new Date().toISOString() };
    if (failure.stage !== 9 && !preserveDeliveryReceipt) await rm(join(runDir, COMPLETION_RECEIPT), { force: true });
    for (const file of ['.stage-complete-notify.done', '.stage-notified.done']) await rm(join(runDir, file), { force: true });
    console.error(`Stalker FAILED at stage ${failure.stage}: ${failure.reason}`);
    await atomicWrite(join(runDir, '.stalker-failure.json'), JSON.stringify(failure, null, 2));
    await notify(`Stalker FAILED at stage ${failure.stage}`, `${basename(runDir)}: ${failure.reason}`.slice(0, 900), 'high').catch(() => console.error('Stalker failure notification also FAILED'));
    throw stageFailure(failure.stage, failure.reason);
  } finally { await unlock(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), value = flag => args[args.indexOf(flag) + 1];
  const option = flag => args.includes(flag) ? value(flag) : undefined;
  completeRun(args[0] ?? '', { repoRoot: option('--repo-root'), orchestratorRoot: option('--orchestrator-root'), hubOrigin: option('--hub-origin') })
    .then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error.message); process.exitCode = 75; });
}
