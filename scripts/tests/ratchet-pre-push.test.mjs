import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, readFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const head = 'a'.repeat(40), base = 'b'.repeat(40), old = 'c'.repeat(40);
function fixture(check) {
  mkdirSync(resolve('docs.local/n4-tests'), { recursive: true });
  const dir = mkdtempSync(resolve('docs.local/n4-tests/push-'));
  try {
    for (const path of ['.githooks', 'scripts/ratchet', 'scripts/hooks', 'bin']) mkdirSync(join(dir, path), { recursive: true });
    for (const path of ['.githooks/pre-push', 'scripts/ratchet/pre-push.mjs', 'scripts/ratchet/run-rows.mjs',
      'scripts/ratchet/table.mjs', 'scripts/ratchet/guarded-paths.sh', 'scripts/hooks/machine-host.mjs']) {
      copyFileSync(resolve(path), join(dir, path));
    }
    const rows = { schema: 1, rows: [
      { id: 'fixture-ci', metric: 'fixture', kind: 'unit', runner: 'ci', direction: 'pass', ceiling: true, command: 'test "$ROW_FAIL" != 1' },
      { id: 'live-tier-freshness', metric: 'freshness', kind: 'unit', runner: 'ci', direction: 'pass', ceiling: true, command: 'false' },
    ] };
    writeFileSync(join(dir, 'scripts/ratchet/rows.json'), JSON.stringify(rows));
    writeFileSync(join(dir, 'scripts/ratchet/local-run.sh'), '#!/bin/bash\necho "mac $*" >> "$CALL_LOG"\nexit "${MAC_FAIL:-0}"\n');
    const fake = `#!/usr/bin/env node
const fs=require('fs'), a=process.argv.slice(2), e=process.env, name=require('path').basename(process.argv[1]);
fs.appendFileSync(e.CALL_LOG, name+' '+a.join(' ')+'\\n');
if(name==='bun') process.exit(Number(e.SUITE_FAIL||0));
if(name==='scutil') { console.log(e.HOST_NAME||'Locals-MacBook-Pro'); process.exit(0); }
if(name==='gh') {
  if(e.NO_PR) process.exit(1);
  console.log(JSON.stringify({number:42,headRefName:'fixture',headRefOid:'${old}',state:'OPEN',body:''})); process.exit(0);
}
if(name==='git') {
  if(a[0]==='-C') a.splice(0,2);
  if(a[0]==='worktree') {
    if(a[1]==='add') { fs.mkdirSync(a[3],{recursive:true}); fs.cpSync(e.SCRIPTS_ROOT,a[3]+'/scripts',{recursive:true}); }
    else { if(e.CLEANUP_FAIL) process.exit(1); fs.rmSync(a[2],{recursive:true}); }
    process.exit(0);
  }
  if(a[0]==='diff') { if(e.DIFF_ERROR) process.exit(2); console.log(e.UNGUARDED?'README.md':'scripts/ratchet/example'); }
  else if(a[0]==='show') console.log(fs.readFileSync(e.ROWS_FILE,'utf8'));
  else if(a[0]==='rev-parse' && a.includes('--local-env-vars')) {}
  else if(a[0]==='rev-parse') console.log(a.some(x=>x.includes('origin/master'))?'${base}':'${head}');
  else if(a[0]==='status') {}
  else if(a[0]!=='cat-file') process.exit(8);
}
`;
    for (const name of ['git', 'gh', 'bun', 'scutil', 'chflags']) writeFileSync(join(dir, 'bin', name), fake, { mode: 0o755 });
    const log = join(dir, 'calls');
    const run = (extra = {}, input = `refs/heads/fixture ${head} refs/heads/fixture ${old}\n`) => {
      writeFileSync(log, '');
      const result = spawnSync('bash', ['.githooks/pre-push'], { cwd: dir, input, encoding: 'utf8',
        env: { ...process.env, HOME: dir, PATH: join(dir, 'bin') + ':' + process.env.PATH,
          CALL_LOG: log, ROWS_FILE: join(dir, 'scripts/ratchet/rows.json'), SCRIPTS_ROOT: join(dir, 'scripts'), ...extra } });
      return { ...result, output: result.stdout + result.stderr, calls: readFileSync(log, 'utf8') };
    };
    check(run, dir);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('unguarded push runs package suite without ratchet rows', () => fixture(run => {
  const r = run({ UNGUARDED: '1' });
  expect(r.status).toBe(0); expect(r.calls).toContain('bun --no-env-file run test');
  expect(r.output).not.toContain('fixture-ci'); expect(r.calls).not.toContain('mac --pr');
}));
test('guarded CI failure blocks with row and command; freshness alone is informational', () => fixture(run => {
  const r = run({ ROW_FAIL: '1' });
  expect(r.status).toBe(1); expect(r.output).toContain('fixture-ci');
  expect(r.output).toContain('test "$ROW_FAIL" != 1'); expect(r.calls).not.toContain('mac --pr');
  const info = run(); expect(info.status).toBe(0); expect(info.output).toContain('live-tier-freshness');
  expect(info.output).toContain('informational'); expect(info.output).toContain('Mac rows not run here');
}));
test('M4 open PR gets exact pending SHA; Mac failure blocks; no PR continues', () => fixture(run => {
  const r = run({ HOST_NAME: 'MacBook-Pro' });
  expect(r.status).toBe(0); expect(r.calls).toContain(`mac --pr 42 --head ${head}`);
  expect(run({ HOST_NAME: 'MacBook-Pro' }, `HEAD ${head} refs/heads/fixture ${old}\n`).calls).toContain(`mac --pr 42 --head ${head}`);
  expect(run({ HOST_NAME: 'MacBook-Pro', MAC_FAIL: '1' }).status).toBe(1);
  const no = run({ HOST_NAME: 'MacBook-Pro', NO_PR: '1' });
  expect(no.status).toBe(0); expect(no.output).toContain('no open PR'); expect(no.calls).not.toContain('mac --pr');
}));
test('Mac escape hatch is loud and uses the existing bypass ledger; CI still blocks', () => fixture((run, dir) => {
  const r = run({ HOST_NAME: 'MacBook-Pro', GOLEMS_PREPUSH_RATCHET: '0' });
  expect(r.status).toBe(0); expect(r.output).toContain('WARNING'); expect(r.calls).not.toContain('mac --pr');
  const entry = JSON.parse(readFileSync(join(dir, '.claude/logs/tmp-block-ledger.jsonl'), 'utf8').trim());
  expect(entry.hatch).toBe('GOLEMS_PREPUSH_RATCHET=0');
  expect(run({ ROW_FAIL: '1', GOLEMS_PREPUSH_RATCHET: '0' }).status).toBe(1);
}));
test('suite or diff errors block; deleted refs are ignored; every pushed ref is inspected', () => fixture(run => {
  expect(run({ SUITE_FAIL: '7' }).status).toBe(7);
  expect(run({ DIFF_ERROR: '1' }).status).toBe(1);
  const deleted = `refs/heads/gone ${'0'.repeat(40)} refs/heads/gone ${old}\n`;
  expect(run({}, deleted).status).toBe(0);
  const r = run({}, deleted + `refs/heads/fixture ${head} refs/heads/fixture ${old}\n`);
  expect(r.status).toBe(0); expect(r.calls).toContain(`diff --name-only ${base}...${head}`);
}));
test('one queued job preserves stdin refs after the queue consumes them', () => fixture((run, dir) => {
  const helper = join(dir, 'Gits/golems/.worktrees/hooks-live/scripts/hooks');
  mkdirSync(helper, { recursive: true });
  writeFileSync(join(helper, 'heavy-suite.py'), `import os, subprocess, sys
with open(os.environ['CALL_LOG'], 'a') as f: f.write('queue ' + sys.stdin.read())
sys.exit(subprocess.call(sys.argv[2:]))
`);
  const r = run({ HOST_NAME: 'MacBook-Pro' });
  expect(r.status).toBe(0); expect(r.calls).toContain(`queue refs/heads/fixture ${head}`);
  expect(r.calls).toContain(`mac --pr 42 --head ${head}`);
}));
test('multiple live refs measure each candidate, isolating another SHA from the current checkout', () => fixture(run => {
  const other = 'd'.repeat(40);
  const r = run({}, `refs/heads/fixture ${head} refs/heads/fixture ${old}\nrefs/heads/other ${other} refs/heads/other ${old}\n`);
  expect(r.status).toBe(0); expect(r.calls).toContain(`diff --name-only ${base}...${other}`);
  expect(r.calls).toContain(`worktree add --detach`); expect(r.calls).toContain('worktree remove');
  expect(r.calls).toContain('bun install --frozen-lockfile --ignore-scripts');
  const failed = run({ ROW_FAIL: '1', CLEANUP_FAIL: '1' }, `refs/heads/other ${other} refs/heads/other ${old}\n`);
  expect(failed.status).toBe(1); expect(failed.output).toContain('CI ratchet failed before push');
  expect(failed.output).toContain('cleanup failed; retained');
}));
