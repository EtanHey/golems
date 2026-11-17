#!/usr/bin/env node
// Synchronous compatibility API; whole-folder work runs in a bounded async pool.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { verifySet, stageSet, verifyTar } from './clear-set.mjs';

export function classify(root, options = {}) {
  if (options.budgetMs !== undefined && (!Number.isFinite(options.budgetMs) || options.budgetMs <= 0 || options.budgetMs > 86_400_000)) throw new Error('invalid-budget');
  if (options.workers !== undefined && (!Number.isInteger(options.workers) || options.workers < 1 || options.workers > 32)) throw new Error('invalid-workers');
  const child = spawnSync(process.execPath, [new URL('./classify-engine.mjs',import.meta.url).pathname, JSON.stringify({root,options})],
    {encoding:'utf8',maxBuffer:256*1024*1024});
  if (child.error || child.status !== 0) throw new Error('scan-classification-error');
  return JSON.parse(child.stdout);
}
export function verifyReports(reports) {
  if (!Array.isArray(reports) || !reports.length) return false;
  return reports.every(saved => saved.status === 'CLEAR' && saved.files === saved.members?.length &&
    saved.members.every(m => /^[a-f0-9]{64}$/.test(m.sha256) && Number.isSafeInteger(m.bytes)) &&
    (() => { const current = classify(saved.root, {verify:true}); return current.status === 'CLEAR' &&
      JSON.stringify(current.members) === JSON.stringify(saved.members); })());
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
  try {
    if (process.argv[2] === '--verify' && process.argv[3] === '--clear-set') {
      if (!(process.argv.length===5 || (process.argv.length===7 && process.argv[5]==='--manifest'))) throw new Error('clear-set-usage');
      const added=verifySet(process.argv[4],process.argv[6],classify);
      console.log(`clear-set-verified new-unarchived:${added}`);
    } else if (['--stage-clear-set','--verify-tar'].includes(process.argv[2])) {
      if(process.argv.length!==6) throw new Error('clear-set-usage');
      (process.argv[2]==='--stage-clear-set'?stageSet:verifyTar)(...process.argv.slice(3));
      console.log(process.argv[2]==='--stage-clear-set'?'clear-set-staged':'tar-verified');
    } else if (process.argv[2] === '--verify') {
      if (process.argv.length !== 4 || !verifyReports(JSON.parse(readFileSync(process.argv[3],'utf8')))) throw new Error();
      console.log('scan-receipt-verified');
    } else {
      const roots=[], options={};
      for(let i=2;i<process.argv.length;i++) {
        const arg=process.argv[i];
        if(arg==='--receipt-dir') options.receiptDir=resolve(process.argv[++i]);
        else if(arg==='--budget-ms') options.budgetMs=Number(process.argv[++i]);
        else if(arg==='--workers') options.workers=Number(process.argv[++i]);
        else if(arg.startsWith('--')) throw new Error();
        else roots.push(arg);
      }
      if(!roots.length || (options.receiptDir && roots.length!==1)) throw new Error();
      console.log(JSON.stringify(roots.map(root=>classify(root,options)),null,2));
    }
  } catch (error) {
    const partial=process.argv[3]==='--clear-set' || ['--stage-clear-set','--verify-tar'].includes(process.argv[2]);
    // Never print decoder/OS errors, paths, content or matched values.
    const reason=partial && /^(clear-set|tar)-[a-z-]+$/.test(error.message) ? error.message : partial?'clear-set-operation-error':process.argv[2]==='--verify'?'scan-receipt-mismatch':'scan-classification-error';
    console.error(reason); process.exitCode=1;
  }
}
