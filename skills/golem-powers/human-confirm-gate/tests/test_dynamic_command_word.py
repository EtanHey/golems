"""Class-only fixtures: substitutions name an absent synthetic executable.

Never substitute a real protected executable into these public fixtures.
The hook only inspects the supplied text; none of it is executed.
"""
import json
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'hooks'))
from commands import operations

CASES = (
    '$(printf fixture-tool) push --force origin topic',
    '`printf fixture-tool` push --force origin topic',
    '$(echo fixture-tool) filter-branch HEAD',
    '$(printf "$(echo fixture-tool)") push -f origin topic',
    'prefix$(printf fixture-tool)suffix push --force',
    '$(printf fixture-tool)$(printf fixture-tool) repo delete fixture/repo',
    '$(printf fixture-tool; true) push --force',
    'env $(printf fixture-tool) push --force',
    '$(printf fixture-tool) >out push --force',
    '"$(printf fixture-tool)" api --method=DELETE repos/fixture/repo',
    '${FIXTURE_TOOL} push --force',
    '/fixture/fixture-* push --force',
    '{fixture-tool,fixture-other} push --force',
    '$(printf fixture-tool ")$") push --force',
    '$(printf fixture-tool ")$+") push --force',
)


class DynamicCommandWord(unittest.TestCase):
    def test_guarded_argv_denied(self):
        for index, command in enumerate(CASES):
            with self.subTest(case=index), self.assertRaises(ValueError):
                operations(command, '/fixture', alias_lookup=lambda *_: None)

    def test_hook_transport_denies(self):
        hook = ROOT / 'hooks/human-confirm-pretooluse.py'
        for index, command in enumerate(CASES):
            with self.subTest(case=index):
                payload = dict(tool_name='Bash', tool_input=dict(command=command),
                               cwd=str(ROOT), session_id='synthetic-dynamic-word')
                run = subprocess.run([sys.executable, '-I', '-B', str(hook)],
                                     input=json.dumps(payload), text=True,
                                     capture_output=True, timeout=10)
                self.assertEqual(run.returncode, 2, run.stderr)
                self.assertEqual(json.loads(run.stdout)['hookSpecificOutput']['permissionDecision'], 'deny')
        payload['tool_input']['command'] = 'printf fixture-tool'
        run = subprocess.run([sys.executable, '-I', '-B', str(hook)],
                             input=json.dumps(payload), text=True,
                             capture_output=True, timeout=10)
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertEqual(json.loads(run.stdout), {})

    def test_data_and_unprotected_argv_allowed(self):
        for command in ('echo $(printf fixture-tool) push --force',
                        'printf "%s" "$(printf fixture-tool) push --force"',
                        "cat <<'EOF'\n$(printf fixture-tool) push --force\nEOF",
                        '$(printf fixture-tool) status',
                        'FIXTURE=$(printf fixture-tool); echo push --force',
                        '[ -f fixture-file ]', '[[ -f fixture-file ]]',
                        'X=fixture; echo $(printf fixture-tool); gh api repos/${X}/project/issues/1/comments -f body=fixture',
                        'echo fixture-tool >$(printf fixture-tool) push --force'):
            with self.subTest(command=command):
                self.assertEqual(operations(command, '/fixture', alias_lookup=lambda *_: None), [])


if __name__ == '__main__':
    unittest.main()
