import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { planRuns as rawPlanRuns, applyPlan } from '../ratchet/prune-runs.mjs';

const planRuns = (root, options) => rawPlanRuns(root, { states: {1: {state:'OPEN'}, 2: {state:'OPEN'}}, ...options });

// A fresh checkout (hosted CI) has no docs.local/ yet.
const scratch = () => { fs.mkdirSync('docs.local', { recursive: true }); return fs.mkdtempSync(path.resolve('docs.local/retention-test-')); };

test('size row counts symlinks by lstat without following cycle, absolute, relative or dangling targets', () => {
  const root = scratch();
  const cli = path.resolve('scripts/ratchet/mac/ratchet-runs-size.mjs');
  try {
    const repo = path.join(root, 'repo');
    fs.mkdirSync(repo);
    execFileSync('git', ['init', '--quiet', repo]);
    const runs = path.join(repo, 'docs.local/ratchet-runs');
    const run = path.join(runs, 'm1-procedure-aaaaaaa-20260101T000000');
    const outside = path.join(root, 'outside');
    fs.mkdirSync(run, { recursive: true });
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'keep'), Buffer.alloc(64 * 1024));
    fs.writeFileSync(path.join(run, 'receipt.log'), 'receipt');
    const links = { cycle: '.', absolute: outside, relative: path.relative(run, outside), dangling: 'missing' };
    for (const [name, target] of Object.entries(links)) fs.symlinkSync(target, path.join(run, name));
    const expectedBytes = [runs, run, ...fs.readdirSync(run).map(name => path.join(run, name))]
      .reduce((sum, entry) => sum + fs.lstatSync(entry).blocks * 512, 0);
    fs.mkdirSync(path.join(repo,'scripts/ratchet/mac'),{recursive:true});
    fs.copyFileSync(cli,path.join(repo,'scripts/ratchet/mac/ratchet-runs-size.mjs'));
    fs.copyFileSync('scripts/ratchet/prune-runs.mjs',path.join(repo,'scripts/ratchet/prune-runs.mjs'));
    const result = spawnSync(process.execPath, [path.join(repo,'scripts/ratchet/mac/ratchet-runs-size.mjs')], { cwd: repo, encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
    const measured = JSON.parse(result.stdout);
    assert.equal(measured.bytes, expectedBytes);
    assert.equal(measured.health, true);
    assert.throws(() => planRuns(runs, { citations: '' }), /symlink refused/);
    assert.equal(fs.statSync(path.join(outside, 'keep')).size, 64 * 1024);
  } finally { fs.rmSync(root, { recursive: true }); }
});

test('apply refuses links introduced after planning without deleting through them', () => {
  const root = scratch();
  const old = new Date(Date.now() - 4 * 3600000);
  const names = ['pr1-aaaaaaa-20260101T000000', 'pr1-bbbbbbb-20260102T000000'];
  try {
    const outside = path.join(root, 'outside');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'keep'), 'preserve');
    for (const name of names) { fs.mkdirSync(path.join(root, name)); fs.utimesSync(path.join(root, name), old, old); }
    const plan = planRuns(root, { keep: 1, citations: '' });
    assert.equal(plan.find(row => row.name === names[0]).action, 'delete');
    const run = path.join(root, names[0]);
    for (const target of ['.', outside, '../outside', 'missing']) {
      const link = path.join(run, 'fixture');
      fs.symlinkSync(target, link);
      fs.utimesSync(run, old, old);
      assert.throws(() => applyPlan(root, plan), /symlink refused/);
      assert.equal(fs.readFileSync(path.join(outside, 'keep'), 'utf8'), 'preserve');
      assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
      fs.unlinkSync(link);
    }
    assert.equal(fs.existsSync(run), true);
  } finally { fs.rmSync(root, { recursive: true }); }
});

