import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const checker = resolve(process.env.BOUNDARY_PREPUSH_CHECKER ?? 'scripts/ci/boundary-prepush.mjs');
const corpus = JSON.parse(readFileSync(new URL('./fixtures/boundary-fleet-paths.json', import.meta.url)));
const safe = [
  'formal/voice-a' + 'sk-' + 'no-answer/results/run.json',
  '"source": "tests/voice-a' + 'sk-' + 'no-answer.test.ts#abcdefghij0123456789"',
  'task-' + '1234567890abcdefgh',
  'desk-' + '1234567890abcdefgh',
];
const credentials = [
  'sk-' + 'a'.repeat(40), 'ghp_' + 'b'.repeat(36),
  'github_pat_' + 'c'.repeat(60), 'xoxb-' + 'd'.repeat(40),
  'AKIA' + 'E'.repeat(16),
];
const cases = safe.map((text, i) => [`path lookalike ${i}`, text, false]);
for (const [i, token] of credentials.entries()) {
  for (const [j, prefix] of ['', ' ', '=', '"', ':', '/', '\t', '('].entries()) {
    cases.push([`credential ${i} delimiter ${j}`, prefix + token, true]);
  }
}
// Captured tracked paths and blob hashes only; no file contents or private prose.
assert.deepEqual([...new Set(corpus.map(row => row.repo))].sort(),
  ['brainlayer', 'golems', 'narrationlayer', 'skill-creator', 'voicelayer']);
for (const row of corpus) {
  assert.match(row.sha256, /^[a-f0-9]{64}$/);
  assert.ok(!row.path.startsWith('/') && !row.path.split('/').includes('..'));
  cases.push([`fleet ${row.repo}/${row.path}`, row.path + '\n' + JSON.stringify({ [row.path]: row.sha256 }), false]);
}
for (const [name, text, refuse] of cases) {
  test(name, () => {
    const root = mkdtempSync(join(tmpdir(), 'boundary-credentials-'));
    const git = (...args) => {
      const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      return r.stdout.trim();
    };
    try {
      git('init', '-q'); git('config', 'user.name', 'Fixture');
      git('config', 'user.email', 'fixture@example.com');
      git('commit', '--allow-empty', '-qm', 'base');
      const base = git('rev-parse', 'HEAD');
      writeFileSync(join(root, 'sample.txt'), text + '\n');
      git('add', 'sample.txt'); git('commit', '-qm', 'candidate');
      const head = git('rev-parse', 'HEAD');
      // The real scanner applies every forbidden class and every push pattern.
      const r = spawnSync(process.execPath, [checker], {
        cwd: root, encoding: 'utf8',
        input: `refs/heads/x ${head} refs/heads/x ${base}\n`,
      });
      assert.equal(r.status, refuse ? 1 : 0, r.stderr);
      assert.match(r.stderr, refuse ? /publication violation \(push-credentials\)/ : /PASS/);
      assert.ok(!r.stderr.includes(text), 'diagnostics must withhold content');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}
