// Release-only client installation. Owner worktree installation stays in install-hooks.mjs.
export const CLIENT_INSTALL_PROTOCOL = 1; // failed applies restore previous client wiring
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { applyCodexHooks, CLIENT_REPAIR, CODEX_TRUST_HINT, planCodexHooks } from './codex-hooks-install.mjs';
import { beginOwnerMigration, ownerInstallPaths } from './owner-install-migration.mjs';
import { beginClientInstall } from './client-install-transaction.mjs';
import { checkReleaseHooks } from './release-self-check.mjs';

const digest = data => createHash('sha256').update(data).digest('hex');
const quote = s => `'${s.replaceAll("'", "'\\''")}'`;
const safe = p => typeof p === 'string' && p && !path.isAbsolute(p) && !p.split('/').some(s => !s || s === '.' || s === '..') && !/[\\\x00-\x1f]/.test(p);
function assertClientHost(home, o) {
  // MBP protection is independent of the release manifest and migration flag.
  const result = spawnSync('scutil', ['--get', 'LocalHostName'], { encoding: 'utf8', timeout: 5000 });
  if (result.status === 0 && result.stdout.trim() === 'MacBook-Pro') throw new Error('refusing client installation: machine is owner host mbp; use --host mbp without --source');
  if (o.migrateOwnerInstall && (result.status !== 0 || !result.stdout.trim())) throw new Error('owner migration: machine identity unavailable; refusing migration');
  if (!o.migrateOwnerInstall && ownerInstallPaths(path.join(home, '.claude/hooks')).length) throw new Error('refusing client installation: HOME has an owner install; use --migrate-owner-install on a non-owner host');
}