test('retention protects cited, recent and unknown runs; apply matches dry plan', () => {
  const root = scratch();
  const old = new Date(Date.now() - 4 * 3600000);
  const names = ['pr1-aaaaaaa-20260101T000000', 'pr1-aaaaaaa-20260102T000000',
    'pr1-bbbbbbb-20260103T000000', 'pr1-ccccccc-20260104T000000',
    'm1-procedure-aaaaaaa-20260101T000000123456', 'pr1-ddddddd-20260101T000000', 'unknown'];
  try {
    for (const name of names) { fs.mkdirSync(path.join(root, name)); fs.utimesSync(path.join(root, name), old, old); }
    fs.utimesSync(path.join(root, names[5]), new Date(), new Date());
    const plan = planRuns(root, { keep: 1, citations: 'receipt bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' });
    assert.deepEqual(plan.filter(x => x.action === 'delete').map(x => x.name), names.slice(0, 2));
    assert.equal(fs.readdirSync(root).length, names.length);
    assert.match(plan.find(x => x.name === 'unknown').reason, /unparseable/);
    applyPlan(root, plan);
    assert.deepEqual(fs.readdirSync(root).sort(), names.slice(2).sort());
  } finally { fs.rmSync(root, { recursive: true }); }
});

test('refuses symlinks, including nested and root aliases; rechecks changed plans', () => {
  const root = scratch();
  try {
    const name = 'pr1-aaaaaaa-20260101T000000';
    fs.symlinkSync('..', path.join(root, name));
    assert.throws(() => planRuns(root, { citations: '' }), /symlink/);
    fs.unlinkSync(path.join(root, name)); fs.mkdirSync(path.join(root, name));
    fs.symlinkSync('..', path.join(root, name, 'escape'));
    assert.throws(() => planRuns(root, { citations: '' }), /symlink/);
    fs.unlinkSync(path.join(root, name, 'escape'));
    assert.throws(() => applyPlan(root, [{ name: '../outside', action: 'delete' }]), /child/);
    const alias = `${root}-alias`; fs.symlinkSync(root, alias);
    try { assert.throws(() => planRuns(alias, { citations: '' }), /symlink/); } finally { fs.unlinkSync(alias); }
  } finally { fs.rmSync(root, { recursive: true }); }
});

import { validRunsMeasurement, parseRows } from '../ratchet/table.mjs';
test('budget fixtures are measured fail/pass and row policy stays scoped', () => {
  for (const [suffix, health] of [['over', false], ['under', true]]) {
    const m = JSON.parse(fs.readFileSync(`scripts/ratchet/fixtures/ratchet-runs-size-${suffix}.json`));
    assert.equal(validRunsMeasurement(m), true);
    assert.equal(m.health, health);
    assert.equal(validRunsMeasurement({ ...m, health: !health }), false);
  }
  const doc = JSON.parse(fs.readFileSync('scripts/ratchet/rows.json'));
  assert.doesNotThrow(() => parseRows(doc));
  doc.rows.at(-1).id = 'unapproved-row';
  assert.throws(() => parseRows(doc), /report-only/);
});

test('named citation and descendant writes protect runs; changed plan is refused', () => {
  const root = scratch();
  const old = new Date(Date.now() - 4 * 3600000);
  const names = ['pr2-aaaaaaa-20260101T000000', 'pr2-bbbbbbb-20260102T000000', 'pr2-ccccccc-20260103T000000'];
  try {
    for (const name of names) { fs.mkdirSync(path.join(root, name)); fs.utimesSync(path.join(root, name), old, old); }
    assert.equal(planRuns(root, { keep: 1, citations: names[0] })[0].action, 'keep');
    const plan = planRuns(root, { keep: 1, citations: '' });
    fs.writeFileSync(path.join(root, names[0], 'live.log'), 'active');
    fs.utimesSync(path.join(root, names[0]), old, old);
    assert.equal(planRuns(root, { keep: 1, citations: '' })[0].action, 'keep');
    assert.throws(() => applyPlan(root, plan), /changed/);
    assert.equal(fs.readdirSync(root).length, 3);
  } finally { fs.rmSync(root, { recursive: true }); }
});

