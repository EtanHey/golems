import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { ageTree, mockGh, rawPR } from './worktree-fixtures.mjs';
const cli = path.resolve('scripts/fleet/worktree-closeout.mjs');
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'closeout-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const repo = path.join(dir, 'repo'), wt = path.join(dir, 'outside', 'worker');
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }).trim();
  fs.mkdirSync(repo); git('init','-b','main'); git('config','user.email','fixture'); git('config','user.name','Fixture');
  fs.writeFileSync(path.join(repo,'file'),'base'); fs.writeFileSync(path.join(repo,'.gitignore'),'node_modules/\ndocs.local/\n');
  git('add','.'); git('commit','-m','base'); git('init','--bare',path.join(dir,'remote')); git('remote','add','origin',path.join(dir,'remote')); git('push','-u','origin','main');
  git('symbolic-ref','refs/remotes/origin/HEAD','refs/remotes/origin/main'); git('worktree','add','-b','worker',wt);
  const bin=path.join(dir,'bin'), data=path.join(dir,'prs.json');
  fs.writeFileSync(data,JSON.stringify([rawPR({headSha:git('rev-parse','HEAD')})]));mockGh(bin,data);
  const run = (...args) => {if(!args.includes('--triage'))ageTree(wt);return spawnSync(process.execPath,[cli,...args],{encoding:'utf8',env:{...process.env,PATH:bin+path.delimiter+process.env.PATH}});};
  return {repo,wt,git,run};
}
test('clean pushed external worktree removed with bytes receipt', t => {
 const f=fixture(t); fs.mkdirSync(path.join(f.wt,'node_modules')); fs.writeFileSync(path.join(f.wt,'node_modules','output'),'x'.repeat(2048));
 const r=f.run(f.wt,'--json'); assert.equal(r.status,0,r.stderr); assert.ok(JSON.parse(r.stdout).bytesFreed>=2048); assert.ok(!fs.existsSync(f.wt));
});
for (const mode of ['dirty','unpushed','root','non-worktree']) test(`refuses ${mode}`, t => {
 const f=fixture(t); if(mode==='dirty') fs.writeFileSync(path.join(f.wt,'new'),'dirty');
 if(mode==='unpushed') { execFileSync('git',['commit','--allow-empty','-m','local'],{cwd:f.wt}); }
 const target=mode==='root'?f.repo:mode==='non-worktree'?path.dirname(f.repo):f.wt;
 const r=f.run(target); assert.equal(r.status,1); assert.match(r.stderr,/closeout:/); assert.ok(fs.existsSync(f.wt));
});
test('keep cleans output and persists reason',t=>{const f=fixture(t); fs.mkdirSync(path.join(f.wt,'node_modules')); const r=f.run(f.wt,'--keep','review pending','--json'); assert.equal(r.status,0,r.stderr); assert.ok(fs.existsSync(f.wt)); assert.ok(!fs.existsSync(path.join(f.wt,'node_modules'))); assert.equal(f.run('--triage',f.repo,'--json').status,0);});
test('triage flags 49-hour unpushed work and bundle preserves dirty state',t=>{
 const f=fixture(t); execFileSync('git',['commit','--allow-empty','-m','local'],{cwd:f.wt,env:{...process.env,GIT_COMMITTER_DATE:new Date(Date.now()-49*3600000).toISOString(),GIT_AUTHOR_DATE:new Date(Date.now()-49*3600000).toISOString()}});
 fs.writeFileSync(path.join(f.wt,'file'),'dirty'); fs.writeFileSync(path.join(f.wt,'new'),'untracked');
 const old=new Date(Date.now()-49*3600000); function age(p){if(fs.lstatSync(p).isDirectory()) for(const n of fs.readdirSync(p)) age(path.join(p,n)); fs.utimesSync(p,old,old);} age(f.wt);
 const tri=f.run('--triage',f.repo,'--json'); assert.equal(tri.status,3,tri.stderr); assert.equal(JSON.parse(tri.stdout).find(x=>x.path===fs.realpathSync(f.wt)).state,'dirty');
 const r=f.run('--bundle',f.wt,'--json'); assert.equal(r.status,0,r.stderr); const receipt=JSON.parse(r.stdout); assert.ok(fs.existsSync(path.join(receipt.archive,'work.bundle'))); assert.ok(fs.readFileSync(path.join(receipt.archive,'dirty.patch'),'utf8').includes('dirty')); assert.ok(fs.existsSync(f.wt));assert.equal(fs.readFileSync(path.join(f.wt,'file'),'utf8'),'dirty');
});

test('tracked build directory is preserved',t=>{const f=fixture(t);fs.mkdirSync(path.join(f.wt,'dist'));fs.writeFileSync(path.join(f.wt,'dist','source'),'keep');execFileSync('git',['add','.'],{cwd:f.wt});execFileSync('git',['commit','-m','tracked dist'],{cwd:f.wt});execFileSync('git',['push','origin','worker'],{cwd:f.wt});const r=f.run(f.wt);assert.equal(r.status,1);assert.ok(fs.existsSync(path.join(f.wt,'dist','source')));});
test('build symlink target stays intact',t=>{const f=fixture(t);const external=path.join(path.dirname(f.repo),'external');fs.mkdirSync(external);fs.writeFileSync(path.join(external,'keep'),'keep');fs.symlinkSync(external,path.join(f.wt,'node_modules'));const r=f.run(f.wt);assert.equal(r.status,1,r.stderr);assert.match(r.stderr,/Dirty or unpushed worktree refused/);assert.ok(fs.existsSync(path.join(external,'keep')));});
test('triage leaves ancestry-only trees pushed-clean and flags stale unpushed',t=>{
 const f=fixture(t); const gitWt=(...a)=>execFileSync('git',a,{cwd:f.wt,stdio:['ignore','pipe','pipe']});
 let r=f.run('--triage',f.repo,'--json'); assert.equal(JSON.parse(r.stdout).find(x=>x.branch==='worker').state,'pushed-clean');
 gitWt('commit','--allow-empty','-m','pushed');gitWt('push','origin','worker');
 r=f.run('--triage',f.repo,'--json');assert.equal(JSON.parse(r.stdout).find(x=>x.branch==='worker').state,'pushed-clean');
 execFileSync('git',['commit','--allow-empty','-m','local'],{cwd:f.wt,env:{...process.env,GIT_COMMITTER_DATE:new Date(Date.now()-49*3600000).toISOString()}});
 const old=new Date(Date.now()-49*3600000);fs.utimesSync(f.wt,old,old);fs.utimesSync(path.join(f.wt,'.git'),old,old);fs.utimesSync(path.join(f.wt,'file'),old,old);fs.utimesSync(path.join(f.wt,'.gitignore'),old,old);
 r=f.run('--triage',f.repo,'--json');assert.equal(r.status,3,r.stderr);assert.equal(JSON.parse(r.stdout).find(x=>x.branch==='worker').state,'unpushed');
 assert.equal(f.run(f.wt,'--keep','awaiting push').status,0);assert.equal(f.run('--triage',f.repo,'--json').status,0);
});
