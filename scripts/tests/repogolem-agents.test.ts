import { afterEach, beforeEach, expect, test } from 'bun:test';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { prepareAgents } from '../repogolem/repogolem-agents';
import { createHash } from 'node:crypto';
import { secretKey } from '../repogolem/repogolem-secrets';
const cli = join(import.meta.dir, '../repogolem/repogolem-config.ts');
let dir: string, home: string, out: string, template: string, manifest: string, config: string, settings: any;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rgagents-')); home = join(dir, 'home'); mkdirSync(home);
  out = join(home, '.config/repogolem/generated'); template = join(dir, 'fixture.md'); manifest = join(dir, 'fixture.values.json'); config = join(dir, 'config.yaml');
  writeFileSync(template, 'Read {{SEED_DIR}} twice: {{SEED_DIR}}.\n');
  writeFileSync(manifest, JSON.stringify({template:'fixture.md',values:[{name:'SEED_DIR',sensitive:false,purpose:'private seed directory'}]}));
  const values = join(dir, 'values.env'); writeFileSync(values, "SEED_DIR='/home/fixture/private canary'\nTOKEN='AGENT_SECRET_CANARY'\n", {mode:0o600});
  settings = {seatRegistry:{seats:{fixture:{launcherPrefix:'fixture'}}},secrets:{backend:'file',valuesFile:values},values:{SEED_DIR:{sensitive:false},TOKEN:{sensitive:true}},agentTemplates:{fixture:template},projects:{}};
});
afterEach(() => rmSync(dir, {recursive:true,force:true}));
function run(command='generate', flags: string[]=[], program=cli, extraEnv: Record<string,string>={}) {
  writeFileSync(config, stringify(settings));
  const args = command==='generate' ? ['--out-dir',out,'--home',home] : [];
  const r = Bun.spawnSync([process.execPath,'--no-install',program,command,'--config',config,...args,...flags], {env:{...process.env,HOME:home,REPOGOLEM_OP_BIN:'/no-real-op',REPOGOLEM_SOURCE_SHA:'0'.repeat(40),...extraEnv},stdout:'pipe',stderr:'pipe'});
  const text = r.stdout.toString()+r.stderr.toString(); expect(text).not.toContain('AGENT_SECRET_CANARY'); expect(text).not.toContain('private canary');
  return {code:r.exitCode,text};
}
test('renders only declared non-sensitive values into private agents; cache-only check detects tampering', () => {
  expect(run().code).toBe(0); const agent=join(out,'agents/fixture.md');
  expect(readFileSync(agent,'utf8')).toBe('Read /home/fixture/private canary twice: /home/fixture/private canary.\n');
  expect(lstatSync(agent).mode&0o777).toBe(0o600); expect(lstatSync(join(out,'agents')).mode&0o777).toBe(0o700);
  expect(readFileSync(join(out,'registry.json'),'utf8')).not.toContain('private canary');
  expect(readFileSync(join(out,'agents.json'),'utf8')).not.toContain('private canary');
  expect(run('generate',['--check']).code).toBe(0);
  writeFileSync(agent,'tampered\n'); expect(run('generate',['--check']).code).toBe(1);
});
test('sensitive schema OR manifest declarations refuse before any output, including cache', () => {
  settings.values.SEED_DIR.sensitive=true; expect(run().code).toBe(2); expect(existsSync(out)).toBe(false);
  settings.values.SEED_DIR.sensitive=false;
  writeFileSync(manifest,JSON.stringify({template:'fixture.md',values:[{name:'SEED_DIR',sensitive:true,purpose:'secret'}]}));
  expect(run().code).toBe(2); expect(existsSync(out)).toBe(false);
});
test('unresolved, undeclared and malformed placeholders preserve every previous output', () => {
  expect(run().code).toBe(0); const before=readFileSync(join(out,'secrets.env'),'utf8');
  for(const content of ['{{UNDECLARED}}','{{TOKEN}}','{{bad-name}}']) {
    writeFileSync(template,content); expect(run().code).toBe(2);
    expect(readFileSync(join(out,'secrets.env'),'utf8')).toBe(before);
    expect(readFileSync(join(out,'agents/fixture.md'),'utf8')).toContain('private canary');
  }
});
test('manifest template mismatch and duplicate declaration fail independently', () => {
  for(const data of [{template:'other.md',values:[{name:'SEED_DIR',sensitive:false}]},{template:'fixture.md',values:[{name:'SEED_DIR',sensitive:false},{name:'SEED_DIR',sensitive:false}]}]) {
    writeFileSync(manifest,JSON.stringify(data)); expect(run().code).toBe(2); expect(existsSync(out)).toBe(false);
  }
});
test('unsafe agent name is refused with an otherwise valid manifest', () => {
  settings.agentTemplates={'../escape':template}; expect(run().code).toBe(2); expect(existsSync(out)).toBe(false);
});
test('symlink output directory is refused before changing old cache or outside target', () => {
  expect(run().code).toBe(0); const before=readFileSync(join(out,'secrets.env'),'utf8');
  rmSync(join(out,'agents'),{recursive:true}); const outside=join(dir,'outside');mkdirSync(outside);symlinkSync(outside,join(out,'agents'));
  expect(run().code).toBe(2); expect(readFileSync(join(out,'secrets.env'),'utf8')).toBe(before);expect(existsSync(join(outside,'fixture.md'))).toBe(false);
});
test('installer links validated generated agents, installed CLI can generate, and rollback removes links', () => {
  expect(run().code).toBe(0); expect(run('install',['--apply']).code).toBe(0);
  const link=join(home,'.claude/agents/fixture.md');expect(readlinkSync(link)).toBe(join(out,'agents/fixture.md'));
  expect(run('generate',[],join(home,'.config/repogolem/runtime/repogolem-cli.js')).code).toBe(0);
  expect(run('install',['--rollback','--apply']).code).toBe(0);expect(existsSync(link)).toBe(false);
});
test('installer refuses absent or changed render and conflicting agent before shell/runtime mutation', () => {
  expect(run('install',['--apply']).code).toBe(2); expect(existsSync(join(home,'.zshrc'))).toBe(false);
  expect(run().code).toBe(0); writeFileSync(join(out,'agents/fixture.md'),'tampered');
  expect(run('install',['--apply']).code).toBe(2);expect(existsSync(join(home,'.config/repogolem/install-state.json'))).toBe(false);
  expect(run().code).toBe(0);mkdirSync(join(home,'.claude/agents'),{recursive:true});writeFileSync(join(home,'.claude/agents/fixture.md'),'existing');
  expect(run('install',['--apply']).code).toBe(2);expect(readFileSync(join(home,'.claude/agents/fixture.md'),'utf8')).toBe('existing');
});
test('changed template and permissive render are stale without a provider call; regeneration removes retired prompts', () => {
  expect(run().code).toBe(0);writeFileSync(template,'New {{SEED_DIR}}\n');expect(run('generate',['--check']).code).toBe(1);
  expect(run().code).toBe(0);chmodSync(join(out,'agents/fixture.md'),0o644);expect(run('generate',['--check']).code).toBe(1);
  settings.agentTemplates={};expect(run().code).toBe(0);expect(existsSync(join(out,'agents/fixture.md'))).toBe(false);
});
test('installer refuses changed owned link on rollback and removes retired links on reinstall', () => {
  expect(run().code).toBe(0);expect(run('install',['--apply']).code).toBe(0);
  const link=join(home,'.claude/agents/fixture.md');rmSync(link);writeFileSync(link,'replacement');
  expect(run('install',['--rollback','--apply']).code).toBe(2);expect(readFileSync(link,'utf8')).toBe('replacement');
  rmSync(link);symlinkSync(join(out,'agents/fixture.md'),link);
  settings.agentTemplates={};expect(run().code).toBe(0);expect(run('install',['--apply']).code).toBe(0);
  expect(() => lstatSync(link)).toThrow();expect(lstatSync(join(out,'agents')).mode&0o777).toBe(0o700);
});
for(const route of ['named value','secrets','env']) test(`shared sensitive source refuses before provider (${route})`, () => {
  const source='op://example-vault/example-item/token', log=join(dir,'op.log');
  settings.secrets={backend:'1password'}; settings.values.SEED_DIR.source=source;
  if(route==='named value') settings.values.TOKEN.source=source;else {delete settings.values.TOKEN;settings.projects={fixture:{path:dir,[route]:{TOKEN:source}}};}
  expect(run('generate',[],cli,{REPOGOLEM_OP_BIN:join(import.meta.dir,'fixtures/repogolem-config/fake-op.sh'),FAKE_OP_LOG:log}).code).toBe(2);
  expect(existsSync(log)).toBe(false);expect(existsSync(out)).toBe(false);
});
for(const embedded of [false,true]) test(`sensitive resolved data cannot enter rendered file (${embedded?'embedded':'equal'})`, () => {
  writeFileSync(settings.secrets.valuesFile,`SEED_DIR='${embedded?'/seed/AGENT_SECRET_CANARY/path':'AGENT_SECRET_CANARY'}'\nTOKEN='AGENT_SECRET_CANARY'\n`,{mode:0o600});
  expect(run().code).toBe(2);expect(existsSync(out)).toBe(false);
});
test('BYO duplicate and template literal cannot expose sensitive data', () => {
  const plugin=join(dir,'duplicate.cjs');writeFileSync(plugin,"const {plugin}=require('varlock/plugin-lib');plugin.name='fixture';plugin.registerResolverFunction({name:'repoGolemBatch',argsSchema:{type:'array',arrayMinLength:1,arrayMaxLength:1},process(){return null;},resolve(){return JSON.stringify({SEED_DIR:'AGENT_SECRET_CANARY',TOKEN:'AGENT_SECRET_CANARY'});}});");
  settings.secrets={backend:'plugin:'+plugin};expect(run().code).toBe(2);expect(existsSync(out)).toBe(false);
  settings.secrets={backend:'file',valuesFile:join(dir,'values.env')};writeFileSync(template,'AGENT_SECRET_CANARY {{SEED_DIR}}');expect(run().code).toBe(2);expect(existsSync(out)).toBe(false);
});
test('cache-only installer applies the sensitive resolved-value backstop', () => {
  expect(run().code).toBe(0);const cache=join(out,'secrets.env'),key=secretKey('varlock://SEED_DIR'),agent=join(out,'agents/fixture.md'),receipt=join(out,'agents.json');
  writeFileSync(cache,readFileSync(cache,'utf8').replace(new RegExp('^'+key+'=.*$','m'),()=>key+"=$'AGENT_SECRET_CANARY'"));
  const text='Read AGENT_SECRET_CANARY twice: AGENT_SECRET_CANARY.\n';writeFileSync(agent,text);const data=JSON.parse(readFileSync(receipt,'utf8'));data.entries.fixture.contentSha=createHash('sha256').update(text).digest('hex');writeFileSync(receipt,JSON.stringify(data,null,2)+'\n');
  expect(run('install',['--apply']).code).toBe(2);expect(existsSync(join(home,'.zshrc'))).toBe(false);expect(run('generate',['--check']).code).toBe(1);
});
test('newline and control values refuse while nested placeholder-looking text stays literal', () => {
  for(const text of ['line\n---\ntools: Bash','line\rnext','line\tvalue','line\x01value']) {
    writeFileSync(settings.secrets.valuesFile,`SEED_DIR="${text}"\nTOKEN='AGENT_SECRET_CANARY'\n`);expect(run().code).toBe(2);expect(existsSync(out)).toBe(false);
  }
  writeFileSync(settings.secrets.valuesFile,"SEED_DIR='{{TOKEN}} $& $1 $(id) `id`'\nTOKEN='AGENT_SECRET_CANARY'\n");expect(run().code).toBe(0);expect(readFileSync(join(out,'agents/fixture.md'),'utf8')).toContain('{{TOKEN}} $& $1 $(id) `id`');
});
test('interrupted install reconciles a missing retired link idempotently', () => {
  expect(run().code).toBe(0);expect(run('install',['--apply']).code).toBe(0);
  const journal=join(home,'.config/repogolem/install-state.json'), state=JSON.parse(readFileSync(journal,'utf8'));state.phase='installing';writeFileSync(journal,JSON.stringify(state));
  rmSync(join(home,'.claude/agents/fixture.md'));settings.agentTemplates={};expect(run().code).toBe(0);
  expect(run('install',['--apply']).code).toBe(0);expect(run('install',['--apply']).code).toBe(0);
});
test('agent filesystem failure leaves shell bytes unchanged', () => {
  expect(run().code).toBe(0);expect(run('install',['--apply']).code).toBe(0);settings.agentTemplates={};expect(run().code).toBe(0);
  const shell=join(home,'.zshrc'), journal=join(home,'.config/repogolem/install-state.json'), state=JSON.parse(readFileSync(journal,'utf8'));state.phase='installing';writeFileSync(journal,JSON.stringify(state));
  writeFileSync(shell,'# interrupted installation\n');chmodSync(join(home,'.claude/agents'),0o500);
  try {expect(run('install',['--apply']).code).toBe(2);expect(readFileSync(shell,'utf8')).toBe('# interrupted installation\n');} finally {chmodSync(join(home,'.claude/agents'),0o700);}
});
test('foreign symlink and retargeted owned link refuse before shell mutation', () => {
  expect(run().code).toBe(0);mkdirSync(join(home,'.claude/agents'),{recursive:true});const link=join(home,'.claude/agents/fixture.md'), foreign=join(dir,'foreign.md');writeFileSync(foreign,'foreign');symlinkSync(foreign,link);
  expect(run('install',['--apply']).code).toBe(2);expect(existsSync(join(home,'.zshrc'))).toBe(false);expect(readlinkSync(link)).toBe(foreign);
  rmSync(link);expect(run('install',['--apply']).code).toBe(0);rmSync(link);symlinkSync(foreign,link);const shell=readFileSync(join(home,'.zshrc'),'utf8');
  expect(run('install',['--apply']).code).toBe(2);expect(readlinkSync(link)).toBe(foreign);expect(readFileSync(join(home,'.zshrc'),'utf8')).toBe(shell);
});
for(const kind of ['out-mode','mode','receipt-mode','cache-mode','receipt','extra']) test(`cache-only check refuses ${kind} tampering`, () => {
  expect(run().code).toBe(0);
  if(kind==='out-mode') chmodSync(out,0o755);
  if(kind==='mode') chmodSync(join(out,'agents'),0o755);
  if(kind==='receipt-mode') chmodSync(join(out,'agents.json'),0o644);
  if(kind==='cache-mode') chmodSync(join(out,'secrets.env'),0o644);
  if(kind==='receipt') {const path=join(out,'agents.json'),receipt=JSON.parse(readFileSync(path,'utf8'));receipt.entries.fixture.templateSha='changed';writeFileSync(path,JSON.stringify(receipt,null,2)+'\n');}
  if(kind==='extra') writeFileSync(join(out,'agents','extra.md'),'extra',{mode:0o600});
  expect(run('install',['--apply']).code).toBe(2);expect(run('generate',['--check']).code).toBe(1);expect(existsSync(join(home,'.zshrc'))).toBe(false);
});
test('manifest shape and value-name guards reject otherwise valid raw inputs', () => {
  writeFileSync(template,'literal prompt');writeFileSync(manifest,JSON.stringify({template:'fixture.md',values:''}));expect(()=>prepareAgents(settings)).toThrow();
  settings.values['BAD-NAME']={sensitive:false};writeFileSync(manifest,JSON.stringify({template:'fixture.md',values:[{name:'BAD-NAME',sensitive:false}]}));expect(()=>prepareAgents(settings)).toThrow();
});
test('regeneration preserves the directory identity of installed prompt targets', () => {
  expect(run().code).toBe(0);expect(run('install',['--apply']).code).toBe(0);const before=lstatSync(join(out,'agents'));
  chmodSync(join(out,'agents'),0o755);
  writeFileSync(template,'Updated {{SEED_DIR}}');expect(run().code).toBe(0);const after=lstatSync(join(out,'agents'));
  expect(after.mode&0o777).toBe(0o700);
  expect([after.dev,after.ino]).toEqual([before.dev,before.ino]);expect(readFileSync(join(home,'.claude/agents/fixture.md'),'utf8')).toBe('Updated /home/fixture/private canary');
});
test('raw installer preparation refuses relative and non-markdown paths', () => {
  const back=process.cwd();try {process.chdir(dir);settings.agentTemplates.fixture='fixture.md';expect(()=>prepareAgents(settings)).toThrow();
    const text=readFileSync(template,'utf8');writeFileSync(join(dir,'fixture.txt'),text);writeFileSync(join(dir,'fixture.txt.values.json'),JSON.stringify({template:'fixture.txt',values:[{name:'SEED_DIR',sensitive:false}]}));settings.agentTemplates.fixture=join(dir,'fixture.txt');expect(()=>prepareAgents(settings)).toThrow();
  } finally {process.chdir(back);}
});