test('archive files are never selected, even old, uncited and run-shaped', () => {
  // skill-creator's ack condition for #1098: m1-procedure-*.tar.zst archives must survive the prune.
  const root = scratch();
  const old = new Date(Date.now() - 4 * 3600000);
  const dirs = ['m1-procedure-aaaaaaa-20260101T000000', 'm1-procedure-bbbbbbb-20260102T000000'];
  const files = ['m1-procedure-ccccccc-20260103T000000.tar.zst', 'm1-procedure-ddddddd-20260104T000000'];
  try {
    for (const name of dirs) fs.mkdirSync(path.join(root, name));
    for (const name of files) fs.writeFileSync(path.join(root, name), 'archive');
    for (const name of [...dirs, ...files]) fs.utimesSync(path.join(root, name), old, old);
    const plan = planRuns(root, { keep: 1, citations: '' });
    assert.deepEqual(plan.filter(x => x.action === 'delete').map(x => x.name), []);
    applyPlan(root, plan);
    assert.deepEqual(fs.readdirSync(root).sort(), [...dirs, ...files].sort());
  } finally { fs.rmSync(root, { recursive: true }); }
});

const sticky = '<!-- ratchet-table: golems-ratchet-mac -->\n<!-- ratchet-verdict: {"head":"abcdef1234567890abcdef1234567890abcdef12","ok":true,"producer":"abcdef1234567890abcdef1234567890abcdef12","receipt":"' + 'f'.repeat(64) + '"} -->';
test('per-PR run counts retain sticky SHA beyond three newer replay runs and after closure', () => {
  const root = scratch();
  try {
    const names = ['pr7-abcdef123456-20261101T000000', ...[2,3,4].map(d => `pr7-111111111111-2026110${d}T000000`)];
    for (const name of names) { fs.mkdirSync(path.join(root,name)); fs.utimesSync(path.join(root,name), new Date(0),new Date(0)); }
    const open = rawPlanRuns(root,{citations:sticky,states:{7:{state:'OPEN'}}});
    assert.equal(open.filter(r=>r.action==='keep').length,4);
    const closed = rawPlanRuns(root,{citations:sticky,states:{7:{state:'MERGED',closedAt:'2020-01-01T00:00:00Z'}}});
    assert.equal(closed.find(r=>r.name===names[0]).action,'keep');
    assert.equal(closed.filter(r=>r.action==='delete').length,3);
    applyPlan(root,closed);
    assert.deepEqual(fs.readdirSync(root),[names[0]]);
  } finally {fs.rmSync(root,{recursive:true});}
});

test('UTC fresh descendant and live run, Unicode alias, unknown state, closed grace', () => {
  const previous = process.env.TZ; process.env.TZ='UTC';
  const root=scratch();
  try {
    const names=['pr8-abcdef123456-20261101T000000','live-pr8-20261101T000000','pr١-abcdef123456-20261101T000000'];
    for(const n of names) {fs.mkdirSync(path.join(root,n));fs.writeFileSync(path.join(root,n,'install.log'),'running');fs.utimesSync(path.join(root,n,'install.log'),new Date(Date.now()-200),new Date(Date.now()-200));}
    let rows=rawPlanRuns(root,{citations:'',states:{8:{state:'MERGED',closedAt:'2020-01-01T00:00:00Z'}}});
    assert.ok(rows.every(r=>r.action==='keep'));
    assert.match(rows.find(r=>r.name===names[0]).reason,/two hours/);
    assert.equal(rows.find(r=>r.name===names[2]).pr,null);
    assert.equal(rows.find(r=>r.name===names[0]).time,Date.UTC(2026,10,1));
    for(const n of names) {fs.utimesSync(path.join(root,n,'install.log'),new Date(0),new Date(0));fs.utimesSync(path.join(root,n),new Date(0),new Date(0));}
    rows=rawPlanRuns(root,{citations:'',states:{8:{state:'MERGED',closedAt:new Date(Date.now()-86400000).toISOString()}}});
    assert.ok(rows.every(r=>r.action==='keep'));
    rows=rawPlanRuns(root,{citations:'',states:{}});
    assert.ok(rows.every(r=>r.action==='keep'));
  } finally {if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous;fs.rmSync(root,{recursive:true});}
});

