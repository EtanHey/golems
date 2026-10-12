// A former owner's release cutover: retain custody of links/pin and undo failed writes.
import { randomUUID } from 'node:crypto';
import { cpSync, lstatSync, mkdirSync, readdirSync, readlinkSync, realpathSync, renameSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const present = at => { try { return lstatSync(at); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };
const intoOwner = target => /\/\.worktrees\/hooks-live(?:\/|$)/.test(target);
export function ownerInstallPaths(hooks) {
  const found = [];
  const pin = path.join(hooks, 'golems-hooks-live.sha');
  if (present(pin)) found.push(pin);
  const walk = at => {
    const st = present(at);
    if (st?.isSymbolicLink()) {
      let owner = intoOwner(path.resolve(path.dirname(at), readlinkSync(at)));
      try { owner ||= intoOwner(realpathSync(at)); }
      catch (e) { if (!['ENOENT', 'ENOTDIR'].includes(e.code)) throw e; }
      if (owner && !found.includes(at)) found.push(at);
    } else if (st?.isDirectory()) for (const name of readdirSync(at)) walk(path.join(at, name));
  };
  walk(hooks);
  return found;
}
// Never move/write through directory aliases (especially a hooks-live alias).
function directories(at) {
  if (at === path.dirname(at)) return;
  directories(path.dirname(at));
  const st = present(at);
  if (st && (!st.isDirectory() || st.isSymbolicLink())) throw new Error(`owner migration: non-regular directory ${at}`);
}
export function beginOwnerMigration(ctx, installStamp) {
  const archiveRoot = path.join(ctx.home, '.golems/archive');
  const targets = [ctx.hooksDir, ctx.settingsPath, ctx.settingsPath + '.bak-' + installStamp,
    ctx.settingsPath + '.install-hooks-tmp', ctx.codex.at, ctx.codex.backup].filter(Boolean);
  const parents = new Set();
  for (const at of [...targets, path.join(archiveRoot, 'unused')]) {
    directories(path.dirname(at));
    for (let p = path.dirname(at); !present(p); p = path.dirname(p)) parents.add(p);
  }
  // settings.json is rewritten by rename; its backup must never follow a symlink.
  for (const at of targets.filter(at => at !== ctx.hooksDir)) {
    const st = present(at);
    if (st && !st.isFile()) throw new Error(`owner migration: non-regular file ${at}`);
  }
  directories(ctx.hooksDir);
  const archived = ownerInstallPaths(ctx.hooksDir);
  for (const e of ctx.golems) directories(path.dirname(e.at));
  for (const name of ['golems-fail-open.py', 'golems-hooks-release.json']) {
    const at = path.join(ctx.hooksDir, name), st = present(at);
    if (st && !st.isFile() && !archived.includes(at)) throw new Error(`owner migration: non-regular file ${at}`);
  }
  const archive = path.join(archiveRoot, 'owner-install-' + installStamp + '-' + randomUUID());
  const rollbackRoot = path.join(archive, '.rollback');
  const saved = targets.map((at, i) => ({ at, backup: path.join(rollbackRoot, String(i)), existed: Boolean(present(at)) }));
  let ready = false;
  const rollback = () => {
    if (ready) for (const row of saved) {
      rmSync(row.at, { recursive: true, force: true });
      if (row.existed) renameSync(row.backup, row.at);
    }
    rmSync(archive, { recursive: true, force: true });
    for (const p of [...parents].sort((a, b) => b.length - a.length)) {
      if (present(p) && readdirSync(p).length === 0) rmdirSync(p);
    }
  };
  try {
    mkdirSync(rollbackRoot, { recursive: true, mode: 0o700 });
    for (const row of saved) if (row.existed) cpSync(row.at, row.backup, { recursive: true, verbatimSymlinks: true, preserveTimestamps: true });
    ready = true;
    for (const at of archived) {
      const to = path.join(archive, 'hooks', path.relative(ctx.hooksDir, at));
      mkdirSync(path.dirname(to), { recursive: true, mode: 0o700 }); renameSync(at, to);
    }
  } catch (e) { rollback(); throw e; }
  return {
    rollback,
    commit() {
      writeFileSync(path.join(archive, 'receipt.json'), JSON.stringify({ status: 'installed', source: ctx.source,
        version: ctx.release.version, commit: ctx.release.commit, archived: archived.map(at => path.relative(ctx.hooksDir, at)) }, null, 2) + '\n', { mode: 0o600 });
      // Receipt commits the cutover. Cleanup failure must not undo a committed install
      // after the rollback snapshot may already have been partly removed.
      try { rmSync(rollbackRoot, { recursive: true }); }
      catch (e) { console.error(`owner migration: retained rollback snapshot at ${rollbackRoot}: ${e.message}`); }
      console.log(`owner install archived: ${archive}`);
    },
  };
}
