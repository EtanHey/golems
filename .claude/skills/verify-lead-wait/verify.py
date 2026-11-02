"""Run real sentinel regressions and every LeadWait config; retain each run's evidence."""
import os
from pathlib import Path
import subprocess
import shutil
import sys
import tempfile

for tool in ('bun', 'tlc'):
    if shutil.which(tool) is None:
        print(f'ERROR: required executable missing: {tool}', file=sys.stderr)
        sys.exit(2)

root = Path(__file__).resolve().parents[3]
parent = root / 'docs.local/verify-lead-wait'
parent.mkdir(parents=True, exist_ok=True)
run = Path(tempfile.mkdtemp(prefix='run-', dir=parent))
env = {**os.environ, 'TMPDIR': str(run)}
print(f'Evidence: {run.relative_to(root)}', flush=True)
with (run / 'sentinel-tests.out').open('w') as log:
    tests = subprocess.run(['bun', 'test', 'scripts/tests/pr-sentinel.test.mjs'],
                           cwd=root, env=env, stdout=log, stderr=subprocess.STDOUT)
print(f'Sentinel regressions: {"PASS" if tests.returncode == 0 else "FAIL"}', flush=True)
errors = tests.returncode != 0
historical = {'Today', 'WakeIgnored', 'SettleWithoutHandoff'}
findings = False
for name in ['Today', 'WakeIgnored', 'SettleWithoutHandoff', 'RulesFollowed',
             'SentinelOnly', 'RulesAndSentinel']:
    with (run / f'{name}.out').open('w') as log:
        checked = subprocess.run(['tlc', '-deadlock', '-workers', '1', '-metadir',
                                  str(run / f'{name}-states'), '-config', f'{name}.cfg', 'LeadWait.tla'],
                                 cwd=root / 'docs/tla/lead-wait', env=env,
                                 stdout=log, stderr=subprocess.STDOUT)
    output = (run / f'{name}.out').read_text()
    passed = checked.returncode == 0 and 'No error has been found' in output
    violated = checked.returncode == 13 and 'Temporal properties were violated' in output
    expected = name in historical and violated
    print(f'{name}: {"historical counterexample" if expected else "PASS" if passed else "Noticed VIOLATED" if violated else "ERROR"}', flush=True)
    errors |= not (passed or violated) or (name in historical and not violated)
    findings |= violated and not expected
if errors:
    print('FAIL: source regressions or unexpected checker result; inspect evidence.')
    sys.exit(2)
if findings:
    print('FINDING: current modeled behavior violates Noticed; do not certify it.')
    sys.exit(1)
print('PASS within the model bounds; source/model correspondence still needs review.')
