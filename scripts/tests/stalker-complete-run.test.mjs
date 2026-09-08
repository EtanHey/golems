import assert from 'node:assert/strict';
import { createServer, get } from 'node:http';
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
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
    if (req.url.includes('/evidence/')) {
      try {
        const mediaRoot = resolve(repoRoot, 'docs.local/dashboards/stalker');
        const asset = resolve(mediaRoot, req.url.split('/stalker/')[1]);
        if (!asset.startsWith(mediaRoot + sep)) { res.statusCode = 404; return res.end(); }
        return res.end(await readFile(asset));
      }
      catch { res.statusCode=404;return res.end(); }
    }
    try { res.end(await readFile(join(repoRoot, 'docs.local/dashboards/stalker', `${runName}.html`))); }
    catch { res.statusCode = 404; res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const options = { repoRoot, orchestratorRoot: join(root, 'orc'), hubOrigin: `http://127.0.0.1:${server.address().port}`,
    generateImpl: async () => { calls.push('generate'); return digest; },
    mediaImpl: async ({summary}) => {
      const items=[];
      for(const item of new Map(Object.values(summary).flat().map(item=>[item.timestamp,item])).values()) {
        const seconds=item.timestamp.split(':').reduce((a,b)=>a*60+Number(b),0);
        const clip=`card-media/clips/clip-${Math.floor(seconds/60)}m${seconds%60}s.mp4`;
        const frame=`card-media/frames/frame-${Math.floor(seconds/60)}m${seconds%60}s.jpg`;
        for(const file of [clip,frame]) { await mkdir(join(runDir,file,'..'),{recursive:true});await writeFile(join(runDir,file),file===clip?'selected clip':'poster'); }
        items.push({timestamp:item.timestamp,clip,frame,startSeconds:Math.max(0,seconds-20),endSeconds:seconds+40,evidenceSeconds:seconds});
      }
      return {items};
    },
    syncImpl: async () => { calls.push('sync'); manifest.included = [{ linkPath: `dashboards/golems/stalker/${runName}.html`, sourceRelative: `golems/docs.local/dashboards/stalker/${runName}.html` }]; },
    notifyImpl: async (title, body) => { calls.push(title); return { accepted: true, messageId: 123, body }; },
    archiveImpl: matchingArchive(),
  };
  return { runDir, repoRoot, calls, options, manifest };
}

function matchingArchive(calls, failOnceAt) {
  let failed = false;
  return async expected => {
    calls?.push(`archive:${expected.relativePath}`);
    if (!failed && expected.relativePath === failOnceAt) {
      failed = true;
      throw new Error('synthetic Drive failure');
    }
    return { id: `drive-${expected.relativePath}`, path: `04_MEDIA/stalker/${expected.runName}/${expected.relativePath}`,
      url: `https://drive.example/${expected.relativePath}`, size: expected.size, sha256: expected.sha256, md5: 'synthetic-md5' };
  };
}

test('completion publishes before notifying, preserves media and validates every retry', async t => {
  const { runDir, repoRoot, calls, options } = await setup(t);
  assert.equal((await completeRun(runDir, options)).status, 'complete');
  assert.deepEqual(calls, ['generate', 'sync', 'Stalker dashboard ready — theo 2026-09-08']);
  const evidenceRoot = join(repoRoot, 'docs.local/dashboards/stalker/evidence/theo-2026-09-08-030512');
  assert.equal(await readFile(join(evidenceRoot, (await readdir(evidenceRoot))[0], 'card-media/clips/clip-0m1s.mp4'), 'utf8'), 'selected clip');
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
  assert.ok(!calls.some(value => value.startsWith('Stalker dashboard ready')));
  await assert.rejects(readFile(join(runDir, '.stalker-completion.json')));
  await assert.rejects(readFile(join(runDir, '.stage-complete-notify.done')));
  assert.equal(JSON.parse(await readFile(join(runDir, '.stalker-failure.json'))).stage, 7);
});

test('notification failure is retryable without rerunning human generation', async t => {
  const { runDir, calls, options } = await setup(t);
  const notify = options.notifyImpl;
  options.notifyImpl = async title => { if (title.includes('dashboard ready')) throw new Error('offline'); return {}; };
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
  assert.equal(calls.filter(value => value.includes('dashboard ready')).length, 1);
});


test('a manifest lost after notification preserves the real receipt and retries without another send', async t => {
  const { runDir, options, manifest, calls } = await setup(t);
  const notify = options.notifyImpl;
  let included;
  options.notifyImpl = async (...args) => { const receipt = await notify(...args); included ??= manifest.included; manifest.included = []; return receipt; };
  await assert.rejects(completeRun(runDir, options), /FAILED at stage 7/);
  const receipt = JSON.parse(await readFile(join(runDir, '.stalker-completion.json')));
  assert.equal(receipt.status, 'notified');
  assert.equal(receipt.notification.messageId, 123);
  for (const file of ['.stage-complete-notify.done', '.stage-notified.done']) {
    await assert.rejects(readFile(join(runDir, file)));
  }
  manifest.included = included;
  options.notifyImpl = notify;
  assert.equal((await completeRun(runDir, options)).status, 'complete');
  assert.equal(calls.filter(call => call.startsWith('Stalker dashboard ready')).length, 1);
  assert.equal(calls.filter(call => call === 'generate' || call === 'sync').length, 2);
});

