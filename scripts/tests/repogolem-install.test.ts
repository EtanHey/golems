import { afterEach, beforeEach, expect, test } from 'bun:test';
import { cpSync, chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
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
  const r = Bun.spawnSync([process.execPath, cli, 'install', '--config', config, ...(apply && !extra.includes('--dry-run') ? ['--apply'] : []), ...extra], { env: { ...process.env, HOME: home, REPOGOLEM_OP_BIN: '/does/not/exist', ...environment }, stdout: 'pipe', stderr: 'pipe' });
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
  const r = Bun.spawnSync([join(home, '.local/bin/repogolem'), 'init', '--config', join(home, 'starter.yaml'), '--host', 'fixture-host'], { cwd: home, env: { ...process.env, HOME: home }, stdout: 'pipe', stderr: 'pipe' });
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
  expect(JSON.parse(readFileSync(join(runtime,'node_modules/varlock/package.json'),'utf8')).version).toBe('1.21.1');
  expect(existsSync(join(runtime,'repogolem-1password-plugin.ts'))).toBe(true);
  const env = { ...process.env, HOME: home, REPOGOLEM_OP_BIN: join(import.meta.dir, 'fixtures/repogolem-config/fake-op.sh'), REPOGOLEM_SOURCE_SHA: '0'.repeat(40) };
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
  const r = Bun.spawnSync([process.execPath, wrapper], { env: { ...process.env, HOME: home }, stdout: 'pipe', stderr: 'pipe' });
  expect(r.exitCode).toBe(2);
  expect(r.stderr.toString()).toContain('varlock version must be 1.21.1');
  expect(existsSync(join(home, '.config/repogolem/runtime/node_modules/varlock'))).toBe(false);
});
