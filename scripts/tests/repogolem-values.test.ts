import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isOpCredential } from '../repogolem/repogolem-check-refs';
import type { BackendSettings } from '../repogolem/repogolem-varlock';
const cli = join(import.meta.dir, '../repogolem/repogolem-config.ts');
let dir: string, file: string, out: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'rgvalues-')); file=join(dir,'values.env'); out=join(dir,'out'); writeFileSync(file,"TOKEN='VALUES_CANARY'\nGRILL_SEED_DIR='/home/fixture/private seed'\n",{mode:0o600}); });
afterEach(() => rmSync(dir,{recursive:true,force:true}));
function run(backend='file', values: NonNullable<BackendSettings['values']> = { TOKEN: { sensitive:true }, GRILL_SEED_DIR: { sensitive:false } }, extra: Partial<NonNullable<BackendSettings['secrets']>> = {}, options: { env?: Record<string,string>; program?: string; defaultFile?: boolean } = {}) {
  const config=join(dir,'config.yaml');
  writeFileSync(config,JSON.stringify({secrets:{backend,...(options.defaultFile ? {} : {valuesFile:file}),...extra},values,projects:{fixture:{path:'/home/fixture',clis:['codex'],secrets:{TOKEN:'varlock://TOKEN'}}}}));
  const environment={...process.env}; if(backend==='1password') for(const key of Object.keys(environment)) if(isOpCredential(key)) delete environment[key];
  const r=Bun.spawnSync([process.execPath,options.program??cli,'generate','--config',config,'--out-dir',out,'--home','/home/fixture'],{env:{...environment,REPOGOLEM_OP_BIN:'/no-real-op',REPOGOLEM_SOURCE_SHA:'0'.repeat(40),...options.env},stdout:'pipe',stderr:'pipe'});
  const text=r.stdout.toString()+r.stderr.toString(); expect(text).not.toContain('VALUES_CANARY');
  if(existsSync(out))expect(readFileSync(join(out,'registry.json'),'utf8')).not.toContain('VALUES_CANARY');
  return {code:r.exitCode,text};
}
test('file backend resolves declared sensitive and personal non-sensitive values through varlock',async()=>{
  expect(run().code).toBe(0);
  const { readRuntime }=await import('../repogolem/runtime-reader');
  expect(readRuntime(out).projects.fixture.secrets.TOKEN).toBe('VALUES_CANARY');
  expect(readFileSync(join(out,'secrets.env'),'utf8')).toContain('private seed');
});
test('missing value preserves previous cache; unknown named reference fails closed',()=>{
  expect(run().code).toBe(0);const before=readFileSync(join(out,'secrets.env'),'utf8');
  writeFileSync(file,'GRILL_SEED_DIR=/home/fixture\n');expect(run().code).toBe(2);
  expect(readFileSync(join(out,'secrets.env'),'utf8')).toBe(before);
  const missing=run('file',{OTHER:{sensitive:true}});expect(missing.code).toBe(2);expect(missing.text).toContain('projects.fixture.secrets.TOKEN');
});
test('permissive private values file is refused before writing',()=>{
  chmodSync(file,0o644);expect(run().code).toBe(2);expect(existsSync(out)).toBe(false);
});
test('BYO normal varlock plugin resolves named keys and inherits no declared overrides',()=>{
  const plugin=join(dir,'plugin.cjs');
  writeFileSync(plugin,`const {plugin}=require('varlock/plugin-lib'); plugin.name='fixture'; plugin.registerResolverFunction({name:'repoGolemBatch',argsSchema:{type:'array',arrayMinLength:1,arrayMaxLength:1},process(){return this.arrArgs[0].staticValue;},resolve(){return JSON.stringify({TOKEN:'VALUES_CANARY',GRILL_SEED_DIR:'/home/fixture/b yo'});}});`);
  expect(run('plugin:'+plugin,undefined,{}, {env:{TOKEN:'INHERITED_CANARY'}}).code).toBe(0);
  expect(readFileSync(join(out,'secrets.env'),'utf8')).not.toContain('INHERITED_CANARY');
});
test('reserved credential names cannot become non-sensitive schema values',()=>{
  expect(run('file',{OP_SERVICE_ACCOUNT_TOKEN:{sensitive:false},TOKEN:{sensitive:true}}).code).toBe(2);
});
test('named 1Password sources and personal file values resolve with one deduplicated op batch',()=>{
  const log=join(dir,'op.log');
  const result=run('1password',{TOKEN:{sensitive:true,source:'op://example-vault/example-item/token'},GRILL_SEED_DIR:{sensitive:false}}, {}, {env:{REPOGOLEM_OP_BIN:join(import.meta.dir,'fixtures/repogolem-config/fake-op.sh'),FAKE_OP_LOG:log}});
  expect(result.code).toBe(0);
  expect(readFileSync(log,'utf8').split('\n').filter(line=>line.startsWith('run '))).toHaveLength(1);
  expect(readFileSync(join(out,'secrets.env'),'utf8')).toContain('resolved:op://example-vault/example-item/token');
});
test('npm backend resolves the installed package export rather than downloading from scratch cwd',()=>{
  // A controlled installed-package fixture; never fetch or run a real provider.
  const packageRoot=join(dir,'node_modules/fixture-backend');
  require('node:fs').mkdirSync(packageRoot,{recursive:true});
  writeFileSync(join(packageRoot,'package.json'),JSON.stringify({name:'fixture-backend',version:'1.0.0',exports:{'./plugin':'./plugin.cjs'}}));
  writeFileSync(join(packageRoot,'plugin.cjs'),`const {plugin}=require('varlock/plugin-lib'); plugin.name='fixture'; plugin.registerResolverFunction({name:'repoGolemBatch',argsSchema:{type:'array',arrayMinLength:1,arrayMaxLength:1},process(){return null;},resolve(){return JSON.stringify({TOKEN:'VALUES_CANARY',GRILL_SEED_DIR:'/home/fixture'});}});`);
  // Explicit installed package lookup location is private config's directory.
  expect(run('plugin:fixture-backend',undefined,{pluginVersion:'1.0.0'}).code).toBe(0);
  expect(run('plugin:fixture-backend',undefined,{pluginVersion:'2.0.0'}).code).toBe(2);
});
test('default private values file is used under scratch HOME with no op invocation',()=>{
  const destination=join(dir,'.config/repogolem');
  require('node:fs').mkdirSync(destination,{recursive:true,mode:0o700});
  writeFileSync(join(destination,'values.env'),readFileSync(file),{mode:0o600});
  expect(run('1password',undefined,{}, {defaultFile:true,env:{HOME:dir}}).code).toBe(0);
});
test('symlink and in-repo values sources are refused',()=>{
  const linked=join(dir,'linked.env');require('node:fs').symlinkSync(file,linked);
  expect(run('file',undefined,{valuesFile:linked}).code).toBe(2);
  require('node:fs').mkdirSync(join(dir,'.git'));
  expect(run().code).toBe(2);expect(existsSync(out)).toBe(false);
});
test('installed CLI loads the packaged file plugin with personal settings kept out of registry',()=>{
  const config=join(dir,'install.yaml');
  writeFileSync(config,'seatRegistry:\n  seats:\n    fixture:\n      launcherPrefix: custom\nprojects: {}\n');
  const r=Bun.spawnSync([process.execPath,cli,'install','--config',config,'--apply'],{env:{...process.env,HOME:dir,REPOGOLEM_OP_BIN:'/no-real-op'},stdout:'pipe',stderr:'pipe'});
  expect(r.exitCode).toBe(0);
  expect(run('file',undefined,{}, {program:join(dir,'.config/repogolem/runtime/repogolem-cli.js'),env:{HOME:dir}}).code).toBe(0);
});

