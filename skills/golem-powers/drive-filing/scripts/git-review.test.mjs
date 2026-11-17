import {test,expect} from 'bun:test';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,renameSync,existsSync,statSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {homedir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {classify,verifyReports} from './classify.mjs';

const base=join(homedir(),'.local/state/golems/drive-scan-tests');mkdirSync(base,{recursive:true});
const value=['gh','p_','R'.repeat(36)].join('');
function git(repo,args,input) {
  const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('GIT_')));
  Object.assign(env,{GIT_CEILING_DIRECTORIES:dirname(repo),GIT_AUTHOR_NAME:'Fixture',GIT_AUTHOR_EMAIL:'f@example.invalid',GIT_COMMITTER_NAME:'Fixture',GIT_COMMITTER_EMAIL:'f@example.invalid'});
  const r=spawnSync('git',['-C',repo,'-c','gc.auto=0','-c','maintenance.auto=false',...args],{input,env,encoding:'utf8'});
  expect(r.status).toBe(0);return r.stdout.trim();
}
function fresh() {
  const dir=mkdtempSync(join(base,'review-')), repo=join(dir,'repo');mkdirSync(repo);
  git(repo,['init','-q','--template=']);writeFileSync(join(repo,'readme.txt'),'ordinary text');
  git(repo,['add','.']);git(repo,['commit','-qm','clean']);return {dir,repo};
}
function clone(repo,dir) {
  const target=join(dir,'clone');git(dir,['-c','pack.writeReverseIndex=false','clone','--no-local','-q','--template=',repo,target]);
  git(target,['-c','pack.writeReverseIndex=false','repack','-a']);return target;
}
function historyHold(repo) {
  const r=classify(repo);expect(r.status).toBe('HOLD');expect(r.reasons['git-history-match']).toBeGreaterThan(0);
  expect(r.gitHistory[0].error).toBeUndefined();
  expect(JSON.stringify(r)).not.toContain(value);return r;
}
test('a clean packed clone without unused binary sidecars clears, including its symbolic remote HEAD',()=>{
  const {dir,repo}=fresh(), r=classify(clone(repo,dir));
  expect(r.gitHistory[0].clean).toBe(true);expect(r.gitHistory[0].error).toBeUndefined();expect(r.status).toBe('CLEAR');
});
test('an unused reverse-index sidecar stays held as unknown binary',()=>{
  const {repo}=fresh();mkdirSync(join(repo,'.git/objects/pack'),{recursive:true});
  writeFileSync(join(repo,'.git/objects/pack','pack-'+'a'.repeat(40)+'.rev'),Buffer.from([0,1,2]));
  const r=classify(repo);expect(r.gitHistory[0].clean).toBe(true);expect(r.status).toBe('HOLD');expect(r.reasons['scan-unsupported-encoding']).toBe(1);
});
test('commit message in packed history holds',()=>{
  const {dir,repo}=fresh();git(repo,['commit','--allow-empty','-q','-F','-'],'deploy GITHUB_TOKEN='+value);
  const r=historyHold(clone(repo,dir));expect(r.gitHistory[0].matches.some(m=>m.type==='commit')).toBe(true);
});
test('annotated tag message in packed history holds',()=>{
  const {dir,repo}=fresh();git(repo,['tag','-a','v1','-F','-'],'tag '+value);
  const r=historyHold(clone(repo,dir));expect(r.gitHistory[0].matches.some(m=>m.type==='tag')).toBe(true);
});
test.each(['.netrc','.pgpass','id_ed25519.pub.bak','secrets/prod.yaml'])('history-only name holds: %s',name=>{
  const {dir,repo}=fresh();mkdirSync(dirname(join(repo,name)),{recursive:true});writeFileSync(join(repo,name),'ordinary text');
  git(repo,['add','-f','.']);git(repo,['commit','-qm','add']);git(repo,['rm','--cached','-q','--',name]);
  renameSync(join(repo,name),join(dir,'retained'));git(repo,['commit','-qm','remove']);
  expect(historyHold(clone(repo,dir)).gitHistory[0].matches.some(m=>m.path===name)).toBe(true);
});
test('unreachable trees and contextual full paths hold',()=>{
  const {repo}=fresh();const blob=git(repo,['hash-object','-w','--stdin'],'ordinary text');
  const tree=git(repo,['mktree'],`100644 blob ${blob}\tconfig.json\n`);
  git(repo,['mktree'],`040000 tree ${tree}\t.docker\n`);
  expect(historyHold(repo).gitHistory[0].matches.some(m=>m.path==='.docker/config.json')).toBe(true);
});
test('new credential-bearing commit invalidates a CLEAR receipt',()=>{
  const {dir,repo}=fresh(), saved=classify(repo);expect(saved.status).toBe('CLEAR');
  git(repo,['commit','--allow-empty','-q','-F','-'],'GITHUB_TOKEN='+value);
  expect(verifyReports([saved])).toBe(false);historyHold(clone(repo,dir));
});
test('PNG-headed deleted blob holds in history and trailing text holds in working tree',()=>{
  const {dir,repo}=fresh(), data=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),Buffer.from('\nGITHUB_TOKEN='+value)]);
  writeFileSync(join(repo,'image.png'),data);expect(classify(repo).status).toBe('HOLD');
  git(repo,['add','.']);git(repo,['commit','-qm','image']);git(repo,['rm','--cached','-q','--','image.png']);
  renameSync(join(repo,'image.png'),join(dir,'retained'));git(repo,['commit','-qm','remove']);historyHold(clone(repo,dir));
});
test.each(['index','objects/info/commit-graph','objects/pack/ignored.pack','objects/pack/pack-'+ 'a'.repeat(40)+'.pack'])('unvalidated Git storage stays held: %s',name=>{
  const {repo}=fresh();mkdirSync(dirname(join(repo,'.git',name)),{recursive:true});writeFileSync(join(repo,'.git',name),'GITHUB_TOKEN='+value);
  const r=classify(repo);expect(r.status).toBe('HOLD');
  if(name.startsWith('objects/pack/'))expect(r.gitHistory[0].error).toBe('git-history-error');
});
test.each(['commondir','gitdir','objects/info/alternates'])('Git redirects refuse: %s',name=>{
  const {repo}=fresh();mkdirSync(dirname(join(repo,'.git',name)),{recursive:true});writeFileSync(join(repo,'.git',name),'../other');
  expect(classify(repo).gitHistory[0].error).toBe('git-history-error');
});
test('HEAD-less .git never discovers a clean parent repository',()=>{
  const {repo}=fresh(), nested=join(repo,'nested');mkdirSync(join(nested,'.git'),{recursive:true});
  const r=classify(nested);expect(r.status).toBe('HOLD');expect(r.gitHistory[0].matches).toEqual([]);expect(r.gitHistory[0].error).toBe('git-history-error');
});
test('ext promisor cannot execute during history scan or path resolution',()=>{
  const {dir,repo}=fresh();writeFileSync(join(repo,'missing.txt'),'ordinary missing blob');
  git(repo,['add','.']);git(repo,['commit','-qm','missing']);
  const oid=git(repo,['rev-parse','HEAD:missing.txt']);renameSync(join(repo,'.git/objects',oid.slice(0,2),oid.slice(2)),join(dir,'retained-object'));
  const marker=join(dir,'EXECUTED');
  writeFileSync(join(repo,'.git/config'),readFileSync(join(repo,'.git/config'),'utf8')+`\n[extensions]\npartialClone=origin\n[remote "origin"]\npromisor=true\nurl=ext::sh -c touch% ${marker}\n[protocol "ext"]\nallow=always\n[core]\nfsmonitor=touch ${marker}\n`);
  const r=classify(repo);expect(r.status).toBe('HOLD');expect(existsSync(marker)).toBe(false);
});
test('forged and unkeyed receipt caches miss even with correct byte hashes',()=>{
  const {dir,repo}=fresh(), rd=join(dir,'receipts');classify(repo,{receiptDir:rd});
  const saved=JSON.parse(readFileSync(join(rd,'scan-cache.json'),'utf8'));
  const body='GITHUB_TOKEN='+value;writeFileSync(join(repo,'secret.txt'),body);const stat=statSync(join(repo,'secret.txt'));
  saved.entries['secret.txt']={size:stat.size,mtime:stat.mtimeMs,receipt:{shapes:[],bytes:stat.size,sha256:createHash('sha256').update(body).digest('hex')}};
  writeFileSync(join(rd,'scan-cache.json'),JSON.stringify(saved));
  const r=classify(repo,{receiptDir:rd});expect(r.status).toBe('HOLD');expect(r.cacheHits).toBe(0);
  expect(readFileSync(join(rd,'upload-manifest.tsv'),'utf8')).not.toContain('secret.txt');
  const unkeyed=JSON.parse(readFileSync(join(rd,'scan-cache.json'),'utf8'));delete unkeyed.hmac;
  writeFileSync(join(rd,'scan-cache.json'),JSON.stringify(unkeyed));expect(classify(repo,{receiptDir:rd}).cacheHits).toBe(0);
});
test.each([NaN,Infinity,0,-1,86_400_001])('nonfinite/invalid API budget refuses: %s',budgetMs=>expect(()=>classify(base,{budgetMs})).toThrow());
test.each([NaN,Infinity,0,33,1.5])('invalid API workers refuse: %s',workers=>expect(()=>classify(base,{workers})).toThrow());
test.each(['abc','NaN','Infinity'])('invalid CLI numeric flags refuse: %s',value=>{
  for(const flag of ['--budget-ms','--workers'])expect(spawnSync('node',[new URL('./classify.mjs',import.meta.url).pathname,flag,value,base]).status).toBe(1);
});
