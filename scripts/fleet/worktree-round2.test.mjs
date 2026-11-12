import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { ageTree, mockGh, rawPR } from './worktree-fixtures.mjs';
const cli = path.resolve('scripts/fleet/worktree-closeout.mjs'), sweeper = path.resolve('scripts/fleet/worktree-sweeper.mjs');
const g = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }).trim();
function fixture(t) {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'round2-')); t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const repo=path.join(dir,'repos','main'), wt=path.join(dir,'worker'), bin=path.join(dir,'bin'), data=path.join(dir,'prs.json');
 fs.mkdirSync(repo,{recursive:true}); g(repo,'init','-b','main'); g(repo,'config','user.email','fixture'); g(repo,'config','user.name','Fixture');
 fs.writeFileSync(path.join(repo,'.gitignore'),'docs.local/\nnode_modules/\nprivate.local\n'); g(repo,'add','.'); g(repo,'commit','-m','base');
 g(repo,'init','--bare',path.join(dir,'remote')); g(repo,'remote','add','origin',path.join(dir,'remote')); g(repo,'push','-u','origin','main'); g(repo,'remote','set-head','origin','main');
 g(repo,'worktree','add','--track','-b','worker',wt,'origin/main');
 fs.mkdirSync(path.join(wt,'docs.local')); fs.writeFileSync(path.join(wt,'docs.local','plan.md'),'plan');
 fs.writeFileSync(data,'[]'); mockGh(bin,data);
 const env={...process.env,PATH:bin+path.delimiter+process.env.PATH};
 const run=(mode,cwd)=>mode==='closeout'?spawnSync(process.execPath,[cli,wt,'--json'],{env,encoding:'utf8',cwd}):spawnSync(process.execPath,['--input-type=module','-e',`import {sweep} from ${JSON.stringify('file://'+sweeper)}; sweep([process.argv[1]], {}, Date.now(), console.log);`,path.dirname(repo)],{env,encoding:'utf8',cwd});
 const merged=(kind='merge')=>{
  fs.writeFileSync(path.join(wt,'change'),'change');g(wt,'add','.');g(wt,'commit','-m','change');g(wt,'push','-u','origin','worker'); const headSha=g(wt,'rev-parse','HEAD');
  g(repo,'commit','--allow-empty','-m','main diverged');
  if(kind==='merge')g(repo,'merge','--no-ff','worker','-m','merge');
  if(kind==='squash'){g(repo,'merge','--squash','worker');g(repo,'commit','-m','squash');}
  if(kind==='rebase'){g(repo,'cherry-pick','worker');}
  if(kind!=='merge')assert.notEqual(g(repo,'rev-parse','HEAD'),headSha);
  g(repo,'push','origin','main');g(repo,'push','origin','--delete','worker');g(repo,'fetch','--prune','origin');
  fs.writeFileSync(data,JSON.stringify([rawPR({headSha})]));ageTree(wt);
 };
 return {dir,repo,wt,bin,data,run,merged};
}
for(const mode of ['closeout','sweeper']) {
 test(`${mode}: fresh origin/main tree with plan and no PR is kept`,t=>{const f=fixture(t),r=f.run(mode);assert.equal(r.status,0,r.stderr);assert.ok(fs.existsSync(path.join(f.wt,'docs.local/plan.md')));});
 for(const kind of ['merge','squash','rebase'])test(`${mode}: ${kind} PR with pruned remote branch closes`,t=>{const f=fixture(t);f.merged(kind);const r=f.run(mode);assert.equal(r.status,0,r.stderr);assert.ok(!fs.existsSync(f.wt),r.stdout);});
 test(`${mode}: fresh merged PR is kept`,t=>{const f=fixture(t);f.merged();fs.writeFileSync(path.join(f.wt,'docs.local/plan.md'),'recent');f.run(mode);assert.ok(fs.existsSync(f.wt));});
 test(`${mode}: local private data injected during network lookup is kept`,t=>{
  const f=fixture(t);f.merged();const gh=path.join(f.bin,'gh');let script=fs.readFileSync(gh,'utf8');script=script.replace('args=sys.argv[1:]',`open(${JSON.stringify(path.join(f.wt,'private.local'))},'w').write('private')\nargs=sys.argv[1:]`);fs.writeFileSync(gh,script);f.run(mode);assert.ok(fs.existsSync(path.join(f.wt,'private.local')));assert.ok(fs.existsSync(path.join(f.wt,'docs.local/plan.md')));
 });
 test(`${mode}: clean preflight failure leaves docs in place`,t=>{const f=fixture(t);f.merged();fs.mkdirSync(path.join(f.wt,'node_modules/.git'),{recursive:true});ageTree(f.wt);f.run(mode);assert.ok(fs.existsSync(path.join(f.wt,'docs.local/plan.md')));});
 test(`${mode}: active cwd retains tree`,t=>{
  const f=fixture(t);f.merged();const child=f.run(mode,f.wt);assert.equal(child.status,0,child.stderr);assert.ok(fs.existsSync(f.wt));assert.match(child.stdout,/process|liveness/);
 });
}
test('no-PR origin/main ancestry is not merged PR evidence', async t=>{const f=fixture(t);const {inspect}=await import('./worktree-state.mjs');assert.equal(inspect(f.wt,[]).merged,false);});
test('final full inspect catches private data written during output cleanup', async t=>{
 const f=fixture(t);f.merged();fs.mkdirSync(path.join(f.wt,'node_modules'));ageTree(f.wt);
 const {closeWorktree}=await import('./worktree-closeout.mjs');const head=g(f.wt,'rev-parse','HEAD'),rm=fs.rmSync,output=path.join(fs.realpathSync(f.wt),'node_modules');
 fs.rmSync=(p,...args)=>{rm(p,...args);if(p===output)fs.writeFileSync(path.join(f.wt,'private.local'),'late');};
 try{assert.throws(()=>closeWorktree(f.wt,head,false,{prs:[{number:1,state:'closed',merged:true,head:'worker',base:'main',headSha:head}]}),/changed before removal/);}finally{fs.rmSync=rm;}
 assert.ok(fs.existsSync(path.join(f.wt,'docs.local/plan.md')));assert.ok(fs.existsSync(path.join(f.wt,'private.local')));
});
test('open file descriptor retains worktree',t=>{const f=fixture(t);f.merged();const fd=fs.openSync(path.join(f.wt,'docs.local/plan.md'),'r');try{const r=f.run('closeout');assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/live process/);assert.ok(fs.existsSync(f.wt));}finally{fs.closeSync(fd);}});
test('one PR snapshot per repository sweep with multiple worktrees',t=>{
 const f=fixture(t);g(f.repo,'worktree','add','--track','-b','second',path.join(f.dir,'second'),'origin/main');
 const gh=path.join(f.bin,'gh'),count=path.join(f.dir,'calls');fs.writeFileSync(gh,fs.readFileSync(gh,'utf8').replace('args=sys.argv[1:]',`open(${JSON.stringify(count)},'a').write('call\\n')\nargs=sys.argv[1:]`));
 const r=f.run('sweeper');assert.equal(r.status,0,r.stderr);assert.equal(fs.readFileSync(count,'utf8'),'call\n');
});
test('raw paginated API pages traverse jq and retain descendant stack',t=>{
 const f=fixture(t);f.merged();const headSha=g(f.wt,'rev-parse','HEAD');fs.writeFileSync(f.data,JSON.stringify([rawPR({headSha})])+'\n'+JSON.stringify([rawPR({number:2,head:'child',base:'worker',state:'open',merged:false,headSha})]));
 const r=f.run('closeout');assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/stack #2 open/);assert.ok(fs.existsSync(f.wt));
});
test('failed lsof retains worktree',t=>{const f=fixture(t);f.merged();fs.writeFileSync(path.join(f.bin,'lsof'),'#!/bin/sh\nexit 2\n',{mode:0o755});const r=f.run('closeout');assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/liveness unknown/);assert.ok(fs.existsSync(f.wt));});
test('failed fsync retains every original',async t=>{
 const f=fixture(t),{preserveDocs}=await import('./worktree-preservation.mjs'),sync=fs.fsyncSync;
 fs.fsyncSync=()=>{throw Error('fixture fsync failure');};try{assert.throws(()=>preserveDocs(f.wt,f.repo,'worker',g(f.wt,'rev-parse','HEAD')),/fsync failure/);}finally{fs.fsyncSync=sync;}
 assert.equal(fs.readFileSync(path.join(f.wt,'docs.local/plan.md'),'utf8'),'plan');
});