test('fake gh reads body, issue comment, review comment and review summary; errors abort', async () => {
  const {evidenceFromGitHub}=await import('../ratchet/prune-runs.mjs');
  const root=scratch(), previous=process.env.PATH;
  try {
    const binary=path.join(root,'gh');
    fs.writeFileSync(binary,`#!/usr/bin/env node
const ep=process.argv.at(-1);
if(process.env.FAKE_GH_FAIL==='1')process.exit(1);
if(ep.includes('/pulls?'))console.log(JSON.stringify([[{number:7,state:'closed',merged_at:'2020-01-01',closed_at:'2020-01-01',body:'body abcdef123456'}]]));
else console.log(JSON.stringify([[{body:ep.includes('/reviews?')?'review-summary':ep.includes('/pulls/')?'review-comment':'issue-comment'}]]));
`);fs.chmodSync(binary,0o755);process.env.PATH=root+path.delimiter+previous;
    const evidence=evidenceFromGitHub();
    for(const text of ['body abcdef123456','review-summary','review-comment','issue-comment'])assert.ok(evidence.citations.includes(text));
    const run='pr7-abcdef123456-20261101T000000';fs.mkdirSync(path.join(root,run));fs.utimesSync(path.join(root,run),new Date(0),new Date(0));
    for(const citation of ['body abcdef123456','review-comment abcdef123456'])assert.equal(rawPlanRuns(root,{...evidence,citations:citation}).find(r=>r.name===run).action,'keep');
    process.env.FAKE_GH_FAIL='1';assert.throws(()=>evidenceFromGitHub());assert.ok(fs.existsSync(path.join(root,run)));
  } finally {delete process.env.FAKE_GH_FAIL;process.env.PATH=previous;fs.rmSync(root,{recursive:true});}
});

test('missing candidate aborts before deleting any other candidate',()=>{
 const root=scratch();try{
 const names=['pr7-aaaaaaa-20260101T000000','pr7-bbbbbbb-20260102T000000'];
 for(const name of names){fs.mkdirSync(path.join(root,name));fs.utimesSync(path.join(root,name),new Date(0),new Date(0));}
 const plan=rawPlanRuns(root,{citations:'',states:{7:{state:'CLOSED',closedAt:'2020-01-01'}}});
 fs.rmdirSync(path.join(root,names[1]));assert.throws(()=>applyPlan(root,plan));assert.ok(fs.existsSync(path.join(root,names[0])));
 }finally{fs.rmSync(root,{recursive:true});}
});

test('CLI fixture --apply uses script main checkout from foreign cwd, aborts on gh failure',()=>{
 const root=scratch();try{
 const repo=path.join(root,'repo');fs.mkdirSync(path.join(repo,'scripts/ratchet'),{recursive:true});execFileSync('git',['init','-q',repo]);
 const script=path.join(repo,'scripts/ratchet/prune-runs.mjs');fs.copyFileSync('scripts/ratchet/prune-runs.mjs',script);
 const runs=path.join(repo,'docs.local/ratchet-runs'),run=path.join(runs,'pr7-aaaaaaa-20260101T000000');fs.mkdirSync(run,{recursive:true});fs.utimesSync(run,new Date(0),new Date(0));
 const bin=path.join(root,'bin');fs.mkdirSync(bin);fs.writeFileSync(path.join(bin,'gh'),`#!/usr/bin/env node
if(process.env.FAKE_GH_FAIL==='1')process.exit(1);
console.log(JSON.stringify(process.argv.at(-1).includes('/pulls?')?[[{number:7,state:'closed',body:null,closed_at:'2020-01-01',merged_at:null}]]:[[]]));
`);fs.chmodSync(path.join(bin,'gh'),0o755);
 const env={...process.env,PATH:bin+path.delimiter+process.env.PATH};
 const invoke=(args,extra={})=>spawnSync('node',[script,...args],{cwd:root,env:{...env,...extra},encoding:'utf8'});
 assert.equal(invoke([]).status,0);assert.ok(fs.existsSync(run));
 assert.match(invoke([],{GOLEMS_RATCHET_RUNS_KEEP:'9'}).stderr,/GOLEMS_RATCHET_RUNS_KEEP.*ignored/);
 assert.equal(invoke(['--apply'],{FAKE_GH_FAIL:'1'}).status,2);assert.ok(fs.existsSync(run));
 const result=invoke(['--apply']);assert.equal(result.status,0,result.stderr);assert.equal(fs.existsSync(run),false);
 }finally{fs.rmSync(root,{recursive:true});}
});