test('private file path with decorator syntax stays literal',()=>{
  const hostile=join(dir,'values "quote" \\ ${literal}.env');
  writeFileSync(hostile,readFileSync(file),{mode:0o600});
  expect(run('file',undefined,{valuesFile:hostile}).code).toBe(0);
});

test('uninstalled npm backend never requests a registry or creates a Bun cache',async()=>{
  const home=join(dir,'home');require('node:fs').mkdirSync(home);
  let requests=0;const registry=Bun.serve({port:0,fetch(){requests++;return new Response('{}',{status:404});}});
  try {
    const config=join(dir,'missing-package.yaml');writeFileSync(config,JSON.stringify({secrets:{backend:'plugin:repogolem-missing-fixture'},values:{TOKEN:{sensitive:true}},projects:{}}));
    const r=Bun.spawn([process.execPath,cli,'generate','--config',config,'--out-dir',out],{env:{...process.env,HOME:home,BUN_CONFIG_REGISTRY:registry.url.toString()},stdout:'pipe',stderr:'pipe'});
    const [code,stdout,stderr]=await Promise.all([r.exited,new Response(r.stdout).text(),new Response(r.stderr).text()]);
    expect(code).toBe(2);expect(stdout+stderr).not.toContain('VALUES_CANARY');
    expect(existsSync(join(home,'.bun/install/cache'))).toBe(false);expect(requests).toBe(0);expect(existsSync(out)).toBe(false);
  }finally{registry.stop(true);}
});
test('isolated CJS adapter gets no 1Password credentials',()=>{
  const plugin=join(dir,'isolated.cjs');
  writeFileSync(plugin,`const {plugin}=require('varlock/plugin-lib');plugin.name='fixture';plugin.registerResolverFunction({name:'repoGolemBatch',argsSchema:{type:'array',arrayMinLength:1,arrayMaxLength:1},process(){return null;},resolve(){if(Object.keys(process.env).some(k=>k.startsWith('OP_')||['GH_TOKEN','AWS_ACCESS_KEY_ID','ANTHROPIC_API_KEY'].includes(k)))throw Error('credential reached plugin');return JSON.stringify({TOKEN:'VALUES_CANARY',GRILL_SEED_DIR:'/home/fixture'});}});`);
  const result=run('plugin:'+plugin,undefined,{}, {env:{OP_SESSION_fixture:'SESSION_CANARY',OP_SERVICE_ACCOUNT_TOKEN:'TOKEN_CANARY',OP_BIOMETRIC_UNLOCK_ENABLED:'true',GH_TOKEN:'HOST_CANARY',AWS_ACCESS_KEY_ID:'HOST_CANARY',ANTHROPIC_API_KEY:'HOST_CANARY'}});
  expect(result.code).toBe(0);expect(result.text).not.toContain('HOST_CANARY');expect(result.text).not.toContain('TOKEN_CANARY');
});
test('unquoted interpolation is refused with safe literal-value guidance',()=>{
  writeFileSync(file,'TOKEN=${HOME}\nGRILL_SEED_DIR=/home/fixture\n');
  const result=run();expect(result.code).toBe(2);expect(result.text).toContain('single-quote literal values');expect(existsSync(out)).toBe(false);
});
for(const kind of ['directory','worktree'])test(`values file in a separate git ${kind} is refused`,()=>{
  const repo=join(dir,'repo');require('node:fs').mkdirSync(repo);
  if(kind==='directory')require('node:fs').mkdirSync(join(repo,'.git'));else writeFileSync(join(repo,'.git'),'gitdir: /home/fixture/git\n');
  const privateFile=join(repo,'values.env');writeFileSync(privateFile,readFileSync(file),{mode:0o600});
  expect(run('file',undefined,{valuesFile:privateFile}).code).toBe(2);expect(existsSync(out)).toBe(false);
});
test('file backend rejects provider sources and reserved runtime value names',()=>{
  expect(run('file',{TOKEN:{sensitive:true,source:'op://example-vault/example-item/token'}}).code).toBe(2);
  for(const name of ['PATH','HOME','TMPDIR','NODE_OPTIONS','BUN_OPTIONS','DYLD_LIBRARY_PATH'])expect(run('file',{TOKEN:{sensitive:true},[name]:{sensitive:false}}).code).toBe(2);
});

