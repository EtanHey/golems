import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { completeRun, notifyDelivery } from '../stalker-complete-run.mjs';
import { validSummary } from './fixtures/stalker-digest-summary.mjs';

async function setup(t, runName = 'theo-2026-09-08-030512') {
  const root = await mkdtemp(join(import.meta.dirname, '.stalker-completion-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repoRoot = join(root, 'golems'), runDir = join(repoRoot, 'docs.local/stalker-golem', runName);
  await mkdir(join(runDir, 'clips'), { recursive: true });
  await writeFile(join(runDir, 'clips/clip-00m01s.mp4'), 'selected clip');
  await writeFile(join(runDir, 'transcript.md'), 'whole transcript');
  await writeFile(join(runDir, 'gems.md'), '# Gems\n### [00:01] Segment 1 A topic\n**Score:** 8/10\nScored: today\n');
  await writeFile(join(runDir, '.stage-complete-notify.done'), 'old false marker');
  const item = { timestamp: '00:01', title: 'A topic', summary: 'A discussion', excerpt: 'A statement', uncertain: false };
  const digest = { summary: { topics: [item], highlights: Array(5).fill(item), claims: [{ ...item, claim: 'Check this' }] },
    markdown: `# Digest\n## What was discussed\n[00:01] A topic\n## Top highlights\n${Array(5).fill('- [00:01] A highlight').join('\n')}\n## Claims worth checking\n[00:01] Check this\n` };
  const manifest = { included: [] }, calls = [];
  const server = createServer(async (req, res) => {
    if (req.url === '/manifest.json') return res.end(JSON.stringify(manifest));
    try { res.end(await readFile(join(repoRoot, 'docs.local/dashboards/stalker', `${runName}.html`))); }
    catch { res.statusCode = 404; res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const options = { repoRoot, orchestratorRoot: join(root, 'orc'), hubOrigin: `http://127.0.0.1:${server.address().port}`,
    generateImpl: async () => { calls.push('generate'); return digest; },
    syncImpl: async () => { calls.push('sync'); manifest.included = [{ linkPath: `dashboards/golems/stalker/${runName}.html`, sourceRelative: `golems/docs.local/dashboards/stalker/${runName}.html` }]; },
    notifyImpl: async (title, body) => { calls.push(title); return { accepted: true, messageId: 123, body }; },
  };
  return { runDir, repoRoot, calls, options, manifest };
}

test('completion publishes before notifying, preserves media and validates every retry', async t => {
  const { runDir, repoRoot, calls, options } = await setup(t);
  assert.equal((await completeRun(runDir, options)).status, 'complete');
  assert.deepEqual(calls, ['generate', 'sync', 'Stalker COMPLETE — theo 2026-09-08']);
  const evidenceRoot = join(repoRoot, 'docs.local/dashboards/stalker/evidence/theo-2026-09-08-030512');
  assert.equal(await readFile(join(evidenceRoot, (await readdir(evidenceRoot))[0], 'clips/clip-00m01s.mp4'), 'utf8'), 'selected clip');
  assert.equal((await completeRun(runDir, options)).skipped, true);
  assert.equal(calls.length, 3);
  await writeFile(join(runDir, 'transcript.md'), 'corrected transcript');
  assert.equal((await completeRun(runDir, options)).skipped, undefined);
  assert.equal(calls.filter(value => value === 'generate').length, 2);
});

test('missing manifest fails stage 7, sends FAILED and leaves completion open', async t => {
  const { runDir, calls, options } = await setup(t);
  options.syncImpl = async () => {};
  await assert.rejects(completeRun(runDir, options), /FAILED at stage 7/);
  assert.ok(calls.includes('Stalker FAILED at stage 7'));
  assert.ok(!calls.some(value => value.includes('COMPLETE')));
  await assert.rejects(readFile(join(runDir, '.stalker-completion.json')));
  await assert.rejects(readFile(join(runDir, '.stage-complete-notify.done')));
  assert.equal(JSON.parse(await readFile(join(runDir, '.stalker-failure.json'))).stage, 7);
});

test('notification failure is retryable without rerunning human generation', async t => {
  const { runDir, calls, options } = await setup(t);
  const notify = options.notifyImpl;
  options.notifyImpl = async title => { if (title.includes('COMPLETE')) throw new Error('offline'); return {}; };
  await assert.rejects(completeRun(runDir, options), /FAILED at stage 8/);
  options.notifyImpl = notify;
  assert.equal((await completeRun(runDir, options)).status, 'complete');
  assert.equal(calls.filter(value => value === 'generate').length, 1);
});

test('HTTP 200 without a Telegram message receipt is rejected by the actual client', async t => {
  const server = createServer((req, res) => res.end('ok'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const previous = process.env.STALKER_TELEGRAM_NOTIFY_URL;
  process.env.STALKER_TELEGRAM_NOTIFY_URL = `http://127.0.0.1:${server.address().port}/notify`;
  t.after(async () => { if (previous === undefined) delete process.env.STALKER_TELEGRAM_NOTIFY_URL; else process.env.STALKER_TELEGRAM_NOTIFY_URL = previous; await new Promise(resolve => server.close(resolve)); });
  await assert.rejects(notifyDelivery('Stalker', 'Dashboard URL'), /no Telegram delivery receipt/);
});

test('concurrent completion cannot double-send and a released lock remains reusable', async t => {
  const { runDir, options, calls } = await setup(t);
  let entered, release;
  const ready = new Promise(resolve => { entered = resolve; });
  const resume = new Promise(resolve => { release = resolve; });
  const generate = options.generateImpl;
  options.generateImpl = async () => { entered(); await resume; return generate(); };
  const first = completeRun(runDir, options);
  await ready;
  await assert.rejects(completeRun(runDir, options), /already running/);
  release();
  await first;
  assert.equal((await completeRun(runDir, options)).skipped, true);
  assert.equal(calls.filter(value => value.includes('COMPLETE')).length, 1);
});


test('a manifest lost after notification cannot leave a complete receipt or marker', async t => {
  const { runDir, options, manifest } = await setup(t);
  const notify = options.notifyImpl;
  options.notifyImpl = async (...args) => { const receipt = await notify(...args); manifest.included = []; return receipt; };
  await assert.rejects(completeRun(runDir, options), /FAILED at stage 7/);
  for (const file of ['.stalker-completion.json', '.stage-complete-notify.done', '.stage-notified.done']) {
    await assert.rejects(readFile(join(runDir, file)));
  }
});

test('an obsolete digest cache is regenerated on a delivery retry', async t => {
  const { runDir, options, calls } = await setup(t);
  const notify = options.notifyImpl;
  options.notifyImpl = async () => { throw new Error('offline'); };
  await assert.rejects(completeRun(runDir, options));
  const path = join(runDir, '.stalker-digest.json');
  const cache = JSON.parse(await readFile(path, 'utf8'));
  cache.contractVersion = 'obsolete';
  await writeFile(path, JSON.stringify(cache));
  options.notifyImpl = notify;
  await completeRun(runDir, options);
  assert.equal(calls.filter(value => value === 'generate').length, 2);
});


test('installed delivery loads the repository hub configuration without shell environment', async t => {
  const { runDir, repoRoot, options } = await setup(t);
  await writeFile(join(repoRoot, 'docs.local/stalker-golem/delivery-config.json'), JSON.stringify({ hubOrigin: options.hubOrigin }));
  delete options.hubOrigin;
  assert.equal((await completeRun(runDir, options)).status, 'complete');
});

test('default generation crosses the real CLI runner and validates its final output', async t => {
  const { runDir, options, calls } = await setup(t);
  delete options.generateImpl;
  await writeFile(join(runDir, 'transcript.md'), `## [00:00] Segment 1 (10s)
you you you you I I I I
## [00:10] Segment 2 (20s)
Creators use AI privately but avoid discussing it publicly.
## [00:30] Segment 3 (30s)
He compared two coding models and preferred the second one's mergeable code.
`);
  const summary = validSummary();
  const map = { topics: summary.topics.map(topic => ({ ...topic, coveredTimestamps: [topic.timestamp] })),
    highlights: summary.highlights.map(highlight => ({ ...highlight, importance: 8 })), claims: summary.claims, unusableTimestamps: [] };
  const executable = join(runDir, 'fixture-codex.mjs');
  await writeFile(executable, `#!/usr/bin/env node
import {writeFileSync} from 'node:fs';
let input = ''; for await (const chunk of process.stdin) input += chunk;
if (!input.includes('Creators use AI privately')) process.exit(2);
writeFileSync(process.argv[process.argv.indexOf('--output-last-message') + 1], ${JSON.stringify(JSON.stringify(map))});
console.log(JSON.stringify({type:'turn.completed'}));
`);
  await chmod(executable, 0o755);
  const previous = process.env.CODEX_BIN;
  process.env.CODEX_BIN = executable;
  t.after(() => { if (previous === undefined) delete process.env.CODEX_BIN; else process.env.CODEX_BIN = previous; });
  assert.equal((await completeRun(runDir, options)).status, 'complete');
  assert.ok(!calls.includes('generate'));
  const diagnostics = JSON.parse(await readFile(join(runDir, '.digest-work/human-digest-map-001.stdout.log')));
  assert.equal(diagnostics.eventTypes['turn.completed'], 1);
  assert.match(await readFile(join(runDir, 'digest.md'), 'utf8'), /Private AI use/);
});


test('legacy date-only recordings retain their channel, date and dashboard URL', async t => {
  const { runDir, options, calls } = await setup(t, 'theo-2026-09-08');
  const generate = options.generateImpl;
  options.generateImpl = async args => {
    assert.equal(args.channel, 'theo');
    assert.equal(args.date, '2026-09-08');
    assert.match(args.dashboardUrl, /\/dashboards\/golems\/stalker\/theo-2026-09-08\.html$/);
    return generate(args);
  };
  const result = await completeRun(runDir, options);
  assert.equal(result.status, 'complete');
  assert.ok(calls.includes('Stalker COMPLETE — theo 2026-09-08'));
  const receipt = JSON.parse(await readFile(join(runDir, '.stalker-completion.json')));
  assert.equal(receipt.runName, 'theo-2026-09-08');
  assert.match(receipt.publication.url, /\/theo-2026-09-08\.html$/);
});

test('completion text leads with selected highlights instead of opening chatter', async t => {
  const { runDir, options } = await setup(t);
  const generate = options.generateImpl, send = options.notifyImpl;
  let message;
  options.generateImpl = async args => {
    const digest = await generate(args);
    digest.summary.topics = [{ ...digest.summary.topics[0], title: 'Opening chatter' }];
    digest.summary.highlights = digest.summary.highlights.map(item => ({ ...item, title: 'Key coding discussion' }));
    return digest;
  };
  options.notifyImpl = async (...args) => { message = args[1]; return send(...args); };
  await completeRun(runDir, options);
  assert.match(message, /Key coding discussion/);
  assert.doesNotMatch(message, /Opening chatter/);
});
