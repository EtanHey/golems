import { afterEach, beforeEach, expect, test } from 'bun:test';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { stringify } from 'yaml';
import { prepareAgents, renderAgents } from '../repogolem/repogolem-agents';

const root = join(import.meta.dir, '../..');
const templates = join(root, 'skills/golem-powers/orc/agents/templates');
const cli = join(root, 'scripts/repogolem/repogolem-config.ts');
// V2 rejects private values files inside any git worktree, even gitignored paths.
const contact = /[\w.+-]+@[\w.-]+\.[a-z]{2,}|\+\d[\d -]{8,}|\b0\d{1,2}[- ]?\d{7}\b|(?:\(\d{3}\)|\b\d{3})[- ]\d{3}[- ]\d{4}\b/i;
test('contact scan rejects synthetic international and local phone formats', () => {
  for (const phone of ['+15555550123', '055-5550123', '(555) 555-0123', '555-555-0123'])
    expect(phone).toMatch(contact);
});
let dir: string, home: string, out: string, config: string, valuesFile: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'repogolem-managed-agents-'));
  home = join(dir, 'home'); mkdirSync(home);
  out = join(home, '.config/repogolem/generated'); config = join(dir, 'config.yaml');
  valuesFile = join(dir, 'values.env');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));
function setup(name: string) {
  const manifest = JSON.parse(readFileSync(join(templates, name+'.values.json'), 'utf8'));
  const values = Object.fromEntries(manifest.values.map((v: any) => [v.name, { sensitive: false }]));
  writeFileSync(valuesFile, manifest.values.map((v: any) => `${v.name}='/fixture/${v.name}'`).join('\n')+'\n', { mode: 0o600 });
  return { seatRegistry: { seats: { fixture: { launcherPrefix: 'fixture' } } },
    secrets: { backend: 'file', valuesFile }, values, agentTemplates: { [name]: join(templates, name+'.md') }, projects: {} };
}
function run(settings: any, command='generate', flags: string[] = []) {
  writeFileSync(config, stringify(settings));
  const args = command === 'generate' ? ['--out-dir', out, '--home', home] : [];
  const result = Bun.spawnSync([process.execPath, '--no-install', cli, command, '--config', config, ...args, ...flags],
    { env: { ...process.env, HOME: home, BUN_RUNTIME_TRANSPILER_CACHE_PATH: join(dir, 'bun-cache'),
      REPOGOLEM_OP_BIN: '/no-real-op', REPOGOLEM_SOURCE_SHA: '0'.repeat(40) }, stdout: 'pipe', stderr: 'pipe' });
  return result.exitCode;
}
function snapshot(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  return Object.fromEntries(readdirSync(path, { recursive: true }).filter(p => lstatSync(join(path, String(p))).isFile())
    .map(p => [String(p), readFileSync(join(path, String(p))).toString('base64')]));
}
for (const file of readdirSync(templates).filter(n => n.endsWith('.md'))) {
  const name = file.slice(0, -3);
  test(`${name}: real V3 generation and cache-only installer link a private contact-free render`, () => {
    const settings = setup(name);
    expect(run(settings)).toBe(0);
    const rendered = join(out, 'agents', file), text = readFileSync(rendered, 'utf8');
    expect(text).not.toMatch(/{{|}}/); expect(text).not.toMatch(contact);
    expect(lstatSync(rendered).mode & 0o777).toBe(0o600);
    expect(lstatSync(join(out, 'agents')).mode & 0o777).toBe(0o700);
    expect(run(settings, 'generate', ['--check'])).toBe(0);
    expect(run(settings, 'install', ['--apply'])).toBe(0);
    expect(readlinkSync(join(home, '.claude/agents', file))).toBe(rendered);
    expect(run(settings, 'install', ['--rollback', '--apply'])).toBe(0);
  });
  test(`${name}: every missing value preserves all outputs and shell state`, () => {
    const settings = setup(name); expect(run(settings)).toBe(0);
    const before = snapshot(home);
    const complete = readFileSync(valuesFile, 'utf8');
    for (const key of Object.keys(settings.values)) {
      writeFileSync(valuesFile, complete.split('\n').filter(l => !l.startsWith(key+'=')).join('\n'));
      expect(run(settings)).toBe(2); expect(snapshot(home)).toEqual(before);
      const values = new Map(Object.keys(settings.values).filter(k => k !== key).map(k => ['varlock://'+k, '/fixture/'+k]));
      expect(() => renderAgents(prepareAgents(settings), values, '0'.repeat(64), null, settings)).toThrow();
    }
  });
  test(`${name}: installer refuses unrendered templates without writes`, () => {
    const settings = setup(name), before = snapshot(home);
    expect(run(settings, 'install', ['--apply'])).toBe(2);
    expect(snapshot(home)).toEqual(before);
  });
  test(`${name}: sensitive declarations and source collisions refuse before any writes`, () => {
    const settings = setup(name);
    for (const key of Object.keys(settings.values)) {
      settings.values[key].sensitive = true;
      expect(run(settings)).toBe(2); expect(existsSync(out)).toBe(false);
      settings.values[key].sensitive = false;
      settings.values[key].source = 'op://fixture/item/token';
      settings.values.PRIVATE_TOKEN = { sensitive: true, source: 'op://fixture/item/token' };
      expect(() => prepareAgents(settings)).toThrow(); expect(existsSync(out)).toBe(false);
      delete settings.values[key].source; delete settings.values.PRIVATE_TOKEN;
    }
  });
  test(`${name}: resolved sensitive bytes cannot render through any declared value`, () => {
    const settings = setup(name);
    settings.values.PRIVATE_TOKEN = { sensitive: true };
    const inputs = prepareAgents(settings);
    for (const key of Object.keys(settings.values).filter(k => k !== 'PRIVATE_TOKEN')) {
      const values = new Map(Object.keys(settings.values).map(k => ['varlock://'+k, '/fixture/'+k]));
      values.set('varlock://PRIVATE_TOKEN', 'PRIVATE_RENDER_CANARY');
      values.set('varlock://'+key, '/fixture/PRIVATE_RENDER_CANARY');
      expect(() => renderAgents(inputs, values, '0'.repeat(64), null, settings)).toThrow();
      expect(existsSync(out)).toBe(false);
    }
  });
}
