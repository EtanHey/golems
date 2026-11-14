#!/usr/bin/env node
// Added-line publication guard. Optional GitHub evidence can exempt parent history.
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
const source = join(dirname(fileURLToPath(import.meta.url)), '..');
const gitInput = (input, ...args) => {
  const r = spawnSync('git', ['--no-replace-objects', ...args], { input, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
  if (r.status !== 0) throw new Error('git evidence unavailable');
  return r.stdout;
};
const git = (...args) => gitInput(undefined, ...args);
function parentHistory(pushURL) {
  // Bind metadata to Git's actual push URL, never origin/upstream names or gh's
  // cwd-selected repository. Unknown hosts/transports retain the original scan.
  const match = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9-]+\/[^/?#\s]+?)\/?$/.exec(pushURL ?? '');
  const target = match?.[1].replace(/\.git$/, '');
  const valid = name => typeof name === 'string' && /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/.test(name) && !['.', '..'].includes(name.split('/')[1]);
  if (!valid(target)) return {};
  let scratch;
  try {
    const metadata = spawnSync('gh', ['api', '--hostname', 'github.com', 'repos/' + target], {
      encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024,
    });
    if (metadata.status !== 0) throw new Error('metadata unavailable');
    const repo = JSON.parse(metadata.stdout);
    if (repo.full_name?.toLowerCase() !== target.toLowerCase() || typeof repo.fork !== 'boolean') throw new Error('target mismatch');
    if (!repo.fork) return {};
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
      'fetch', '--no-tags', '--filter=tree:0', 'https://github.com/' + parent + '.git', '+refs/heads/*:refs/heads/*');
    const commits = new Set(isolated('rev-list', '--all').trim().split('\n').filter(Boolean));
    if (!commits.size) throw new Error('empty parent history');
    return { commits };
  } catch {
    console.error('boundary-prepush: parent evidence unavailable; scanning without parent exemptions');
    return {};
  } finally { if (scratch) rmSync(scratch, { recursive: true, force: true }); }
}
let destinationExclusions, destinationEvidenceUnavailable = false;
function newRefExclusions() {
  if (destinationExclusions) return destinationExclusions;
  destinationExclusions = [];
  // Check Git's second hook argument for another fetch-side URL rewrite before
  // reading its advertisement. Configured transport helpers remain trusted.
  // Local default branches and refs/remotes/* never prove publication there.
  const destination = process.argv[3];
  const resolved = destination && spawnSync('git', ['--no-replace-objects', 'ls-remote', '--get-url', '--', destination], {
    encoding: 'utf8', timeout: 15_000, maxBuffer: 1024 * 1024,
  });
  if (!resolved || resolved.status !== 0 || resolved.stdout.trim() !== destination) {
    destinationEvidenceUnavailable = true;
    console.error('boundary-prepush: destination URL rewritten or unavailable; scanning full history');
    return destinationExclusions;
  }
  const advertised = spawnSync('git', ['--no-replace-objects', 'ls-remote', '--refs', '--', destination], {
    encoding: 'utf8', timeout: 15_000, maxBuffer: 128 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  const rows = advertised?.stdout?.trim().split('\n').filter(Boolean) ?? [];
  if (!advertised || advertised.status !== 0 || rows.some(row => !/^[a-f0-9]{40,64}\trefs\/\S+$/.test(row))) {
    destinationEvidenceUnavailable = true;
    // Keep child output private. A failed/partial advertisement cannot exclude
    // anything: large repos may rescan thousands of commits and fail on old PII.
    console.error('boundary-prepush: destination advertisement unavailable; scanning full history (historical violations may refuse the push)');
    return destinationExclusions;
  }
  const tips = [...new Set(rows.map(row => row.split('\t')[0]))];
  if (!tips.length) return destinationExclusions;
  // Batch the local check: large destinations can advertise thousands of refs.
  // Disable promisor fetching so an absent tip remains absent, without network.
  const local = spawnSync('git', ['--no-replace-objects', 'cat-file', '--batch-check=%(objectname) %(objecttype)'], {
    input: tips.map(sha => sha + '^{commit}\n').join(''), encoding: 'utf8',
    env: { ...process.env, GIT_NO_LAZY_FETCH: '1' }, timeout: 15_000, maxBuffer: 128 * 1024 * 1024,
  });
  if (local.status !== 0) return destinationExclusions;
  const objects = local.stdout.trim().split('\n');
  if (objects.length !== tips.length) return destinationExclusions;
  for (const [index, sha] of tips.entries()) {
    // Unknown remote objects cannot be rev-list boundaries. Never resolve the
    // advertised names via local refs; annotated tags must peel to a commit.
    if (/^[a-f0-9]{40,64} commit$/.test(objects[index])) destinationExclusions.push('^' + sha);
  }
  return destinationExclusions;
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
    const c = /^  ([a-z0-9_-]+):/.exec(line);
    if (c) { klass = c[1]; rules.set(klass, { patterns: [], allowed_patterns: [], allowed_versions: [] }); kind = null; }
    const k = /^    (patterns|allowed_patterns|allowed_versions):/.exec(line);
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
    // Destination advertisements define the new-ref baseline in both modes.
    // Verified parent evidence can additionally exempt already-public history.
    // Existing refs use Git's advertised old tip, even for non-ancestor updates.
    const exclusions = /^0+$/.test(remote) ? newRefExclusions() : ['^' + remote];
    const commits = gitInput([head, ...exclusions].join('\n') + '\n', 'rev-list', '--stdin').trim().split('\n').filter(Boolean).filter(commit => !parent.commits?.has(commit));
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
            for (const re of rule.allowed_versions) text = text.replace(re, token => {
              // Inspect overlapping runs, including suffixes within an octet.
              // A valid address is never a version exemption. Only invalid-octet
              // runs glued to a letter-bearing identifier may be removed.
              const runs = token.matchAll(/(?=(([0-9]{1,3}\.){3}[0-9]{1,3}))/g);
              for (const run of runs) {
                if (run[1].split('.').every(octet => Number(octet) <= 255)) return token;
                if (!/[A-Za-z][A-Za-z0-9]*-$/.test(token.slice(0, run.index).replace(/[0-9]+$/, ''))) return token;
              }
              return '';
            });
            // Policy patterns include dotted-number boundaries: never infer an
            // address from a four-part window inside a longer numeric version.
            if (rule.patterns.some(re => { re.lastIndex = 0; return re.test(text); })) throw new Error(`publication violation (${name}); content withheld`);
          }
        }
      }
    }
    checked += commits.length;
  }
  console.error(`boundary-prepush: PASS (${checked} commits)`);
} catch (error) { console.error(`boundary-prepush: REFUSED: ${error.message}${destinationEvidenceUnavailable ? '; retry or check destination access' : ''}`); process.exitCode = 1; }
