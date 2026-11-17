import { spawn } from 'node:child_process';
import { readFileSync, lstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative, sep } from 'node:path';
import { isUtf8 } from 'node:buffer';
import { MAX_SCAN_BYTES } from './scan-content.mjs';
import { credentialPathRule, packageTree } from './credential-policy.mjs';
import { isCredentialDir } from './rollup.mjs';

function gitProcess(repo, args, deadline) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('GIT_')));
  Object.assign(env,{GIT_NO_LAZY_FETCH:'1',GIT_OPTIONAL_LOCKS:'0',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CEILING_DIRECTORIES:dirname(repo),GIT_TERMINAL_PROMPT:'0'});
  const child=spawn('git',['--no-lazy-fetch','--no-replace-objects','--git-dir='+join(repo,'.git'),'--work-tree='+repo,
    '-c','core.fsmonitor=false','-c','core.commitGraph=false','-c','core.hooksPath=/dev/null',...args],{stdio:['ignore','pipe','ignore'],env});
  const exit=new Promise(resolve=>{child.on('error',()=>resolve(-1));child.on('close',resolve);});
  const timer=setTimeout(()=>child.kill('SIGKILL'),Math.max(1,deadline-Date.now()));
  return {child,exit,async close(){clearTimeout(timer);child.kill('SIGKILL');await exit;}};
}
async function gitText(repo,args,deadline,onLine) {
  const p=gitProcess(repo,args,Math.min(deadline,Date.now()+15_000));
  let text='';
  try {
    for await(const chunk of p.child.stdout) {
      text+=chunk.toString('utf8'); if(text.length>1024*1024) throw new Error();
      let end; while((end=text.indexOf('\n'))>=0){onLine(text.slice(0,end));text=text.slice(end+1);}
    }
    if(text) onLine(text);
    if(await p.exit!==0) throw new Error();
  } finally {await p.close();}
}
function parseTree(data, oidBytes) {
  const entries=[]; let at=0;
  while(at<data.length) {
    const space=data.indexOf(32,at), end=data.indexOf(0,space+1);
    if(space<at || end<space || end+1+oidBytes>data.length) throw new Error();
    const mode=data.toString('ascii',at,space), raw=data.subarray(space+1,end);
    if(!/^(40000|100644|100755|120000|160000)$/.test(mode)||!isUtf8(raw)) throw new Error();
    const name=raw.toString('utf8');
    if(!name || name==='.' || name==='..' || name.includes('/') || name.includes('\\')) throw new Error();
    entries.push({name,mode,oid:data.subarray(end+1,end+1+oidBytes).toString('hex')});
    at=end+1+oidBytes;
  }
  return entries;
}

