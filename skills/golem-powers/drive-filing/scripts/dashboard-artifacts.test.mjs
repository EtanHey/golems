import { test, expect } from 'bun:test';
import { gzipSync } from 'node:zlib';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { scanData } from './scan-content.mjs';
import { fixture, join, dirname, spawnSync } from './rollup-test-parts/common.mjs';

const id = '0600-2026-11-17';
const archive = `dashboards/runtime-20261104/archive-${id}/${id}`;
// The complete minified expression exceeds the generic rule's eight-byte bound.
const code = '<script>function next(){token=++n;return(n)}</script>';
const classify = (repo, path) => {
  const result = spawnSync('node', [new URL('./classify.mjs', import.meta.url).pathname,
    join(repo, 'docs.local', path)], { encoding: 'utf8' });
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout)[0];
};

test.each(['page.html', 'clips.json'])('generated archive %s clears through the real classifier', name => {
  const text = name === 'page.html' ? code : JSON.stringify({ catalogSource: 'const token=process.env.OPENAI_API_KEY;' });
  const repo = fixture({ [`${archive}/${name}`]: text });
  expect(classify(repo, archive).status).toBe('CLEAR');
});

test('only the exact archive member shape receives the exception', () => {
  const paths = [
    'page.html', 'other/page.html', `${archive}/other.html`, `${archive}/answers.json`,
    `${archive}/nested/page.html`, `${archive}/page.html.bak`,
    archive.replace('/runtime-20261104/', '/runtime-latest/') + '/page.html',
    archive.replace(`/archive-${id}/`, '/archive-unrelated/') + '/page.html',
    archive.replace(`/${id}`, '/2300-2026-11-17') + '/page.html',
  ];
  const repo = fixture(Object.fromEntries(paths.map(path => [path, code])));
  const report = classify(repo, '.');
  expect(report.heldMembers).toBe(paths.length);
  expect(report.reasons['generic-assignment']).toBe(paths.length);
});

test('specific detectors still hold both allowed artifact names', async () => {
  const values = [
    ['openai', ['sk-', 'proj-', 'A'.repeat(24)].join('')],
    ['anthropic', ['sk-', 'ant-', 'synthetic'].join('')],
    ['google-oauth', ['ya29', '.synthetic'].join('')],
    ['private-key', ['-----BEGIN ', 'PRIVATE KEY-----'].join('')],
    ['credential-json-key', JSON.stringify({ access_token: 'synthetic' })],
  ];
  for (const name of ['page.html', 'clips.json']) {
    for (const [rule, value] of values) {
      const repo = fixture({ [`${archive}/${name}`]: `${code}\n${value}` });
      const report = classify(repo, archive);
      expect(report.status).toBe('HOLD');
      expect(report.reasons[rule]).toBe(1);
    }
  }
});

test('history, compressed bytes and media retain generic scanning', async () => {
  const path = `/repo/docs.local/${archive}/page.html`;
  expect((await scanData(Buffer.from(code), path, { history: true })).shapes).toContain('generic-assignment');
  expect((await scanData(gzipSync(code), path)).shapes).toContain('generic-assignment');
  expect((await scanData(Buffer.from('GIF89a' + code), path)).shapes).toContain('generic-assignment');
});

test('the observed tonight archive suffix has the same exact member contract', () => {
  const path = archive.replace(`/archive-${id}/`, `/archive-${id}-tonight/`);
  const repo = fixture({ [`${path}/page.html`]: code });
  expect(classify(repo, path).status).toBe('CLEAR');
});

for (const name of ['page.html', 'clips.json']) {
  test.each(['file root', 'descendant directory'])('symlinked archive ancestor holds ' + name + ' via %s', entry => {
    const repo = fixture({});
    const outside = join(repo, 'outside');
    const target = join(outside, id, name);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, 'password=synthetic-review-only-value');
    const alias = join(repo, 'docs.local', dirname(archive));
    mkdirSync(dirname(alias), { recursive: true });
    symlinkSync(outside, alias, 'dir');

    // The canonical outside path and both alias entry points must agree.
    const canonical = classify(repo, `../outside/${id}/${name}`);
    expect(canonical.status).toBe('HOLD');
    expect(canonical.reasons['generic-assignment']).toBe(1);
    const report = classify(repo, entry === 'file root' ? `${archive}/${name}` : archive);
    expect(report.status).toBe('HOLD');
    expect(report.reasons['generic-assignment']).toBe(1);
  });
}