test('copied CJS template runs outside node_modules with a hostile plugin pathname',()=>{
  const plugin=join(dir,'adapter "quote" \\ ${literal}.cjs');
  const template=readFileSync(join(import.meta.dir,'../repogolem/adapters/TEMPLATE/plugin.cjs'),'utf8');
  writeFileSync(plugin,template.replace("throw new Error('implement provider batch before using this template');","return Object.fromEntries(_refs.map(ref=>[ref,ref==='varlock://TOKEN'?'VALUES_CANARY':'/home/fixture']));"));
  expect(run('plugin:'+plugin).code).toBe(0);expect(existsSync(join(dir,'node_modules'))).toBe(false);
});
test('npm export cannot escape its installed package directory',()=>{
  const root=join(dir,'node_modules/fixture-escape');require('node:fs').mkdirSync(root,{recursive:true});
  writeFileSync(join(dir,'escape.cjs'),`const {plugin}=require('varlock/plugin-lib');plugin.name='escape-fixture';plugin.registerResolverFunction({name:'repoGolemBatch',argsSchema:{type:'array',arrayMinLength:1,arrayMaxLength:1},process(){return null;},resolve(){return JSON.stringify({TOKEN:'VALUES_CANARY',GRILL_SEED_DIR:'/home/fixture'});}});`);
  for(const entry of ['../../../escape.cjs','./link.cjs']){
    writeFileSync(join(root,'package.json'),JSON.stringify({name:'fixture-escape',exports:{'./plugin':entry}}));
    if(entry==='./link.cjs')require('node:fs').symlinkSync(join(dir,'escape.cjs'),join(root,'link.cjs'));
    expect(run('plugin:fixture-escape').code).toBe(2);expect(existsSync(out)).toBe(false);
  }
});
for(const extension of ['mjs','ts'])test(`BYO rejects ${extension} before executing adapter code`,()=>{
  const plugin=join(dir,'rejected.'+extension),marker=join(dir,'adapter-loaded');
  writeFileSync(plugin,"import {writeFileSync} from 'node:fs';writeFileSync(process.env.HOME+'/adapter-loaded','executed');throw Error('adapter executed');");
  const result=run('plugin:'+plugin,undefined,{}, {env:{HOME:dir}});
  expect(result.code).toBe(2);expect(existsSync(marker)).toBe(false);expect(result.text).toContain('not installed; nothing written');expect(existsSync(out)).toBe(false);
});
