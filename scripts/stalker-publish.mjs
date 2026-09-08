import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { stageFailure } from './stalker-run-contract.mjs';

export async function atomicWrite(path, content) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.new-${process.pid}`;
  await writeFile(temporary, content);
  await rename(temporary, path);
}

export function configuredHubOrigin() {
  const value = process.env.TAILNET_HUB_HOST
    ? `https://${process.env.TAILNET_HUB_HOST}` : process.env.STALKER_DASHBOARD_BASE;
  if (!value) throw stageFailure(7, 'TAILNET_HUB_HOST or STALKER_DASHBOARD_BASE must be configured');
  return new URL(value).origin;
}

async function syncHub(orchestratorRoot) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(orchestratorRoot, 'scripts/sync-tailnet-dashboards.mjs')], {
      cwd: orchestratorRoot, stdio: ['ignore', 'ignore', 'pipe'],
    });
    let detail = '';
    child.stderr.on('data', bytes => { detail = (detail + bytes.toString()).slice(-2000); });
    let forceKill, timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      forceKill = setTimeout(() => child.kill('SIGKILL'), 5000);
    }, 120000);
    child.on('error', error => { clearTimeout(timer); clearTimeout(forceKill); reject(error); });
    child.on('close', code => {
      clearTimeout(timer); clearTimeout(forceKill);
      if (code === 0 && !timedOut) resolve(); else reject(new Error(`hub sync ${timedOut ? 'timed out' : `exited ${code}`}: ${detail}`));
    });
  });
}

// Publish into a source tree the hub reconstructs, never directly into its output tree.
export async function publishRunDashboard({ runDir, repoRoot, orchestratorRoot, html, assets = [], hubOrigin, syncImpl = syncHub }) {
  try {
    const origin = new URL(hubOrigin ?? configuredHubOrigin());
    if (!['http:', 'https:'].includes(origin.protocol) || origin.hostname.endsWith('.invalid')
      || origin.username || origin.password) throw new Error('invalid hub origin');
    const runName = basename(runDir), repoName = basename(repoRoot);
    if (![runName, repoName].every(name => /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(name))) throw new Error('invalid run/repository name');
    const sourceRoot = join(repoRoot, 'docs.local/dashboards/stalker');
    const evidenceRoot = join(sourceRoot, 'evidence', runName);
    const selected = [...new Set(assets)];
    for (const asset of selected) {
      if (!/^(?:clips\/clip-\d+m\d+s\.mp4|frames\/frame-\d+m\d+s\.jpg)$/.test(asset)) throw new Error('invalid publication asset');
      if (!(await stat(join(runDir, asset))).isFile()) throw new Error('publication asset is not a file');
    }
    await mkdir(evidenceRoot, { recursive: true });
    const revision = randomUUID();
    const versionRoot = join(evidenceRoot, revision);
    const staging = await mkdtemp(join(sourceRoot, `.${runName}-new-`));
    const name = `${runName}.html`;
    const source = join(sourceRoot, name);
    const previousHtml = await readFile(source).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    let committed = false, sourceWritten = false;
    try {
      for (const asset of selected) {
        const target = join(staging, asset);
        await mkdir(dirname(target), { recursive: true });
        await copyFile(join(runDir, asset), target);
      }
      await rename(staging, versionRoot);
      const publishedHtml = html.replaceAll(`evidence/${runName}/`, `evidence/${runName}/${revision}/`);
      // Existing served HTML is a symlink to this source. Admit the new media
      // links while the previous page and its media are still intact.
      if (previousHtml !== null) await syncImpl(orchestratorRoot);
      await atomicWrite(join(runDir, 'dashboard.html'), publishedHtml);
      await atomicWrite(source, publishedHtml);
      sourceWritten = true;
      if (previousHtml === null) await syncImpl(orchestratorRoot);
      committed = true;
      for (const previous of await readdir(evidenceRoot)) {
        if (previous !== revision) await rm(join(evidenceRoot, previous), { recursive: true, force: true })
          .catch(() => console.warn('Stalker: stale media cleanup deferred'));
      }
      // The periodic hub sync drops stale links; the new HTML/media pair is live.
    } finally {
      await rm(staging, { recursive: true, force: true });
      if (!committed) {
        if (sourceWritten && previousHtml === null) await rm(source, { force: true });
        await rm(versionRoot, { recursive: true, force: true });
      }
    }
    const linkPath = `dashboards/${repoName}/stalker/${name}`;
    return {
      url: `${origin.origin}/${linkPath}`, manifestUrl: `${origin.origin}/manifest.json`, linkPath,
      sourceRelative: `${repoName}/docs.local/dashboards/stalker/${name}`,
    };
  } catch (error) { throw stageFailure(7, error.message); }
}
