import { isolatedBunTestEnv, assertNoBunInstallCache } from './fixtures/bun-test-env';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { cpSync, chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, lstatSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const cli = join(import.meta.dir, '../repogolem/repogolem-config.ts');
let home: string, config: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'repogolem-install-'));
  config = join(home, 'private.yaml');
  writeFileSync(config, 'seatRegistry:\n  seats:\n    fixture:\n      launcherPrefix: custom\n');
  mkdirSync(join(home, '.golems'));
  writeFileSync(join(home, '.golems/config.yaml'), readFileSync(config));
  writeFileSync(join(home, '.zshrc'), '# before\nsource "$HOME/.config/ralphtools/launchers.zsh"\n# after\n');
});
afterEach(() => rmSync(home, { recursive: true, force: true }));
function run(extra: string[] = [], apply = true, environment = {}) {
  const r = Bun.spawnSync([process.execPath, cli, 'install', '--config', config, ...(apply && !extra.includes('--dry-run') ? ['--apply'] : []), ...extra], { env: isolatedBunTestEnv({ ...process.env, HOME: home, REPOGOLEM_OP_BIN: '/does/not/exist', ...environment }), stdout: 'pipe', stderr: 'pipe' });
  return { code: r.exitCode, text: r.stdout.toString() + r.stderr.toString() };
}
test('dry run leaves zshrc, seats and installation untouched', () => {
  expect(run(['--dry-run']).code).toBe(0);
  expect(existsSync(join(home, '.config/repogolem'))).toBe(false);
  expect(readFileSync(join(home, '.zshrc'), 'utf8')).toContain('ralphtools');
});
test('install is idempotent, preserves the seat prefix, and rollback restores exact bytes', () => {
  const before = readFileSync(join(home, '.zshrc'), 'utf8');
  expect(run().code).toBe(0);
  const after = readFileSync(join(home, '.zshrc'), 'utf8');
  expect(after).toContain('REPOGOLEM_CONFIG=');
  expect(after).not.toContain('ralphtools/launchers.zsh');
  expect(readlinkSync(join(home, '.golems/config.yaml'))).toBe(config);
  expect(readFileSync(join(home, '.golems/config.yaml'), 'utf8')).toContain('launcherPrefix: custom');
  expect(run().code).toBe(0);
  expect(readFileSync(join(home, '.zshrc'), 'utf8')).toBe(after);
  expect(run(['--rollback']).code).toBe(0);
  expect(readFileSync(join(home, '.zshrc'), 'utf8')).toBe(before);
  expect(readFileSync(join(home, '.golems/config.yaml'), 'utf8')).toContain('launcherPrefix: custom');
});
test('rollback refuses to overwrite subsequent zshrc edits', () => {
  expect(run().code).toBe(0);
  writeFileSync(join(home, '.zshrc'), 'user edits\n');
  expect(run(['--rollback']).code).toBe(2);
  expect(readFileSync(join(home, '.zshrc'), 'utf8')).toBe('user edits\n');
});
test('refuses mismatched seat prefixes and symlinked shell targets', () => {
  writeFileSync(config, 'seatRegistry:\n  seats:\n    fixture:\n      launcherPrefix: changed\n');
  expect(run().code).toBe(2);
  expect(existsSync(join(home, '.local/bin/repogolem'))).toBe(false);
});
test('installed bundled CLI runs from outside the checkout without node_modules', () => {
  expect(run().code).toBe(0);
  const r = Bun.spawnSync([join(home, '.local/bin/repogolem'), 'init', '--config', join(home, 'starter.yaml'), '--host', 'fixture-host'], { cwd: home, env: isolatedBunTestEnv({ ...process.env, HOME: home }), stdout: 'pipe', stderr: 'pipe' });
  expect(r.exitCode).toBe(0);
  expect(readFileSync(join(home, 'starter.yaml'), 'utf8')).toContain('fixture-host');
});
test('selects the matching machine seat view and preserves that machine settings', () => {
  const mbp = readFileSync(config, 'utf8');
  const m1 = mbp.replace('launcherPrefix: custom', 'launcherPrefix: remote') + 'machineRole: worker\n';
  writeFileSync(join(home, '.golems/config.yaml'), m1);
  writeFileSync(config, mbp + 'machineSeatConfigs:\n  fixture-host: |\n' + m1.split('\n').filter(Boolean).map(line => '    '+line).join('\n') + '\n');
  expect(run(['--host', 'fixture-host']).code).toBe(0);
  expect(readFileSync(join(home, '.golems/config.yaml'), 'utf8')).toBe(m1);
  expect(readlinkSync(join(home, '.golems/config.yaml'))).toBe(join(home, '.config/repogolem/machine-config.yaml'));
  expect(run(['--host', 'fixture-host']).code).toBe(0);
  expect(run(['--rollback']).code).toBe(0);
  expect(readFileSync(join(home, '.golems/config.yaml'), 'utf8')).toBe(m1);
});

