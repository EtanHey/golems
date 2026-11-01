#!/usr/bin/env node
// Select actual CI commands; the workflow remains the command inventory.
// Only the checked-out HEAD can be pushed; other branch heads are refused.
import { readFileSync, readdirSync, existsSync, mkdirSync, appendFileSync, accessSync, constants } from 'node:fs';
import { dirname, basename, resolve, join } from 'node:path';
import { homedir, hostname } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
process.chdir(root);
const python = process.env.PYTHON_BIN || 'python3';
function available(command) {
  return (command.includes('/') ? [command] : (process.env.PATH || '').split(':').map(p => join(p || '.', command)))
    .some(p => { try { accessSync(p, constants.X_OK); return true; } catch { return false; } });
}
const warnMissing = tool => console.error(`prepush-touched: ${tool} not installed here; dependent checks will run in CI`);
const pythonModules = new Set();
function run(command, env = {}, capture = false, retrySuite = false) {
  if (command[0] !== 'git' && !available(command[0])) { warnMissing(command[0]); return ''; }
  if (command[1] === '-m' && command[2] === 'pytest' && !pythonModules.has(command[0])) {
    const probe = spawnSync(command[0], ['-c', "import importlib.util; raise SystemExit(0 if importlib.util.find_spec('pytest') else 1)"], { encoding: 'utf8' });
    if (probe.status === 1) { warnMissing('pytest'); return ''; }
    pythonModules.add(command[0]);
  }
  const display = command.join(' ');
  console.error(`prepush-touched: RUN ${display.length > 700 ? display.slice(0, 700) + ' … (' + command.length + ' args)' : display}`);
  const execute = () => spawnSync(command[0], command.slice(1), {
    cwd: root, env: { ...process.env, ...env }, encoding: 'utf8',
    ...(command[0] === 'bats' ? { timeout: 180_000, killSignal: 'SIGKILL' } : {}),
    maxBuffer: 64 * 1024 * 1024,
    stdio: retrySuite ? ['ignore', 'pipe', 'pipe'] : capture ? ['ignore', 'pipe', 'inherit'] : ['ignore', 'inherit', 'inherit'],
  });
  let r = execute();
  if (r.error?.code === 'ENOENT' && command[0] !== 'git') { warnMissing(command[0]); return ''; }
  if (retrySuite && (r.error || r.status !== 0)) {
    const first = r;
    const tail = result => [result.stdout, result.stderr].filter(Boolean).join('\n').trimEnd().split('\n').slice(-40).join('\n');
    console.error(`prepush-touched: FAIL ${display} run 1 (${first.error?.message || first.status})\n${tail(first)}`);
    console.error(`prepush-touched: RETRY ${display}`);
    r = execute();
    if (r.error || r.status !== 0) {
      console.error(`prepush-touched: FAIL ${display} run 2 (${r.error?.message || r.status})\n${tail(r)}`);
    } else {
      const ledger = join(homedir(), '.golems/prepush-flakes.jsonl');
      mkdirSync(dirname(ledger), { recursive: true });
      appendFileSync(ledger, JSON.stringify({ ts: new Date().toISOString(), repo: root,
        head_sha: git('rev-parse', 'HEAD'), command: display,
        first_exit: first.status > 0 ? first.status : 1, first_tail: tail(first), host: hostname() }) + '\n');
      console.error(`prepush-touched: FLAKE ${display} failed then passed on retry; logged`);
    }
  }
  if (retrySuite && r.status === 0) {
    if (r.stdout) process.stdout.write(r.stdout);
    if (r.stderr) process.stderr.write(r.stderr);
  }
  if (r.error || r.status !== 0) {
    console.error(`prepush-touched: FAIL ${command.join(' ')} (${r.error?.message || r.status})`);
    process.exit(r.status > 0 ? r.status : 1);
  }
  return r.stdout || '';
}
const suite = command => run(command, {}, false, true);
const git = (...args) => run(['git', ...args], {}, true).trim();
function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const path = join(dir, e.name);
    return e.isDirectory() && !['__pycache__', 'node_modules', '.pytest_cache', '_archive'].includes(e.name)
      ? walk(path) : e.isFile() ? [path.replaceAll('\\', '/')] : [];
  });
}
function skip() {
  // Same destination and fields as tmp-block's log_bypass; failure is a denial.
  const ledger = (process.env.TMP_BLOCK_LEDGER || '~/.claude/logs/tmp-block-ledger.jsonl')
    .replace(/^~(?=\/)/, homedir());
  mkdirSync(dirname(ledger), { recursive: true });
  appendFileSync(ledger, JSON.stringify({ ts: new Date().toISOString(), tool: 'pre-push',
    targets: [], session_id: process.env.CLAUDE_SESSION_ID || '', cwd: root,
    hatch: 'GOLEMS_PREPUSH_TOUCHED=0', command: 'scripts/ci/prepush-touched.sh' }) + '\n');
  console.error(`prepush-touched: SKIP GOLEMS_PREPUSH_TOUCHED=0; logged to ${ledger}`);
}
async function main() {
  if (process.env.GOLEMS_PREPUSH_TOUCHED === '0') return skip();
  if (!available('git')) return warnMissing('git');
  const args = process.argv.slice(2);
  const ranges = [];
  if (args.length) {
    if (args.length !== 1 || !/^[^.]+\.\.[^.]+$/.test(args[0]) || args[0].startsWith('-'))
      throw new Error('usage: prepush-touched.sh [base..head] or pre-push stdin');
    ranges.push(args[0].split('..'));
  } else {
    const input = readFileSync(0, 'utf8').trim();
    if (input) {
      for (const line of input.split('\n')) {
        const fields = line.trim().split(/\s+/);
        if (fields.length !== 4) throw new Error('malformed pre-push ref line');
        const [, head, , remote] = fields;
        if (/^0+$/.test(head)) continue;
        if (!/^[a-zA-Z0-9]+$/.test(head + remote)) throw new Error('invalid push object IDs');
        ranges.push([/^0+$/.test(remote) ? git('merge-base', 'origin/master', head) : remote, head]);
      }
    } else {
      // The existing package-suite queue consumes stdin. Retest the branch range.
      console.error('prepush-touched: no ref input; checking merge-base(origin/master, HEAD)..HEAD');
      ranges.push([git('merge-base', 'origin/master', 'HEAD'), 'HEAD']);
    }
  }
  if (!ranges.length) return console.error('prepush-touched: SKIP delete-only push');
  const changed = new Set(ranges.flatMap(([base, head]) =>
    git('diff', '--name-only', '--no-renames', '-z', `${base}..${head}`).split('\0').filter(Boolean)));
  // Always check every added commit, including intermediate trees, as CI does.
  for (const [base, head] of ranges) {
    const original = git('rev-parse', 'HEAD');
    const target = git('rev-parse', head);
    if (original !== target) throw new Error('push head differs from checkout; check out that head before pushing');
    if (!available(process.env.PUBLISH_BOUNDARY_RUBY_BIN || 'ruby')) { warnMissing('ruby'); continue; }
    run(['bash', 'scripts/check-publish-boundary.sh'], {
      PUBLISH_BOUNDARY_HISTORY_MODE: 'ratchet', PUBLISH_BOUNDARY_HISTORY_BASE: base,
    });
  }
  run(['node', 'scripts/ci/check-model-role-drift.mjs']);
  const scans = git('ls-files', '-z', 'skills/**/*.md').split('\0').filter(Boolean);
  run(['node', 'scripts/ci/canon-drift-lint.mjs', '--check', '--routing-allowlist',
    'scripts/ci/routing-restatement-allowlist.json', ...scans.flatMap(p => ['--routing-scan', p])]);

  let parse;
  try { ({ parse } = await import('yaml')); } catch (error) {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
    return warnMissing('yaml');
  }
  const skillBats = [];
  const workflow = parse(readFileSync('.github/workflows/golem-powers-skill-tests.yml', 'utf8'));
  const skills = [...new Set([...changed].filter(p => p.startsWith('skills/golem-powers/')).map(p => p.split('/')[2]))];
  if (skills.length) {
    suite(['node', '--test', 'scripts/tests/model-roles.test.mjs', 'scripts/tests/model-role-wiring.test.mjs']);
    const listed = run(['bash', 'scripts/ci/run-skill-tests.sh'], { RUN_SKILL_TESTS_LIST_ONLY: '1' }, true)
      .trim().split('\n');
    const selected = listed.filter(p => skills.some(s => p.startsWith(`skills/golem-powers/${s}/`)));
    const suites = selected.filter(p => !p.endsWith('.py'));
    if (suites.length) suite([python, '-m', 'pytest', ...suites, '-q']);
    skillBats.push(...skills.flatMap(s => walk(`skills/golem-powers/${s}`)).filter(p => p.endsWith('.bats')));
    for (const evalSuite of selected.filter(p => p.endsWith('.py'))) suite([python, evalSuite]);
  }
  // These are the pristine gate's input families (FILES and imported split modules).
  const pristine = [...changed].some(p =>
    /^skills\/golem-powers\/(_shared|tmp-block|git-guardian)\//.test(p) ||
    /^scripts\/(ci\/pristine-harness|tests\/fixtures\/(pristine-harness|codex-sessions)|repogolem\/(golem-dispatch\.zsh|worktree-bootstrap\.sh))/.test(p));
  if (pristine) {
    const baseline = workflow.jobs['python-skill-tests'].steps.find(s => s.name === 'Pristine split baseline gate');
    if (!baseline?.run) throw new Error('CI pristine baseline command missing');
    suite([python, ...baseline.run.trim().split(/\s+/).slice(1)]);
  }

  const inventory = [];
  const security = parse(readFileSync('.github/workflows/security.yml', 'utf8'));
  const steps = [...workflow.jobs['script-tests'].steps, ...Object.values(security.jobs).flatMap(job => job.steps || [])];
  for (const step of steps) {
    for (const line of (step.run || '').replace(/\\\n\s*/g, ' ').split('\n')) {
      const tokens = line.trim().split(/\s+/);
      if (!/^(bun|node|bash|python|python3\.9)$/.test(tokens[0])) continue;
      if (!(tokens.includes('test') || tokens.includes('--test') || tokens.includes('pytest') ||
            tokens.includes('unittest') || tokens.some(t => t.endsWith('.test.sh')))) continue;
      const first = tokens.findIndex(t => /^(\.\/)?(scripts|skills)\//.test(t));
      if (first < 0) continue;
      if (tokens.includes('unittest')) {
        const pattern = tokens[tokens.indexOf('-p') + 1];
        inventory.push({ command: tokens, path: `scripts/tests/${pattern}` });
      } else {
        for (const path of tokens.slice(first).filter(t => /^(\.\/)?(scripts|skills)\//.test(t))) {
          const flags = tokens.slice(first).filter(t => t.startsWith('-'));
          inventory.push({ command: [...tokens.slice(0, first), path, ...flags], path: path.replace(/^\.\//, '') });
        }
      }
    }
  }
  // run-skill-tests also collects scripts/tests pytest files, beyond named steps.
  for (const path of walk('scripts/tests').filter(p => /\/test[^/]*\.py$/.test(p)))
    inventory.push({ command: [python, '-m', 'pytest', path, '-q'], path });
  for (const path of walk('scripts').filter(p => /^scripts\/test_[^/]*\.py$/.test(p)))
    inventory.push({ command: [python, path], path });
  // Include new test files before the CI inventory learns their name.
  for (const path of changed) {
    if (/^scripts\/.*\.test\.mjs$/.test(path) && existsSync(path) && !inventory.some(s => s.path === path))
      inventory.push({ command: ['node', '--test', path], path });
  }
  const manifest = JSON.parse(readFileSync('scripts/ci/bats-suites.json', 'utf8'));
  const bats = manifest.run.map(name => `scripts/tests/${name}`);
  const texts = new Map();
  const text = p => {
    if (!texts.has(p)) texts.set(p, existsSync(p) ? (readdirSafe(p) ? walk(p).map(text).join('\n') : readFileSync(p, 'utf8')) : '');
    return texts.get(p);
  };
  function readdirSafe(p) { try { readdirSync(p); return true; } catch { return false; } }
  const references = (suite, path) => suite === path || suite.startsWith(path + '/') ||
    text(suite).includes(path) || text(suite).includes(basename(path));
  const relevant = [...changed].filter(p => p.startsWith('scripts/') || p.startsWith('.githooks/'));
  // Follow local consumers too: a helper's direct test must not hide regressions
  // in suites exercising its callers. Unknown mappings still fall back below.
  const callers = walk('scripts').filter(p => !p.startsWith('scripts/tests/') && /\.(mjs|ts|py|sh|zsh)$/.test(p));
  for (let index = 0; index < relevant.length; index++) {
    for (const caller of callers) {
      if (!relevant.includes(caller) && references(caller, relevant[index])) relevant.push(caller);
    }
  }
  const touchedSkills = skills.map(s => `skills/golem-powers/${s}/`);
  let selected = inventory.filter(s => [...relevant, ...touchedSkills].some(p => references(s.path, p)));
  let selectedBats = bats.filter(s => [...relevant, ...touchedSkills].some(p => references(s, p)));
  if ([...changed].filter(p => p.startsWith('scripts/') || p.startsWith('.githooks/')).some(p => ![...inventory.map(s => s.path), ...bats].some(s => references(s, p)))) {
    console.error('prepush-touched: unclear script mapping; running CI Script suite and registered Bats');
    selected = inventory;
    selectedBats = bats;
  }
  const seen = new Set();
  for (const { command } of selected) {
    if (seen.has(JSON.stringify(command))) continue;
    seen.add(JSON.stringify(command));
    suite(command[0] === 'python' ? [python, ...command.slice(1)] : command);
  }
  const batsCount = skillBats.length + selectedBats.length;
  if (batsCount && !available('bats')) {
    console.error(`prepush-touched: bats not installed here; ${batsCount} bats suites will run in CI`);
  } else {
    for (const path of skillBats) suite(['bats', '--tap', path]);
    if (selectedBats.length) suite(['node', 'scripts/ci/run-bats-suites.mjs', '--run', ...selectedBats.map(p => basename(p))]);
  }
  if (!skills.length && !relevant.length) console.error('prepush-touched: no relevant suites; available cheap gates finished');
}
try { await main(); } catch (error) { console.error(`prepush-touched: FAIL ${error.message}`); process.exitCode = 1; }
