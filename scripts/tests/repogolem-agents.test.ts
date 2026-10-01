import { afterEach, beforeEach, expect, test } from 'bun:test';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stringify } from 'yaml';
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
function run(command='generate', flags: string[]=[], program=cli) {
  writeFileSync(config, stringify(settings));
  const args = command==='generate' ? ['--out-dir',out,'--home',home] : [];
  const r = Bun.spawnSync([process.execPath,'--no-install',program,command,'--config',config,...args,...flags], {env:{...process.env,HOME:home,REPOGOLEM_OP_BIN:'/no-real-op',REPOGOLEM_SOURCE_SHA:'0'.repeat(40)},stdout:'pipe',stderr:'pipe'});
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
test('manifest template mismatch, duplicate declaration and unsafe agent name fail closed', () => {
  for(const data of [{template:'other.md',values:[]},{template:'fixture.md',values:[{name:'SEED_DIR',sensitive:false},{name:'SEED_DIR',sensitive:false}]}]) {
    writeFileSync(manifest,JSON.stringify(data)); expect(run().code).toBe(2); expect(existsSync(out)).toBe(false);
  }
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
  expect(existsSync(link)).toBe(false);expect(lstatSync(join(out,'agents')).mode&0o777).toBe(0o700);
});