test('install and rollback default to dry run', () => {
  expect(run([], false).code).toBe(0);
  expect(existsSync(join(home, '.config/repogolem'))).toBe(false);
  expect(run().code).toBe(0);
  const after=readFileSync(join(home,'.zshrc'),'utf8');
  expect(run(['--rollback'], false).code).toBe(0);
  expect(readFileSync(join(home,'.zshrc'),'utf8')).toBe(after);
});
test('unmanaged edits survive re-install and rollback', () => {
  const before=readFileSync(join(home,'.zshrc'),'utf8');
  expect(run().code).toBe(0);
  writeFileSync(join(home,'.zshrc'), '# user prefix\n'+readFileSync(join(home,'.zshrc'),'utf8')+'# user suffix\n');
  expect(run().code).toBe(0);
  expect(run(['--rollback']).code).toBe(0);
  expect(readFileSync(join(home,'.zshrc'),'utf8')).toBe('# user prefix\n'+before+'# user suffix\n');
});
test('changed managed block or seat link is refused without overwriting edits', () => {
  expect(run().code).toBe(0);
  const edited=readFileSync(join(home,'.zshrc'),'utf8').replace('REPOGOLEM_CONFIG=', 'ALTERED_CONFIG=');
  writeFileSync(join(home,'.zshrc'),edited);
  expect(run().code).toBe(2); expect(run(['--rollback']).code).toBe(2);
  expect(readFileSync(join(home,'.zshrc'),'utf8')).toBe(edited);
});
test('a failed runtime build leaves a recoverable journal before shell changes', () => {
  const bin=join(home,'fault-bin');mkdirSync(bin);
  writeFileSync(join(bin,'bun'),'#!/bin/sh\nexit 77\n',{mode:0o700});
  const before=readFileSync(join(home,'.zshrc'),'utf8');
  expect(run([],true,{PATH:bin+':'+process.env.PATH}).code).toBe(2);
  expect(existsSync(join(home,'.config/repogolem/install-state.json'))).toBe(true);
  expect(readFileSync(join(home,'.zshrc'),'utf8')).toBe(before);
  expect(run().code).toBe(0);
  expect(run(['--rollback']).code).toBe(0);
  expect(readFileSync(join(home,'.zshrc'),'utf8')).toBe(before);
});
test('rollback can recover a failed build directly', () => {
  const bin=join(home,'fault-bin');mkdirSync(bin);
  writeFileSync(join(bin,'bun'),'#!/bin/sh\nexit 77\n',{mode:0o700});
  const before=readFileSync(join(home,'.zshrc'),'utf8');
  expect(run([],true,{PATH:bin+':'+process.env.PATH}).code).toBe(2);
  expect(run(['--rollback']).code).toBe(0);
  expect(readFileSync(join(home,'.zshrc'),'utf8')).toBe(before);
});
test('no-view installation refuses to drop extra old seat settings', () => {
  writeFileSync(join(home,'.golems/config.yaml'), readFileSync(config,'utf8')+'voice:\n  enabled: true\n');
  expect(run().code).toBe(2);
  expect(existsSync(join(home,'.config/repogolem'))).toBe(false);
});
test('missing machine view fails before writes', () => {
  writeFileSync(config,readFileSync(config,'utf8')+'machineSeatConfigs:\n  other-host: "seatRegistry: {}"\n');
  expect(run(['--host','missing-host']).code).toBe(2);
  expect(existsSync(join(home,'.config/repogolem'))).toBe(false);
});
test('symlinked shell and changed previous config are refused', () => {
  const outside=join(home,'outside');writeFileSync(outside,'preserve');
  rmSync(join(home,'.zshrc'));symlinkSync(outside,join(home,'.zshrc'));
  expect(run().code).toBe(2);expect(readFileSync(outside,'utf8')).toBe('preserve');
  rmSync(join(home,'.zshrc'));writeFileSync(join(home,'.zshrc'),'# original\n');
  expect(run().code).toBe(0);
  const changed=join(home,'other.yaml');writeFileSync(changed,readFileSync(config));
  expect(run(['--config',changed]).code).toBe(2);
});
test('installer enforces private artifacts and preserves shell mode on rollback', () => {
  chmodSync(join(home,'.zshrc'),0o644);
  mkdirSync(join(home,'.config/repogolem/runtime'),{recursive:true,mode:0o755});
  expect(run().code).toBe(0);
  for(const name of ['install-state.json','runtime/runtime.zsh','runtime/repogolem-cli.js','zshrc.before','seats.before'])
    expect(statSync(join(home,'.config/repogolem',name)).mode & 0o777).toBe(0o600);
  expect(statSync(join(home,'.config/repogolem/runtime')).mode & 0o777).toBe(0o700);
  expect(run(['--rollback']).code).toBe(0);
  expect(statSync(join(home,'.zshrc')).mode & 0o777).toBe(0o644);
});

