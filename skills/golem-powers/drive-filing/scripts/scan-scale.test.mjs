import { test, expect } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, utimesSync, statSync, symlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { classify, verifyReports } from './classify.mjs';
import { fixture, join } from './rollup-test-parts/common.mjs';

test('cache rehashes raw bytes, resumes partial work, and manifests partition members', () => {
  const root=fixture({'plain.txt':'ordinary text', 'data.bin':Buffer.from([0,1,2]), 'notes.txt':'password='+['runtime','only','value'].join('')});
  const source=join(root,'docs.local'), receiptDir=join(root,'receipts');
  const first=classify(source,{receiptDir});
  expect(first.status).toBe('HOLD'); expect(first.cacheHits).toBe(0);
  const second=classify(source,{receiptDir}); expect(second.cacheHits).toBe(3);
  const manifest=readFileSync(join(receiptDir,'upload-manifest.tsv'),'utf8');
  const held=readFileSync(join(receiptDir,'held.tsv'),'utf8');
  expect(manifest.split('\n').filter(Boolean)).toHaveLength(2);
  expect(manifest).toContain('plain.txt'); expect(held).toContain('notes.txt'); expect(held).toContain('data.bin');
  expect(held+manifest+JSON.stringify(second)).not.toContain(['runtime','only','value'].join(''));
  expect(second.unsupportedEncoding).toContainEqual({extension:'.bin',magic:'unknown',count:1});
  const file=join(source,'plain.txt'), before=statSync(file);
  writeFileSync(file,'changed bytes');utimesSync(file,before.atime,before.mtime);
  expect(classify(source,{receiptDir}).cacheHits).toBe(2);
  const expired=classify(source,{receiptDir:join(root,'expired'),budgetMs:1});
  expect(expired.reasons['scan-run-time-limit']).toBeGreaterThan(0);
  expect(classify(source,{receiptDir:join(root,'expired')}).reasons['scan-run-time-limit']).toBeUndefined();
});

test('receipts cannot be written inside source, including through an ancestor symlink', () => {
  const root=fixture({'plain.txt':'ordinary text'}), source=join(root,'docs.local');
  expect(()=>classify(source,{receiptDir:join(source,'receipts')})).toThrow();
  symlinkSync(source,join(root,'redirect'));
  expect(()=>classify(source,{receiptDir:join(root,'redirect','receipts')})).toThrow();
  const receiptDir=join(root,'receipts');mkdirSync(receiptDir);
  symlinkSync(join(source,'plain.txt'),join(receiptDir,'upload-manifest.tsv'));
  expect(()=>classify(source,{receiptDir})).toThrow();
  expect(readFileSync(join(source,'plain.txt'),'utf8')).toBe('ordinary text');
});

test('clean Git internals clear; deleted and unreachable credential blobs hold and never print values', () => {
  const root=fixture({'repo/readme.txt':'ordinary text'}), repo=join(root,'docs.local/repo');
  const git=(...args)=>{const r=spawnSync('git',['-C',repo,...args],{encoding:'utf8'});expect(r.status).toBe(0);return r.stdout.trim();};
  git('init','--template=');git('config','user.email','fixture@example.invalid');git('config','user.name','Fixture');
  git('add','.');git('commit','-m','clean');
  const clean=classify(repo);expect(clean.status).toBe('CLEAR');expect(verifyReports([clean])).toBe(true);
  const value=['gh','p_', 'q'.repeat(36)].join('');
  writeFileSync(join(repo,'old.txt'),value);git('add','.');git('commit','-m','old blob');
  git('rm','old.txt');git('commit','-m','remove old blob');git('repack','-a');
  const held=classify(repo);expect(held.status).toBe('HOLD');expect(held.reasons['git-history-match']).toBeGreaterThan(0);
  expect(held.gitHistory[0].matches.some(m=>m.path==='old.txt')).toBe(true);
  expect(JSON.stringify(held)).not.toContain(value);
  // cat-file --batch-all-objects must also cover blobs without a reachable path.
  const other=fixture({'repo/readme.txt':'ordinary text'}), untracked=join(other,'docs.local/repo');
  expect(spawnSync('git',['-C',untracked,'init','--template=']).status).toBe(0);
  expect(spawnSync('git',['-C',untracked,'hash-object','-w','--stdin'],{input:value}).status).toBe(0);
  expect(classify(untracked).reasons['git-history-match']).toBeGreaterThan(0);
});

test('corrupt Git object fails closed', () => {
  const base=join(homedir(),'.local/state/golems/drive-scan-tests');mkdirSync(base,{recursive:true});
  const repo=mkdtempSync(join(base,'corrupt-'));
  const env={...process.env,GIT_CEILING_DIRECTORIES:dirname(repo)};
  expect(spawnSync('git',['-C',repo,'init','--template='],{env}).status).toBe(0);
  mkdirSync(join(repo,'.git/objects/aa'),{recursive:true});
  writeFileSync(join(repo,'.git/objects/aa', 'b'.repeat(38)),'corrupt');
  const corrupt=classify(repo);expect(corrupt.status).toBe('HOLD');
  expect(corrupt.gitHistory[0].error).toBe('git-history-error');
  expect(corrupt.gitHistory[0].matches).toEqual([]);
  const emptyRepo=mkdtempSync(join(base,'empty-'));
  mkdirSync(join(emptyRepo,'.git'));
  const empty=classify(emptyRepo);expect(empty.status).toBe('HOLD');
  expect(empty.gitHistory[0].error).toBe('git-history-error');
  expect(empty.gitHistory[0].matches).toEqual([]);
});

test('20k small members plus large text finish and reuse the cache', () => {
  const root=fixture({}), source=join(root,'docs.local'), receiptDir=join(root,'receipts');
  mkdirSync(source,{recursive:true});
  for(let i=0;i<20000;i++) writeFileSync(join(source,`${i}.txt`),'ordinary text\n');
  for(let i=0;i<3;i++) writeFileSync(join(source,`large${i}.txt`),Buffer.alloc(8*1024*1024,32));
  const first=classify(source,{receiptDir}), second=classify(source,{receiptDir});
  expect(first.status).toBe('CLEAR');expect(first.files).toBe(20003);expect(first.elapsedMs).toBeLessThan(first.budgetMs);
  expect(second.status).toBe('CLEAR');expect(second.cacheHits).toBe(20003);
},30000);
