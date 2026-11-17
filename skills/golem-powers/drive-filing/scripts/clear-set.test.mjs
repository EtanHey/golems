import { test, expect } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, symlinkSync, renameSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
const script = resolve(import.meta.dir, 'classify.mjs');
const scratch = resolve(import.meta.dir, '../../../../docs.local/w212');
mkdirSync(scratch, {recursive:true});
const run = (...args) => spawnSync('node', [script, ...args], {encoding:'utf8'});
function fixture() {
  const base=mkdtempSync(join(scratch,'case-')), source=join(base,'source'), receipts=join(base,'receipts');
  mkdirSync(source); mkdirSync(join(source,'nested'));
  for(const name of ['a.txt','nested/b.txt','tab\tline\n.txt']) writeFileSync(join(source,name),'ordinary text');
  writeFileSync(join(source,'.env'),'held');
  expect(run('--receipt-dir',receipts,source).status).toBe(0);
  return {base,source,receipt:join(receipts,'receipt.json'),manifest:join(receipts,'upload-manifest.tsv'),tar:join(base,'archive.tar')};
}
test('partial receipt verifies only its exact saved CLEAR set; additions remain unarchived', () => {
  const f=fixture();
  expect(run('--verify',f.receipt).status).toBe(1);
  expect(run('--verify','--clear-set',f.receipt).status).toBe(0);
  expect(run('--verify','--clear-set',f.receipt,'--manifest',f.manifest).status).toBe(0);
  writeFileSync(join(f.source,'new.txt'),'new');
  expect(run('--verify','--clear-set',f.receipt).stdout).toContain('new-unarchived:1');
  writeFileSync(join(f.source,'a.txt'),'changed');
  expect(run('--verify','--clear-set',f.receipt).stderr).toContain('clear-set-member-mismatch');
});
test('new credential, missing member, forged/duplicate manifest, and changed policy fail closed', () => {
  const f=fixture(), original=readFileSync(f.manifest,'utf8');
  writeFileSync(join(f.source,'a.txt'),['gh','p_', 'q'.repeat(36)].join(''));
  expect(run('--verify','--clear-set',f.receipt).stderr).toContain('clear-set-member-held');
  renameSync(join(f.source,'a.txt'),join(f.source,'gone.txt'));
  expect(run('--verify','--clear-set',f.receipt).status).toBe(1);
  writeFileSync(f.manifest,original+'".env"\t4\t'+'0'.repeat(64)+'\n');
  expect(run('--verify','--clear-set',f.receipt).stderr).toContain('clear-set-manifest-mismatch');
  writeFileSync(f.manifest,original+original.split('\n')[1]+'\n');
  expect(run('--verify','--clear-set',f.receipt).status).toBe(1);
  writeFileSync(f.manifest,original.split('\n').slice(0,-2).join('\n')+'\n');
  expect(run('--verify','--clear-set',f.receipt).stderr).toContain('clear-set-manifest-mismatch');
  writeFileSync(f.manifest,original);
  const saved=JSON.parse(readFileSync(f.receipt)); saved[0].policy='0'.repeat(64);writeFileSync(f.receipt,JSON.stringify(saved));
  expect(run('--verify','--clear-set',f.receipt).stderr).toContain('clear-set-policy-mismatch');
});
test('stage and verify exact bytes; reject extra entries, changed bytes and symlinks', () => {
  const f=fixture();
  expect(run('--stage-clear-set',f.receipt,f.manifest,f.tar).status).toBe(0);
  expect(run('--verify-tar',f.receipt,f.manifest,f.tar).status).toBe(0);
  // A real tar client must read the emitted USTAR bytes, including unusual paths.
  expect(spawnSync('tar',['-xOf',f.tar,'nested/b.txt'],{encoding:'utf8'}).stdout).toBe('ordinary text');
  const bytes=readFileSync(f.tar), changed=Buffer.from(bytes); changed[512]^=1;
  writeFileSync(join(f.base,'changed.tar'),changed);
  expect(run('--verify-tar',f.receipt,f.manifest,join(f.base,'changed.tar')).status).toBe(1);
  writeFileSync(join(f.base,'extra.tar'),Buffer.concat([bytes.subarray(0,-1024),bytes]));
  expect(run('--verify-tar',f.receipt,f.manifest,join(f.base,'extra.tar')).status).toBe(1);
  // Recompute header checksum after turning a regular entry into a symlink.
  const link=Buffer.from(bytes);link[156]=50;link.fill(32,148,156);
  const sum=link.subarray(0,512).reduce((n,b)=>n+b,0);link.write(sum.toString(8).padStart(6,'0')+'\0 ',148);
  writeFileSync(join(f.base,'link.tar'),link);
  expect(run('--verify-tar',f.receipt,f.manifest,join(f.base,'link.tar')).status).toBe(1);
  renameSync(join(f.source,'a.txt'),join(f.source,'old.txt'));symlinkSync('old.txt',join(f.source,'a.txt'));
  expect(run('--stage-clear-set',f.receipt,f.manifest,join(f.base,'refused.tar')).status).toBe(1);
});
