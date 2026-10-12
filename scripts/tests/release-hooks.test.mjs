import { afterEach, expect, setDefaultTimeout, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildRelease } from '../release/build-release.mjs';

setDefaultTimeout(60_000);
const repo = path.resolve(import.meta.dir, '../..');
const roots = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
function command(bin, args, options = {}) {
  const r = spawnSync(bin, args, { encoding: 'utf8', ...options });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout);
  return r.stdout.trim();
}
function fixture() {
  const scratch = path.join(repo, 'docs.local/release-hooks-fixtures');
  mkdirSync(scratch, { recursive: true });
  const root = mkdtempSync(path.join(scratch, 'client-')); roots.push(root);
  const candidate = path.join(root, 'candidate'), source = path.join(root, 'release'), home = path.join(root, 'home');
  mkdirSync(candidate); mkdirSync(source); mkdirSync(home);
  for (const file of ['scripts/hooks', 'skills/golem-powers', '.claude/hooks/block-dangerous-commands.py', 'hooks/daemon-gate-precheck.py', 'package.json']) {
    mkdirSync(path.dirname(path.join(candidate, file)), { recursive: true });
    cpSync(path.join(repo, file), path.join(candidate, file), { recursive: true, filter: p => !p.includes('__pycache__') });
  }
  command('git', ['init', '-q', candidate]);
  command('git', ['-C', candidate, 'add', '.']);
  command('git', ['-C', candidate, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'release fixture']);
  const release = buildRelease({ repo: candidate, out: path.join(root, 'assets') });
  command('tar', ['-xzf', release.tarball, '-C', source]);
  // The installer gets only node/python/sh on PATH; neither git nor scutil is available.
  const bin = path.join(root, 'bin'); mkdirSync(bin);
  for (const name of ['node', 'python3', 'sh']) symlinkSync(command('sh', ['-c', `command -v ${name}`]), path.join(bin, name));
  const env = { ...process.env, HOME: home, CODEX_HOME: path.join(home, '.codex'), PATH: bin, TMP_BLOCK_LEDGER: path.join(root, 'ledger.jsonl') };
  for (const key of ['WEAVE_ALLOW_TMP', 'PYTHONPATH', 'PYTHONHOME', 'GOLEM_ROLE', 'GOLEMS_WORKER', 'GOLEMS_HEAVY_SUITE_HELD']) delete env[key];
  return { root, source, home, env, release };
}
function run(f, ...args) {
  const r = spawnSync('node', [path.join(f.source, 'scripts/hooks/install-hooks.mjs'), '--host', 'client', '--source', f.source, ...args], { env: f.env, encoding: 'utf8' });
  return { status: r.status, out: r.stdout + r.stderr };
}
function rehash(f, relative, text) {
  writeFileSync(path.join(f.source, relative), text);
  const at = path.join(f.source, 'MANIFEST.json'), m = JSON.parse(readFileSync(at));
  m.files.find(row => row.path === relative).sha256 = createHash('sha256').update(text).digest('hex');
  writeFileSync(at, JSON.stringify(m));
}
function snapshot(at) {
  if (!existsSync(at)) return null;
  return readdirSync(at).sort().map(name => {
    const file = path.join(at, name), st = lstatSync(file);
    return [name, st.mode, st.isSymbolicLink() ? readlinkSync(file) : st.isDirectory() ? snapshot(file) : readFileSync(file).toString('base64')];
  });
}
for (const signal of ['pin', 'pin-and-link', 'link', 'dangling-link', 'indirect-link', 'nested-link']) test(`R1: client refuses owner ${signal} without changing HOME`, () => {
  const f = fixture(), hooks = path.join(f.home, '.claude/hooks'); mkdirSync(hooks, { recursive: true });
  writeFileSync(path.join(f.home, '.claude/settings.json'), JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Task', hooks: [{ type: 'command', command: 'node /old/model-pin-gate-hook.mjs' }] }] } }, null, 2) + '\n');
  if (signal === 'pin' || signal === 'pin-and-link') writeFileSync(path.join(hooks, 'golems-hooks-live.sha'), 'a'.repeat(40) + '\n');
  if (signal !== 'pin') {
    const live = path.join(f.home, 'Gits/golems/.worktrees/hooks-live/skills/golem-powers/tmp-block');
    if (signal !== 'dangling-link') mkdirSync(live, { recursive: true });
    const alias = path.join(f.root, 'alias');
    if (signal === 'indirect-link') symlinkSync(live, alias);
    if (signal === 'nested-link') mkdirSync(path.join(hooks, 'nested'));
    const at = path.join(hooks, signal === 'nested-link' ? 'nested/tmp-block' : 'tmp-block');
    symlinkSync(signal === 'indirect-link' ? alias : path.relative(path.dirname(at), live), at);
  }
  const before = snapshot(f.home);
  for (const args of [[], ['--apply'], ['--status']]) {
    const result = run(f, ...args);
    expect(snapshot(f.home)).toEqual(before);
    expect(result.status, result.out).not.toBe(0);
    expect(result.out).toContain('owner install');
    expect(result.out).not.toContain('client host');
  }
});
for (const name of ['MacBook-Pro']) test(`R1: client refuses owner hostname ${name} before writes`, () => {
  const f = fixture();
  writeFileSync(path.join(f.env.PATH, 'scutil'), `#!/bin/sh\nprintf '%s\\n' '${name}'\n`, { mode: 0o755 });
  for (const args of [[], ['--apply'], ['--status']]) {
    const result = run(f, ...args);
    expect(readdirSync(f.home)).toEqual([]);
    expect(result.status, result.out).not.toBe(0);
    expect(result.out).toContain('owner host');
    expect(result.out).not.toContain('client host');
  }
});
for (const hostname of ['Third-Party-Mac', 'Locals-MacBook-Pro']) test(`P5: ${hostname} is a release client`, () => {
  const f = fixture();
  writeFileSync(path.join(f.env.PATH, 'scutil'), `#!/bin/sh\nprintf '%s\\n' '${hostname}'\n`, { mode: 0o755 });
  expect(run(f, '--apply').status).toBe(0);
});
test('R1: a receipt manifest hash rejects a rewritten manifest before writes', () => {
  const f = fixture(), manifest = path.join(f.source, 'MANIFEST.json');
  mkdirSync(path.join(f.home, '.golems'));
  writeFileSync(path.join(f.home, '.golems/release.json'), JSON.stringify({ manifest_sha256: createHash('sha256').update(readFileSync(manifest)).digest('hex') }));
  // All file hashes still match; only the trusted manifest bytes changed.
  writeFileSync(manifest, readFileSync(manifest, 'utf8') + '\n');
  const before = snapshot(f.home), result = run(f, '--apply');
  expect(snapshot(f.home)).toEqual(before);
  expect(result.status, result.out).not.toBe(0);
  expect(result.out).toContain('manifest_sha256');
});
for (const hashed of [false, true]) test(`R1: release receipt ${hashed ? 'matching hash' : 'without hash'} permits installation`, () => {
  const f = fixture(); mkdirSync(path.join(f.home, '.golems'));
  writeFileSync(path.join(f.home, '.golems/release.json'), JSON.stringify(hashed ? { manifest_sha256: createHash('sha256').update(readFileSync(path.join(f.source, 'MANIFEST.json'))).digest('hex') } : { version: 'legacy' }));
  expect(run(f, '--apply').status).toBe(0);
});
test('P1 tarball installs on an unknown client without git, skips owner-only hooks, and reports drift zero without claiming trust', () => {
  const f = fixture(), installed = run(f, '--apply');
  expect(installed.out).toContain('private_gate: skipped (client host)');
  expect(installed.status, installed.out).toBe(0);
  expect(installed.out).toContain('public hook self-tests: PASS');
  expect(installed.out).toContain('owner-only');
  const skipped = installed.out.split('\n').filter(line => line.startsWith('skipped '));
  expect(skipped.length).toBeGreaterThan(0);
  expect(new Set(skipped).size).toBe(skipped.length);
  expect(existsSync(path.join(f.home, 'Gits'))).toBe(false);
  expect(existsSync(path.join(f.source, '.git'))).toBe(false);
  expect(readlinkSync(path.join(f.home, '.claude/hooks/tmp-block'))).toBe(path.join(f.source, 'skills/golem-powers/tmp-block'));
  const settings = readFileSync(path.join(f.home, '.claude/settings.json'), 'utf8');
  expect(settings).not.toContain('daemon-gate-precheck');
  const codex = readFileSync(path.join(f.home, '.codex/hooks.json'), 'utf8');
  expect(codex).toContain(f.source + '/scripts/hooks/codex-policy-hook.py');
  expect(codex).not.toContain('hooks-live');
  const status = run(f, '--status');
  expect(status.status).toBe(0);
  expect(status.out).toContain('drift=0');
  expect(status.out).toContain('trust=missing');
  expect(existsSync(path.join(f.home, '.codex/config.toml'))).toBe(false);
});
test('R1: client Claude and Codex shell fallbacks give release repair instructions', () => {
  const f = fixture(), python = path.join(f.root, 'pinned-python');
  symlinkSync(command('sh', ['-c', 'command -v python3']), python);
  expect(run(f, '--apply', '--python', python).status).toBe(0);
  const settings = JSON.parse(readFileSync(path.join(f.home, '.claude/settings.json')));
  const claude = settings.hooks.PreToolUse.flatMap(g => g.hooks).find(h => h.command.includes('human-confirm-pretooluse')).command;
  const codex = JSON.parse(readFileSync(path.join(f.home, '.codex/hooks.json'))).hooks.PreToolUse[0].hooks[0].command;
  rmSync(python);
  for (const hook of [claude, codex]) {
    const result = spawnSync('/bin/sh', ['-c', hook], { env: f.env, input: '{}', encoding: 'utf8' });
    expect(result.status).toBe(2);
    const output = result.stdout + result.stderr;
    expect(output).toContain('rerun the release installer');
    expect(output).toContain('install-hooks.mjs --host client --source ~/.golems/current --apply');
    expect(output).not.toContain('~/Gits');
  }
});
test('installed Claude and Codex human-confirm deny a no-token lease and allow an ordinary command', () => {
  const f = fixture(); expect(run(f, '--apply').status).toBe(0);
  const claude = JSON.parse(readFileSync(path.join(f.home, '.claude/settings.json'))).hooks.PreToolUse.flatMap(g => g.hooks).find(h => h.command.includes('human-confirm-pretooluse')).command;
  const codex = JSON.parse(readFileSync(path.join(f.home, '.codex/hooks.json'))).hooks.PreToolUse.flatMap(g => g.hooks).find(h => h.command.includes('human-confirm')).command;
  for (const hook of [claude, codex]) for (const denied of [false, true]) {
    const payload = { tool_name: 'Bash', cwd: f.home, session_id: 'fixture', tool_input: { command: denied ? `git push --force-with-lease=refs/heads/topic:${'a'.repeat(40)} origin HEAD:refs/heads/topic` : 'pwd' } };
    const r = spawnSync('/bin/sh', ['-c', hook], { env: f.env, input: JSON.stringify(payload), encoding: 'utf8' });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(denied && hook === claude ? 2 : 0);
    expect(JSON.parse(r.stdout).hookSpecificOutput?.permissionDecision).toBe(denied ? 'deny' : undefined);
  }
});
test('dry-run writes nothing; re-applying preserves configuration bytes and creates no backups', () => {
  const f = fixture(); expect(run(f).status).toBe(0); expect(readdirSync(f.home)).toEqual([]);
  expect(run(f, '--apply').status).toBe(0);
  const paths = ['.claude/settings.json', '.codex/hooks.json'];
  const before = paths.map(p => readFileSync(path.join(f.home, p)));
  expect(run(f, '--apply').status).toBe(0);
  paths.forEach((p, i) => expect(readFileSync(path.join(f.home, p))).toEqual(before[i]));
  expect(readdirSync(path.join(f.home, '.claude')).filter(n => n.includes('bak'))).toEqual([]);
  expect(run(f, '--status').status).toBe(0);
});
test('tampered bytes and symlinked source files refuse before configuration writes', () => {
  for (const link of [false, true]) {
    const f = fixture(), at = path.join(f.source, 'scripts/hooks/codex-policy-hook.py');
    if (link) { rmSync(at); symlinkSync('/etc/passwd', at); } else writeFileSync(at, '# tampered');
    const result = run(f, '--apply'); expect(result.status).not.toBe(0); expect(result.out).toContain('release integrity');
    expect(readdirSync(f.home)).toEqual([]);
  }
});
test('a manifest-matching broken policy fails public self-tests before writes', () => {
  const f = fixture(); rehash(f, 'scripts/hooks/codex-policy-hook.py', "print('{}')\n");
  const result = run(f, '--apply'); expect(result.status).not.toBe(0); expect(result.out).toContain('public hook self-tests');
  expect(readdirSync(f.home)).toEqual([]);
});
test('status catches registration and release-content drift; checkout-only options cannot enter the source path', () => {
  const f = fixture(); expect(run(f, '--apply').status).toBe(0);
  const at = path.join(f.home, '.claude/settings.json'), value = JSON.parse(readFileSync(at));
  value.hooks.PreToolUse[0].hooks[0].timeout = 100;
  writeFileSync(at, JSON.stringify(value, null, 2) + '\n');
  expect(run(f, '--status').status).not.toBe(0);
  expect(run(f, '--update', '--apply').status).not.toBe(0);
  expect(run(f, '--restore-live', '--apply').status).not.toBe(0);
  writeFileSync(path.join(f.source, 'skills/golem-powers/_shared/shell_parse.py'), '# tampered');
  expect(run(f, '--status').out).toContain('release integrity');
});
test('release links and registered commands handle spaces and quotes in the source path', () => {
  const f = fixture(), renamed = path.join(f.root, "release with 'quote'");
  renameSync(f.source, renamed); f.source = renamed;
  const installed = run(f, '--apply'); expect(installed.status, installed.out).toBe(0);
  expect(run(f, '--status').status).toBe(0);
});
test('client migration removes skipped golems registrations while preserving externally owned hooks', () => {
  const f = fixture(), at = path.join(f.home, '.claude/settings.json');
  mkdirSync(path.dirname(at));
  const external = { command: 'python3 /foreign/brainlayer-session-start.py', type: 'command' };
  writeFileSync(at, JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Task', hooks: [{ type: 'command', command: 'node /old/model-pin-gate-hook.mjs' }] }], SessionStart: [{ hooks: [external] }] } }, null, 2) + '\n');
  const installed = run(f, '--apply'); expect(installed.status, installed.out).toBe(0);
  const settings = JSON.parse(readFileSync(at));
  expect(JSON.stringify(settings)).not.toContain('model-pin-gate-hook');
  expect(settings.hooks.SessionStart[0].hooks).toEqual([external]);
  expect(run(f, '--status').status).toBe(0);
});

function formerOwner(f) {
  const hooks = path.join(f.home, '.claude/hooks'); mkdirSync(hooks, { recursive: true });
  writeFileSync(path.join(f.env.PATH, 'scutil'), "#!/bin/sh\nprintf '%s\\n' 'Locals-MacBook-Pro'\n", { mode: 0o755 });
  writeFileSync(path.join(hooks, 'golems-hooks-live.sha'), 'a'.repeat(40) + '\n');
  for (const name of ['tmp-block', 'model-pin-gate', 'nested/old']) {
    const at = path.join(hooks, name); mkdirSync(path.dirname(at), { recursive: true });
    symlinkSync(path.relative(path.dirname(at), path.join(f.home, 'Gits/golems/.worktrees/hooks-live', name)), at);
  }
  symlinkSync('/foreign/external.py', path.join(hooks, 'external.py'));
  writeFileSync(path.join(f.home, '.claude/settings.json'), JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Task', hooks: [{ type: 'command', command: 'node /old/model-pin-gate-hook.mjs' }] }] } }, null, 2) + '\n');
  mkdirSync(path.join(f.home, '.codex'));
  writeFileSync(path.join(f.home, '.codex/hooks.json'), '{"hooks":{}}\n');
  return hooks;
}
test('P5: explicit former-owner migration archives pin/links, installs both clients, and denies no-token leases', () => {
  const f = fixture(), hooks = formerOwner(f);
  const oldPin = readFileSync(path.join(hooks, 'golems-hooks-live.sha'));
  const result = run(f, '--migrate-owner-install', '--apply'); expect(result.status, result.out).toBe(0);
  expect(existsSync(path.join(hooks, 'golems-hooks-live.sha'))).toBe(false);
  expect(existsSync(path.join(hooks, 'model-pin-gate'))).toBe(false);
  expect(readlinkSync(path.join(hooks, 'tmp-block'))).toBe(path.join(f.source, 'skills/golem-powers/tmp-block'));
  expect(readlinkSync(path.join(hooks, 'external.py'))).toBe('/foreign/external.py');
  const archive = path.join(f.home, '.golems/archive', readdirSync(path.join(f.home, '.golems/archive'))[0]);
  const receipt = JSON.parse(readFileSync(path.join(archive, 'receipt.json')));
  expect(receipt.source).toBe(f.source); expect(receipt.commit).toBe(f.release.commit);
  expect(receipt.archived.sort()).toEqual(['golems-hooks-live.sha', 'model-pin-gate', 'nested/old', 'tmp-block']);
  expect(readFileSync(path.join(archive, 'hooks/golems-hooks-live.sha'))).toEqual(oldPin);
  expect(readlinkSync(path.join(archive, 'hooks/nested/old'))).toContain('hooks-live');
  const status = run(f, '--status'); expect(status.status, status.out).toBe(0); expect(status.out).toContain('drift=0');
  for (const client of ['.claude/settings.json', '.codex/hooks.json']) {
    const groups = JSON.parse(readFileSync(path.join(f.home, client))).hooks.PreToolUse;
    const hook = groups.flatMap(g => g.hooks).find(h => h.command.includes('human-confirm')).command;
    const payload = { tool_name: 'Bash', cwd: f.home, session_id: 'P5', tool_input: { command: `git push --force-with-lease=refs/heads/topic:${'a'.repeat(40)} origin HEAD:refs/heads/topic` } };
    const r = spawnSync('/bin/sh', ['-c', hook], { env: f.env, input: JSON.stringify(payload), encoding: 'utf8' });
    expect(r.status).toBe(client.startsWith('.claude') ? 2 : 0);
    expect(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision).toBe('deny');
  }
});
for (const mode of ['without-flag', 'dry-run', 'mbp']) test(`P5: ${mode} preserves former-owner HOME`, () => {
  const f = fixture(); formerOwner(f);
  if (mode === 'mbp') writeFileSync(path.join(f.env.PATH, 'scutil'), "#!/bin/sh\nprintf '%s\\n' 'MacBook-Pro'\n", { mode: 0o755 });
  const before = snapshot(f.home), args = mode === 'without-flag' ? ['--apply'] : ['--migrate-owner-install', ...(mode === 'dry-run' ? [] : ['--apply'])];
  const r = run(f, ...args); expect(snapshot(f.home)).toEqual(before);
  expect(r.status, r.out).toBe(mode === 'dry-run' ? 0 : 1);
});
for (const destination of ['settings.json', 'hooks.json']) test(`P5: failure replacing ${destination} rolls back pin, links, both configurations and backups`, () => {
  const f = fixture(); formerOwner(f);
  const inject = path.join(f.root, 'fault.mjs');
  writeFileSync(inject, `import fs from 'node:fs'; import { syncBuiltinESMExports } from 'node:module'; const rename = fs.renameSync; let fired = false; fs.renameSync = (a, b) => { if (!fired && b.endsWith('/${destination}')) { fired = true; throw new Error('P5 injected install failure'); } return rename(a, b); }; syncBuiltinESMExports();`);
  f.env.NODE_OPTIONS = `--import=${inject}`;
  const before = snapshot(f.home), r = run(f, '--migrate-owner-install', '--apply');
  expect(r.status, r.out).not.toBe(0); expect(r.out).toContain('P5 injected install failure');
  expect(snapshot(f.home)).toEqual(before);
});

for (const script of [null, '#!/bin/sh\nexit 1\n', '#!/bin/sh\nexit 0\n']) test('P5: migration refuses unavailable machine identity without writes', () => {
  const f = fixture(); formerOwner(f); const at = path.join(f.env.PATH, 'scutil');
  if (script) writeFileSync(at, script, { mode: 0o755 }); else rmSync(at);
  const before = snapshot(f.home), r = run(f, '--migrate-owner-install', '--apply');
  expect(r.status, r.out).not.toBe(0); expect(r.out).toContain('machine identity unavailable'); expect(snapshot(f.home)).toEqual(before);
});
for (const name of ['golems-fail-open.py', 'golems-hooks-release.json']) test(`P5: migration refuses foreign writable alias ${name}`, () => {
  const f = fixture(), hooks = formerOwner(f), foreign = path.join(f.root, 'foreign');
  writeFileSync(foreign, 'foreign bytes'); symlinkSync(foreign, path.join(hooks, name));
  const before = snapshot(f.home), r = run(f, '--migrate-owner-install', '--apply');
  expect(r.status, r.out).not.toBe(0); expect(r.out).toContain('non-regular file');
  expect(snapshot(f.home)).toEqual(before); expect(readFileSync(foreign, 'utf8')).toBe('foreign bytes');
});
