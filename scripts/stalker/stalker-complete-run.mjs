#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateHumanDigest } from './stalker-human-digest.mjs';
import { prepareCardMedia } from './stalker-card-media.mjs';
import { buildRunDashboard } from './stalker-dashboard.mjs';
import { parseGems } from './stalker-morning-digest.mjs';
import { atomicWrite, configuredHubOrigin, publishRunDashboard } from './stalker-publish.mjs';
import { artifactHashes, COMPLETION_RECEIPT, migrateCompletionReceipt, sha256, stageFailure, verifyRunDelivery } from './stalker-run-contract.mjs';
import { createDriveArchive } from './stalker-drive-archive.mjs';
import { retainRunMedia, verifyLocalMediaRetention } from './stalker-media-retention.mjs';

const canonicalPath = candidate => { try { return realpathSync(candidate); } catch { return resolve(candidate); } };
// Bump whenever the digest prompt, schema or grounding validator changes.
const DIGEST_CONTRACT_VERSION = 3;
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
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
  let stage = 6, receipt, preserveDeliveryReceipt = false;
  try {
    const name = basename(runDir), match = name.match(/^(.+)-(\d{4}-\d{2}-\d{2})(?:-\d{6})?$/);
    if (!match) throw stageFailure(6, 'run directory must be channel-YYYY-MM-DD[-HHMMSS]');
    const [, channel, date] = match;
    receipt = await readFile(join(runDir, COMPLETION_RECEIPT), 'utf8').then(JSON.parse).catch(() => null);
    const legacy = receipt?.version === 3 && ['notified', 'complete'].includes(receipt.status);
    let initialError;
    try {
      const verified = legacy && receipt.status === 'complete' ? await migrateCompletionReceipt(runDir, {receipt, fetchImpl: options.fetchImpl}) : receipt;
      const result = await verifyRunDelivery(runDir, {receipt: verified, fetchImpl: options.fetchImpl});
      if (legacy) await atomicWrite(join(runDir, COMPLETION_RECEIPT), JSON.stringify(verified, null, 2));
      return {...result, skipped: true};
    } catch (error) { initialError = error; }
    let resumeRetention = false;
    if (legacy || (receipt?.version === 4 && ['published', 'complete'].includes(receipt.status))) {
      preserveDeliveryReceipt = true;
      if (initialError.liveVerificationFailure || (receipt.status === 'complete' && initialError.stage === 9)) throw initialError;
      const {notification, ...evidence} = receipt;
      const published = {...evidence, version: 4, status: 'published'};
      try {
        await verifyRunDelivery(runDir, {receipt: published, fetchImpl: options.fetchImpl, requireRetention: false});
        receipt = published;
        await atomicWrite(join(runDir, COMPLETION_RECEIPT), JSON.stringify(receipt, null, 2));
        resumeRetention = true;
      } catch (error) {
        if (error.liveVerificationFailure) throw error;
        preserveDeliveryReceipt = false;
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
      receipt = { version: 4, runName: name, status: 'published', artifacts: await artifactHashes(runDir), publication,
        retention: { keepPaths: assets } };
      await verifyRunDelivery(runDir, { receipt, fetchImpl: options.fetchImpl, requireRetention: false });
      await atomicWrite(join(runDir, '.stage-7-publish.done'), new Date().toISOString());
      // Durable local checkpoint before any retention work can offload originals.
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
    await rm(join(runDir, '.stalker-failure.json'), { force: true });
    console.log(`Stalker COMPLETE: ${receipt.publication.url}`);
    return result;
  } catch (error) {
    const failure = { status: 'failed', stage: error.stage ?? stage, reason: error.message, ts: new Date().toISOString() };
    if (failure.stage !== 9 && !preserveDeliveryReceipt) await rm(join(runDir, COMPLETION_RECEIPT), { force: true });
    for (const file of ['.stage-complete-notify.done', '.stage-notified.done']) await rm(join(runDir, file), { force: true });
    console.error(`Stalker FAILED at stage ${failure.stage}: ${failure.reason}`);
    await atomicWrite(join(runDir, '.stalker-failure.json'), JSON.stringify(failure, null, 2));
    throw stageFailure(failure.stage, failure.reason);
  } finally { await unlock(); }
}

if (process.argv[1] && canonicalPath(process.argv[1]) === canonicalPath(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2), value = flag => args[args.indexOf(flag) + 1];
  const option = flag => args.includes(flag) ? value(flag) : undefined;
  completeRun(args[0] ?? '', { repoRoot: option('--repo-root'), orchestratorRoot: option('--orchestrator-root'), hubOrigin: option('--hub-origin') })
    .then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error.message); process.exitCode = 75; });
}
