import { afterAll } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Only registry location is injected; subprocesses execute the real history code.
export function designTestCell() {
  const parent = fileURLToPath(new URL('../../../../docs.local/adp-test-cells/', import.meta.url));
  mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(path.join(parent, 'design-')), registryRoot = path.join(root, 'registry');
  const modulePath = fileURLToPath(new URL('../src/design-history.mjs', import.meta.url));
  const preload = path.join(root, 'registry-preload.mjs');
  writeFileSync(preload, `import { mock } from 'bun:test';
const actual = await import(${JSON.stringify(modulePath)});
const { loadPublishedDesign, recordPublishedDesign } = actual;
mock.module(${JSON.stringify(modulePath)}, () => ({ ...actual,
loadPublishedDesign: (spec, output, options) => loadPublishedDesign(spec, output, { ...options, registryRoot: ${JSON.stringify(registryRoot)} }),
recordPublishedDesign: (spec, output, html, options) => recordPublishedDesign(spec, output, html, { ...options, registryRoot: ${JSON.stringify(registryRoot)} }) }));
`);
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  return { root, options: { registryRoot }, command: (script, args = []) => [process.execPath, '--preload', preload, script, ...args] };
}
