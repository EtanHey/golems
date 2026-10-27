#!/usr/bin/env node
// Usage: node scripts/install-receipt.mjs validate|write <receipt.json|->
import Ajv from 'ajv';
import { readFileSync, mkdirSync, lstatSync, writeFileSync, linkSync, unlinkSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { hostname, userInfo } from 'node:os';
import { randomUUID } from 'node:crypto';
import schema from './schemas/install-receipt-v1.mjs';

const ajv = new Ajv({ strict: false });
ajv.addFormat('utc-time', value => /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19));
const valid = ajv.compile(schema);
function validate(receipt) {
  if (!valid(receipt)) throw new Error(ajv.errorsText(valid.errors));
}
function assess(r) {
  const mismatch = (r.installed.embedded_commit && r.installed.embedded_commit !== r.target.merge_sha)
    || (!r.installed.embedded_commit && r.installed.content_sha256 && r.target.release_asset
      && r.installed.content_sha256 !== r.target.release_asset.sha256);
  if (mismatch && r.verdict !== 'FAILED') return ['MISMATCH', 'Installed identity differs from target merge/artifact'];
  const identity = r.installed.embedded_commit === r.target.merge_sha || (!r.installed.embedded_commit
    && r.installed.content_sha256 && r.installed.content_sha256 === r.target.release_asset?.sha256);
  const fresh = r.activation.processes.some(p => Date.parse(p.started_at) > Date.parse(r.installed.install_finished_at));
  const probe = r.activation.self_report?.version === r.target.version || r.activation.mcp_probe?.ok === true;
  if (r.verdict === 'LIVE' && !(identity && fresh && probe)) return ['INSTALLED_NOT_ACTIVE', 'Missing matching identity, fresh activation process or runtime proof'];
  return [r.verdict];
}
try {
  const [command, input, ...extra] = process.argv.slice(2);
  if (!['validate', 'write'].includes(command) || !input || extra.length) throw new Error('Usage: install-receipt.mjs validate|write <receipt.json|->');
  const r = JSON.parse(readFileSync(input === '-' ? 0 : input, 'utf8'));
  if (command === 'write') { r.receipt_id = randomUUID(); r.written_at = new Date().toISOString(); }
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
    for (const part of ['', '.local', 'state', 'golems', 'install-receipts', r.product]) {
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
      renameSync(temp, join(dir, 'latest.json'));
    } finally {
      try { unlinkSync(temp); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    process.stdout.write(JSON.stringify({ ...r, path: file }) + '\n');
  }
} catch (error) {
  // Input values are deliberately excluded: validation errors must not echo forbidden payloads.
  process.stderr.write(`install-receipt: ${error instanceof SyntaxError ? 'Invalid JSON' : error.message}\n`);
  process.exitCode = 1;
}