test('a completed run fails closed when its custody ledger is missing or invalid', async t => {
  for (const corruption of ['missing', 'invalid']) await t.test(corruption, async t => {
    const {runDir, options, calls} = await setup(t);
    await writeFile(join(runDir, 'video.mp4'), 'raw original');
    options.archiveImpl = matchingArchive(calls);
    await completeRun(runDir, options);
    const completionPath = join(runDir, '.stalker-completion.json');
    const ledgerPath = join(runDir, '.stalker-media-retention.json');
    const completed = await readFile(completionPath, 'utf8');
    await assert.rejects(readFile(join(runDir, 'video.mp4')), {code: 'ENOENT'});
    if (corruption === 'missing') await rm(ledgerPath);
    else await writeFile(ledgerPath, '{invalid');
    const before = calls.filter(call => !call.startsWith('Stalker FAILED'));
    await assert.rejects(completeRun(runDir, options), /FAILED at stage 9/);
    assert.equal(await readFile(completionPath, 'utf8'), completed);
    assert.deepEqual(calls.filter(call => !call.startsWith('Stalker FAILED')), before);
    if (corruption === 'missing') await assert.rejects(readFile(ledgerPath), {code: 'ENOENT'});
    else assert.equal(await readFile(ledgerPath, 'utf8'), '{invalid');
    await assert.rejects(readFile(join(runDir, '.stage-complete-notify.done')));
  });
});

