#!/usr/bin/env node
import { readdirSync, existsSync, statfsSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execute, run } from './fleet-runtime.mjs';
export function planDisk({ free, threshold, sizes, host, now = Date.now() }, state = {}) {
  const low = free < threshold;
  const posts = [];
  if (low && (!state.low || now - state.lastPost >= 86400000)) {
    const top = Object.entries(sizes).sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([p, n]) => `${p}: ${n.toFixed(2)} GiB (delta ${state.sizes?.[p] === undefined ? 'UNKNOWN' : (n - state.sizes[p]).toFixed(2)})`).join('\n');
    posts.push(`\n### disk-guard → @orc — ${new Date(now).toISOString()} ${host} ${free.toFixed(2)} GiB free: top 5 growers\n${top}\n`);
  }
  return { posts, state: { ...state, low, sizes, lastPost: posts.length ? now : state.lastPost } };
}
export function collectDisk(config) {
  const host = hostname(); const fs = statfsSync(homedir());
  const roots = config.repoRoots ?? [join(homedir(), 'Gits'), join(homedir(), '.t3/worktrees')];
  const sizes = {};
  for (const root of roots) if (existsSync(root)) for (const e of readdirSync(root, { withFileTypes: true })) {
    if (e.isDirectory()) { const p = join(root, e.name); sizes[p] = Number(run('du', ['-sk', p]).split(/\s/)[0]) / 1048576; }
  }
  const configured = config.diskThresholdGiB?.[host];
  // Capacity distinguishes the fleet's smaller M1 volume without hard-coded hostnames.
  const threshold = configured ?? (fs.blocks * fs.bsize / 1073741824 < 1000 ? 40 : 60);
  if (!Number.isFinite(threshold) || threshold <= 0) throw Error('invalid disk threshold');
  return { host, free: fs.bfree * fs.bsize / 1073741824, threshold, sizes };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = execute('disk-guard', (s, c) => planDisk(collectDisk(c), s));
