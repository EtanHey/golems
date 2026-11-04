import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const runner = process.env.W19_RUNNER_UNDER_TEST ?? fileURLToPath(new URL('./run.mjs', import.meta.url));
async function fixture(fn) {
  const root = await mkdtemp(path.join(tmpdir(), 'w19-runner-'));
  try {
    const creator = path.join(root,'creator'), home = path.join(root,'home'), bin = path.join(root,'bin');
    await mkdir(path.join(creator,'evals/large-plan-trigger'),{recursive:true});
    await mkdir(path.join(home,'.codex'),{recursive:true});await mkdir(bin);
    await writeFile(path.join(home,'.codex/auth.json'),JSON.stringify({auth_mode:'chatgpt',tokens:{access_token:'synthetic-fixture-token'}}));
    // External transport/validator stub: no network, real credential or model call.
    await writeFile(path.join(creator,'evals/large-plan-trigger/codex.mjs'), `
      import {rm} from 'node:fs/promises';
      export function createCodexCell(root) { return {attach(){},kill(){},stop(){},async cleanup(){await rm(root,{recursive:true,force:true});}}; }
      export function validateCodexRun(){throw Error('synthetic runtime validation failure');}
    `);
    await writeFile(path.join(bin,'codex'),'#!/bin/sh\nprintf \'%s\\n\' \'{"type":"turn.failed","error":{"message":"synthetic"}}\'\n',{mode:0o700});
    const run = out => spawnSync(process.execPath,[runner,creator,'HEAD',out,'candidate'],{
      env:{PATH:`${bin}:${process.env.PATH}`,HOME:home},encoding:'utf8',timeout:10000,
    });
    await fn({root,run});
  } finally { await rm(root,{recursive:true,force:true}); }
}
test('real CLI refuses an existing evidence directory without replacing inputs',()=>fixture(async({root,run})=>{
  const out=path.join(root,'out');await mkdir(out);
  await writeFile(path.join(out,'inputs.json'),'preserved evidence');
  const result=run(out);assert.notEqual(result.status,0);assert.match(result.stderr,/EEXIST/);
  assert.equal(await readFile(path.join(out,'inputs.json'),'utf8'),'preserved evidence');
  assert.deepEqual(await readdir(out),['inputs.json']);
}));
test('real CLI retains invalid-run reason and raw transcript without a positive receipt',()=>fixture(async({root,run})=>{
  const out=path.join(root,'out'),result=run(out);assert.notEqual(result.status,0);
  const error=JSON.parse(await readFile(path.join(out,'C1-candidate-1.error.json'),'utf8'));
  assert.equal(error.status,'INVALID');assert.equal(error.error,'synthetic runtime validation failure');
  assert.match(await readFile(path.join(out,'C1-candidate-1.jsonl'),'utf8'),/turn.failed/);
  assert.ok(!(await readdir(out)).includes('runtime.json'));
}));
