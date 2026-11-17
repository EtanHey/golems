#!/usr/bin/env node
// Read-only classification of an entire archive run, independent of dating or
// regenerable-directory exclusions. Nothing is uploaded, moved or written.
import { lstatSync, readdirSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { contentShapes, isCredentialDir, isCredentialFile } from './rollup.mjs';
import { credentialNameRule } from './credential-policy.mjs';

export function classify(root) {
  root = resolve(root);
  const deadline = Date.now() + 120_000;
  const held = [], reasons = {};
  let files = 0;
  const hold = (path, rule) => {
    held.push({ path: relative(root, path) || basename(root), rule });
    reasons[rule] = (reasons[rule] ?? 0) + 1;
  };
  function walk(path, inherited) {
    try {
      const stat = lstatSync(path);
      if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) { hold(path, 'scan-unsupported-member'); return; }
      if (stat.isDirectory()) {
        if ((stat.mode & 0o444) === 0) { hold(path, 'scan-unreadable'); return; }
        const rule = inherited ?? (isCredentialDir(basename(path)) ? 'credential-directory' : null);
        for (const name of readdirSync(path).sort()) walk(join(path, name), rule);
      } else {
        files++;
        if (inherited || isCredentialFile(basename(path))) {
          hold(path, inherited ?? credentialNameRule(basename(path)) ?? 'browser-profile');
        } else {
          for (const rule of contentShapes(path, deadline - Date.now())) hold(path, rule);
        }
      }
    } catch { hold(path, 'scan-unreadable'); }
  }
  walk(root);
  return { root, files, heldMembers: new Set(held.map(h => h.path)).size, reasons, held, status: held.length ? 'HOLD' : 'CLEAR' };
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
  if (process.argv.length < 3) { console.error('usage: classify.mjs <archive-run> [...]'); process.exitCode = 2; }
  else process.stdout.write(JSON.stringify(process.argv.slice(2).map(classify), null, 2) + '\n');
}
