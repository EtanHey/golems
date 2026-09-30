// Explicit installation only: never generate or resolve secrets here.
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
const start = '# >>> repogolem generated launchers >>>';
const end = '# <<< repogolem generated launchers <<<';
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const quote = (text: string) => "'" + text.replaceAll("'", "'\\''") + "'";
function present(path: string) { try { return lstatSync(path); } catch { return null; } }
function safePath(home: string, path: string) {
  const relative = resolve(path).slice(home.length + 1);
  if (!resolve(path).startsWith(home + '/')) throw new Error('install path is outside HOME');
  let current = home;
  for (const part of relative.split('/')) {
    current = join(current, part);
    const stat = present(current);
    if (stat && (stat.isSymbolicLink() || stat.uid !== process.getuid?.() || (stat.mode & 0o022) !== 0)) throw new Error('install path is a symlink or owned by another user');
  }
}
function atomic(path: string, text: string) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.new-${process.pid}`;
  writeFileSync(temporary, text, { mode: 0o600, flag: 'wx' });
  renameSync(temporary, path);
}
function seatBlock(text: string) {
  return text.match(/^seatRegistry:\s*\n(?:[ \t].*\n|\s*\n|#.*\n)*/m)?.[0].trimEnd();
}
export function runInstall(argv: string[]): number {
  let config = process.env.REPOGOLEM_CONFIG, dry = false, rollback = false, host: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--config' && argv[i + 1]) config = argv[++i];
    else if (argv[i] === '--host' && argv[i + 1]) host = argv[++i];
    else if (argv[i] === '--dry-run') dry = true;
    else if (argv[i] === '--rollback') rollback = true;
    else throw new Error('usage: install [--config <private-file>] [--dry-run|--rollback]');
  }
  const home = resolve(homedir()), root = join(home, '.config/repogolem');
  const statePath = join(root, 'install-state.json'), shell = join(home, '.zshrc'), seats = join(home, '.golems/config.yaml');
  for (const path of [root, shell, statePath]) safePath(home, path);
  if (rollback) {
    if (!existsSync(statePath)) throw new Error('no installer backup to roll back');
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    if (digest(readFileSync(shell, 'utf8')) !== state.shellDigest || !present(seats)?.isSymbolicLink() || readlinkSync(seats) !== (state.seatTarget ?? state.config) || (state.machineDigest && digest(readFileSync(state.seatTarget, 'utf8')) !== state.machineDigest)) {
      throw new Error('installation changed since backup; rollback refused');
    }
    if (dry) { console.log('would restore shell and seat-registry backups'); return 0; }
    atomic(shell, readFileSync(join(root, 'zshrc.before'), 'utf8'));
    if (!state.hadShell) rmSync(shell);
    rmSync(seats);
    if (state.hadSeats) copyFileSync(join(root, 'seats.before'), seats);
    rmSync(statePath);
    console.log('restored shell and seat registry; installed runtime retained'); return 0;
  }
  if (!config || !existsSync(config)) throw new Error('install requires an existing --config or REPOGOLEM_CONFIG');
  config = resolve(config);
  const configText = readFileSync(config, 'utf8');
  let views: Record<string, string> | undefined;
  try { views = parseYaml(configText)?.machineSeatConfigs; } catch { throw new Error('private config could not be parsed; values hidden'); }
  let seatText = configText, seatTarget = config;
  if (views) {
    if (!host) {
      const probe = Bun.spawnSync(['scutil', '--get', 'LocalHostName'], { stdout: 'pipe', stderr: 'pipe' });
      if (probe.exitCode !== 0) throw new Error('cannot select machine seat config; pass --host');
      host = probe.stdout.toString().trim();
    }
    if (typeof views[host] !== 'string') throw new Error('no seat config for this machine; nothing written');
    seatText = views[host];
    seatTarget = join(root, 'machine-config.yaml');
    safePath(home, seatTarget);
  }
  const block = `${start}\nexport REPOGOLEM_CONFIG=${quote(config)}\n[[ -f "$HOME/.config/repogolem/generated/launchers.zsh" ]] && source "$HOME/.config/repogolem/generated/launchers.zsh"\n${end}\n`;
  const before = existsSync(shell) ? readFileSync(shell, 'utf8') : '';
  if (before.includes(start) && !before.includes(end)) throw new Error('incomplete installer block; nothing written');
  const clean = before.replace(new RegExp(`${start}[\\s\\S]*?${end}\\n?`, 'g'), '')
    .split('\n').filter(line => !/^\s*(source|\.)\s+.*(?:ralphtools|repogolem\/generated)\/launchers\.zsh["']?\s*$/.test(line)).join('\n');
  const after = clean.replace(/\n*$/, '\n') + block;
  const previous = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : null;
  if (previous && (previous.config !== config || digest(before) !== previous.shellDigest || readlinkSync(seats) !== seatTarget || (previous.machineDigest && digest(readFileSync(seatTarget, 'utf8')) !== previous.machineDigest))) {
    throw new Error('existing installation changed; roll back or reconcile it first');
  }
  if (!previous) {
    if (seatTarget !== config && existsSync(seatTarget)) throw new Error('unmanaged machine seat view exists; nothing written');
    safePath(home, seats);
    const old = existsSync(seats) ? seatBlock(readFileSync(seats, 'utf8')) : undefined;
    if (!seatBlock(seatText) || (old && old !== seatBlock(seatText))) {
      throw new Error('seatRegistry must be preserved verbatim, including launcherPrefix; nothing written');
    }
  }
  if (dry) { console.log(`would install runtime and CLI; link seat registry to ${seatTarget}; swap ${shell}; no generate or op`); return 0; }
  const runtime = join(root, 'runtime');
  safePath(home, runtime);
  mkdirSync(runtime, { recursive: true, mode: 0o700 });
  chmodSync(root, 0o700); chmodSync(runtime, 0o700);
  for (const name of ['runtime.zsh', 'runtime-reader.ts', 'golem-dispatch.zsh', 'worktree-bootstrap.sh', 'config.example.yaml']) {
    const target = join(runtime, name); safePath(home, target);
    copyFileSync(join(import.meta.dir, name), target); chmodSync(target, name === 'worktree-bootstrap.sh' ? 0o700 : 0o600);
  }
  safePath(home, join(runtime, 'dispatch'));
  mkdirSync(join(runtime, 'dispatch'), { recursive: true, mode: 0o700 });
  for (const name of readdirSync(join(import.meta.dir, 'dispatch'))) {
    const target = join(runtime, 'dispatch', name); safePath(home, target);
    copyFileSync(join(import.meta.dir, 'dispatch', name), target); chmodSync(target, name === 'worktree-bootstrap.sh' ? 0o700 : 0o600);
  }
  const bundle = join(runtime, 'repogolem-cli.js'); safePath(home, bundle);
  const build = Bun.spawnSync(['bun', 'build', join(import.meta.dir, 'repogolem-config.ts'), '--target=bun', '--outfile', bundle], { stdout: 'pipe', stderr: 'pipe' });
  if (build.exitCode !== 0) throw new Error('CLI bundle failed; shell and seats unchanged');
  chmodSync(bundle, 0o600);
  const bin = join(home, '.local/bin/repogolem'); safePath(home, bin);
  atomic(bin, `#!/bin/sh\nexec bun ${quote(bundle)} "$@"\n`); chmodSync(bin, 0o700);
  if (!previous) {
    safePath(home, join(root, 'zshrc.before')); safePath(home, join(root, 'seats.before'));
    atomic(join(root, 'zshrc.before'), before);
    if (existsSync(seats)) atomic(join(root, 'seats.before'), readFileSync(seats, 'utf8'));
  }
  const hadSeats = previous?.hadSeats ?? existsSync(seats), hadShell = previous?.hadShell ?? existsSync(shell);
  if (seatTarget !== config) atomic(seatTarget, seatText);
  atomic(shell, after);
  mkdirSync(dirname(seats), { recursive: true, mode: 0o700 });
  if (!previous) { rmSync(seats, { force: true }); symlinkSync(seatTarget, seats); }
  atomic(statePath, JSON.stringify({ config, seatTarget, machineDigest: seatTarget === config ? null : digest(seatText), shellDigest: digest(after), hadSeats, hadShell }) + '\n');
  console.log('installed cache-only runtime and repogolem CLI; shell and seat backups saved; generate not run');
  return 0;
}
