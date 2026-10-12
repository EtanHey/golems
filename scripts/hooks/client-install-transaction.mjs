// Restore client registrations and pinned links if an apply fails after writes.
import { randomUUID } from 'node:crypto';
import { chmodSync, cpSync, lchmodSync, lstatSync, mkdirSync, readdirSync, renameSync, rmSync, rmdirSync } from 'node:fs';
import path from 'node:path';

const present = at => { try { return lstatSync(at); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };
function directories(at) {
  if (at === path.dirname(at)) return;
  directories(path.dirname(at));
  const st = present(at);
  if (st && !st.isDirectory()) throw new Error(`client install: non-regular directory ${at}`);
}
function modes(from, to) {
  const st = lstatSync(from);
  if (st.isSymbolicLink()) {
    if (typeof lchmodSync === 'function') lchmodSync(to, st.mode & 0o777);
  } else {
    chmodSync(to, st.mode & 0o777);
    if (st.isDirectory()) for (const name of readdirSync(from)) modes(path.join(from, name), path.join(to, name));
  }
}
export function beginClientInstall(ctx, stamp) {
  const root = path.join(ctx.home, '.golems', '.hooks-rollback-' + randomUUID());
  const targets = [ctx.hooksDir, ctx.settingsPath, ctx.settingsPath + '.bak-' + stamp,
    ctx.settingsPath + '.install-hooks-tmp', ctx.codex.at, ctx.codex.backup].filter(Boolean);
  const parents = new Set();
  for (const at of [...targets, root]) {
    directories(path.dirname(at));
    for (let p = path.dirname(at); !present(p); p = path.dirname(p)) parents.add(p);
  }
  directories(ctx.hooksDir);
  for (const e of ctx.golems) directories(path.dirname(e.at));
  for (const at of [...targets.filter(at => at !== ctx.hooksDir),
    path.join(ctx.hooksDir, 'golems-fail-open.py'), path.join(ctx.hooksDir, 'golems-hooks-release.json')]) {
    const st = present(at);
    if (st && !st.isFile()) throw new Error(`client install: non-regular file ${at}`);
  }
  const saved = targets.map((at, i) => ({ at, backup: path.join(root, String(i)), existed: Boolean(present(at)) }));
  try {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    for (const row of saved) if (row.existed) {
      cpSync(row.at, row.backup, { recursive: true, verbatimSymlinks: true, preserveTimestamps: true });
      modes(row.at, row.backup);
    }
  } catch (e) { rmSync(root, { recursive: true, force: true }); throw e; }
  const cleanup = () => {
    rmSync(root, { recursive: true, force: true });
    for (const p of [...parents].sort((a, b) => b.length - a.length)) {
      if (present(p) && readdirSync(p).length === 0) rmdirSync(p);
    }
  };
  return {
    rollback() {
      for (const row of saved) {
        rmSync(row.at, { recursive: true, force: true });
        if (row.existed) renameSync(row.backup, row.at);
      }
      cleanup();
    },
    commit() {
      // Once committed, a cleanup failure must not undo a successful apply.
      try { cleanup(); } catch (e) { console.error(`client install: retained snapshot ${root}: ${e.message}`); }
    },
  };
}
