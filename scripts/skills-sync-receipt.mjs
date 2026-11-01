#!/usr/bin/env node
import { emitSkillsReceipt, snapshotSkills } from './lib/skills-sync-receipt.mjs';
import { hostAlias } from './install-receipt-status.mjs';
import { hostname } from 'node:os';
import { resolve } from 'node:path';

try {
  const [command, mode = 'release-channel', host = 'auto', source = resolve(process.env.HOME, '.golems/current'), prefix = resolve(source, '..')] = process.argv.slice(2);
  if (!['emit', 'snapshot'].includes(command) || !['checkout', 'release-channel'].includes(mode)) throw Error('invalid skills receipt command');
  if (command === 'snapshot') console.log(JSON.stringify(snapshotSkills({ mode, source, prefix })));
  else emitSkillsReceipt({ mode, source, prefix, alias: host === 'auto' ? hostAlias(hostname()) : host,
    ownerArgs: ['--host', 'client', '--source', source] });
} catch (error) { console.error('SKILLS-SYNC RECEIPT UNAVAILABLE: ' + error.message); process.exitCode = 1; }