test('repeated interrupted upgrades keep the previous machine digest recoverable', () => {
  const seat=readFileSync(config,'utf8');
  function view(extra='') {writeFileSync(config,seat+'machineSeatConfigs:\n  fixture-host: |\n'+(seat+extra).split('\n').filter(Boolean).map(line=>'    '+line).join('\n')+'\n');}
  view();expect(run(['--host','fixture-host']).code).toBe(0);
  view('voice:\n  enabled: true\n');
  const bin=join(home,'fault-bin');mkdirSync(bin);writeFileSync(join(bin,'bun'),'#!/bin/sh\nexit 77\n',{mode:0o700});
  for(let i=0;i<2;i++)expect(run(['--host','fixture-host'],true,{PATH:bin+':'+process.env.PATH}).code).toBe(2);
  expect(run(['--host','fixture-host']).code).toBe(0);
  expect(readFileSync(join(home,'.golems/config.yaml'),'utf8')).toContain('enabled: true');
  expect(run(['--rollback']).code).toBe(0);
  expect(readFileSync(join(home,'.golems/config.yaml'),'utf8')).toBe(seat);
});

test('changed config path is refused even when its machine seat target stays the same', () => {
  const seat=readFileSync(config,'utf8');
  writeFileSync(config,seat+'machineSeatConfigs:\n  fixture-host: |\n'+seat.split('\n').filter(Boolean).map(line=>'    '+line).join('\n')+'\n');
  expect(run(['--host','fixture-host']).code).toBe(0);
  const changed=join(home,'other-view-config.yaml');writeFileSync(changed,readFileSync(config));
  expect(run(['--config',changed,'--host','fixture-host']).code).toBe(2);
});
test('different seatRegistry in a machine view is refused before writes', () => {
  const seat=readFileSync(config,'utf8');
  const changed=seat.replace('launcherPrefix: custom','launcherPrefix: changed');
  writeFileSync(config,seat+'machineSeatConfigs:\n  fixture-host: |\n'+changed.split('\n').filter(Boolean).map(line=>'    '+line).join('\n')+'\n');
  expect(run(['--host','fixture-host']).code).toBe(2);
  expect(existsSync(join(home,'.config/repogolem'))).toBe(false);
});
for(const recovery of ['retry','rollback'])test(`journal recovers ${recovery} after interruption between seat unlink and symlink`, () => {
  const before=readFileSync(join(home,'.zshrc'),'utf8'), original=readFileSync(join(home,'.golems/config.yaml'),'utf8');
  const bin=join(home,'fault-bin');mkdirSync(bin);writeFileSync(join(bin,'bun'),'#!/bin/sh\nexit 77\n',{mode:0o700});
  expect(run([],true,{PATH:bin+':'+process.env.PATH}).code).toBe(2);
  // The journal is already durable when installation unlinks the old seat file.
  rmSync(join(home,'.golems/config.yaml'));
  expect(run(recovery==='rollback'?['--rollback']:[]).code).toBe(0);
  if(recovery==='retry')expect(run(['--rollback']).code).toBe(0);
  expect(readFileSync(join(home,'.zshrc'),'utf8')).toBe(before);
  expect(readFileSync(join(home,'.golems/config.yaml'),'utf8')).toBe(original);
});
test('completed installation refuses a missing seat link', () => {
  expect(run().code).toBe(0);rmSync(join(home,'.golems/config.yaml'));
  expect(run().code).toBe(2);expect(run(['--rollback']).code).toBe(2);
});
test('installed Bun CLI resolves through packaged varlock from an unrelated cwd', () => {
  writeFileSync(config, readFileSync(config, 'utf8') + 'projects:\n  fixture:\n    path: /home/fixture\n    clis: [codex]\n    secrets:\n      TOKEN: op://example-vault/example-item/token\n');
  expect(run().code).toBe(0);
  const runtime = join(home, '.config/repogolem/runtime');
  expect(readFileSync(join(home,'.local/bin/repogolem'),'utf8')).toContain('exec bun --no-install');
  expect(JSON.parse(readFileSync(join(runtime,'node_modules/varlock/package.json'),'utf8')).version).toBe('1.21.1');
  expect(existsSync(join(runtime,'repogolem-1password-plugin.ts'))).toBe(true);
  const env = isolatedBunTestEnv({ ...process.env, HOME: home, REPOGOLEM_OP_BIN: join(import.meta.dir, 'fixtures/repogolem-config/fake-op.sh'), REPOGOLEM_SOURCE_SHA: '0'.repeat(40) });
  for (const key of Object.keys(env)) if (key === 'OP_SERVICE_ACCOUNT_TOKEN' || key.startsWith('OP_SESSION')) delete env[key];
  const r = Bun.spawnSync([join(home, '.local/bin/repogolem'), 'generate', '--config', config, '--out-dir', join(home, '.config/repogolem/generated')], { cwd: home, env, stdout: 'pipe', stderr: 'pipe' });
  expect(r.exitCode).toBe(0);
  expect(readFileSync(join(home, '.config/repogolem/generated/secrets.env'), 'utf8')).toContain('resolved:op://example-vault/example-item/token');
});

