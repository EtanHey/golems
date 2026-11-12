#!/usr/bin/env node
// Close only registered linked worktrees. No force removal, and no network fetch.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { preserveDocs, stackHold } from './worktree-preservation.mjs';
const OUTPUTS = ['.build.noindex','node_modules','.test-tmp','dist','.build','target','__pycache__','.venv'];
const git = (cwd,...args) => execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
function bytes(p) { const s=fs.lstatSync(p); return s.isDirectory()&&!s.isSymbolicLink()?fs.readdirSync(p).reduce((n,x)=>n+bytes(path.join(p,x)),0):s.size; }
function modified(p) { const s=fs.lstatSync(p); return s.isDirectory()&&!s.isSymbolicLink()?Math.max(s.mtimeMs,...fs.readdirSync(p).map(x=>modified(path.join(p,x)))):s.mtimeMs; }
function inventory(repo) {
 return git(repo,'worktree','list','--porcelain','-z').split('\0\0').filter(Boolean).map(block=>{
   const lines=block.split('\0'); const get=k=>lines.find(x=>x.startsWith(k+' '))?.slice(k.length+1);
   return {path:get('worktree'),branch:get('branch')?.replace('refs/heads/','')||null,locked:lines.some(x=>x==='locked'||x.startsWith('locked '))};
 });
}
function context(input) {
 const p=fs.realpathSync(input); const root=fs.realpathSync(git(p,'rev-parse','--show-toplevel'));
 if(p!==root) throw Error('Not a worktree root. Pass an exact registered worktree path.');
 const common=fs.realpathSync(path.resolve(p,git(p,'rev-parse','--git-common-dir')));
 const all=inventory(p); const entry=all.find(x=>fs.existsSync(x.path)&&fs.realpathSync(x.path)===p);
 if(!entry) throw Error('Not a registered worktree. Run git worktree list.');
 return {p,common,all,entry,primary:all[0].path};
}
export function worktreeStatus(worktreePath) {
 const w={path:worktreePath};
 const hidden=git(w.path,'ls-files','-v').split('\n').some(l=>/^[a-zS]/.test(l));
 const dirty=hidden||!!git(w.path,'status','--porcelain','--untracked-files=all');
 const unpushed=!!git(w.path,'rev-list','HEAD','--not','--remotes');
 let merged=false;
 try { const ref=git(w.path,'symbolic-ref','refs/remotes/origin/HEAD'); git(w.path,'merge-base','--is-ancestor','HEAD',ref); merged=true; } catch {}
 return {head:git(w.path,'rev-parse','HEAD'),dirty,unpushed,state:dirty?'dirty':unpushed?'unpushed':merged?'merged':'pushed-clean',merged};
}
function clean(p) {
 const config=path.join(p,'.golems-closeout.json'); const extra=fs.existsSync(config)?JSON.parse(fs.readFileSync(config,'utf8')).outputs||[]:[];
 if(!Array.isArray(extra)||extra.some(x=>typeof x!=='string'||!x||x==='.'||x==='..'||x.includes('/')||x.includes('\\')||x==='.git')) throw Error('outputs must contain directory basenames only, excluding .git.');
 const names=new Set([...OUTPUTS,...extra]); const targets=[];
 function walk(dir) { for(const name of fs.readdirSync(dir)) { if(name==='.git') continue; const q=path.join(dir,name), s=fs.lstatSync(q); if(s.isSymbolicLink()||!s.isDirectory()) continue; if(names.has(name)) targets.push(q); else walk(q); } }
 walk(p);
 // A name alone is insufficient authority to delete tracked or nested repository data.
 const tracked=git(p,'ls-files','-z').split('\0').filter(Boolean);
 for(const q of targets) {
  const relative=path.relative(p,q);
  if(tracked.some(x=>x===relative||x.startsWith(relative+'/'))) throw Error(`Build output contains tracked files: ${relative}. Keep it or change the output list.`);
  function nested(dir) { if(fs.existsSync(path.join(dir,'.git'))) throw Error(`Nested repository in ${relative}; move it before cleanup.`); for(const n of fs.readdirSync(dir)) { const child=path.join(dir,n); if(fs.lstatSync(child).isDirectory()&&!fs.lstatSync(child).isSymbolicLink()) nested(child); } } nested(q);
 }
 let freed=0; for(const q of targets) { freed+=bytes(q); fs.rmSync(q,{recursive:true}); } return freed;
}
function branchDisposition(c,s) {
 let branchAction='kept', reason='detached HEAD or archived unpushed branch';
 if(c.entry.branch&&!s.unpushed) { try {git(c.primary,'branch','-d',c.entry.branch);branchAction='deleted';reason='merged';} catch {reason='fully pushed; git branch -d requires merge into its upstream; branch retained without force';} }
 return {branch:c.entry.branch,branchAction,reason};
}
export function closeWorktree(worktreePath, expectedHead, deleteBranch = true) {
 const c=context(worktreePath);
 if(c.p===fs.realpathSync(c.primary)||c.p===path.dirname(c.common)||c.entry.locked) throw Error('Root or locked worktree refused');
 const before=worktreeStatus(c.p);
 if(before.dirty||before.unpushed||expectedHead&&before.head!==expectedHead) throw Error('Worktree changed or is dirty/unpushed');
 const hold=stackHold(c.p,c.entry.branch);
 if(hold)return {path:c.p,reason:hold,worktree:'kept'};
 const docs=preserveDocs(c.p,c.primary,c.entry.branch,before.head);
 const current=worktreeStatus(c.p);
 if(current.dirty||current.unpushed||current.head!==before.head)throw Error('Worktree changed before removal; archive retained');
 const bytesFreed=clean(c.p), remaining=bytes(c.p);
 git(c.primary,'worktree','remove',c.p);
 if(inventory(c.primary).some(w=>w.path===c.p))throw Error('Removal registration proof failed');
 try {fs.lstatSync(c.p);throw Error('Removed worktree path still present');}catch(e){if(e.code!=='ENOENT')throw e;}
 return {path:c.p,...(deleteBranch?branchDisposition(c,before):{branch:c.entry.branch,branchAction:'kept'}),bytesFreed:bytesFreed+remaining,buildBytesFreed:bytesFreed,docs,worktree:'removed',
  proof:'git worktree remove exit 0; git worktree list --porcelain path absent; filesystem path absent',
  receiptLine:`moved ${docs.files.length} files / ${docs.bytes} bytes to ${docs.destination||'(none)'}${docs.collision?' (collision: suffixed)':''}; worktree removed; proof: git worktree list --porcelain path absent`};
}
function main() {
 const args=process.argv.slice(2); const take=k=>{const i=args.indexOf(k); if(i<0)return null; if(!args[i+1]||args[i+1].startsWith('--'))throw Error(`${k} requires a value`); const v=args[i+1];args.splice(i,2);return v;};
 const json=args.includes('--json'); if(json)args.splice(args.indexOf('--json'),1);
 const triage=take('--triage'), bundle=take('--bundle'), keep=take('--keep');
 if(args.some(x=>x.startsWith('--'))||args.length>1||[triage,bundle,args[0]].filter(Boolean).length!==1||bundle&&keep) throw Error('Usage: worktree-closeout.mjs <path> [--keep reason] | --bundle <path> | --triage <repo> [--json]');
 if(keep!==null&&!keep.trim())throw Error('Keep reason must not be empty');
 const c=context(triage||bundle||args[0]); const ledger=path.join(c.common,'golems-closeout-keeps.json');
 const keeps=fs.existsSync(ledger)?JSON.parse(fs.readFileSync(ledger,'utf8')):{};
 const emit=x=>console.log(json?JSON.stringify(x):JSON.stringify(x,null,2));
 if(triage) {
  const rows=c.all.map(w=>{if(!fs.existsSync(w.path))return {...w,state:'missing',flagged:true}; const s=worktreeStatus(w.path),head=git(w.path,'rev-parse','HEAD'),lastCommit=Number(git(w.path,'show','-s','--format=%ct','HEAD'))*1000,lastMtime=modified(w.path); const kept=keeps[w.path]; const reason=kept?.head===head&&kept?.status===git(w.path,'status','--porcelain','--untracked-files=all')?kept.reason:null;
   return {...w,...s,lastCommit:new Date(lastCommit).toISOString(),lastMtime:new Date(lastMtime).toISOString(),bytes:bytes(w.path),keepReason:reason,flagged:(s.dirty||s.unpushed)&&Date.now()-Math.max(lastCommit,lastMtime)>48*3600000&&!reason,actions:['--bundle <path>','<path> --keep "reason"']};});
  emit(rows); process.exitCode=rows.some(x=>x.flagged)?3:0; return;
 }
 if(c.p===fs.realpathSync(c.primary)||c.p===path.dirname(c.common))throw Error('Root checkout refused. Close a linked worktree instead.');
 if(c.entry.locked)throw Error('Worktree is locked. Resolve its lock explicitly before closeout.');
 const s=worktreeStatus(c.entry.path); let archive=null;
 if((s.dirty||s.unpushed)&&!bundle&&!keep)throw Error(`${s.dirty?'Dirty':'Unpushed'} worktree refused. Commit and push, use --bundle <path>, or --keep "reason".`);
 if(!bundle&&!keep) { emit(closeWorktree(c.p)); return; }
 if(bundle) {
  const hold=stackHold(c.p,c.entry.branch); if(hold){emit({path:c.p,reason:hold,worktree:'kept'});return;}
  const parent=path.join(c.primary,'docs.local','worktree-archive');
  git(c.primary,'check-ignore','--quiet','--',path.join(parent,'probe'));
  fs.mkdirSync(parent,{recursive:true}); archive=fs.mkdtempSync(path.join(parent,'closeout-'));
  fs.writeFileSync(path.join(archive,'dirty.patch'),execFileSync('git',['diff','HEAD','--binary'],{cwd:c.p}));
  const untracked=git(c.p,'ls-files','--others','--exclude-standard','-z').split('\0').filter(Boolean);
  for(const file of untracked) {const dest=path.join(archive,'untracked',file);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.cpSync(path.join(c.p,file),dest,{dereference:false});}
  git(c.p,'bundle','create',path.join(archive,'work.bundle'),'HEAD','--all'); git(c.p,'bundle','verify',path.join(archive,'work.bundle'));
  fs.writeFileSync(path.join(archive,'receipt.json'),JSON.stringify({path:c.p,head:git(c.p,'rev-parse','HEAD'),untracked},null,2));
  // Stash also retains the dirty state in Git; normal worktree removal still enforces cleanliness.
  if(s.dirty)git(c.p,'stash','push','--include-untracked','-m','worktree-closeout archived state');
 }
 if(keep) { const bytesFreed=clean(c.p); keeps[c.p]={reason:keep,head:git(c.p,'rev-parse','HEAD'),status:git(c.p,'status','--porcelain','--untracked-files=all')}; fs.writeFileSync(ledger,JSON.stringify(keeps,null,2)); emit({path:c.p,bytesFreed,branch:c.entry.branch,branchAction:'kept',reason:keep});return; }
 const docs=preserveDocs(c.p,c.primary,c.entry.branch,s.head);
 const bytesFreed=clean(c.p);
 const remaining=bytes(c.p); git(c.primary,'worktree','remove',c.p);
 emit({path:c.p,bytesFreed:bytesFreed+remaining,...branchDisposition(c,s),archive,docs});
}
if(process.argv[1]===fileURLToPath(import.meta.url)) { try {main();} catch(e) {console.error(`closeout: ${e.message}`);process.exitCode=1;} }
