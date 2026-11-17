import { spawn } from 'node:child_process';
import { MAX_SCAN_BYTES } from './scan-content.mjs';

const gitEnv = () => ({...Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('GIT_'))), GIT_NO_LAZY_FETCH:'1',GIT_OPTIONAL_LOCKS:'0',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'});
async function resolvePaths(repo, matches, deadline) {
  if (!matches.length || Date.now() >= deadline) return;
  const wanted=new Map(matches.map(m=>[m.blob,m]));
  const child=spawn('git',['--no-replace-objects','-C',repo,'rev-list','--objects','--all'],{stdio:['ignore','pipe','ignore'],env:gitEnv()});
  const exit=new Promise(resolve=>{child.on('error',()=>resolve(-1));child.on('close',resolve);});
  const timer=setTimeout(()=>child.kill('SIGKILL'),Math.max(1,deadline-Date.now()));
  try {
    let line='';
    for await(const chunk of child.stdout) {
      line+=chunk.toString('utf8'); if(line.length>1024*1024) break;
      let end; while((end=line.indexOf('\n'))>=0) {
        const row=line.slice(0,end);line=line.slice(end+1);
        const split=row.indexOf(' '), match=wanted.get(row.slice(0,split));
        if(match && !match.path) match.path=row.slice(split+1);
      }
    }
  } catch {} finally {clearTimeout(timer);child.kill('SIGKILL');await exit;}
}

// All objects, including unreachable blobs. No checkout, hooks or writes.
// Git framing is parsed as bytes; filenames and blob values never become errors.
export async function scanHistory(repo, pool, deadline) {
  const child = spawn('git', ['--no-replace-objects', '-C', repo, 'cat-file', '--batch-all-objects', '--batch'], {
    stdio: ['ignore', 'pipe', 'ignore'], env:gitEnv(),
  });
  const exit = new Promise(resolve => { child.on('error', () => resolve(-1)); child.on('close', resolve); });
  const timer = setTimeout(() => child.kill('SIGKILL'), Math.max(1, deadline - Date.now()));
  const matches = [];
  try {
    const iter = child.stdout[Symbol.asyncIterator](); let pending = Buffer.alloc(0);
    async function take(n, keep = true) {
      const parts = []; let remaining = n;
      while (remaining) {
        if (!pending.length) { const next = await iter.next(); if (next.done) throw new Error(); pending = next.value; }
        const count = Math.min(remaining, pending.length);
        if (keep) parts.push(pending.subarray(0, count));
        pending = pending.subarray(count); remaining -= count;
      }
      return keep ? Buffer.concat(parts) : null;
    }
    while (true) {
      let header = '';
      while (true) {
        if (!pending.length) { const next = await iter.next(); if (next.done) break; pending = next.value; }
        const b = pending[0]; pending = pending.subarray(1);
        if (b === 10) break;
        header += String.fromCharCode(b); if (header.length > 200) throw new Error();
      }
      if (!header) break;
      if (Date.now() >= deadline) throw new Error();
      const match = /^([a-f0-9]{40,64}) (blob|tree|commit|tag) (\d+)$/.exec(header);
      if (!match) throw new Error();
      const [, oid, type, rawSize] = match, size = Number(rawSize);
      if (!Number.isSafeInteger(size)) throw new Error();
      if (type === 'blob' && size <= MAX_SCAN_BYTES) {
        const blob = await take(size);
        const receipt = await pool.run({blob});
        if (receipt.shapes.length) matches.push({blob:oid, rules:receipt.shapes});
      } else {
        await take(size, false);
        if (type === 'blob') matches.push({blob:oid, rules:['scan-size-limit']});
      }
      if ((await take(1))[0] !== 10) throw new Error();
    }
    if (await exit !== 0) throw new Error();
    await resolvePaths(repo,matches,deadline);
    return {clean:matches.length === 0, matches};
  } catch { return {clean:false, matches, error:'git-history-error'}; }
  finally { clearTimeout(timer); child.kill('SIGKILL'); await exit; }
}