// Every object is framed from the same bounded byte stream, including unreachable
// commits/tags/trees. No repository discovery, replacement refs or lazy fetching.
export async function scanHistory(repo,pool,deadline,files=[]) {
  const matches=[], allowed=[], trees=new Map(), seen=new Set(), references=[];
  const paths=files.map(f=>relative(join(repo,'.git'),f.abs).split(sep).join('/'));
  const fail=()=>({clean:false,matches,error:'git-history-error',allowed:[]});
  let p;
  try {
    for(const name of ['HEAD','objects','refs']) {
      const stat=lstatSync(join(repo,'.git',name));
      if(stat.isSymbolicLink() || (name==='HEAD' ? !stat.isFile() : !stat.isDirectory())) throw new Error();
    }
    for(const name of ['commondir','gitdir','objects/info/alternates','objects/info/http-alternates']) {
      try {lstatSync(join(repo,'.git',name));} catch(e) {if(e.code==='ENOENT') continue;throw e;}
      throw new Error();
    }
    const packs=paths.filter(x=>/^objects\/pack\/pack-[a-f0-9]{40}(?:[a-f0-9]{24})?\.pack$/.test(x));
    const indexes=paths.filter(x=>/^objects\/pack\/pack-[a-f0-9]{40}(?:[a-f0-9]{24})?\.idx$/.test(x));
    if(packs.length!==indexes.length || packs.some(x=>!indexes.includes(x.replace(/\.pack$/,'.idx')))) throw new Error();
    const counts={};await gitText(repo,['count-objects','-v'],deadline,line=>{
      const m=/^([a-z-]+): (\d+)$/.exec(line);if(m)counts[m[1]]=Number(m[2]);
    });
    const loose=paths.filter(x=>/^objects\/[a-f0-9]{2}\/[a-f0-9]{38}(?:[a-f0-9]{24})?$/.test(x));
    if(counts.packs!==packs.length || counts.count!==loose.length) throw new Error();
    let packedObjects=0;
    for(const pack of packs) {
      await gitText(repo,['verify-pack','-v',join(repo,'.git',pack.replace(/\.pack$/,'.idx'))],deadline,line=>{
        if(/^[a-f0-9]{40,64} (?:blob|tree|commit|tag) /.test(line)) packedObjects++;
      });
      allowed.push(pack,pack.replace(/\.pack$/,'.idx'));
    }
    if(counts['in-pack']!==packedObjects) throw new Error();
    p=gitProcess(repo,['cat-file','--batch-all-objects','--batch'],deadline);
    const iter=p.child.stdout[Symbol.asyncIterator]();let pending=Buffer.alloc(0);
    async function take(n,keep=true) {
      const parts=[];let left=n;
      while(left) {
        if(!pending.length){const next=await iter.next();if(next.done)throw new Error();pending=next.value;}
        const count=Math.min(left,pending.length);if(keep)parts.push(pending.subarray(0,count));
        pending=pending.subarray(count);left-=count;
      }
      return keep?Buffer.concat(parts):null;
    }
    let treeEntries=0;
    while(true) {
      let header='';
      while(true) {
        if(!pending.length){const next=await iter.next();if(next.done)break;pending=next.value;}
        const b=pending[0];pending=pending.subarray(1);if(b===10)break;
        header+=String.fromCharCode(b);if(header.length>200)throw new Error();
      }
      if(!header)break;
      if(Date.now()>=deadline)throw new Error();
      const match=/^([a-f0-9]{40}(?:[a-f0-9]{24})?) (blob|tree|commit|tag) (\d+)$/.exec(header);
      if(!match)throw new Error();
      const [,oid,type,rawSize]=match,size=Number(rawSize);
      if(!Number.isSafeInteger(size))throw new Error();
      seen.add(oid);
      if(seen.size>1_000_000)throw new Error();
      if(size>MAX_SCAN_BYTES){await take(size,false);matches.push({blob:oid,type,rules:['scan-size-limit']});}
      else {
        const data=await take(size);
        if(type==='tree') {
          const entries=parseTree(data,oid.length/2);treeEntries+=entries.length;
          if(treeEntries>500_000)throw new Error();
          trees.set(oid,entries);
        } else {
          if(type==='commit' || type==='tag') {
            const header=data.toString('utf8').split('\n\n',1)[0];
            const ref=type==='commit'?/^tree ([a-f0-9]{40,64})$/m:/^object ([a-f0-9]{40,64})$/m;
            const first=ref.exec(header);if(!first)throw new Error();references.push(first[1]);
            if(type==='commit')for(const parent of header.matchAll(/^parent ([a-f0-9]{40,64})$/gm))references.push(parent[1]);
          }
          const receipt=await pool.run({blob:data});
          if(receipt.shapes.length)matches.push({blob:oid,type,rules:receipt.shapes});
        }
      }
      if((await take(1))[0]!==10)throw new Error();
    }
    if(await p.exit!==0)throw new Error();await p.close();p=null;
    if(references.some(oid=>!seen.has(oid)))throw new Error();
    // Starting at every tree covers unreachable subtrees and contextual paths.
    // A bounded traversal refuses pathological DAG expansion instead of omitting it.
    let visits=0;
    for(const [root] of trees) {
      const stack=[{oid:root,path:'',ancestors:new Set()}];
      while(stack.length) {
        const item=stack.pop();if(++visits>1_000_000 || item.path.length>16384 || Date.now()>=deadline)throw new Error();
        if(item.ancestors.has(item.oid))throw new Error();
        const entries=trees.get(item.oid);if(!entries)throw new Error();
        const ancestors=new Set(item.ancestors);ancestors.add(item.oid);
        for(const e of entries) {
          const path=item.path?item.path+'/'+e.name:e.name;
          if(e.mode==='160000')matches.push({blob:e.oid,type:'tree-entry',path,rules:['scan-unsupported-member']});
          else if(!seen.has(e.oid))throw new Error();
          if(credentialPathRule(e.name)||credentialPathRule(path)||isCredentialDir(e.name,packageTree(path))||isCredentialDir(path,packageTree(path))) {
            matches.push({blob:e.oid,type:'tree-entry',path,rules:['credential-history-path']});
          }
          if(e.mode==='40000')stack.push({oid:e.oid,path,ancestors});
        }
      }
    }
    for(const path of loose) {
      if(!seen.has(path.slice(8).replace('/','')))throw new Error();
      allowed.push(path);
    }
    const refs=new Map();let refText='';
    await gitText(repo,['for-each-ref','--format=%(refname) %(objectname)'],deadline,line=>{
      const m=/^(refs\/\S+) ([a-f0-9]{40}(?:[a-f0-9]{24})?)$/.exec(line);
      if(!m || !seen.has(m[2]))throw new Error();
      refs.set(m[1],m[2]);refText+=line+'\n';if(refText.length>MAX_SCAN_BYTES)throw new Error();
    });
    for(const path of paths.filter(x=>x.startsWith('refs/'))) {
      if(lstatSync(join(repo,'.git',path)).size>8192)throw new Error();
      const raw=readFileSync(join(repo,'.git',path),'utf8');
      if(/^ref: refs\/\S+\n?$/.test(raw)) {
        let target='';await gitText(repo,['symbolic-ref','--quiet',path],deadline,line=>{target+=line;});
        if(target!==raw.trim().slice(5) || !refs.has(path))throw new Error();
      } else if(!/^[a-f0-9]{40}(?:[a-f0-9]{24})?\n?$/.test(raw) || refs.get(path)!==raw.trim())throw new Error();
      allowed.push(path);
    }
    const head=readFileSync(join(repo,'.git/HEAD'),'utf8');if(head.length>8192)throw new Error();
    let resolvedHead='';
    if(/^ref: refs\/\S+\n?$/.test(head)) {
      await gitText(repo,['symbolic-ref','--quiet','HEAD'],deadline,line=>{resolvedHead+=line;});
      if(resolvedHead!==head.trim().slice(5))throw new Error();
    } else {
      await gitText(repo,['rev-parse','--verify','HEAD'],deadline,line=>{resolvedHead+=line;});
      if(resolvedHead!==head.trim() || !seen.has(resolvedHead))throw new Error();
    }
    const refReceipt=await pool.run({blob:Buffer.from(refText+head),validatedIndex:true});
    if(refReceipt.shapes.length)matches.push({type:'refs',path:'.git/refs',rules:refReceipt.shapes});
    allowed.push('HEAD');
    if(paths.includes('index')) {
      const stat=lstatSync(join(repo,'.git/index'));if(stat.size>MAX_SCAN_BYTES)throw new Error();
      const data=readFileSync(join(repo,'.git/index'));
      const sha256=[...seen][0]?.length===64, hashBytes=sha256?32:20;
      if(data.length<12+hashBytes || data.toString('ascii',0,4)!=='DIRC' || !createHash(sha256?'sha256':'sha1').update(data.subarray(0,-hashBytes)).digest().equals(data.subarray(-hashBytes)))throw new Error();
      await gitText(repo,['ls-files','--stage'],deadline,()=>{});
      const receipt=await pool.run({blob:data,validatedIndex:true});
      if(receipt.shapes.length)matches.push({type:'index',path:'.git/index',rules:receipt.shapes});
      allowed.push('index');
    }
    // Path hints are advisory; scanning does not depend on reachability or hints.
    const wanted=new Map(matches.filter(m=>m.blob&&!m.path).map(m=>[m.blob,m]));
    if(wanted.size) await gitText(repo,['rev-list','--objects','--all'],deadline,line=>{
      const split=line.indexOf(' '), m=wanted.get(line.slice(0,split));if(m&&!m.path)m.path=line.slice(split+1);
    });
    return {clean:matches.length===0,matches,allowed};
  } catch {return fail();}
  finally {if(p)await p.close();}
}
