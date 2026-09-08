import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { MAX_LOCAL_MEDIA_BYTES, retainRunMedia, verifyLocalMediaRetention,
  verifyRunMediaRetention } from '../stalker-media-retention.mjs';
async function fixture(t, name) {
  const root = join(import.meta.dirname, `.retention-${process.pid}-${name}`);
  await rm(root, { recursive: true, force: true });
  t.after(() => rm(root, { recursive: true, force: true }));
  const runDir = join(root, 'theo-2026-09-08-030512');
  await mkdir(runDir, { recursive: true });
  return { root, runDir };
}
function matchingArchive(calls = []) {
  return async expected => {
    calls.push(expected);
    return {
      id: `drive-${expected.relativePath}`,
      path: `04_MEDIA/stalker/${expected.runName}/${expected.relativePath}`,
      url: `https://drive.example/${expected.relativePath}`,
      size: expected.size,
      sha256: expected.sha256,
      md5: 'remote-md5',
    };
  };
}
test('fails closed without an adapter and preserves a file on remote mismatch', async t => {
  const { runDir } = await fixture(t, 'adapter');
  await writeFile(join(runDir, 'video.mp4'), 'video');
  await assert.rejects(retainRunMedia({ runDir }), /archiveImpl.*required/);
  await assert.rejects(retainRunMedia({
    runDir,
    archiveImpl: async expected => ({ id: 'wrong', path: 'remote/video.mp4', size: expected.size, sha256: '0'.repeat(64) }),
  }), /remote size\/hash mismatch/);
  assert.equal(await readFile(join(runDir, 'video.mp4'), 'utf8'), 'video');
});
test('rechecks source identity immediately before unlink', async t => {
  const { runDir } = await fixture(t, 'mutation');
  const path = join(runDir, 'full-audio.wav');
  await writeFile(path, 'audio');
  await assert.rejects(retainRunMedia({
    runDir,
    archiveImpl: async expected => {
      await writeFile(path, 'changed-after-upload');
      return matchingArchive()(expected);
    },
  }), /source changed/);
  assert.equal(await readFile(path, 'utf8'), 'changed-after-upload');
});
test('resumes after unlink-before-checkpoint and stays idempotent', async t => {
  const { runDir } = await fixture(t, 'resume');
  const path = join(runDir, 'video.ts');
  await writeFile(path, 'transport');
  const calls = [];
  const archiveImpl = matchingArchive(calls);
  await assert.rejects(retainRunMedia({
    runDir,
    archiveImpl,
    unlinkImpl: async target => {
      await rm(target);
      throw new Error('simulated crash after unlink');
    },
  }), /simulated crash/);
  const interrupted = JSON.parse(await readFile(join(runDir, '.stalker-media-retention.json')));
  assert.equal(interrupted.files[0].state, 'verified');
  const resumed = await retainRunMedia({ runDir, archiveImpl });
  assert.equal(resumed.status, 'complete');
  assert.equal(resumed.files[0].state, 'deleted');
  await assert.rejects(readFile(path), { code: 'ENOENT' });
  await writeFile(join(runDir, 'post-offload-notes.md'), 'must remain recoverable');
  const repeated = await retainRunMedia({ runDir, archiveImpl });
  assert.equal(repeated.status, 'complete');
  assert.equal(repeated.files.length, 1);
  const local = await verifyLocalMediaRetention({ runDir });
  assert.equal(local.verification, 'local-receipt-only');
  assert.equal(await readFile(join(runDir, 'post-offload-notes.md'), 'utf8'), 'must remain recoverable');
  const validReceipt = await readFile(join(runDir, '.stalker-media-retention.json'), 'utf8');
  const tampered = JSON.parse(validReceipt);
  tampered.files[0].remote.sha256 = '0'.repeat(64);
  await writeFile(join(runDir, '.stalker-media-retention.json'), JSON.stringify(tampered));
  await assert.rejects(verifyLocalMediaRetention({ runDir }), /remote size\/hash mismatch/);
  await writeFile(join(runDir, '.stalker-media-retention.json'), validReceipt);
  await writeFile(join(runDir, 'late.wav'), 'untracked');
  await assert.rejects(verifyLocalMediaRetention({ runDir }), /untracked local media/);
  await rm(join(runDir, 'late.wav'));
  assert.equal((await verifyRunMediaRetention({ runDir, archiveImpl })).verification, 'remote-fresh');
  assert.ok(calls.length >= 4, 'resume, repeat, and verification must refresh remote metadata');
});
test('preserves permanent text plus dashboard and caller-selected media', async t => {
  const { runDir } = await fixture(t, 'preserve');
  await mkdir(join(runDir, 'clips'), { recursive: true });
  await mkdir(join(runDir, 'frames'), { recursive: true });
  await writeFile(join(runDir, 'video.mp4'), 'raw');
  await writeFile(join(runDir, 'clips/selected.mp4'), 'selected');
  await writeFile(join(runDir, 'clips/README'), 'permanent clip notes');
  await writeFile(join(runDir, 'frames/keep.jpg'), 'frame');
  await writeFile(join(runDir, 'transcript.md'), 'forever');
  await writeFile(join(runDir, 'chat.log'), 'forever');
  await writeFile(join(runDir, 'signals.json'), '{}');
  await writeFile(join(runDir, 'dashboard.html'), '<video src="evidence/theo-2026-09-08-030512/revision/clips/selected.mp4"></video>');
  const calls = [];
  const receipt = await retainRunMedia({ runDir, archiveImpl: matchingArchive(calls), keepPaths: ['frames/keep.jpg'] });
  await assert.rejects(readFile(join(runDir, 'video.mp4')), { code: 'ENOENT' });
  assert.equal(await readFile(join(runDir, 'clips/selected.mp4'), 'utf8'), 'selected');
  assert.equal(await readFile(join(runDir, 'frames/keep.jpg'), 'utf8'), 'frame');
  assert.equal(await readFile(join(runDir, 'clips/README'), 'utf8'), 'permanent clip notes');
  assert.ok(!calls.some(call => call.relativePath === 'clips/README'));
  for (const file of ['transcript.md', 'chat.log', 'signals.json', 'dashboard.html']) assert.ok(await readFile(join(runDir, file)));
  assert.deepEqual(receipt.totals, { beforeBytes: 16, afterBytes: 13, freedBytes: 3 });
});
test('matches exact dashboard asset identities without retaining suffix collisions', async t => {
  const { runDir } = await fixture(t, 'reference-identity');
  const runName = 'theo-2026-09-08-030512';
  const rawCollision = 'clips/clip-105m41s.mp4';
  const publishedV2 = 'card-media-v2/clips/clip-105m41s.mp4';
  const directReference = 'frames/direct.jpg';
  const hrefReference = 'clips/direct-link.mp4';
  const callerSelected = 'clips/caller-selected.mp4';
  const visibleTextOnly = 'clips/visible-only.mp4';
  for (const [relativePath, content] of [
    [rawCollision, 'raw-collision'],
    [publishedV2, 'published-v2'],
    [directReference, 'direct-reference'],
    [hrefReference, 'href-reference'],
    [callerSelected, 'caller-selected'],
    [visibleTextOnly, 'visible-text-only'],
  ]) {
    await mkdir(join(runDir, relativePath, '..'), { recursive: true });
    await writeFile(join(runDir, relativePath), content);
  }
  await writeFile(join(runDir, 'dashboard.html'), [
    `<video src="evidence/${runName}/revision-1/${publishedV2}?download=1#t=5" poster="./${directReference}#poster"></video>`,
    `<a href="./${hrefReference}?download=1">download</a>`,
    `<div title='download href="${visibleTextOnly}"'>${visibleTextOnly}</div>`,
  ].join('\n'));

  const receipt = await retainRunMedia({
    runDir,
    archiveImpl: matchingArchive(),
    keepPaths: [callerSelected],
  });

  await assert.rejects(readFile(join(runDir, rawCollision)), { code: 'ENOENT' });
  await assert.rejects(readFile(join(runDir, visibleTextOnly)), { code: 'ENOENT' });
  assert.equal(await readFile(join(runDir, publishedV2), 'utf8'), 'published-v2');
  assert.equal(await readFile(join(runDir, directReference), 'utf8'), 'direct-reference');
  assert.equal(await readFile(join(runDir, hrefReference), 'utf8'), 'href-reference');
  assert.equal(await readFile(join(runDir, callerSelected), 'utf8'), 'caller-selected');
  assert.equal(receipt.files.find(file => file.relativePath === rawCollision).state, 'deleted');
  assert.equal(receipt.files.find(file => file.relativePath === publishedV2).keepReason, 'run-dashboard-reference');
  assert.equal(receipt.files.find(file => file.relativePath === callerSelected).keepReason, 'caller-selected');
  assert.equal((await verifyLocalMediaRetention({ runDir })).verification, 'local-receipt-only');
});
test('preserves a real media link after quoted delimiters in an earlier attribute', async t => {
  const { runDir } = await fixture(t, 'quoted-delimiters');
  await mkdir(join(runDir, 'clips'));
  await writeFile(join(runDir, 'clips/selected.mp4'), 'selected');
  await writeFile(join(runDir, 'dashboard.html'), '<video title="a > b < c" src="clips/selected.mp4"></video>');
  await retainRunMedia({ runDir, archiveImpl: matchingArchive() });
  assert.equal(await readFile(join(runDir, 'clips/selected.mp4'), 'utf8'), 'selected');
  assert.equal((await verifyLocalMediaRetention({ runDir })).verification, 'local-receipt-only');
});
test('a stray slash before a real media attribute cannot hang retention', async t => {
  const { runDir } = await fixture(t, 'stray-slash');
  await mkdir(join(runDir, 'clips'));
  await writeFile(join(runDir, 'clips/selected.mp4'), 'selected');
  await writeFile(join(runDir, 'dashboard.html'), '<video / src="clips/selected.mp4"></video>');
  const moduleUrl = new URL('../stalker-media-retention.mjs', import.meta.url).href;
  const code = [
    'import { retainRunMedia, verifyLocalMediaRetention } from ' + JSON.stringify(moduleUrl) + ';',
    'const runDir = process.argv[1];',
    'await retainRunMedia({ runDir, archiveImpl: async file => ({ id: "fixture-drive", path: "archive/" + file.relativePath, size: file.size, sha256: file.sha256 }) });',
    'await verifyLocalMediaRetention({ runDir });',
  ].join('\n');
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', code, runDir], {
    encoding: 'utf8', timeout: 5_000,
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await readFile(join(runDir, 'clips/selected.mp4'), 'utf8'), 'selected');
});
test('HTML character references resolve to the actual retained media filename', async t => {
  const { runDir } = await fixture(t, 'html-entities');
  const references = [
    ['clips/a&b.mp4', 'clips/a&amp;b.mp4'],
    ['clips/c&d.mp4', 'clips/c&#38;d.mp4'],
    ['clips/e&f.mp4', 'clips/e&#x26;f.mp4'],
    ['clips/copyright©.mp4', 'clips/copyright&copy;.mp4'],
    ['clips/selected.mp4', 'clips/selected.mp4&#63;download=1&amp;x=2'],
  ];
  await mkdir(join(runDir, 'clips'));
  for (const [path] of references) await writeFile(join(runDir, path), path);
  await writeFile(join(runDir, 'dashboard.html'), references.map(([, value]) => `<video src="${value}"></video>`).join('\n'));
  const receipt = await retainRunMedia({ runDir, archiveImpl: matchingArchive() });
  assert.equal(receipt.files.filter(file => file.state === 'retained').length, references.length);
  for (const [path] of references) assert.equal(await readFile(join(runDir, path), 'utf8'), path);
  assert.equal((await verifyLocalMediaRetention({ runDir })).verification, 'local-receipt-only');
});
test('caller-proven published dashboard media can be removed and remains idempotent', async t => {
  const { runDir } = await fixture(t, 'published');
  await mkdir(join(runDir, 'clips'), { recursive: true });
  await writeFile(join(runDir, 'clips/selected.mp4'), 'selected');
  await writeFile(join(runDir, 'dashboard.html'), '<video src="clips/selected.mp4"></video>');
  const options = { runDir, archiveImpl: matchingArchive(), publishedCopyPaths: ['clips/selected.mp4'] };
  const receipt = await retainRunMedia(options); assert.equal(receipt.files[0].state, 'deleted');
  assert.equal(receipt.files[0].publishedCopyProven, true);
  assert.equal((await retainRunMedia(options)).status, 'complete');
});
test('enforces the 2 GB default cap using an injectable small-boundary fixture', async t => {
  assert.equal(MAX_LOCAL_MEDIA_BYTES, 2_000_000_000);
  const { runDir } = await fixture(t, 'cap');
  await writeFile(join(runDir, 'video.mp4'), 'three');
  await assert.rejects(retainRunMedia({
    runDir,
    archiveImpl: matchingArchive(),
    keepPaths: ['video.mp4'],
    maxRemainingBytes: 4,
  }), /remaining media.*exceeds/);
  const receipt = JSON.parse(await readFile(join(runDir, '.stalker-media-retention.json')));
  assert.notEqual(receipt.status, 'complete');
});
test('refuses symlinks without traversing or deleting their targets', async t => {
  const { root, runDir } = await fixture(t, 'symlink');
  const outside = join(root, 'outside.mp4');
  await writeFile(outside, 'outside');
  await symlink(outside, join(runDir, 'video.mp4'));
  await assert.rejects(retainRunMedia({ runDir, archiveImpl: matchingArchive() }), /symlink/);
  assert.equal(await readFile(outside, 'utf8'), 'outside');
});

test('retention APIs require an explicit run directory before scanning cwd', async t => {
  const { runDir } = await fixture(t, 'required-directory');
  const previousCwd = process.cwd();
  process.chdir(runDir);
  try {
    for (const implementation of [retainRunMedia, verifyLocalMediaRetention, verifyRunMediaRetention]) {
      for (const missing of [undefined, null, '', '  ']) {
        await assert.rejects(implementation({ runDir: missing, archiveImpl: async () => assert.fail('must not archive cwd') }), /runDir is required/);
      }
    }
  } finally { process.chdir(previousCwd); }
});
