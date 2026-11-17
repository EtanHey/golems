import { lstatSync, readdirSync, readFileSync, writeFileSync, mkdirSync, realpathSync, openSync, closeSync, fstatSync, ftruncateSync, constants } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { isCredentialDir } from './rollup.mjs';
import { credentialPathRule, packageTree } from './credential-policy.mjs';
import { ScanPool, defaultWorkers } from './scan-pool.mjs';
import { scanHistory } from './git-history.mjs';
import { cacheAuthenticator } from './cache-auth.mjs';

export const budgetFor = (bytes, files) => Math.min(3_600_000, Math.ceil(60_000 + bytes / (25 * 1024 * 1024) * 1000 + files * 5));
const within = (root, path) => path === root || path.startsWith(root.endsWith(sep)?root:root+sep);
const definitive = r => r.sha256 && !r.shapes.some(s => /time-limit|unreadable|worker-error|policy-error|source-changed/.test(s));

export async function classifyAsync(root, options = {}) {
  root = resolve(root); const started = Date.now();
  const held = [], inventory = [], repos = [];
  const hold = (path, rule) => held.push({path, rule});
  function walk(abs, inherited, git) {
    const path = relative(root, abs) || basename(root);
    try {
      const stat = lstatSync(abs);
      if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) { if(git)git.unsafe=true;hold(path, 'scan-unsupported-member'); return; }
      if (stat.isDirectory()) {
        if (!(stat.mode & 0o444)) { hold(path, 'scan-unreadable'); return; }
        if (basename(abs) === '.git') { git = {repo:dirname(abs), dir:abs}; repos.push(git); }
        const rule = inherited ?? (isCredentialDir(basename(abs), packageTree(abs)) ? 'credential-directory' : null);
        for (const name of readdirSync(abs).sort()) walk(join(abs,name), rule, git);
      } else {
        if(basename(abs)==='.git')hold(path,'git-history-error');
        inventory.push({abs,path,stat,git,rule:inherited ?? credentialPathRule(abs)});
      }
    } catch { hold(path,'scan-unreadable'); }
  }
  walk(root);
  const budgetMs = options.budgetMs ?? budgetFor(inventory.reduce((n,f)=>n+f.stat.size,0), inventory.length);
  if (!Number.isFinite(budgetMs) || budgetMs <= 0 || budgetMs > 86_400_000) throw new Error('invalid-budget');
  const deadline = started + budgetMs;
  let receiptDir, cache = {};
  // Canonicalize before writing: an ancestor symlink must not redirect receipts into source.
  if (options.receiptDir) {
    let dest = resolve(options.receiptDir), ancestor = dest, tail = [];
    while (true) { try { ancestor = realpathSync(ancestor); break; } catch { tail.unshift(basename(ancestor)); const parent = dirname(ancestor); if (parent === ancestor) throw new Error('receipt-location'); ancestor = parent; } }
    dest = join(ancestor,...tail);
    if (within(realpathSync(root), dest)) throw new Error('receipt-inside-source');
    receiptDir = dest; mkdirSync(dest,{recursive:true});
  }
  const policyHash = createHash('sha256');
  for (const name of ['scan-content.mjs','scan-worker.mjs','credential-policy.mjs','classify-engine.mjs','git-history.mjs','cache-auth.mjs']) policyHash.update(readFileSync(new URL(name,import.meta.url)));
  policyHash.update(readFileSync(new URL('../../../../scripts/publish-boundary-policy.yaml',import.meta.url)));
  const policy = policyHash.digest('hex');
  const auth=receiptDir?cacheAuthenticator(realpathSync(root),receiptDir):null;
  if (receiptDir && !options.verify) {
    try { const saved=JSON.parse(readFileSync(join(receiptDir,'scan-cache.json'),'utf8')); if(saved.root===root && saved.policy===policy && auth.valid(saved)) cache=saved.entries; } catch {}
  }
  const pool = new ScanPool(options.workers ?? defaultWorkers(), deadline);
  if (!Number.isInteger(pool.count) || pool.count < 1 || pool.count > 32) throw new Error('invalid-workers');
  const entries = {}, members = [], triage = {}, gitHistory = [];
  for (const f of inventory) if (!f.git && cache[f.path]?.size === f.stat.size && cache[f.path]?.mtime === f.stat.mtimeMs) entries[f.path]=cache[f.path];
  let cacheHits = 0;
  try {
    // Validate exact Git storage before granting any binary decoding exception.
    for (const git of repos) {
      const history=git.unsafe?{clean:false,matches:[],allowed:[],error:'git-history-error'}:await scanHistory(git.repo,pool,deadline,inventory.filter(f=>f.git===git));
      git.allowed=new Set(history.allowed);delete history.allowed;
      gitHistory.push({path:relative(root,git.repo)||'.',...history});
      if(!history.clean) {
        const rules=history.matches.length?['git-history-match']:[];
        if(history.error)rules.push(history.error);
        for(const rule of rules) {
          hold(relative(root,git.dir),rule);
          for(const f of inventory.filter(f=>f.git===git))hold(f.path,rule);
        }
      }
    }
    const work = [...inventory].sort((a,b)=>Number(Boolean(cache[a.path]))-Number(Boolean(cache[b.path]))).map(async f => {
      if (f.rule) { hold(f.path,f.rule); return; }
      const inside = f.git && relative(f.git.dir,f.abs).split(sep).join('/');
      const hashOnly = Boolean(inside && f.git.allowed.has(inside));
      const cached = !f.git && cache[f.path];
      const looseOid=hashOnly && /^objects\/[a-f0-9]{2}\/[a-f0-9]+$/.test(inside)?inside.slice(8).replace('/',''):undefined;
      const r = await pool.run({path:f.abs, hashOnly, looseOid, cached,expected:{size:f.stat.size,mtimeMs:f.stat.mtimeMs,ctimeMs:f.stat.ctimeMs,ino:f.stat.ino}});
      if (r.reused) cacheHits++;
      members.push({path:f.path,bytes:r.bytes,sha256:r.sha256});
      for(const rule of r.shapes) hold(f.path,rule);
      if (r.shapes.includes('scan-unsupported-encoding')) {
        const kind = `${extname(f.path).toLowerCase() || '(none)'}|${r.magic ?? 'unknown'}`;
        triage[kind]=(triage[kind]??0)+1;
      }
      if (!f.git && definitive(r)) entries[f.path]={size:f.stat.size,mtime:f.stat.mtimeMs,receipt:{shapes:r.shapes,bytes:r.bytes,sha256:r.sha256,magic:r.magic}};
    });
    await Promise.all(work);
  } finally { await pool.close(); }
  members.sort((a,b)=>a.path.localeCompare(b.path,'en'));
  held.sort((a,b)=>a.path.localeCompare(b.path,'en')||a.rule.localeCompare(b.rule,'en'));
  const reasons={}; for(const h of held) reasons[h.rule]=(reasons[h.rule]??0)+1;
  const report={root,files:inventory.length,members,heldMembers:new Set(held.map(h=>h.path)).size,reasons,held,status:held.length?'HOLD':'CLEAR',budgetMs,elapsedMs:Date.now()-started,cacheHits,gitHistory,
    unsupportedEncoding:Object.entries(triage).map(([type,count])=>({extension:type.split('|')[0],magic:type.split('|')[1],count})).sort((a,b)=>b.count-a.count)};
  if (receiptDir) {
    const writeReceipt = (name, text) => {
      const fd = openSync(join(receiptDir,name), constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
      try {
        const stat=fstatSync(fd);
        if(!stat.isFile() || stat.nlink!==1) throw new Error('receipt-location');
        ftruncateSync(fd,0); writeFileSync(fd,text);
      } finally {closeSync(fd);}
    };
    const grouped=new Map(); for(const h of held) { if(!grouped.has(h.path)) grouped.set(h.path,[]); grouped.get(h.path).push(h.rule); }
    const heldPaths=new Set(grouped.keys());
    const cell=x=>JSON.stringify(x); // quoted cells safely encode tabs/newlines in filenames
    writeReceipt('upload-manifest.tsv','path\tbytes\tsha256\n'+members.filter(m=>!heldPaths.has(m.path)).map(m=>`${cell(m.path)}\t${m.bytes}\t${m.sha256}\n`).join(''));
    writeReceipt('held.tsv','path\treasons\n'+[...grouped].map(([path,rules])=>`${cell(path)}\t${cell(rules)}\n`).join(''));
    writeReceipt('scan-cache.json',JSON.stringify(auth.seal({root,policy,entries})));
    writeReceipt('receipt.json',JSON.stringify([report],null,2)+'\n');
  }
  return report;
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
  try { const {root,options}=JSON.parse(process.argv[2]); console.log(JSON.stringify(await classifyAsync(root,options))); }
  catch { console.error('scan-classification-error'); process.exitCode=1; }
}
