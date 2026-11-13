import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, renameSync, openSync, closeSync, unlinkSync, statSync, fstatSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { readConfig } from './ratchet-inbox-relay.mjs';
export const fleetDir = join(homedir(), '.golems/fleet');
export function run(command, args, input) {
  const r = spawnSync(command, args, { input, encoding: 'utf8', timeout: 60000, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw Error(`${command} failed`);
  return r.stdout.trim();
}
// Match the relay: recover abandoned locks after 90 minutes and report recovery.
export function execute(name, collect, { dir = fleetDir, now = Date.now(), config = readConfig, ssh = (text, c) => run('ssh',
  ['-o', 'BatchMode=yes', c.sshHost, `cat >> '${c.remoteInbox.replaceAll("'", "'\\''")}'`], text) } = {}) {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name + '.json'); let lock; let recovered = false;
  try { lock = openSync(path + '.lock', 'wx'); } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    if (now - statSync(path + '.lock').mtimeMs <= 90 * 60000) return 0;
    unlinkSync(path + '.lock'); lock = openSync(path + '.lock', 'wx'); recovered = true;
  }
  let state = {};
  const save = () => { writeFileSync(path + '.new', JSON.stringify(state), { mode: 0o600 }); renameSync(path + '.new', path); };
  try {
    try { state = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    state.pending ??= [];
    const label = name.toUpperCase();
    const post = text => `\n### ${name} → @orc — ${new Date(now).toISOString()} ${text}\n`;
    if (recovered) { state.pending.push(post(label + ' stale lock recovered (older than 90 minutes)')); save(); }
    const failures = state.failures ?? 0;
    let c; try { c = config(); } catch { /* Still collect and preserve local alerts. */ }
    const result = collect(state, c ?? {});
    state = { ...result.state, failures, pending: [...state.pending, ...result.posts] };
    save();
    if (!c) throw Error('config missing or invalid');
    const recovery = failures >= 3 ? post(`${label} was failing for ${failures} runs`) : '';
    if (state.pending.length || recovery) ssh(state.pending.join('') + recovery, c);
    state.pending = []; state.failures = 0; save(); return 0;
  } catch (e) {
    state.failures = (state.failures ?? 0) + 1; save();
    let outbox = join(dir, 'OUTBOX.md');
    try { outbox = config().localOutbox; } catch {}
    mkdirSync(dirname(outbox), { recursive: true });
    appendFileSync(outbox, state.pending?.join('') || `\n### ${name} → @orc — ${new Date().toISOString()} self-health failure\n`);
    appendFileSync(join(dir, name + '.log'), `${new Date().toISOString()} self-health failure: ${e.message}\n`);
    return 1;
  } finally {
    const held = fstatSync(lock); closeSync(lock);
    try { if (statSync(path + '.lock').ino === held.ino) unlinkSync(path + '.lock'); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
}