test('installer rejects an unexpected varlock version before copying the package', () => {
  const source = join(home, 'source % space');
  cpSync(join(import.meta.dir, '../repogolem'), source, { recursive: true });
  const dependency = join(source, 'node_modules/varlock');
  mkdirSync(join(dependency, 'dist'), { recursive: true });
  writeFileSync(join(dependency, 'package.json'), JSON.stringify({ name: 'varlock', version: '9.9.9', exports: './dist/index.js' }));
  writeFileSync(join(dependency, 'dist/index.js'), '');
  symlinkSync(join(import.meta.dir, '../../node_modules/yaml'), join(source, 'node_modules/yaml'));
  const wrapper = join(source, 'install.ts');
  writeFileSync(wrapper, `import { runInstall } from './repogolem-install'; try { process.exit(runInstall(${JSON.stringify(['--config', config, '--apply'])})); } catch (error) { console.error(error.message); process.exit(2); }`);
  const r = Bun.spawnSync([process.execPath, wrapper], { env: isolatedBunTestEnv({ ...process.env, HOME: home }), stdout: 'pipe', stderr: 'pipe' });
  expect(r.exitCode).toBe(2);
  expect(r.stderr.toString()).toContain('varlock version must be 1.21.1');
  expect(existsSync(join(home, '.config/repogolem/runtime/node_modules/varlock'))).toBe(false);
});

test('missing installed varlock core fails without npm requests or a Bun cache', async () => {
  writeFileSync(config,readFileSync(config,'utf8')+'projects:\n  fixture:\n    path: /home/fixture\n    clis: [codex]\n    secrets:\n      TOKEN: op://example-vault/example-item/token\n');
  expect(run().code).toBe(0);
  rmSync(join(home,'.config/repogolem/runtime/node_modules/varlock'),{recursive:true});
  let requests=0;const registry=Bun.serve({port:0,fetch(){requests++;return new Response('{}',{status:404});}});
  try {
    const env=isolatedBunTestEnv({...process.env,HOME:home,BUN_CONFIG_REGISTRY:registry.url.toString(),REPOGOLEM_OP_BIN:join(import.meta.dir,'fixtures/repogolem-config/fake-op.sh'),REPOGOLEM_SOURCE_SHA:'0'.repeat(40)});
    for(const key of Object.keys(env))if(key==='OP_SERVICE_ACCOUNT_TOKEN'||key.startsWith('OP_SESSION'))delete env[key];
    const r=Bun.spawn([process.execPath,join(home,'.config/repogolem/runtime/repogolem-cli.js'),'generate','--config',config],{env,stdout:'pipe',stderr:'pipe'});
    const [code,stdout,stderr]=await Promise.all([r.exited,new Response(r.stdout).text(),new Response(r.stderr).text()]);
    expect(code).toBe(2);expect(requests).toBe(0);expect(stdout+stderr).toContain('not installed');
    assertNoBunInstallCache(home);expect(existsSync(join(home,'.config/repogolem/generated'))).toBe(false);
  }finally{registry.stop(true);}
});

