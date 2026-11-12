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
// Keep manifest admission and the vetted stable interpreter together at both entry points.
export function installContextFleetJobs(ctx, options = {}) {
  if (ctx.fleetJobs) installFleetJobs(ctx.live, { ...options, node: ctx.hookNode.path });
}
export function reportFleetJobsStatus(ctx, current, options = {}) {
  if (!current || !ctx.fleetJobs) return false;
  const problems = fleetJobsStatus(ctx.live, { ...options, node: ctx.hookNode.path });
  for (const problem of problems) console.log(problem);
  return problems.length > 0;
}
function launchctl(args) {
  const r = spawnSync('launchctl', args, { encoding: 'utf8' });
  if (r.status !== 0) {
    const error = Error('launchctl ' + args[0] + ' failed: ' + (r.error?.message || r.stderr?.trim() || `exit ${r.status}`));
    // Only launchd's explicit service-absence diagnostic permits bootstrap.
    if (!r.error && args[0] === 'print' && /Could not find service/.test(r.stderr)) error.code = 'LAUNCHD_NOT_LOADED';
    throw error;
  }
}
export function installFleetJobs(live, { home = homedir(), accountHome = userInfo().homedir, node = process.execPath,
  command = launchctl, uid = process.getuid() } = {}) {
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
    if (activate) {
      try { command(['print', service]); loaded = true; }
      catch (error) {
        if (error.code !== 'LAUNCHD_NOT_LOADED') throw Error(`fleet launchd: refusing ${service}; could not determine loaded state: ${error.message}`);
      }
    }
    if (same && loaded) continue;
    if (loaded) command(['bootout', service]);
    mkdirSync(join(home, 'Library/LaunchAgents'), { recursive: true });
    writeFileSync(f.path + '.new', f.text, { mode: 0o600 });
    renameSync(f.path + '.new', f.path);
    if (activate) command(['bootstrap', domain, f.path]);
  }
}
