#!/usr/bin/env node
// Added-line publication guard. No package install, Ruby, network, or suite.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const source = join(dirname(fileURLToPath(import.meta.url)), '..');
const git = (...args) => {
  const r = spawnSync('git', ['--no-replace-objects', ...args], { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
  if (r.status !== 0) throw new Error('git evidence unavailable');
  return r.stdout;
};
// The public policy uses quoted scalars and POSIX ERE character classes.
// Reject unknown classes rather than silently weakening their translation.
function regex(value) {
  const classes = { alnum: 'a-zA-Z0-9', alpha: 'a-zA-Z', digit: '0-9', space: '\\s', cntrl: '\\x00-\\x1f\\x7f' };
  const translated = value.replace(/\[:([a-z]+):\]/g, (_, c) => {
    if (!classes[c]) throw new Error('unsupported policy character class');
    return classes[c];
  });
  return new RegExp(translated, 'gi');
}
function policy() {
  let section, klass, kind;
  const rules = new Map();
  for (const line of readFileSync(join(source, 'publish-boundary-policy.yaml'), 'utf8').split('\n')) {
    if (/^[a-z_]+:/.test(line)) section = line.split(':')[0];
    if (section !== 'forbidden_classes' && section !== 'push_patterns') continue;
    const c = /^  ([a-z_-]+):/.exec(line);
    if (c) { klass = c[1]; rules.set(klass, { patterns: [], allowed_patterns: [] }); kind = null; }
    const k = /^    (patterns|allowed_patterns):/.exec(line);
    if (k) kind = k[1];
    const scalar = /^      - '(.*)'\s*$/.exec(line);
    if (scalar && kind) rules.get(klass)[kind].push(regex(scalar[1].replaceAll("''", "'")));
    else if (/^      -/.test(line)) throw new Error('unsupported policy scalar');
  }
  if (![...rules.values()].some(r => r.patterns.length)) throw new Error('empty policy');
  return rules;
}
function allowlist() {
  const result = new Set();
  for (let line of readFileSync(join(source, '..', '.publish-boundary-allow'), 'utf8').split('\n')) {
    line = line.replace(/\r$/, '');
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('/') || line.includes('..') || /[*?[]/.test(line) || line.endsWith('/') || result.has(line))
      throw new Error('invalid exact-path allowlist');
    result.add(line);
  }
  return result;
}
try {
  const rules = policy(), allowed = allowlist();
  const input = readFileSync(0, 'utf8').trim();
  if (!input) throw new Error('missing pre-push ref evidence');
  let checked = 0;
  for (const row of input.split('\n')) {
    const fields = row.split(/\s+/);
    if (fields.length !== 4 || !fields[1].match(/^[a-f0-9]{40,64}$/) || !fields[3].match(/^[a-f0-9]{40,64}$/)) throw new Error('invalid pre-push ref evidence');
    const [, head, , remote] = fields;
    if (/^0+$/.test(head)) continue;
    git('cat-file', '-e', head + '^{commit}');
    // New refs scan all reachable commits. Existing refs scan all new commits,
    // including side branches and merge resolutions; never assume ancestor base.
    const commits = git('rev-list', head, ...(/^0+$/.test(remote) ? [] : ['^' + remote])).trim().split('\n').filter(Boolean);
    const diffs = commits.map(commit => ['diff-tree', '--root', '-m', '-p', '--no-ext-diff', '--no-textconv', '--no-renames', '--unified=0', commit]);
    if (!/^0+$/.test(remote)) diffs.push(['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--unified=0', remote, head]);
    for (const args of diffs) {
      let file = null;
      for (const line of git(...args).split('\n')) {
        if (line.startsWith('+++ b/')) file = line.slice(6);
        else if (line.startsWith('+++ "')) file = JSON.parse(line.slice(4)).slice(2);
        else if (line.startsWith('+++ ')) file = null;
        else if (file && line.startsWith('+') && !allowed.has(file) && file !== '.publish-boundary-allow' && file !== 'scripts/publish-boundary-policy.yaml') {
          for (const [name, rule] of rules) {
            let text = line.slice(1);
            for (const re of rule.allowed_patterns) text = text.replace(re, '');
            if (rule.patterns.some(re => { re.lastIndex = 0; return re.test(text); })) throw new Error(`publication violation (${name}); content withheld`);
          }
        }
      }
    }
    checked += commits.length;
  }
  console.error(`boundary-prepush: PASS (${checked} commits)`);
} catch (error) { console.error(`boundary-prepush: REFUSED: ${error.message}`); process.exitCode = 1; }