test('isolated source resolution cannot auto-install a missing varlock core',async()=>{
  const source=join(home,'isolated-source');cpSync(join(import.meta.dir,'../repogolem'),source,{recursive:true});
  const probe=join(source,'probe.ts');writeFileSync(probe,`import {varlockResolver} from './repogolem-varlock';try{varlockResolver(${JSON.stringify(join(import.meta.dir,'fixtures/repogolem-config/fake-op.sh'))},process.env)(['op://example-vault/example-item/token']);}catch{process.exit(2);}`);
  let requests=0;const registry=Bun.serve({port:0,fetch(){requests++;return new Response('{}',{status:404});}});
  try{
    const r=Bun.spawn([process.execPath,probe],{env: isolatedBunTestEnv({PATH:process.env.PATH,HOME:home,BUN_CONFIG_REGISTRY:registry.url.toString(),BUN_INSTALL_CACHE_DIR:join(home,'.bun/install/cache')}),stdout:'pipe',stderr:'pipe'});
    expect(await r.exited).toBe(2);expect(requests).toBe(0);assertNoBunInstallCache(home);
  }finally{registry.stop(true);}
});
test('isolated installer source refuses missing varlock without registry requests or cache',async()=>{
  const source=join(home,'isolated-installer');cpSync(join(import.meta.dir,'../repogolem'),source,{recursive:true});
  // Supply only YAML by absolute fixture import; no node_modules may hide Bun's missing-package fallback.
  const installer=join(source,'repogolem-install.ts');writeFileSync(installer,readFileSync(installer,'utf8').replace("from 'yaml'",'from '+JSON.stringify(join(import.meta.dir,'../../node_modules/yaml/dist/index.js'))));
  const probe=join(source,'install-probe.ts');
  writeFileSync(probe,"import {runInstall} from './repogolem-install';try{process.exit(runInstall(['--config',process.env.FIXTURE_CONFIG,'--apply']));}catch(e){console.error(e.message);process.exit(2);}");
  let requests=0;const registry=Bun.serve({hostname:'127.0.0.1',port:0,fetch(){requests++;return new Response('{}',{status:404});}});
  try{
    const r=Bun.spawn([process.execPath,probe],{env: isolatedBunTestEnv({PATH:process.env.PATH,HOME:home,FIXTURE_CONFIG:config,BUN_CONFIG_REGISTRY:registry.url.toString(),BUN_INSTALL_CACHE_DIR:join(home,'.bun/install/cache')}),stdout:'pipe',stderr:'pipe'});
    const [code,stdout,stderr]=await Promise.all([r.exited,new Response(r.stdout).text(),new Response(r.stderr).text()]);
    expect(code).toBe(2);expect(requests).toBe(0);expect(stdout+stderr).toContain('not installed');
    assertNoBunInstallCache(home);expect(existsSync(join(home,'.local/bin/repogolem'))).toBe(false);
  }finally{registry.stop(true);}
});