test('leading-zero PR aliases stay unknown; closed citations use neutral wording',()=>{
 const root=scratch();try{
 const alias='pr01-aaaaaaa-20260101T000000', normal='pr1-bbbbbbb-20260101T000000';
 for(const name of [alias,normal]){fs.mkdirSync(path.join(root,name));fs.utimesSync(path.join(root,name),new Date(0),new Date(0));}
 const rows=rawPlanRuns(root,{citations:'bbbbbbb',states:{1:{state:'CLOSED',closedAt:'2020-01-01'}}});
 assert.equal(rows.find(r=>r.name===alias).pr,null);
 assert.equal(rows.find(r=>r.name===alias).action,'keep');
 assert.equal(rows.find(r=>r.name===normal).reason,'PR citation');
 }finally{fs.rmSync(root,{recursive:true});}
});

test('non-PR lane keeps three newest runs, cited older run and recent writes (fake gh)', async()=>{
 const {evidenceFromGitHub}=await import('../ratchet/prune-runs.mjs');
 const root=scratch(), oldPath=process.env.PATH;
 try{
  const names=Array.from({length:7},(_,i)=>`m1-procedure-${String(i+1).repeat(7)}-2026010${i+1}T000000`);
  for(const n of names){fs.mkdirSync(path.join(root,n));fs.utimesSync(path.join(root,n),new Date(0),new Date(0));}
  const bin=path.join(root,'bin');fs.mkdirSync(bin);const gh=path.join(bin,'gh');
  fs.writeFileSync(gh,`#!/usr/bin/env node
if(process.env.NONPR_GH_FAIL==='1')process.exit(1);
const ep=process.argv.at(-1);
if(process.argv.includes('graphql')){console.log(JSON.stringify([{data:{repository:{pullRequests:{totalCount:1,pageInfo:{hasNextPage:false},nodes:[{number:42,reviews:{totalCount:0,nodes:[],pageInfo:{hasNextPage:false}}}]}}}}]));process.exit(0);}
console.log(JSON.stringify(ep.includes('/pulls?')?[[{number:42,state:'closed',closed_at:'2020-01-01',merged_at:null,body:'${names[0]}'}]]:ep.includes('/issues/')?[[{body:'<!-- ratchet-table: golems-ratchet-mac --> ${names[1]}'}]]:[[]]));
`);fs.chmodSync(gh,0o755);process.env.PATH=bin+path.delimiter+oldPath;
  const evidence=evidenceFromGitHub(root);
  const rows=rawPlanRuns(root,evidence);
  assert.deepEqual(rows.filter(r=>r.action==='delete').map(r=>r.name),names.slice(2,4));
  assert.equal(rows.find(r=>r.name===names[0]).reason,'PR citation');
  assert.equal(rows.find(r=>r.name===names[1]).reason,'PR citation');
  fs.writeFileSync(path.join(root,names[2],'active.log'),'working');fs.utimesSync(path.join(root,names[2]),new Date(0),new Date(0));
  assert.match(rawPlanRuns(root,evidence).find(r=>r.name===names[2]).reason,/two hours/);
  process.env.NONPR_GH_FAIL='1';assert.throws(()=>evidenceFromGitHub(root));assert.ok(fs.existsSync(path.join(root,names[3])));
 }finally{delete process.env.NONPR_GH_FAIL;process.env.PATH=oldPath;fs.rmSync(root,{recursive:true});}
});