test('an obsolete digest cache is regenerated on a delivery retry', async t => {
  const { runDir, options, calls } = await setup(t);
  const notify = options.notifyImpl;
  options.notifyImpl = async () => { throw new Error('offline'); };
  await assert.rejects(completeRun(runDir, options));
  const path = join(runDir, '.stalker-digest.json');
  const cache = JSON.parse(await readFile(path, 'utf8'));
  cache.contractVersion = 2;
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
const target = process.argv[process.argv.indexOf('--output-last-message') + 1];
const curation = target.includes('curation');
if (!curation && !input.includes('Creators use AI privately')) process.exit(2);
writeFileSync(target, curation ? JSON.stringify({topicIndexes:[0,1,2],highlightIndexes:[0,1,2,3,4],claimIndexes:[0]}) : ${JSON.stringify(JSON.stringify(map))});
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
  const curation = JSON.parse(await readFile(join(runDir, '.digest-work/human-digest-curation.stdout.log')));
  assert.equal(curation.eventTypes['turn.completed'], 1);
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
  assert.ok(calls.includes('Stalker dashboard ready — theo 2026-09-08'));
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

test('legacy delivery receipts cannot skip the every-card clip rebuild', async t => {
  const {runDir,options,calls}=await setup(t);
  await completeRun(runDir,options);
  const path=join(runDir,'.stalker-completion.json');
  const receipt=JSON.parse(await readFile(path));receipt.version=1;await writeFile(path,JSON.stringify(receipt));
  assert.equal((await completeRun(runDir,options)).skipped,undefined);
  assert.equal(calls.filter(call=>call.startsWith('Stalker dashboard ready')).length,2);
});

test('a missing card clip fails publication before a completion notification', async t => {
  const {runDir,options,calls}=await setup(t);
  options.mediaImpl=async()=>{throw new Error('missing card clip');};
  await assert.rejects(completeRun(runDir,options),/FAILED at stage 7.*missing card clip/);
  assert.ok(!calls.some(call=>call.startsWith('Stalker dashboard ready')));
});

test('COMPLETE waits for stage 9 retention after a truthful dashboard-ready notification', async t => {
  const {runDir,options,calls}=await setup(t);
  await writeFile(join(runDir,'video.mp4'),'raw video');
  options.archiveImpl=matchingArchive(calls);
  assert.equal((await completeRun(runDir,options)).status,'complete');
  const ready=calls.findIndex(call=>call.startsWith('Stalker dashboard ready'));
  const archive=calls.findIndex(call=>call.startsWith('archive:'));
  assert.ok(ready>=0&&archive>ready);assert.ok(!calls.some(call=>call.startsWith('Stalker COMPLETE')));
  const completion=JSON.parse(await readFile(join(runDir,'.stalker-completion.json')));
  const retention=JSON.parse(await readFile(join(runDir,'.stalker-media-retention.json')));
  assert.equal(completion.version,3);assert.equal(retention.status,'complete');
  await assert.rejects(readFile(join(runDir,'video.mp4')),{code:'ENOENT'});
  await assert.rejects(readFile(join(runDir,'clips/clip-00m01s.mp4')),{code:'ENOENT'});
  assert.equal(await readFile(join(runDir,'card-media/clips/clip-0m1s.mp4'),'utf8'),'selected clip');
});

test('a stage 9 failure keeps COMPLETE open and retry reuses digest, publication and notification after video offload', async t => {
  const {runDir,options,calls}=await setup(t);
  await writeFile(join(runDir,'video.mp4'),'raw video');
  await writeFile(join(runDir,'zzz.wav'),'late failure');
  options.archiveImpl=matchingArchive(calls,'zzz.wav');
  await assert.rejects(completeRun(runDir,options),/FAILED at stage 9/);
  await assert.rejects(readFile(join(runDir,'video.mp4')),{code:'ENOENT'});
  await assert.rejects(readFile(join(runDir,'.stage-complete-notify.done')));
  assert.equal(JSON.parse(await readFile(join(runDir,'.stalker-failure.json'))).stage,9);
  assert.equal((await completeRun(runDir,options)).status,'complete');
  assert.equal(calls.filter(call=>call==='generate').length,1);
  assert.equal(calls.filter(call=>call==='sync').length,1);
  assert.equal(calls.filter(call=>call.startsWith('Stalker dashboard ready')).length,1);
});

test('a temporary live verification failure preserves notified delivery without repeating it', async t => {
  const {runDir,options,calls}=await setup(t);
  await writeFile(join(runDir,'video.mp4'),'raw video');
  await writeFile(join(runDir,'zzz.wav'),'late failure');
  options.archiveImpl=matchingArchive(calls,'zzz.wav');
  await assert.rejects(completeRun(runDir,options),/FAILED at stage 9/);
  const path=join(runDir,'.stalker-completion.json');
  const notified=await readFile(path,'utf8');
  const before={generate:calls.filter(call=>call==='generate').length,sync:calls.filter(call=>call==='sync').length,
    ready:calls.filter(call=>call.startsWith('Stalker dashboard ready')).length,archive:calls.filter(call=>call.startsWith('archive:')).length};
  options.fetchImpl=async()=>{throw new Error('temporary hub outage');};
  await assert.rejects(completeRun(runDir,options),/FAILED at stage 7.*temporary hub outage/);
  assert.equal(await readFile(path,'utf8'),notified);
  assert.deepEqual({generate:calls.filter(call=>call==='generate').length,sync:calls.filter(call=>call==='sync').length,
    ready:calls.filter(call=>call.startsWith('Stalker dashboard ready')).length,archive:calls.filter(call=>call.startsWith('archive:')).length},before);
  delete options.fetchImpl;
  assert.equal((await completeRun(runDir,options)).status,'complete');
  assert.equal(calls.filter(call=>call.startsWith('Stalker dashboard ready')).length,1);
});

test('a final live failure after resumed retention preserves the durable notified receipt', async t => {
  const {runDir,options,calls}=await setup(t);
  await writeFile(join(runDir,'video.mp4'),'raw video');
  await writeFile(join(runDir,'zzz.wav'),'late failure');
  const archive=matchingArchive(calls,'zzz.wav');let resumedRetention=false;
  options.archiveImpl=async expected=>{
    const result=await archive(expected);
    if(expected.relativePath==='zzz.wav') resumedRetention=true;
    return result;
  };
  await assert.rejects(completeRun(runDir,options),/FAILED at stage 9/);
  const path=join(runDir,'.stalker-completion.json');
  const notified=await readFile(path,'utf8');
  options.fetchImpl=(...args)=>{
    if(resumedRetention) throw new Error('final verification outage');
    return fetch(...args);
  };
  await assert.rejects(completeRun(runDir,options),/FAILED at stage 7.*final verification outage/);
  assert.equal(JSON.parse(await readFile(join(runDir,'.stalker-media-retention.json'))).status,'complete');
  assert.equal(await readFile(path,'utf8'),notified);
  assert.equal(calls.filter(call=>call==='generate').length,1);
  assert.equal(calls.filter(call=>call==='sync').length,1);
  assert.equal(calls.filter(call=>call.startsWith('Stalker dashboard ready')).length,1);
  delete options.fetchImpl;
  assert.equal((await completeRun(runDir,options)).status,'complete');
  assert.equal(calls.filter(call=>call.startsWith('Stalker dashboard ready')).length,1);
});

test('retention fails closed at stage 9 without an injected adapter or configured parent ID', async t => {
  const {runDir,options}=await setup(t);
  delete options.archiveImpl;
  await assert.rejects(completeRun(runDir,options),/FAILED at stage 9/);
  assert.equal(JSON.parse(await readFile(join(runDir,'.stalker-completion.json'))).status,'notified');
  await assert.rejects(readFile(join(runDir,'.stage-complete-notify.done')));
});


test('fixture media server rejects traversal outside its publication root', async t => {
  const { repoRoot, options } = await setup(t);
  await writeFile(join(repoRoot, 'fixture-private.txt'), 'private fixture sentinel');
  const origin = new URL(options.hubOrigin);
  const response = await new Promise((resolveResponse, reject) => {
    get({ hostname: origin.hostname, port: origin.port,
      path: '/dashboards/golems/stalker/evidence/../../../../fixture-private.txt' }, response => {
      let body = ''; response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolveResponse({ status: response.statusCode, body }));
    }).on('error', reject);
  });
  assert.equal(response.status, 404);
  assert.doesNotMatch(response.body, /private fixture sentinel/);
});
