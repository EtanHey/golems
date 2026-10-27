import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, copyFileSync, cpSync, readdirSync, symlinkSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';

test('locked validator rebuild matches committed bundle and licenses', () => {
  execFileSync('bash', ['scripts/build-receipt-validator.sh', '--check'], { stdio: 'pipe' });
});
test('validator names the dependency when its license is missing', () => {
  mkdirSync('docs.local', { recursive: true });
  const root = mkdtempSync(resolve('docs.local/validator-missing-license-'));
  try {
    mkdirSync(join(root, 'scripts/lib/vendor'), { recursive: true });
    mkdirSync(join(root, 'node_modules'));
    for (const file of ['.bun-version', 'bun.lock', 'scripts/build-receipt-validator.sh']) copyFileSync(file, join(root, file));
    for (const name of readdirSync('node_modules')) {
      const source = resolve('node_modules', name), target = join(root, 'node_modules', name);
      if (name === 'require-from-string') cpSync(source, target, { recursive: true, dereference: true });
      else symlinkSync(source, target);
    }
    const dependency = join(root, 'node_modules/require-from-string');
    for (const name of readdirSync(dependency)) if (/^license(?:\.(?:md|txt))?$/i.test(name)) rmSync(join(dependency, name));
    const r = spawnSync('bash', [join(root, 'scripts/build-receipt-validator.sh'), '--check'], { encoding: 'utf8' });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /Missing license for require-from-string/);
    assert.doesNotMatch(r.stderr, /StopIteration|Traceback/);
  } finally { rmSync(root, { recursive: true, force: true }); }
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
