import { afterEach, expect, setDefaultTimeout, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
test('P1 tarball installs on an unknown client without git, skips owner-only hooks, and reports drift zero without claiming trust', () => {
  const f = fixture(), installed = run(f, '--apply');
  expect(installed.out).toContain('private_gate: skipped (client host)');
  expect(installed.status, installed.out).toBe(0);
  expect(installed.out).toContain('public hook self-tests: PASS');
  expect(installed.out).toContain('owner-only');
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
