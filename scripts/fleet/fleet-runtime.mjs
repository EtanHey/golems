import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, renameSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { readConfig } from './ratchet-inbox-relay.mjs';
export const fleetDir = join(homedir(), '.golems/fleet');
export function run(command, args, input) {
  const r = spawnSync(command, args, { input, encoding: 'utf8', timeout: 60000, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw Error(`${command} failed`);
  return r.stdout.trim();
}
// Exclusive lock is deliberately not stolen: a stalled run needs operator attention.
export function execute(name, collect, { dir = fleetDir, config = readConfig, ssh = (text, c) => run('ssh',
  ['-o', 'BatchMode=yes', c.sshHost, `cat >> '${c.remoteInbox.replaceAll("'", "'\\''")}'`], text) } = {}) {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name + '.json'); let lock;
  try { lock = openSync(path + '.lock', 'wx'); } catch (e) { if (e.code === 'EEXIST') return 1; throw e; }
  let state = {};
  const save = () => { writeFileSync(path + '.new', JSON.stringify(state), { mode: 0o600 }); renameSync(path + '.new', path); };
  try {
    try { state = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    state.pending ??= [];
    let c; try { c = config(); } catch { /* Still collect and preserve local alerts. */ }
    const result = collect(state, c ?? {});
    state = { ...result.state, pending: [...state.pending, ...result.posts] };
    save();
    if (!c) throw Error('config missing or invalid');
    if (state.pending.length) ssh(state.pending.join(''), c);
    state.pending = []; state.failures = 0; save(); return 0;
  } catch (e) {
    state.failures = (state.failures ?? 0) + 1; save();
    let outbox = join(dir, 'OUTBOX.md');
    try { outbox = config().localOutbox; } catch {}
    mkdirSync(dirname(outbox), { recursive: true });
    appendFileSync(outbox, state.pending?.join('') || `\n### ${name} → @orc — ${new Date().toISOString()} self-health failure\n`);
    appendFileSync(join(dir, name + '.log'), `${new Date().toISOString()} self-health failure: ${e.message}\n`);
    return 1;
  } finally { closeSync(lock); unlinkSync(path + '.lock'); }
}