function machineEditFixture() {
  const seat = readFileSync(config, 'utf8');
  const prior = seat + 'voice:\n  enabled: true\n';
  const current = seat + 'machineRole: worker\n';
  const source = (text: string) => seat + 'machineSeatConfigs:\n  fixture-host: |\n' + text.trimEnd().split('\n').map(line => '    ' + line).join('\n') + '\n';
  writeFileSync(config, source(prior));
  const installed = run(['--host', 'fixture-host']);
  expect(installed.code).toBe(0);
  writeFileSync(config, source(current));
  const target = join(home, '.config/repogolem/machine-config.yaml');
  const journal = join(home, '.config/repogolem/install-state.json');
  writeFileSync(target, current);
  return { seat, current, target, journal };
}
for (const dry of [false, true]) test(`machine edit matching current render reconciles (${dry ? 'dry-run' : 'apply'})`, () => {
  const { seat, current, target, journal } = machineEditFixture();
  const before = readFileSync(journal, 'utf8');
  const result = run(['--host', 'fixture-host', ...(dry ? ['--dry-run'] : [])]);
  expect(result.code).toBe(0);
  expect(result.text).toContain('machine view reconciled: matches current render');
  expect(readFileSync(target, 'utf8')).toBe(current);
  if (dry) expect(readFileSync(journal, 'utf8')).toBe(before);
  else {
    expect(JSON.parse(readFileSync(journal, 'utf8')).machineDigest).toBe(createHash('sha256').update(current).digest('hex'));
    expect(run(['--rollback']).code).toBe(0);
    expect(readFileSync(join(home, '.golems/config.yaml'), 'utf8')).toBe(seat);
  }
});
for (const dry of [false, true]) test(`unmatched machine edit refuses with key-only diagnostics (${dry ? 'dry-run' : 'apply'})`, () => {
  const { current, target, journal } = machineEditFixture();
  const edited = current + 'privateToken: NEVER_PRINT_THIS_VALUE\n';
  writeFileSync(target, edited);
  const before = readFileSync(journal, 'utf8');
  const result = run(['--host', 'fixture-host', ...(dry ? ['--dry-run'] : [])]);
  expect(result.code).toBe(2);
  expect(result.text).toContain('privateToken');
  expect(result.text).not.toContain('NEVER_PRINT_THIS_VALUE');
  expect(readFileSync(target, 'utf8')).toBe(edited);
  expect(readFileSync(journal, 'utf8')).toBe(before);
});
test('rollback refuses matching-current hand edit until install adopts it', () => {
  const { current, target, journal } = machineEditFixture();
  const before = readFileSync(journal, 'utf8');
  expect(run(['--rollback']).code).toBe(2);
  expect(readFileSync(target, 'utf8')).toBe(current);
  expect(readFileSync(journal, 'utf8')).toBe(before);
});
test('semantically equal machine edit with different bytes still refuses', () => {
  const { current, target, journal } = machineEditFixture();
  writeFileSync(target, current + '# manual comment\n');
  const before = readFileSync(journal, 'utf8');
  expect(run(['--host', 'fixture-host']).code).toBe(2);
  expect(readFileSync(journal, 'utf8')).toBe(before);
});

test('reconciled machine view remains recoverable after an interrupted build', () => {
  const { seat, current, target, journal } = machineEditFixture();
  const bin = join(home, 'reconcile-fault'); mkdirSync(bin);
  writeFileSync(join(bin, 'bun'), '#!/bin/sh\nexit 77\n', { mode: 0o700 });
  expect(run(['--host', 'fixture-host'], true, { PATH: bin + ':' + process.env.PATH }).code).toBe(2);
  expect(JSON.parse(readFileSync(journal, 'utf8')).machineDigest).toBe(createHash('sha256').update(current).digest('hex'));
  expect(readFileSync(target, 'utf8')).toBe(current);
  expect(run(['--rollback']).code).toBe(0);
  expect(readFileSync(join(home, '.golems/config.yaml'), 'utf8')).toBe(seat);
});
test('malformed machine edit refuses without YAML excerpts or values', () => {
  const { target, journal } = machineEditFixture();
  writeFileSync(target, 'privateToken: [NEVER_PRINT_THIS_VALUE\n');
  const before = readFileSync(journal, 'utf8');
  const result = run(['--host', 'fixture-host']);
  expect(result.code).toBe(2);
  expect(result.text).toContain('values hidden');
  expect(result.text).not.toContain('NEVER_PRINT_THIS_VALUE');
  expect(readFileSync(journal, 'utf8')).toBe(before);
});

