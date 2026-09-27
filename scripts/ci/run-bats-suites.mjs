#!/usr/bin/env node
// The manifest is both the coverage contract and the runner's input.
import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const { run, skip } = JSON.parse(readFileSync(new URL('./bats-suites.json', import.meta.url)));
const suites = readdirSync(`${root}/scripts/tests`).filter(name => name.endsWith('.bats')).sort();
const errors = [];
if (!Array.isArray(run) || !skip || typeof skip !== 'object' || Array.isArray(skip)) {
  throw new Error('Expected run array and skip object');
}
const listed = [...run, ...Object.keys(skip)];
for (const name of suites) {
  if (!listed.includes(name)) errors.push(`Uncovered suite: ${name}`);
}
for (const name of listed) {
  if (!suites.includes(name)) errors.push(`Unknown suite: ${name}`);
  if (listed.indexOf(name) !== listed.lastIndexOf(name)) errors.push(`Duplicate suite: ${name}`);
}
for (const [name, reason] of Object.entries(skip)) {
  if (typeof reason !== 'string' || !reason.trim() || /[\r\n]/.test(reason)) {
    errors.push(`Skip needs a one-line reason: ${name}`);
  }
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`Bats coverage: ${run.length} run, ${Object.keys(skip).length} explicitly skipped`);
for (const [name, reason] of Object.entries(skip)) console.log(`SKIP ${name}: ${reason}`);
if (process.argv[2] === '--check') process.exit(0);
if (process.argv[2] !== '--run') throw new Error('Usage: run-bats-suites.mjs --check|--run');

// Bound each file: the dispatch concurrency test has previously hung waiting
// for a release sentinel. A timeout is a failure; still report later suites.
let failed = false;
for (const name of run) {
  console.log(`\n=== ${name} ===`);
  const result = spawnSync('timeout', ['--kill-after=10s', '180s', 'bats', '--tap', `scripts/tests/${name}`], {
    cwd: root, stdio: 'inherit',
  });
  if (result.error || result.status !== 0) {
    console.error(`FAIL ${name}: ${result.error?.message ?? `exit ${result.status}, signal ${result.signal}`}`);
    failed = true;
  }
}
process.exitCode = failed ? 1 : 0;
