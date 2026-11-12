#!/usr/bin/env node
// Added-line publication guard. Optional GitHub evidence can exempt parent history.
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
const source = join(dirname(fileURLToPath(import.meta.url)), '..');
const git = (...args) => {
  const r = spawnSync('git', ['--no-replace-objects', ...args], { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
  if (r.status !== 0) throw new Error('git evidence unavailable');
  return r.stdout;
};
function parentHistory(pushURL) {
  // Bind metadata to Git's actual push URL, never origin/upstream names or gh's
  // cwd-selected repository. Unknown hosts/transports retain the original scan.
  const match = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9-]+\/[^/?#\s]+?)\/?$/.exec(pushURL ?? '');
  const target = match?.[1].replace(/\.git$/, '');
  const valid = name => typeof name === 'string' && /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/.test(name) && !['.', '..'].includes(name.split('/')[1]);
  if (!valid(target)) return { fork: false };
  // Until GitHub proves non-fork status, local refs cannot establish published
  // history for a new GitHub branch. Lookup failures must not enable a bypass.
  let scratch;
  try {
    const metadata = spawnSync('gh', ['api', '--hostname', 'github.com', 'repos/' + target], {
      encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024,
    });
    if (metadata.status !== 0) throw new Error('metadata unavailable');
    const repo = JSON.parse(metadata.stdout);
    if (repo.full_name?.toLowerCase() !== target.toLowerCase() || typeof repo.fork !== 'boolean') throw new Error('target mismatch');
    if (!repo.fork) return { fork: false };
    const parent = repo.parent?.full_name;
    if (!valid(parent) || parent.toLowerCase() === target.toLowerCase()) throw new Error('invalid parent');
    // No local refs, alternates, grafts, templates, URL rewrites, config includes,
    // or inherited Git environment may supply the publication evidence.
    scratch = mkdtempSync(join(tmpdir(), 'boundary-parent-'));
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
    Object.assign(env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0', GIT_NO_LAZY_FETCH: '1' });
    const isolated = (...args) => {
      const r = spawnSync('git', ['--no-replace-objects', '-C', scratch, ...args], {
        env, encoding: 'utf8', timeout: 60_000, maxBuffer: 128 * 1024 * 1024,
      });
      if (r.status !== 0) throw new Error('parent history unavailable');
      return r.stdout;
    };
    isolated('init', '--bare', '--template=');
    isolated('-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always', '-c', 'http.followRedirects=false',
      'fetch', '--no-tags', '--filter=blob:none', 'https://github.com/' + parent + '.git', '+refs/heads/*:refs/heads/*');
    const commits = new Set(isolated('rev-list', '--all').trim().split('\n').filter(Boolean));
    if (!commits.size) throw new Error('empty parent history');
    return { fork: true, commits };
  } catch {
    console.error('boundary-prepush: parent evidence unavailable; scanning without parent exemptions');
    return { fork: true };
  } finally { if (scratch) rmSync(scratch, { recursive: true, force: true }); }
}
function newRefExclusions() {
  if (git('for-each-ref', '--format=%(refname)', 'refs/remotes/').trim()) return ['--not', '--remotes'];
  const configured = spawnSync('git', ['config', '--get', 'init.defaultBranch'], { encoding: 'utf8' });
  if (![0, 1].includes(configured.status)) throw new Error('default branch evidence unavailable');
  const candidates = [...new Set([configured.status === 0 ? configured.stdout.trim() : '', 'main', 'master'].filter(Boolean))];
  for (const branch of candidates) {
    const ref = 'refs/heads/' + branch;
    const found = spawnSync('git', ['show-ref', '--verify', '--quiet', ref]);
    // --branches=<literal> implicitly adds /* in Git. Exclude the
    // resolved default ref directly so the branch itself is excluded.
    if (found.status === 0) return ['--not', ref];
    if (found.status !== 1) throw new Error('default branch evidence unavailable');
  }
  throw new Error('no remote refs or identifiable local default branch');
}
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
  const parent = parentHistory(process.argv[3]);
  let checked = 0;
  for (const row of input.split('\n')) {
    const fields = row.split(/\s+/);
    if (fields.length !== 4 || !fields[1].match(/^[a-f0-9]{40,64}$/) || !fields[3].match(/^[a-f0-9]{40,64}$/)) throw new Error('invalid pre-push ref evidence');
    const [, head, , remote] = fields;
    if (/^0+$/.test(head)) continue;
    git('cat-file', '-e', head + '^{commit}');
    // Verified non-forks and other transports retain the original new-ref
    // baseline. Forks/unknown GitHub targets cannot trust local tracking refs.
    // Existing refs use Git's advertised old tip, even for non-ancestor updates.
    const exclusions = /^0+$/.test(remote) ? parent.fork ? [] : newRefExclusions() : ['^' + remote];
    const commits = git('rev-list', head, ...exclusions).trim().split('\n').filter(Boolean).filter(commit => !parent.commits?.has(commit));
    // Combined patches scan novel merge resolution lines against ALL parents.
    // Imported lines are scanned in their originating own commit, or exempted
    // only by the fresh parent graph. -m and the aggregate diff would rescan
    // upstream lines as if we authored them. Ordinary commits retain full patches.
    const diffs = commits.map(commit => ['diff-tree', '--root', parent.commits ? '-c' : '-m', '-p', '--no-ext-diff', '--no-textconv', '--no-renames', '--unified=0', commit]);
    if (!parent.commits && !/^0+$/.test(remote)) diffs.push(['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--unified=0', remote, head]);
    for (const args of diffs) {
      let file = null, columns = 1, inHunk = false;
      for (const line of git(...args).split('\n')) {
        if (line.startsWith('diff ')) { file = null; inHunk = false; }
        else if (/^@@+ /.test(line)) { columns = line.indexOf(' ') - 1; inHunk = true; }
        else if (!inHunk && line.startsWith('+++ b/')) file = line.slice(6);
        else if (!inHunk && line.startsWith('+++ "')) file = JSON.parse(line.slice(4)).slice(2);
        else if (!inHunk && line.startsWith('+++ ')) file = null;
        else if (inHunk && file && line.startsWith('+'.repeat(columns)) && !allowed.has(file) && file !== '.publish-boundary-allow' && file !== 'scripts/publish-boundary-policy.yaml') {
          for (const [name, rule] of rules) {
            let text = line.slice(columns);
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