function regularSeatFixture() {
  const fixture = machineEditFixture();
  const seats = join(home, '.golems/config.yaml');
  rmSync(seats);
  const original = fixture.current + '# preserved comment\n';
  writeFileSync(seats, original);
  return { ...fixture, seats, original };
}
function treeSnapshot(path = home): unknown {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) return { link: readlinkSync(path) };
  if (stat.isDirectory()) return Object.fromEntries(readdirSync(path).sort().map(name => [name, treeSnapshot(join(path, name))]));
  return { bytes: readFileSync(path).toString('base64'), mode: stat.mode };
}
for (const dry of [false, true]) test(`regular seat identical parsed content reconciles (${dry ? 'dry-run' : 'apply'})`, () => {
  const { seats, target, journal, original } = regularSeatFixture();
  const before = treeSnapshot();
  const result = run(['--host', 'fixture-host', ...(dry ? ['--dry-run'] : [])]);
  expect(result.code).toBe(0);
  if (dry) { expect(treeSnapshot()).toEqual(before); return; }
  expect(readlinkSync(seats)).toBe(target);
  const [entry] = JSON.parse(readFileSync(journal, 'utf8')).seatReconciliations;
  expect(entry.path).toBe(seats);
  expect(entry.at).toMatch(/^\d{4}-/);
  expect(entry.backup.startsWith(join(home, '.golems/config.yaml.backup-'))).toBe(true);
  expect(readFileSync(entry.backup, 'utf8')).toBe(original);
  expect(statSync(entry.backup).mode & 0o777).toBe(0o600);
  expect(statSync(join(entry.backup, '..')).mode & 0o777).toBe(0o700);
  const backup = treeSnapshot(entry.backup);
  expect(run(['--host', 'fixture-host']).code).toBe(0);
  expect(treeSnapshot(entry.backup)).toEqual(backup);
  // Replacing the link with another equal regular file creates a new backup.
  rmSync(seats); writeFileSync(seats, original + '# second copy\n');
  expect(run(['--host', 'fixture-host']).code).toBe(0);
  const entries = JSON.parse(readFileSync(journal, 'utf8')).seatReconciliations;
  expect(entries).toHaveLength(2);
  expect(entries[1].backup).not.toBe(entry.backup);
  expect(treeSnapshot(entry.backup)).toEqual(backup);
  expect(readFileSync(entries[1].backup, 'utf8')).toBe(original + '# second copy\n');
});
for (const edit of ['privateToken: NEVER_PRINT_THIS_VALUE\n', 'privateToken: [NEVER_PRINT_THIS_VALUE\n'])
  test(`regular seat refuses ${edit.includes('[') ? 'malformed YAML' : 'changed key'} without writes`, () => {
    const { seats, original } = regularSeatFixture();
    writeFileSync(seats, original + edit);
    const before = treeSnapshot();
    const result = run(['--host', 'fixture-host']);
    expect(result.code).toBe(2);
    expect(result.text).toContain('installed seat link changed; reconciliation required');
    expect(result.text).toContain(edit.includes('[') ? 'values hidden' : 'privateToken');
    expect(result.text).not.toContain('NEVER_PRINT_THIS_VALUE');
    expect(treeSnapshot()).toEqual(before);
  });
test('regular seat rollback and foreign symlink remain refused without writes', () => {
  const { seats, original } = regularSeatFixture();
  let before = treeSnapshot();
  expect(run(['--rollback']).code).toBe(2);
  expect(treeSnapshot()).toEqual(before);
  const other = join(home, 'other-seat.yaml'); writeFileSync(other, original);
  rmSync(seats); symlinkSync(other, seats);
  before = treeSnapshot();
  expect(run(['--host', 'fixture-host']).code).toBe(2);
  expect(treeSnapshot()).toEqual(before);
});

test('regular seat exact bytes reconcile without changing the original rollback backup', () => {
  const { seats, current, journal, seat } = regularSeatFixture();
  writeFileSync(seats, current);
  const backup = join(home, '.config/repogolem/seats.before');
  const original = readFileSync(backup, 'utf8');
  expect(run(['--host', 'fixture-host']).code).toBe(0);
  expect(readFileSync(backup, 'utf8')).toBe(original);
  expect(JSON.parse(readFileSync(journal, 'utf8')).seatReconciliations).toHaveLength(1);
  expect(run(['--rollback']).code).toBe(0);
  expect(readFileSync(seats, 'utf8')).toBe(seat);
});

for (const dry of [false, true]) test(`redteam regular seat refuses target hand edit (${dry ? 'dry-run' : 'apply'})`, () => {
  const { target, seats, current } = regularSeatFixture();
  writeFileSync(seats, current);
  writeFileSync(target, current + 'handKey: precious\n');
  const before = treeSnapshot();
  const result = run(['--host', 'fixture-host', ...(dry ? ['--dry-run'] : [])]);
  expect(result.code).toBe(2);
  expect(result.text).toContain('installed machine seat view changed; install refused');
  expect(result.text).toContain('handKey');
  expect(result.text).not.toContain('precious');
  expect(readFileSync(target, 'utf8')).toContain('handKey: precious');
  expect(treeSnapshot()).toEqual(before);
});
test('redteam rollback reports every retained reconciliation backup', () => {
  const { seats, original, journal } = regularSeatFixture();
  expect(run(['--host', 'fixture-host']).code).toBe(0);
  rmSync(seats); writeFileSync(seats, original + '# second reconciliation\n');
  expect(run(['--host', 'fixture-host']).code).toBe(0);
  const entries = JSON.parse(readFileSync(journal, 'utf8')).seatReconciliations;
  expect(entries).toHaveLength(2);
  const backups = entries.map((entry: { backup: string }) => ({ path: entry.backup, bytes: readFileSync(entry.backup, 'utf8') }));
  const result = run(['--rollback']);
  expect(result.code).toBe(0);
  expect(existsSync(journal)).toBe(false);
  for (const backup of backups) {
    expect(result.text).toContain(backup.path);
    expect(readFileSync(backup.path, 'utf8')).toBe(backup.bytes);
  }
});

