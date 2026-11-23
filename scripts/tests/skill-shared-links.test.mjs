import { afterAll, expect, test } from 'bun:test';
import { readFileSync, existsSync, mkdirSync, mkdtempSync, symlinkSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const repo = resolve(import.meta.dir, '../..');
mkdirSync(resolve(repo, 'docs.local'), { recursive: true });
const fixture = mkdtempSync(resolve(repo, 'docs.local/sharedlink-fixture-'));
const root = resolve(fixture, '.codex/skills');
mkdirSync(root, { recursive: true });
afterAll(() => rmSync(fixture, { recursive: true }));
const publicRoot = 'https://github.com/EtanHey/golems/blob/master/';
for (const name of ['drive-filing', 'fleet-wrap-gate', 'pr-loop']) {
  test(`${name}: contract resolves from an installed skill without a support sibling`, () => {
    const text = readFileSync(resolve(repo, 'skills/golem-powers', name, 'SKILL.md'), 'utf8');
    const link = text.match(/\[workspace lifecycle contract\]\(([^)]+)\)/)[1];
    // Model a Markdown consumer normalizing against its installed symlink pathname.
    // No _shared entry exists in that root. Public URLs resolve independently of HOME.
    symlinkSync(resolve(repo, 'skills/golem-powers', name), resolve(root, name));
    expect(existsSync(resolve(root, '_shared'))).toBe(false);
    const installedDocument = resolve(root, name, 'SKILL.md');
    const resolved = new URL(link, `file://${installedDocument}`);
    expect(resolved.protocol).toBe('https:');
    expect(resolved.href.startsWith(publicRoot)).toBe(true);
    expect(resolved.href).toBe(publicRoot + 'skills/golem-powers/_shared/lifecycle/CONTRACT.md');
    expect(existsSync(resolve(repo, resolved.href.slice(publicRoot.length)))).toBe(true);
  });
}
