import { expect, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildRelease, shipped } from '../release/build-release.mjs';

const root = resolve(import.meta.dir, '../..');
const helper = 'launchd/named-program.mjs';
test('named-program import is included for every release-shipped caller', () => {
  expect(shipped(helper)).toBe(true);
  // The launchd entrypoints are checkout tools, not release entrypoints. Their
  // new local dependencies must exist there; only fleet-jobs ships to clients.
  for (const caller of ['scripts/hooks/fleet-jobs.mjs', 'scripts/install-google-drive-oauth-guard.mjs', 'launchd/install-job.sh', 'launchd/install.sh', 'launchd/install-stalker-morning-digest.sh', 'launchd/install-design-skill-updates.mjs']) {
    expect(readFileSync(join(root, caller), 'utf8')).toContain('named-program.mjs');
    expect(shipped(caller)).toBe(caller === 'scripts/hooks/fleet-jobs.mjs');
  }
  for (const file of ['launchd/unload-label.sh', 'launchd/render-plist.sh']) expect(existsSync(join(root, file))).toBe(true);
  const imports = [...readFileSync(join(root, helper), 'utf8').matchAll(/from ['"]([^'"]+)['"]/g)].map(match => match[1]);
  expect(imports.every(specifier => specifier.startsWith('node:'))).toBe(true);
});

test('real release tarball loads fleet-jobs and executes its named-wrapper dependency', () => {
  const scratchRoot = join(root, 'docs.local/w171/payload-fix');
  mkdirSync(scratchRoot, { recursive: true });
  const scratch = mkdtempSync(join(scratchRoot, 'artifact-'));
  try {
    // This is the production builder used to produce the M1 installer input,
    // not a fixture that copies all source files and hides missing payload paths.
    const release = buildRelease({ repo: root, commit: 'HEAD', out: join(scratch, 'assets') });
    const payload = join(scratch, 'payload'); mkdirSync(payload);
    execFileSync('tar', ['-xzf', release.tarball, '-C', payload]);
    const manifest = JSON.parse(readFileSync(join(payload, 'MANIFEST.json'), 'utf8'));
    expect(manifest.files.some(file => file.path === helper)).toBe(true);
    const home = join(scratch, 'home'); mkdirSync(home);
    const source = `
      const fleet = await import(${JSON.stringify(pathToFileURL(join(payload, 'scripts/hooks/fleet-jobs.mjs')).href)});
      fleet.installContextFleetJobs({fleetJobs: false});
      const { installWrapper } = await import(${JSON.stringify(pathToFileURL(join(payload, helper)).href)});
      const wrapper = installWrapper(process.env.HOME, 'Golems Disk Guard', '/bin/sh');
      console.log(JSON.stringify({ jobs: fleet.jobs, wrapper }));
    `;
    const result = spawnSync(Bun.which('node'), ['--input-type=module', '-e', source], { cwd: payload, env: { ...process.env, HOME: home }, encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
    const resultData = JSON.parse(result.stdout);
    expect(resultData.jobs).toEqual(['worktree-sweeper', 'disk-guard']);
    expect(readFileSync(resultData.wrapper, 'utf8')).toBe(`#!/bin/sh\nset -eu\nexec '/bin/sh' "$@"\n`);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}, 30000);
