// Exact manifest contracts and a deliberately narrow, streaming USTAR codec.
// No extraction, shell expansion, link entries, PAX overrides or GNU extensions.
import { readFileSync, openSync, closeSync, readSync, writeSync, lstatSync, fstatSync, realpathSync, constants } from 'node:fs';
import { resolve, dirname, join, sep } from 'node:path';
import { createHash } from 'node:crypto';

const fail = reason => { throw new Error(reason); };
const validPath = p => typeof p==='string' && p.length>0 && !p.includes('\0') && !p.startsWith('/') && !p.split('/').some(s=>!s || s==='.' || s==='..');
const validMember = m => m && validPath(m.path) && Number.isSafeInteger(m.bytes) && m.bytes>=0 && /^[a-f0-9]{64}$/.test(m.sha256);
const same = (a,b) => a.bytes===b.bytes && a.sha256===b.sha256;
function heldMatcher(entries) {
  const paths=new Set(entries.map(h=>h.path));
  return path=>{let p=path;while(true){if(paths.has(p))return true;const i=p.lastIndexOf('/');if(i<0)return false;p=p.slice(0,i);}};
}
export function loadSet(receipt, manifest) {
  const reports=JSON.parse(readFileSync(receipt,'utf8'));
  if(!Array.isArray(reports) || reports.length!==1) fail('clear-set-invalid-receipt');
  const saved=reports[0];
  if(typeof saved.root!=='string' || resolve(saved.root)!==saved.root || !Array.isArray(saved.members) || !Array.isArray(saved.held) || !['CLEAR','HOLD'].includes(saved.status)) fail('clear-set-invalid-receipt');
  const all=new Map();
  for(const m of saved.members) {
    if(!validPath(m.path) || all.has(m.path)) fail('clear-set-invalid-receipt');
    all.set(m.path,m);
  }
  if(saved.held.some(h=>!validPath(h.path) || typeof h.rule!=='string')) fail('clear-set-invalid-receipt');
  const held = heldMatcher(saved.held);
  const expected=new Map([...all].filter(([p])=>!held(p)));
  if([...expected.values()].some(m=>!validMember(m))) fail('clear-set-invalid-receipt');
  const lines=readFileSync(manifest??join(dirname(resolve(receipt)),'upload-manifest.tsv'),'utf8').split('\n');
  if(lines.shift()!=='path\tbytes\tsha256' || lines.pop()!=='') fail('clear-set-invalid-manifest');
  const members=[]; const seen=new Set();
  for(const line of lines) {
    const cells=line.split('\t');
    if(cells.length!==3 || !/^(0|[1-9][0-9]*)$/.test(cells[1])) fail('clear-set-invalid-manifest');
    const m={path:JSON.parse(cells[0]),bytes:Number(cells[1]),sha256:cells[2]};
    if(!validMember(m) || seen.has(m.path)) fail('clear-set-invalid-manifest');
    seen.add(m.path); members.push(m);
    if(!expected.has(m.path) || !same(expected.get(m.path),m)) fail('clear-set-manifest-mismatch');
  }
  if(members.length!==expected.size) fail('clear-set-manifest-mismatch');
  return {saved,members};
}
export function verifySet(receipt, manifest, classify) {
  const {saved,members}=loadSet(receipt,manifest);
  const current=classify(saved.root,{verify:true});
  if(!saved.policy || saved.policy!==current.policy) fail('clear-set-policy-mismatch');
  const live=new Map(current.members.map(m=>[m.path,m]));
  const held=heldMatcher(current.held);
  for(const m of members) {
    if(held(m.path)) fail('clear-set-member-held');
    if(!live.has(m.path)) fail('clear-set-member-missing');
    if(!same(m,live.get(m.path))) fail('clear-set-member-mismatch');
  }
  const old=new Set([...saved.members.map(m=>m.path),...saved.held.map(h=>h.path)]);
  const added=new Set([...current.members.map(m=>m.path),...current.held.map(h=>h.path)].filter(p=>!old.has(p)));
  return added.size;
}
function regular(path) {
  if(lstatSync(path).isSymbolicLink()) fail('clear-set-symlink');
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  if(!fstatSync(fd).isFile()) {closeSync(fd);fail('clear-set-unsupported-member');}
  return fd;
}
function sourceFile(root,path) {
  // Every ancestor, including root's ancestors, must be a real directory.
  let cursor=resolve(root);
  while(true) {if(!lstatSync(cursor).isDirectory()) fail('clear-set-symlink');const parent=dirname(cursor);if(parent===cursor)break;cursor=parent;}
  cursor=root;
  for(const part of path.split('/').slice(0,-1)) {cursor=join(cursor,part);if(!lstatSync(cursor).isDirectory()) fail('clear-set-symlink');}
  return regular(join(root,path));
}
function readExact(fd,n) {
  const buf=Buffer.alloc(n);let pos=0;
  while(pos<n) {const got=readSync(fd,buf,pos,n-pos,null);if(!got)fail('tar-truncated');pos+=got;}
  return buf;
}
function writeAll(fd,buf) {let pos=0;while(pos<buf.length)pos+=writeSync(fd,buf,pos,buf.length-pos);}
function transfer(fd,n,out) {
  const hash=createHash('sha256');
  while(n) {const bytes=readExact(fd,Math.min(n,65536));hash.update(bytes);if(out!==undefined)writeAll(out,bytes);n-=bytes.length;}
  return hash.digest('hex');
}
function octal(buf,pos,len,n) {
  const s=n.toString(8);if(s.length>=len)fail('tar-size-limit');buf.write(s.padStart(len-1,'0')+'\0',pos,len,'ascii');
}
function header(m) {
  const b=Buffer.alloc(512);let name=m.path,prefix='';
  if(Buffer.byteLength(name)>100) {
    const splits=[...name.matchAll(/\//g)].map(m=>m.index).reverse();
    const split=splits.find(i=>Buffer.byteLength(name.slice(0,i))<=155 && Buffer.byteLength(name.slice(i+1))<=100);
    if(split===undefined)fail('tar-path-limit');prefix=name.slice(0,split);name=name.slice(split+1);
  }
  b.write(name,0);b.write(prefix,345);octal(b,100,8,0o600);octal(b,108,8,0);octal(b,116,8,0);octal(b,124,12,m.bytes);octal(b,136,12,0);
  b.fill(32,148,156);b[156]=48;b.write('ustar\0',257);b.write('00',263);
  octal(b,148,7,b.reduce((n,v)=>n+v,0));b[155]=32;return b;
}
export function stageSet(receipt,manifest,out) {
  const {saved,members}=loadSet(receipt,manifest);
  const dest=join(realpathSync(dirname(resolve(out))),resolve(out).split(sep).pop());
  const root=realpathSync(saved.root);
  if(dest===root || dest.startsWith(root+sep)) fail('clear-set-output-inside-source');
  const output=openSync(dest,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try {
    for(const m of members) {
      const fd=sourceFile(saved.root,m.path);
      try {
        if(fstatSync(fd).size!==m.bytes)fail('clear-set-member-mismatch');
        writeAll(output,header(m));
        if(transfer(fd,m.bytes,output)!==m.sha256 || readSync(fd,Buffer.alloc(1),0,1,null)!==0) fail('clear-set-member-mismatch');
        writeAll(output,Buffer.alloc((512-m.bytes%512)%512));
      } finally {closeSync(fd);}
    }
    writeAll(output,Buffer.alloc(1024));
  } finally {closeSync(output);}
}
export function verifyTar(receipt,manifest,tar) {
  const {members}=loadSet(receipt,manifest), expected=new Map(members.map(m=>[m.path,m])), seen=new Set();
  const fd=regular(tar);
  const field=(b,p,n)=>{const v=b.subarray(p,p+n),zero=v.indexOf(0),raw=zero<0?v:v.subarray(0,zero),text=raw.toString('utf8');if(!Buffer.from(text).equals(raw))fail('tar-invalid-header');return text;};
  const number=(b,p,n)=>{const s=field(b,p,n).trim();if(!/^[0-7]+$/.test(s))fail('tar-invalid-header');const v=parseInt(s,8);if(!Number.isSafeInteger(v))fail('tar-invalid-header');return v;};
  try {
    while(true) {
      const b=readExact(fd,512);
      if(b.every(v=>v===0)) {
        if(readExact(fd,512).some(v=>v!==0))fail('tar-extra-entry');
        // Allow conventional tar zero record padding, never concatenated archives.
        const rest=Buffer.alloc(65536);let n;while((n=readSync(fd,rest,0,rest.length,null)))if(rest.subarray(0,n).some(v=>v!==0))fail('tar-extra-entry');
        break;
      }
      const checksum=number(b,148,8);b.fill(32,148,156);
      if(b.reduce((n,v)=>n+v,0)!==checksum || field(b,257,6)!=='ustar' || field(b,263,2)!=='00')fail('tar-invalid-header');
      if(b[156]!==48 && b[156]!==0)fail('tar-unsupported-entry');
      if(field(b,157,100))fail('tar-unsupported-entry');
      const prefix=field(b,345,155),path=(prefix?prefix+'/':'')+field(b,0,100), size=number(b,124,12);
      if(!validPath(path) || seen.has(path) || !expected.has(path))fail('tar-extra-entry');
      seen.add(path);const m=expected.get(path);
      if(size!==m.bytes || transfer(fd,size)!==m.sha256)fail('tar-member-mismatch');
      if(readExact(fd,(512-size%512)%512).some(v=>v!==0))fail('tar-invalid-padding');
    }
    if(seen.size!==expected.size)fail('tar-member-missing');
  } finally {closeSync(fd);}
}
