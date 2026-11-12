import { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, userInfo } from 'node:os';
import { spawnSync } from 'node:child_process';
export const jobs = ['worktree-sweeper', 'disk-guard'];
const xml = s => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
export function fleetJobFiles(live, home = homedir(), node = process.execPath) {
  return jobs.map(name => ({
    name,
    path: join(home, 'Library/LaunchAgents', 'com.golems.' + name + '.plist'),
    text: readFileSync(join(live, 'scripts/fleet', 'com.golems.' + name + '.plist.template'), 'utf8')
      .replaceAll('/opt/homebrew/bin/node', xml(node)).replaceAll('__HOME__/Gits/golems', xml(live)).replaceAll('__HOME__', xml(home))
  }));
}
export function fleetJobsStatus(live, options = {}) {
  return fleetJobFiles(live, options.home, options.node).filter(f => !existsSync(f.path) || readFileSync(f.path, 'utf8') !== f.text).map(f => 'fleet job drift: ' + f.name);
}
export function installFleetJobs(live, { home = homedir(), accountHome = userInfo().homedir, node = process.execPath, command = (args) => {
  const r = spawnSync('launchctl', args, { encoding: 'utf8' });
  if (r.status !== 0) throw Error('launchctl failed: ' + args[0]);
}, uid = process.getuid() } = {}) {
  // launchd's gui domain belongs to the account, independently of process HOME.
  let activate = false;
  try { activate = realpathSync(home) === realpathSync(accountHome); } catch {}
  if (!activate) console.log('fleet launchd: skipped (HOME is not the account home)');
  const files = fleetJobFiles(live, home, node);
  mkdirSync(join(home, '.golems/fleet'), { recursive: true });
  for (const f of files) {
    const domain = 'gui/' + uid; const service = domain + '/com.golems.' + f.name;
    const same = existsSync(f.path) && readFileSync(f.path, 'utf8') === f.text;
    let loaded = false;
    if (activate) try { command(['print', service]); loaded = true; } catch {}
    if (same && loaded) continue;
    if (loaded) command(['bootout', service]);
    mkdirSync(join(home, 'Library/LaunchAgents'), { recursive: true });
    writeFileSync(f.path + '.new', f.text, { mode: 0o600 });
    renameSync(f.path + '.new', f.path);
    if (activate) command(['bootstrap', domain, f.path]);
  }
}
