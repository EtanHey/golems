#!/usr/bin/env node
import fs from 'node:fs';
import { defaultRoot, inspectTree } from '../prune-runs.mjs';
const ceiling = Number(process.env.GOLEMS_RATCHET_RUNS_MAX_GB ?? 10);
if (!Number.isFinite(ceiling) || ceiling <= 0) throw new Error('invalid size ceiling');
const root = defaultRoot();
const bytes = fs.existsSync(root) ? inspectTree(root, { allowSymlinks: true }).bytes : 0;
const health = bytes <= ceiling * 1e9;
console.log(JSON.stringify({ root, bytes, size_gb: bytes / 1e9, ceiling_gb: ceiling, health }));
process.exitCode = health ? 0 : 1;
