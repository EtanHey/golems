"""Derive MergeReceipts' flags from the real code, run every config, and keep each run's evidence."""
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

for tool in ('tlc', 'node', 'bash'):
    if shutil.which(tool) is None:
        print(f'ERROR: required executable missing: {tool}', file=sys.stderr)
        sys.exit(2)

root = Path(__file__).resolve().parents[3]
spec = root / 'docs/tla/merge-receipts'
parent = root / 'docs.local/verify-merge-receipts'
parent.mkdir(parents=True, exist_ok=True)
run = Path(tempfile.mkdtemp(prefix='run-', dir=parent))
env = {**os.environ, 'TMPDIR': str(run)}
print(f'Evidence: {run.relative_to(root)}', flush=True)
read = lambda rel: (root / rel).read_text()


def status_mode():
    """Feed the real status() line template to the real live/status.sh."""
    installer = read('scripts/hooks/install-hooks.mjs')
    if '...ctx.driftPaths' not in installer:
        return 'pre1063'
    template = re.search(r'console\.log\(`(hooks-live=[^`]*)`\)', installer).group(1)
    line = re.sub(r'\$\{[^}]*\}', 'x', template.replace('${drift}', '0').replace('${behind}', '3'))
    home, bin_dir = run / 'status-home', run / 'status-bin'
    (home / 'Gits/golems/scripts/hooks').mkdir(parents=True)
    bin_dir.mkdir()
    (bin_dir / 'git').write_text('#!/usr/bin/env bash\nexit 0\n')
    (home / 'Gits/golems/scripts/hooks/install-hooks.sh').write_text(f"#!/usr/bin/env bash\nprintf '%s\\n' '{line}'\n")
    for f in (bin_dir / 'git', home / 'Gits/golems/scripts/hooks/install-hooks.sh'):
        f.chmod(0o755)
    probe = subprocess.run(['bash', str(root / 'scripts/ratchet/live/status.sh')], capture_output=True, text=True,
                           env={**env, 'HOME': str(home), 'PATH': f'{bin_dir}:{os.environ["PATH"]}'})
    (run / 'status-probe.out').write_text(f'line: {line}\n{probe.stdout}{probe.stderr}')
    return 'today' if probe.returncode == 0 else 'fx16'


def unguarded_hook_paths():
    """Real hookDriftPaths(manifest) against guarded-paths.sh's own regex."""
    guarded = re.search(r"^guarded='([^']+)'", read('scripts/ratchet/guarded-paths.sh'), re.M).group(1)
    script = ('import { readFileSync } from "node:fs";'
              'import { hookDriftPaths } from "./scripts/hooks/install-hooks.mjs";'
              'const m = JSON.parse(readFileSync("scripts/hooks/manifest.json", "utf8"));'
              'console.log(hookDriftPaths(m).join("\\n"));')
    paths = subprocess.run(['node', '--input-type=module', '-e', script], cwd=root, env=env,
                           capture_output=True, text=True, check=True).stdout.split()
    return [p for p in paths if not re.match(guarded, p)]


freshness = read('scripts/ratchet/live-freshness.mjs')
grace_body = freshness.split('export function checkLiveFreshness', 1)[1].split('\nfunction run(', 1)[0]
unguarded = unguarded_hook_paths()
derived = {
    'HeadBound': 'verdict.head !== head' in read('scripts/ratchet/check-comment.mjs'),
    'MatchHead': '--match-head-commit' in read('skills/golem-powers/pr-loop/references/merge-and-verification.md'),
    'PinLease': "!options['--lease-pr'] ||" not in read('scripts/ratchet/post-merge-live.mjs'),
    'Status': status_mode(),
    'GraceBound': 'age <= GRACE_MINUTES' in grace_body,
    'GuardHookPaths': not unguarded,
}
tla = lambda value: f'"{value}"' if isinstance(value, str) else str(value).upper()
print('Derived from the code: ' + ', '.join(f'{k}={tla(v)}' for k, v in derived.items()), flush=True)
if unguarded:
    print(f'  hook-loaded but unguarded: {" ".join(unguarded)}', flush=True)

errors = False
for name in ('TodayMerge', 'TodayLive', 'TodayFresh'):
    text = (spec / f'{name}.cfg').read_text()
    for key, value in derived.items():
        if not re.search(rf'^\s*{key} = {re.escape(tla(value))}$', text, re.M):
            print(f'SOURCE CHANGED: {name}.cfg does not say {key} = {tla(value)}; re-check the model first.')
            errors = True

fixes = {**derived, 'MatchHead': True, 'PinLease': True, 'GuardHookPaths': True}
(run / 'TodayWithFixes.cfg').write_text(
    'SPECIFICATION Spec\nCONSTANTS\n' + ''.join(f'  {k} = {tla(v)}\n' for k, v in fixes.items())
    + '  QKinds = {"hooks", "hookSkill", "docs"}\n  MaxPush = 1\nINVARIANT TypeOK\n'
    + ''.join(f'INVARIANT {p}\n' for p in ('ReceiptMatchesMerge', 'LiveReceiptIsolated', 'NoFalseFresh')))

expected = {'TodayMerge': 'finding', 'TodayLive': 'finding', 'TodayFresh': 'finding',
            'MatchHead': 'pass', 'NoHeadBound': 'violated', 'PinnedLease': 'pass', 'Pre1063': 'violated',
            'FX16': 'violated', 'GuardHookPaths': 'pass', 'NoGraceBound': 'violated', 'AllFixes': 'pass',
            'TodayWithFixes': 'pass'}
findings = []
for name, want in expected.items():
    config = run / f'{name}.cfg' if name == 'TodayWithFixes' else spec / f'{name}.cfg'
    with (run / f'{name}.out').open('w') as log:
        checked = subprocess.run(['tlc', '-deadlock', '-workers', '1', '-metadir', str(run / f'{name}-states'),
                                  '-config', str(config), 'MergeReceipts.tla'],
                                 cwd=spec, env=env, stdout=log, stderr=subprocess.STDOUT)
    output = (run / f'{name}.out').read_text()
    broken = re.search(r'Invariant (\w+) is violated', output)
    got = 'pass' if checked.returncode == 0 and 'No error has been found' in output else 'violated' if broken else 'error'
    label = {'pass': 'PASS', 'violated': f'{broken and broken.group(1)} VIOLATED', 'error': 'ERROR'}[got]
    ok = got == want or (want == 'finding' and got == 'violated')
    note = 'known finding' if want == 'finding' and got == 'violated' else 'historical/mutant counterexample' if want == got == 'violated' else ''
    print(f'{name}: {label}' + (f' ({note})' if note else '') + ('' if ok else f'  <-- expected {want}'), flush=True)
    errors |= not ok
    if want == 'finding' and got == 'violated':
        findings.append(name)
if errors:
    print('FAIL: source drift or unexpected checker result; inspect the evidence and the coverage table.')
    sys.exit(2)
if findings:
    print(f'KNOWN FINDINGS: {", ".join(findings)}; see docs/tla/merge-receipts/README.md. Do not certify.')
    sys.exit(1)
print('PASS within the model bounds; source/model correspondence still needs review.')