function interruptedMachineFirstInstall() {
  const seat = readFileSync(config, 'utf8');
  writeFileSync(config, seat + 'machineSeatConfigs:\n  fixture-host: |\n' + seat.trimEnd().split('\n').map(line => '    ' + line).join('\n') + '\n');
  const bin = join(home, 'first-build-fault'); mkdirSync(bin);
  writeFileSync(join(bin, 'bun'), '#!/bin/sh\nexit 77\n', { mode: 0o700 });
  const failed = run(['--host', 'fixture-host'], true, { PATH: bin + ':' + process.env.PATH });
  expect(failed.code).toBe(2);
  expect(failed.text).toContain('CLI bundle failed; retry install or rollback');
  const target = join(home, '.config/repogolem/machine-config.yaml');
  expect(existsSync(target)).toBe(false);
  expect(lstatSync(join(home, '.golems/config.yaml')).isFile()).toBe(true);
  return { seat, target };
}
test('round2 machine first install retries after a failed build with no target', () => {
  const { seat, target } = interruptedMachineFirstInstall();
  const result = run(['--host', 'fixture-host']);
  expect(result.code).toBe(0);
  expect(readlinkSync(join(home, '.golems/config.yaml'))).toBe(target);
  expect(readFileSync(target, 'utf8')).toBe(seat);
  expect(run(['--rollback']).code).toBe(0);
  expect(readFileSync(join(home, '.golems/config.yaml'), 'utf8')).toBe(seat);
});
test('round2 interrupted first install still refuses a hand-edited existing target', () => {
  const { seat, target } = interruptedMachineFirstInstall();
  writeFileSync(target, seat + 'handKey: precious\n');
  const before = treeSnapshot();
  const result = run(['--host', 'fixture-host']);
  expect(result.code).toBe(2);
  expect(result.text).toContain('installed machine seat view changed; install refused');
  expect(result.text).toContain('handKey');
  expect(result.text).not.toContain('precious');
  expect(treeSnapshot()).toEqual(before);
});
test('round2 dry rollback lists retained backups without writing', () => {
  const { journal } = regularSeatFixture();
  expect(run(['--host', 'fixture-host']).code).toBe(0);
  const entries = JSON.parse(readFileSync(journal, 'utf8')).seatReconciliations;
  expect(entries).toHaveLength(1);
  const before = treeSnapshot();
  const result = run(['--rollback', '--dry-run']);
  expect(result.code).toBe(0);
  expect(result.text).toContain(entries[0].backup);
  expect(treeSnapshot()).toEqual(before);
});

test('combined policy normalization refuses a raw old-render regular seat with denied MCPs', () => {
  const seat = readFileSync(config, 'utf8');
  const oldView = seat + 'contextProfiles:\n  fixture:\n    mcps:\n      allow:\n        - brainlayer\n        - cmuxlayer\n      block: []\n';
  writeFileSync(config, seat + 'machineSeatConfigs:\n  fixture-host: |\n' + oldView.trimEnd().split('\n').map(line => '    ' + line).join('\n') + '\n');
  expect(run(['--host', 'fixture-host']).code).toBe(0);
  const seats = join(home, '.golems/config.yaml');
  const normalized = readFileSync(seats, 'utf8');
  expect(normalized).toContain('allow:\n        - brainlayer\n      block:\n        - cmuxlayer');
  rmSync(seats); writeFileSync(seats, oldView);
  const before = treeSnapshot();
  const result = run(['--host', 'fixture-host']);
  expect(result.code).toBe(2);
  expect(result.text).toContain('installed seat link changed; reconciliation required');
  expect(result.text).toContain('changed top-level keys: contextProfiles');
  expect(treeSnapshot()).toEqual(before);
});
