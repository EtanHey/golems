#!/usr/bin/env node
// Usage: node scripts/install-receipt.mjs validate|write <receipt.json|-> | status
import { hostAlias } from './install-receipt-status.mjs';
import { validate, assess } from './lib/install-receipt-core.mjs';
import { readFileSync, mkdirSync, lstatSync, writeFileSync, linkSync, unlinkSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { hostname, userInfo } from 'node:os';
import { randomUUID } from 'node:crypto';

async function main() {
try {
  const [command, input, ...extra] = process.argv.slice(2);
  if (command === 'status') {
    const { printStatus } = await import('./install-receipt-status.mjs');
    printStatus([input, ...extra].filter(value => value !== undefined));
  } else {
  if (!['validate', 'write'].includes(command) || !input || extra.length) throw new Error('Usage: install-receipt.mjs validate|write <receipt.json|->');
  const r = JSON.parse(readFileSync(input === '-' ? 0 : input, 'utf8'));
  if (command === 'write') { r.host.alias = hostAlias(r.host.alias); r.receipt_id = randomUUID(); r.written_at = new Date().toISOString(); }
  validate(r);
  const [verdict, reason] = assess(r);
  if (command === 'validate') {
    if (verdict !== r.verdict) throw new Error(reason);
    process.stdout.write(JSON.stringify(r) + '\n');
  } else {
    if (!process.env.HOME) throw new Error('HOME is required');
    if (r.host.hostname !== hostname() || r.host.user !== userInfo().username) throw new Error('Receipt must describe this host and user');
    r.verdict = verdict; if (reason) r.reasons.push(reason);
    const dir = join(process.env.HOME, '.local/state/golems/install-receipts', r.product);
    let ancestor = process.env.HOME;
    for (const part of ['.local', 'state', 'golems', 'install-receipts', r.product]) {
      ancestor = join(ancestor, part);
      try { mkdirSync(ancestor, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
      if (!lstatSync(ancestor).isDirectory() || lstatSync(ancestor).isSymbolicLink()) throw new Error('State path must contain only local directories');
    }
    const file = join(dir, `${r.written_at}-${r.target.version}.json`);
    const temp = join(dir, `.${r.receipt_id}.tmp`);
    const bytes = JSON.stringify(r, null, 2) + '\n';
    writeFileSync(temp, bytes, { flag: 'wx', mode: 0o600 });
    try {
      linkSync(temp, file); // Atomic publication; EEXIST preserves an earlier install event.
      renameSync(temp, join(dir, ['skills-sync', 'hooks-sync'].includes(r.artifact_kind) ? `latest-${r.artifact_kind}-${r.install_source.mode}.json` : 'latest.json'));
    } finally {
      try { unlinkSync(temp); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    process.stdout.write(JSON.stringify({ ...r, path: file }) + '\n');
  }
  }
} catch (error) {
  // Input values are deliberately excluded: validation errors must not echo forbidden payloads.
  process.stderr.write(`install-receipt: ${error instanceof SyntaxError ? 'Invalid JSON' : error.message}\n`);
  process.exitCode = 1;
}
}
await main();