function releaseContext(o, { E1_DELETED, failClosedCommand, pathPython, pinnedFingerprints, resolveHookPython }) {
  if (o.host !== 'client' || o.update || o.restoreLive || o.manifest) throw new Error('--source requires --host client and cannot use --update, --restore-live or --manifest');
  const home = homedir(), hooksDir = path.join(home, '.claude/hooks');
  const source = realpathSync(o.source), at = path.join(source, 'MANIFEST.json');
  if (!lstatSync(at).isFile()) throw new Error('release integrity: MANIFEST.json must be a regular file');
  const bytes = readFileSync(at), receipt = path.join(home, '.golems/release.json');
  if (existsSync(receipt)) {
    const installed = JSON.parse(readFileSync(receipt));
    if (Object.hasOwn(installed, 'manifest_sha256') && installed.manifest_sha256 !== digest(bytes)) throw new Error('release integrity: MANIFEST.json does not match release receipt manifest_sha256');
  }
  const release = JSON.parse(bytes);
  if (!/^[0-9a-f]{40}$/.test(release.commit) || typeof release.version !== 'string' || !Array.isArray(release.files)) throw new Error('release integrity: invalid MANIFEST.json');
  const files = new Set();
  for (const row of release.files) {
    if (!safe(row.path) || files.has(row.path) || !/^[0-9a-f]{64}$/.test(row.sha256) || !['0644', '0755'].includes(row.mode)) throw new Error('release integrity: invalid file record');
    files.add(row.path);
    const file = path.join(source, row.path);
    if (!existsSync(file) || !lstatSync(file).isFile() || realpathSync(file) !== file || digest(readFileSync(file)) !== row.sha256 || (lstatSync(file).mode & 0o777) !== parseInt(row.mode, 8)) throw new Error(`release integrity: mismatch ${row.path}`);
  }
  // Extra importable files can change a policy without changing its declared hash.
  const directories = new Set([...files].flatMap(p => p.split('/').slice(0, -1).map((_, i) => p.split('/').slice(0, i + 1).join('/'))));
  const walk = relative => {
    for (const name of readdirSync(path.join(source, relative))) {
      const child = path.posix.join(relative, name), st = lstatSync(path.join(source, child));
      if (st.isDirectory() && directories.has(child)) walk(child);
      else if (!files.has(child)) throw new Error(`release integrity: unexpected ${child}`);
    }
  };
  for (const root of ['scripts/hooks', 'skills/golem-powers']) walk(root);
  if (!files.has('scripts/hooks/manifest.json')) throw new Error('release integrity: hook manifest missing');
  const text = readFileSync(path.join(source, 'scripts/hooks/manifest.json'), 'utf8');
  if (E1_DELETED.some(name => text.includes(name))) throw new Error('E1-deleted hook in release manifest');
  const manifest = JSON.parse(text), listed = manifest.hosts?.client;
  if (!Array.isArray(listed)) throw new Error('release manifest has no client profile');
  assertClientHost(home, o);
  const skipped = listed.filter(e => e.ownerOnly);
  const skippedCodex = (manifest.codex_hosts?.client ?? []).filter(e => e.ownerOnly);
  const entries = listed.filter(e => !e.ownerOnly);
  for (const e of entries) {
    if (e.kind !== 'golems' || !safe(e.link) || !safe(e.source) || !e.match || typeof e.command !== 'string' || !Number.isInteger(e.timeout) || e.timeout < 1 || e.timeout > 120 || (e.command.includes('--fail-closed') && e.timeout < 2)) throw new Error(`invalid client hook: ${e.id}`);
    if (!files.has(e.source) && ![...files].some(p => p.startsWith(e.source + '/'))) throw new Error(`release integrity: hook source missing ${e.id}`);
    if (e.requiresPin && (!safe(e.requiresPin) || !files.has(e.requiresPin) || !pinnedFingerprints(readFileSync(path.join(source, e.requiresPin))))) throw new Error(`client hook ${e.id} has no release anchor fingerprint; refusing installation`);
  }
  const hookPython = resolveHookPython({ override: o.python, pathPython: pathPython() });
  if (!hookPython) throw new Error('no acceptable hook interpreter (absolute Python >= 3.11)');
  // Absolute node chosen by the invoking CLI; no git discovery.
  const expand = s => s.replaceAll('{home}', quote(home)).replaceAll('{hooks}', quote(hooksDir)).replaceAll('{live}', quote(source)).replaceAll('{node}', quote(process.execPath)).replaceAll('{python}', quote(hookPython.python));
  const golems = entries.map(e => ({ ...e, at: path.join(hooksDir, e.link), to: path.join(source, e.source), cmd: e.command.includes(' --fail-closed ')
    ? failClosedCommand(expand(e.command.replace(' --fail-closed ', ` --fail-closed --client --budget ${e.timeout - 1} `)), CLIENT_REPAIR) : expand(e.command) }));
  const codex = planCodexHooks({ manifest, host: 'client', source, codexHome: path.resolve(process.env.CODEX_HOME || path.join(home, '.codex')), python: hookPython.python });
  if (!codex || !codex.enabled || !codex.source) throw new Error('client Codex hooks disabled or adapter absent');
  const wrapper = path.join(source, 'scripts/hooks/fail-open.py');
  if (!/^FAIL_CLOSED_PROTOCOL = 2\b/m.test(readFileSync(wrapper, 'utf8'))) throw new Error('release launcher lacks fail-closed protocol');
  return { source, release, entries, skipped, skippedCodex, golems, hooksDir, live: source, codex, hookPython, home, expand, wrapper, settingsPath: path.join(home, '.claude/settings.json') };
}

