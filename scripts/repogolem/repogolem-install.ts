// Installation is dry-run unless --apply; no generation or secret resolution.
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installedVarlock } from './repogolem-varlock-package';
import { isDeepStrictEqual } from 'node:util';
const start = '# >>> repogolem generated launchers >>>';
const end = '# <<< repogolem generated launchers <<<';
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const quote = (text: string) => "'" + text.replaceAll("'", "'\\''") + "'";
const legacy = /^\s*(source|\.)\s+.*(?:ralphtools|repogolem\/generated)\/launchers\.zsh["']?\s*$/;
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
function atomic(path: string, text: string, mode = 0o600) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.new-${process.pid}`;
  writeFileSync(temporary, text, { mode, flag: 'wx' });
  renameSync(temporary, path);
}
function seatBlock(text: string) {
  return text.match(/^seatRegistry:\s*\n(?:[ \t].*\n|\s*\n|#.*\n)*/m)?.[0].trimEnd();
}
function managedBlock(config: string) {
  return `${start}\nexport REPOGOLEM_CONFIG=${quote(config)}\n[[ -f "$HOME/.config/repogolem/generated/launchers.zsh" ]] && source "$HOME/.config/repogolem/generated/launchers.zsh"\n${end}\n`;
}
function removeManaged(text: string, state: any) {
  const blocks = text.match(new RegExp(`${start}[\\s\\S]*?${end}\\n?`, 'g')) ?? [];
  if (blocks.length === 0 && state.phase === 'installing' && !text.includes(start) && !text.includes(end)) return text;
  if (blocks.length !== 1 || blocks[0] !== (state.managedBlock ?? managedBlock(state.config))) {
    throw new Error('managed installation block changed; reconciliation required');
  }
  return text.replace(blocks[0], '');
}
function restoreLegacy(current: string, original: string) {
  const cleaned = original.split('\n').filter(line => !legacy.test(line)).join('\n').replace(/\n*$/, '\n');
  if (current === cleaned) return original;
  const lines = current.split('\n'), before = original.split('\n');
  for (let i = 0; i < before.length; i++) {
    if (!legacy.test(before[i]) || lines.includes(before[i])) continue;
    const next = before.slice(i + 1).find(line => line && !legacy.test(line) && lines.includes(line));
    const previous = before.slice(0, i).reverse().find(line => line && !legacy.test(line) && lines.includes(line));
    lines.splice(next ? lines.indexOf(next) : previous ? lines.indexOf(previous) + 1 : 0, 0, before[i]);
  }
  return lines.join('\n');
}
function verifySeats(state: any, seats: string) {
  const stat = present(seats), pending = state.phase === 'installing';
  const target = state.seatTarget ?? state.config;
  if (stat?.isSymbolicLink() && stat.uid === process.getuid?.() && readlinkSync(seats) === target) {
    if (state.machineDigest) {
      const observed = present(target) && digest(readFileSync(target, 'utf8'));
      if (observed !== state.machineDigest && !(pending && observed === state.previousMachineDigest)) throw new Error('installed machine seat view changed; rollback refused');
    }
  // A pending attempt may have unlinked the original file before linking its view.
  } else if (!pending || (stat && (!state.hadSeats || !stat.isFile() || digest(readFileSync(seats, 'utf8')) !== state.originalSeatDigest))) {
    throw new Error('installed seat link changed; reconciliation required');
  }
}
export function runInstall(argv: string[]): number {
  let config = process.env.REPOGOLEM_CONFIG, dry = true, rollback = false, host: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--config' && argv[i + 1]) config = argv[++i];
    else if (argv[i] === '--host' && argv[i + 1]) host = argv[++i];
    else if (argv[i] === '--dry-run') dry = true;
    else if (argv[i] === '--apply') dry = false;
    else if (argv[i] === '--rollback') rollback = true;
    else throw new Error('usage: install [--config <private-file>] [--apply|--dry-run] [--rollback]');
  }
  const home = resolve(homedir()), root = join(home, '.config/repogolem');
  const statePath = join(root, 'install-state.json'), shell = join(home, '.zshrc'), seats = join(home, '.golems/config.yaml');
  for (const path of [root, shell, statePath, dirname(seats)]) safePath(home, path);
  const previous = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : null;
  const before = existsSync(shell) ? readFileSync(shell, 'utf8') : '';
  if (previous) verifySeats(previous, seats);
  if (rollback) {
    if (!previous) throw new Error('no installer backup to roll back');
    const clean = removeManaged(before, previous);
    if (dry) { console.log('would remove managed block and restore seat backup, preserving shell edits'); return 0; }
    safePath(home, join(root, 'zshrc.before')); safePath(home, join(root, 'seats.before'));
    const original = readFileSync(join(root, 'zshrc.before'), 'utf8');
    if (previous.originalShellDigest && digest(original) !== previous.originalShellDigest) throw new Error('shell backup changed; rollback refused');
    const saved = previous.hadSeats ? readFileSync(join(root, 'seats.before'), 'utf8') : '';
    if (previous.originalSeatDigest && digest(saved) !== previous.originalSeatDigest) throw new Error('seat backup changed; rollback refused');
    const restored = before === clean ? before : restoreLegacy(clean, original);
    if (!previous.hadShell && !restored.trim()) rmSync(shell, { force: true });
    else atomic(shell, restored, previous.shellMode ?? 0o600);
    if (present(seats)?.isSymbolicLink()) rmSync(seats);
    if (previous.hadSeats) {
      atomic(seats, saved, previous.seatMode ?? 0o600);
    }
    rmSync(statePath);
    console.log('restored shell and seat registry; installed runtime retained'); return 0;
  }
  if (!config || !existsSync(config)) throw new Error('install requires an existing --config or REPOGOLEM_CONFIG');
  config = resolve(config);
  if (previous && previous.config !== config) throw new Error('existing installation uses another config; roll back first');
  const configText = readFileSync(config, 'utf8');
  let parsed: any;
  try { parsed = parseYaml(configText); } catch { throw new Error('private config could not be parsed; values hidden'); }
  const views = parsed?.machineSeatConfigs;
  let seatText = configText, seatTarget = config;
  if (views) {
    if (!host) {
      const probe = Bun.spawnSync(['scutil', '--get', 'LocalHostName'], { stdout: 'pipe', stderr: 'pipe' });
      if (probe.exitCode !== 0) throw new Error('cannot select machine seat config; pass --host');
      host = probe.stdout.toString().trim();
    }
    if (typeof views[host] !== 'string') throw new Error('no seat config for this machine; nothing written');
    seatText = views[host]; seatTarget = join(root, 'machine-config.yaml'); safePath(home, seatTarget);
  }
  if (previous && (previous.seatTarget ?? previous.config) !== seatTarget) throw new Error('existing installation seat target differs; roll back first');
  const clean = (previous ? removeManaged(before, previous) : before);
  if (!previous && (clean.includes(start) || clean.includes(end))) throw new Error('unmanaged installer block; nothing written');
  const after = clean.split('\n').filter(line => !legacy.test(line)).join('\n').replace(/\n*$/, '\n') + managedBlock(config);
  if (!previous) {
    if (seatTarget !== config && existsSync(seatTarget)) throw new Error('unmanaged machine seat view exists; nothing written');
    safePath(home, seats);
  }
  const oldText = previous ? (previous.hadSeats ? readFileSync(join(root, 'seats.before'), 'utf8') : '') : existsSync(seats) ? readFileSync(seats, 'utf8') : '';
  const old = oldText && seatBlock(oldText);
  if (!seatBlock(seatText) || (old && old !== seatBlock(seatText))) throw new Error('seatRegistry must be preserved verbatim, including launcherPrefix; nothing written');
  if (!views && oldText) {
    const oldDocument = parseYaml(oldText);
    if (Object.entries(oldDocument ?? {}).some(([key, value]) => !isDeepStrictEqual(value, parsed?.[key]))) throw new Error('old seat settings must be preserved; nothing written');
  }
  if (dry) { console.log(`would install runtime and CLI; link seat registry to ${seatTarget}; swap ${shell}; no generate or op`); return 0; }
  mkdirSync(root, { recursive: true, mode: 0o700 }); chmodSync(root, 0o700);
  if (!previous) {
    safePath(home, join(root, 'zshrc.before')); safePath(home, join(root, 'seats.before'));
    atomic(join(root, 'zshrc.before'), before);
    if (existsSync(seats)) atomic(join(root, 'seats.before'), oldText);
  }
  const state = { ...previous, config, seatTarget, managedBlock: managedBlock(config), phase: 'installing',
    machineDigest: seatTarget === config ? null : digest(seatText), previousMachineDigest: previous?.phase === 'installing' ? previous.previousMachineDigest : previous?.machineDigest,
    hadSeats: previous?.hadSeats ?? existsSync(seats), hadShell: previous?.hadShell ?? existsSync(shell),
    shellMode: previous?.shellMode ?? (present(shell)?.mode ?? 0o600) & 0o777,
    seatMode: previous?.seatMode ?? (present(seats)?.mode ?? 0o600) & 0o777,
    originalShellDigest: previous?.originalShellDigest ?? digest(previous ? readFileSync(join(root, 'zshrc.before'), 'utf8') : before), originalSeatDigest: previous?.originalSeatDigest ?? digest(oldText) };
  // Persist recovery state BEFORE any shell, seat, runtime or CLI mutation.
  atomic(statePath, JSON.stringify(state) + '\n');
  const runtime = join(root, 'runtime'); safePath(home, runtime);
  mkdirSync(runtime, { recursive: true, mode: 0o700 });
  chmodSync(root, 0o700); chmodSync(runtime, 0o700);
  for (const name of ['runtime.zsh', 'runtime-reader.ts', 'golem-dispatch.zsh', 'worktree-bootstrap.sh', 'config.example.yaml', 'repogolem-file-plugin.ts', 'repogolem-1password-plugin.ts', 'repogolem-secrets.ts', 'repogolem-check-refs.ts']) {
    const target = join(runtime, name); safePath(home, target);
    copyFileSync(join(import.meta.dir, name), target); chmodSync(target, name === 'worktree-bootstrap.sh' ? 0o700 : 0o600);
  }
  safePath(home, join(runtime, 'dispatch')); mkdirSync(join(runtime, 'dispatch'), { recursive: true, mode: 0o700 }); chmodSync(join(runtime, 'dispatch'), 0o700);
  for (const name of readdirSync(join(import.meta.dir, 'dispatch'))) {
    const target = join(runtime, 'dispatch', name); safePath(home, target);
    copyFileSync(join(import.meta.dir, 'dispatch', name), target); chmodSync(target, 0o600);
  }
  // Snapshot the exact-pinned core into the installation. A fresh staging
  // directory avoids following pre-existing nested links during package copy.
  const modules = join(runtime, 'node_modules'); safePath(home, modules);
  mkdirSync(modules, { recursive: true, mode: 0o700 }); chmodSync(modules, 0o700);
  const dependency = join(modules, 'varlock'); safePath(home, dependency);
  const stage = mkdtempSync(join(runtime, '.varlock-'));
  try {
    const source = installedVarlock(dirname(fileURLToPath(import.meta.url)));
    if (JSON.parse(readFileSync(join(source, 'package.json'), 'utf8')).version !== '1.21.1') throw new Error('varlock version must be 1.21.1');
    cpSync(source, stage, { recursive: true });
    function privateTree(path: string) {
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) throw new Error('varlock package contains a symlink');
      chmodSync(path, stat.isDirectory() ? 0o700 : 0o600);
      if (stat.isDirectory()) for (const entry of readdirSync(path)) privateTree(join(path, entry));
    }
    privateTree(stage);
    rmSync(dependency, { recursive: true, force: true }); renameSync(stage, dependency);
  } finally { rmSync(stage, { recursive: true, force: true }); }
  const bundle = join(runtime, 'repogolem-cli.js'); safePath(home, bundle);
  const build = Bun.spawnSync(['bun', '--no-install', 'build', join(import.meta.dir, 'repogolem-config.ts'), '--target=bun', '--outfile', bundle], { stdout: 'pipe', stderr: 'pipe' });
  if (build.exitCode !== 0) throw new Error('CLI bundle failed; retry install or rollback; shell and seats unchanged');
  chmodSync(bundle, 0o600);
  const bin = join(home, '.local/bin/repogolem'); safePath(home, bin);
  atomic(bin, `#!/bin/sh\nexec bun --no-install ${quote(bundle)} "$@"\n`); chmodSync(bin, 0o700);
  if (seatTarget !== config) atomic(seatTarget, seatText);
  atomic(shell, after, state.shellMode);
  mkdirSync(dirname(seats), { recursive: true, mode: 0o700 });
  if (!present(seats)?.isSymbolicLink()) { rmSync(seats, { force: true }); symlinkSync(seatTarget, seats); }
  atomic(statePath, JSON.stringify({ ...state, phase: 'installed' }) + '\n');
  console.log('installed cache-only runtime and repogolem CLI; backups and recovery journal saved; generate not run');
  return 0;
}