test('non-PR citations use four gh invocations for 1201 PRs; empty/short/incomplete evidence KEEP (S6)', async()=>{
 const {evidenceFromGitHub}=await import('../ratchet/prune-runs.mjs');
 const root=scratch(), previous=process.env.PATH;
 try{
  const names=Array.from({length:5},(_,i)=>`m1-procedure-${String(i+1).repeat(7)}-2026010${i+1}T000000`);
  for(const n of names){fs.mkdirSync(path.join(root,n));fs.utimesSync(path.join(root,n),new Date(0),new Date(0));}
  const bin=path.join(root,'bin');fs.mkdirSync(bin);const log=path.join(root,'calls');
  fs.writeFileSync(path.join(bin,'gh'),`#!/usr/bin/env node
const fs=require('fs');fs.appendFileSync(${JSON.stringify(log)},'x\\n');
if(fs.readFileSync(${JSON.stringify(log)},'utf8').split('\\n').length>7)process.exit(1);
const mode=process.env.CITATION_MODE||'',ep=process.argv.at(-1),m=1201;
const chunk=a=>Array.from({length:Math.ceil(a.length/100)},(_,i)=>a.slice(i*100,i*100+100));
if(process.argv.includes('graphql')){
 const nodes=Array.from({length:m},(_,i)=>({number:i+1,reviews:{totalCount:0,nodes:[],pageInfo:{hasNextPage:mode==='inner'}}}));
 const pages=chunk(nodes).map((nodes,i)=>({data:{repository:{pullRequests:{totalCount:m,nodes,pageInfo:{hasNextPage:i<12}}}}}));
 if(mode==='outer')pages.pop();
 console.log(JSON.stringify(pages));
}else if(ep.includes('/pulls?')){
 const prs=Array.from({length:mode==='empty'?0:mode==='short'?1:m},(_,i)=>({number:i+1,state:'closed',body:'',closed_at:'2020-01-01',merged_at:null}));
 console.log(JSON.stringify(prs.length?chunk(prs):[[]]));
}else {if(mode==='page-error')process.exit(1);console.log('[[]]');}
`);fs.chmodSync(path.join(bin,'gh'),0o755);process.env.PATH=bin+path.delimiter+previous;
  const evidence=evidenceFromGitHub(root);
  assert.equal(evidence.nonPrEvidenceComplete,true);
  assert.equal(fs.readFileSync(log,'utf8').trim().split('\n').length,4);
  assert.equal(rawPlanRuns(root,evidence).filter(r=>r.action==='delete').length,2);
  for(const mode of ['empty','short','inner','outer']){
   fs.writeFileSync(log,'');process.env.CITATION_MODE=mode;
   const incomplete=evidenceFromGitHub(root);
   assert.equal(incomplete.nonPrEvidenceComplete,false,mode);
   assert.ok(rawPlanRuns(root,incomplete).every(r=>r.action==='keep'),mode);
  }
  fs.writeFileSync(log,'');process.env.CITATION_MODE='page-error';assert.throws(()=>evidenceFromGitHub(root));
  const fileRoot=path.join(root,'file-only');fs.mkdirSync(fileRoot);fs.writeFileSync(path.join(fileRoot,names[0]),'archive');
  fs.writeFileSync(log,'');delete process.env.CITATION_MODE;
  evidenceFromGitHub(fileRoot);assert.equal(fs.readFileSync(log,'utf8').trim().split('\n').length,1,'plain files must not trigger repo-wide citations');
 }finally{process.env.PATH=previous;delete process.env.CITATION_MODE;fs.rmSync(root,{recursive:true});}
});

test('lane allowlist, UTC procedure names, and procedure lock keep data',()=>{
 const root=scratch(), lstat=fs.lstatSync, previousTZ=process.env.TZ;
 try{
  process.env.TZ='Asia/Jerusalem';
  const names=['m1-procedure-aaaaaaa-20260101T010000','m1-procedure-bbbbbbb-20260102T010000','m1-procedure-ccccccc-20260103T010000','m1-procedure-ddddddd-20260104T010000','mac-pr12-aaaaaaa-20260101T010000','pr-aaaaaaa-20260101T010000'];
  for(const n of names){fs.mkdirSync(path.join(root,n));fs.utimesSync(path.join(root,n),new Date(0),new Date(0));}
  const options={citations:'',nonPrEvidenceComplete:true};
  let rows=rawPlanRuns(root,options);
  assert.equal(rows.find(r=>r.name===names[0]).time,Date.UTC(2026,0,1,1));
  assert.ok(rows.filter(r=>names.slice(4).includes(r.name)).every(r=>r.action==='keep'));
  const plan=rows;
  fs.lstatSync=(p,...args)=>String(p).endsWith('/.golems/m1-procedure.lock')?{}:lstat(p,...args);
  rows=rawPlanRuns(root,options);assert.ok(rows.every(r=>r.action==='keep'));
  assert.throws(()=>applyPlan(root,plan),/active procedure/);
 }finally{fs.lstatSync=lstat;if(previousTZ===undefined)delete process.env.TZ;else process.env.TZ=previousTZ;fs.rmSync(root,{recursive:true});}
});