function releaseStatus(ctx, { readSettings, linkState, hookSpec, retiredRegistrations }) {
  const settings = readSettings(ctx.settingsPath), hooks = settings.json.hooks ?? {};
  let drift = 0, settingsDrift = 0;
  const wrapper = path.join(ctx.hooksDir, 'golems-fail-open.py');
  if (!existsSync(wrapper) || !readFileSync(wrapper).equals(readFileSync(ctx.wrapper))) drift++;
  for (const e of ctx.golems) {
    const matches = Object.entries(hooks).flatMap(([event, groups]) => (Array.isArray(groups) ? groups : []).flatMap(g => (g?.hooks ?? [])
      .filter(h => String(h?.command ?? '').includes(e.match)).map(h => ({ event, matcher: g.matcher ?? null, hook: h }))));
    const registered = matches.length === 1 && matches[0].event === e.event && matches[0].matcher === (e.matcher ?? null) && isDeepStrictEqual(matches[0].hook, hookSpec(e));
    if (!registered) settingsDrift++;
    const ok = linkState(e.at, e.to) === 'ok' && registered;
    if (!ok) drift++;
    console.log(`${e.id} ${ok ? 'ok' : 'drifted'}`);
  }
  const retired = retiredRegistrations(ctx, hooks).length;
  drift += retired; settingsDrift += retired;
  for (const e of ctx.skipped.filter(e => e.kind === 'golems')) if ((hooks[e.event] ?? []).some(g => (g.hooks ?? []).some(h => String(h.command ?? '').includes(e.match)))) { drift++; settingsDrift++; }
  if (!ctx.codex.registered) settingsDrift++;
  if (!ctx.codex.registered || ctx.codex.trust === 'disabled') drift++;
  const receipt = path.join(ctx.hooksDir, 'golems-hooks-release.json');
  if (!existsSync(receipt) || readFileSync(receipt, 'utf8') !== receiptText(ctx)) drift++;
  console.log(`codex wiring=${ctx.codex.registered ? 'ok' : 'drifted'} trust=${ctx.codex.trust} (native /hooks review required; trust unverified)`);
  console.log(`release=${ctx.release.version} commit=${ctx.release.commit} source=${ctx.source} drift=${drift}`);
  console.log(`settings-drift=${settingsDrift}`);
  return drift ? 1 : 0;
}
const receiptText = ctx => JSON.stringify({ version: ctx.release.version, commit: ctx.release.commit, source: ctx.source, private_gate: 'skipped (client host)' }, null, 2) + '\n';
const stamp = () => new Date().toISOString().replaceAll(/[:.]/g, '');
export function runReleaseHooks(o, helpers) {
  const { readSettings, desiredHooks, withoutHooks, withoutRetired, retiredRegistrations, linkState } = helpers;
  let migration;
  try {
    const ctx = releaseContext(o, helpers);
    for (const entry of ctx.skipped) console.log(`skipped ${entry.id}: owner-only (client host)`);
    for (const entry of ctx.skippedCodex) console.log(`skipped codex ${entry.gate}: owner-only (client host)`);
    console.log('private_gate: skipped (client host)');
    if (o.status) return releaseStatus(ctx, helpers);
    const settings = readSettings(ctx.settingsPath);
    if (!settings.canonical) throw new Error('settings.json is not canonical 2-space JSON; refusing rewrite');
    const next = JSON.stringify({ ...settings.json, hooks: withoutHooks(withoutRetired(desiredHooks(settings.json.hooks, ctx.golems), retiredRegistrations(ctx, settings.json.hooks)), ctx.skipped.filter(e => e.kind === 'golems')) }, null, 2) + '\n';
    if (!o.apply) { console.log('dry-run: nothing written (pass --apply); public hook self-tests run on apply'); return 0; }
    checkReleaseHooks({ ...ctx, python: ctx.hookPython.python });
    // Re-check all hashes after executing public specimens, before any host write.
    releaseContext(o, helpers);
    const installStamp = stamp();
    migration = o.migrateOwnerInstall ? beginOwnerMigration(ctx, installStamp) : beginClientInstall(ctx, installStamp);
    mkdirSync(ctx.hooksDir, { recursive: true });
    const wrapper = path.join(ctx.hooksDir, 'golems-fail-open.py');
    if (!existsSync(wrapper) || !readFileSync(wrapper).equals(readFileSync(ctx.wrapper))) { copyFileSync(ctx.wrapper, wrapper); chmodSync(wrapper, 0o755); }
    for (const e of ctx.golems) {
      const state = linkState(e.at, e.to);
      if (state === 'ok') continue;
      if (state === 'copy(not link)') renameSync(e.at, e.at + '.bak-' + installStamp);
      else if (state !== 'missing') unlinkSync(e.at);
      mkdirSync(path.dirname(e.at), { recursive: true }); symlinkSync(e.to, e.at);
    }
    if (next !== settings.text) {
      if (settings.text) writeFileSync(ctx.settingsPath + '.bak-' + installStamp, settings.text, { mode: settings.mode });
      const stage = ctx.settingsPath + '.install-hooks-tmp';
      writeFileSync(stage, next, { mode: settings.mode }); chmodSync(stage, settings.mode); renameSync(stage, ctx.settingsPath);
    }
    const receipt = path.join(ctx.hooksDir, 'golems-hooks-release.json');
    if (!existsSync(receipt) || readFileSync(receipt, 'utf8') !== receiptText(ctx)) writeFileSync(receipt, receiptText(ctx), { mode: 0o600 });
    applyCodexHooks(ctx.codex);
    migration?.commit();
    console.log(`applied release ${ctx.release.version}; ${CODEX_TRUST_HINT}`);
    return 0;
  } catch (error) {
    try { migration?.rollback(); } catch (rollbackError) { console.error(`install-hooks: rollback failed: ${rollbackError.message}`); }
    console.error(`install-hooks: ${error.message}`); return 1;
  }
}
