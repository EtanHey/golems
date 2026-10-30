#!/usr/bin/env bun
import { readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { checkPublishedDesign, writeDesignReport } from '../src/design-preservation.mjs';

try {
  const args = {};
  for (let i = 2; i < process.argv.length; i += 2) {
    const flag = process.argv[i];
    if (!['--spec', '--out', '--screenshots'].includes(flag) || !process.argv[i + 1]) throw new Error('usage: check-design-preservation.mjs --spec job.json [--out dashboard.html] [--screenshots directory]');
    args[flag.slice(2)] = process.argv[i + 1];
  }
  const expand = value => path.resolve(value.replace(/^~(?=\/)/, os.homedir()));
  const spec = JSON.parse(readFileSync(expand(args.spec), 'utf8'));
  const output = expand(args.out || spec.outputPath), html = readFileSync(output, 'utf8');
  const result = await checkPublishedDesign(spec, output, html, { screenshotDir: args.screenshots && expand(args.screenshots) });
  writeDesignReport(output, html, result);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.verdict === 'PASS' ? 0 : 3);
} catch (error) { console.error(`[design-preservation] FATAL: ${error.message}`); process.exit(3); }
