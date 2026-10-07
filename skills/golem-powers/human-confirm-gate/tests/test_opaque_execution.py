"""Class-only regressions; fixture-tool is absent and commands are never run.

Real executable spellings belong only in the gitignored private suite.
"""
import json
from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'hooks'))
from commands import operations

CASES = (
    'FIXTURE="fixture-tool push --force origin topic"; $FIXTURE',
    'IFS=:; FIXTURE=fixture-tool:push:--force:origin:topic; $FIXTURE',
    'IFS=,; FIXTURE=fixture-tool,push,--force,origin,topic; $FIXTURE',
    'IFS=:; FIXTURE=fixture-tool:push:--force:origin:topic; env $FIXTURE',
    'FIXTURE="fixture-tool push --force origin topic"; $FIXTURE status',
    'FIXTURE="fixture-tool push --force origin topic"; sh -c "$FIXTURE"',
    'FIXTURE="fixture-tool push --force origin topic"; bash -c "$FIXTURE"',
    "bash -c '\"$@\"' fixture \"$TOOL\" push --force origin topic",
    "sh -c '$@' fixture \"$TOOL\" push --force origin topic",
    'bash < <(printf "%s" "fixture-tool push --force origin topic")',
    'fixture() { "$(printf fixture-tool)" "$@"; }; fixture push --force origin topic',
    'printf fixture-tool | xargs -I FIXTURE FIXTURE push --force origin topic',
    'printf fixture-tool | xargs -IFIXTURE FIXTURE push --force origin topic',
    'printf fixture-tool | xargs -i {} push --force origin topic',
    'printf fixture-tool | xargs --replace {} push --force origin topic',
    'printf fixture-tool | xargs --replace=FIXTURE FIXTURE push --force origin topic',
    'printf fixture-tool | xargs -n 1 -P 1 -I FIXTURE FIXTURE push --force origin topic',
    'printf fixture-tool | xargs -I FIXTURE /fixture/FIXTURE push --force origin topic',
)

CONTROLS = (
    'printf fixture-tool',
    'echo $(printf fixture-tool) push --force origin topic',
    '$(printf fixture-tool) status',
    'FIXTURE=--force; DATA="$FIXTURE"; echo "$DATA"',
    'FIXTURE="fixture-tool push --force origin topic"; printf "%s" "$FIXTURE"',
    'IFS=:; FIXTURE=fixture-tool:push:--force; echo "$FIXTURE"',
    'printf fixture | xargs -I FIXTURE echo FIXTURE push --force',
    'printf fixture | xargs -I FIXTURE printf "%s" FIXTURE',
    'printf fixture | xargs -i echo {} push --force',
    'printf fixture | xargs --replace printf "%s" {}',
    'bash scripts/check.sh < /dev/null',
    "cat <<'EOF'\nfixture-tool push --force origin topic\nEOF",
)


class OpaqueExecution(unittest.TestCase):
    def test_structural_denials(self):
        for command in CASES:
            with self.subTest(command=command), self.assertRaises(ValueError):
                operations(command, '/fixture', alias_lookup=lambda *_: None)

    def test_data_and_explicit_argv_controls(self):
        for command in CONTROLS:
            with self.subTest(command=command):
                self.assertEqual(operations(command, '/fixture', alias_lookup=lambda *_: None), [])

    def test_real_hook_transport(self):
        hook = ROOT / 'hooks/human-confirm-pretooluse.py'
        for command, expected in [(c, 2) for c in CASES] + [(c, 0) for c in CONTROLS]:
            with self.subTest(command=command):
                payload = dict(tool_name='Bash', tool_input=dict(command=command),
                               cwd=str(ROOT.parents[2]), session_id='synthetic-opaque-execution')
                run = subprocess.run([sys.executable, '-I', '-B', str(hook)],
                                     input=json.dumps(payload), text=True,
                                     capture_output=True, timeout=10)
                self.assertEqual(run.returncode, expected, run.stderr)
                data = json.loads(run.stdout)
                if expected == 2:
                    self.assertEqual(data['hookSpecificOutput']['permissionDecision'], 'deny')
                else:
                    self.assertEqual(data, {})


if __name__ == '__main__':
    unittest.main()
