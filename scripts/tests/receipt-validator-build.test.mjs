import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, copyFileSync, symlinkSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';

test('locked validator rebuild matches committed bundle and licenses', () => {
  execFileSync('bash', ['scripts/build-receipt-validator.sh', '--check'], { stdio: 'pipe' });
});
for (const tool of ['Bun', 'Ajv']) test(`validator generation refuses an unexpected ${tool} version before building`, () => {
  mkdirSync('docs.local', { recursive: true });
  const bin = mkdtempSync(resolve('docs.local/validator-version-'));
  try {
    const version = tool === 'Bun' ? '0.0.0' : readFileSync('.bun-version', 'utf8').trim();
    writeFileSync(join(bin, 'bun'), `#!/bin/sh\nif [ "$1" = --version ]; then echo '${version}'; else exit 99; fi\n`, { mode: 0o755 });
    if (tool === 'Ajv') writeFileSync(join(bin, 'node'), '#!/bin/sh\necho 0.0.0\n', { mode: 0o755 });
    const r = spawnSync('bash', ['scripts/build-receipt-validator.sh', '--check'], { encoding: 'utf8', env: { ...process.env, PATH: bin + ':' + process.env.PATH } });
    assert.notEqual(r.status, 0); assert.match(r.stderr, new RegExp(tool + ' version mismatch'));
  } finally { rmSync(bin, { recursive: true, force: true }); }
});
test('validator check detects differing committed bytes without replacing them', () => {
  const root = mkdtempSync(resolve('docs.local/validator-corrupt-'));
  try {
    mkdirSync(join(root, 'scripts/lib/vendor'), { recursive: true });
    for (const file of ['.bun-version', 'bun.lock', 'scripts/build-receipt-validator.sh']) copyFileSync(file, join(root, file));
    symlinkSync(resolve('node_modules'), join(root, 'node_modules'));
    const bundle = join(root, 'scripts/lib/vendor/receipt-ajv.generated.mjs'); writeFileSync(bundle, 'corrupt fixture');
    const r = spawnSync('bash', [join(root, 'scripts/build-receipt-validator.sh'), '--check'], { encoding: 'utf8' });
    assert.notEqual(r.status, 0); assert.equal(readFileSync(bundle, 'utf8'), 'corrupt fixture');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
