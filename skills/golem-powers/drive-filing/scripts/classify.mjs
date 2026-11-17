#!/usr/bin/env node
// Read-only classification of an entire archive run, independent of dating or
// regenerable-directory exclusions. Nothing is uploaded, moved or written.
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { scanReceipt, isCredentialDir } from './rollup.mjs';
import { credentialPathRule, packageTree } from './credential-policy.mjs';

export function classify(root) {
  root = resolve(root);
  const deadline = Date.now() + 120_000;
  const held = [], reasons = {};
  let files = 0;
  const members = [];
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
        const rule = inherited ?? (isCredentialDir(basename(path), packageTree(path)) ? 'credential-directory' : null);
        for (const name of readdirSync(path).sort()) walk(join(path, name), rule);
      } else {
        files++;
        if (inherited || credentialPathRule(path)) {
          hold(path, inherited ?? credentialPathRule(path));
        } else {
          const receipt = scanReceipt(path, deadline - Date.now());
          members.push({path: relative(root, path), bytes: receipt.bytes, sha256: receipt.sha256});
          for (const rule of receipt.shapes) hold(path, rule);
        }
      }
    } catch { hold(path, 'scan-unreadable'); }
  }
  walk(root);
  return { root, files, members, heldMembers: new Set(held.map(h => h.path)).size, reasons, held, status: held.length ? 'HOLD' : 'CLEAR' };
}
// Upload preflight: rescan and rehash every member; the entire inventory must
// equal the prior CLEAR receipt, including additions/deletions and media bytes.
export function verifyReports(reports) {
  if (!Array.isArray(reports) || !reports.length) return false;
  return reports.every(saved => saved.status === 'CLEAR' && saved.files === saved.members?.length &&
    saved.members.every(m => /^[a-f0-9]{64}$/.test(m.sha256) && Number.isSafeInteger(m.bytes)) &&
    (() => { const current = classify(saved.root); return current.status === 'CLEAR' &&
      JSON.stringify(current.members) === JSON.stringify(saved.members); })());
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
  if (process.argv[2] === '--verify') {
    try {
      if (process.argv.length !== 4 || !verifyReports(JSON.parse(readFileSync(process.argv[3], 'utf8')))) throw new Error();
      console.log('scan-receipt-verified');
    } catch { console.error('scan-receipt-mismatch'); process.exitCode = 1; }
  } else if (process.argv.length < 3) {
    console.error('usage: classify.mjs <archive-run> [...] | --verify <receipt.json>'); process.exitCode = 2;
  } else process.stdout.write(JSON.stringify(process.argv.slice(2).map(classify), null, 2) + '\n');
}
