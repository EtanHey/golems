"""human-confirm through the Codex adapter (scripts/hooks/codex-policy-hook.py),
with Codex 0.160's PreToolUse payload shape: the token binds the payload's
session_id (Codex: the root thread id), cwd and command, exactly as on Claude."""
import json
import os
import shutil
import subprocess
import unittest
import test_gate
from test_gate import ROOT

ADAPTER = ROOT.parents[2] / 'scripts/hooks/codex-policy-hook.py'
LAUNCHER = ROOT.parents[2] / 'scripts/hooks/fail-open.py'
SESSION = '019a0000-0000-7000-8000-00000000c0de'  # a Codex root thread id


class CodexAdapter(unittest.TestCase):
    setUp_gate = test_gate.Gate.setUp
    tearDown = test_gate.Gate.tearDown
    token = test_gate.Gate.token
    commit_pins = test_gate.Gate.commit_pins
    unlock = test_gate.Gate.unlock

    def setUp(self):
        self.setUp_gate()
        hooks = self.home / 'live/scripts/hooks'
        hooks.mkdir(parents=True)
        for source in (ADAPTER, LAUNCHER):
            shutil.copy2(source, hooks / source.name)
        self.adapter = hooks / ADAPTER.name

    def run_codex(self, tool='Bash', command=None):
        payload = dict(session_id=SESSION, turn_id='turn-1', cwd=str(self.repo), hook_event_name='PreToolUse',
                       model='fixture', permission_mode='default', tool_name=tool, tool_use_id='call-1',
                       transcript_path=None, tool_input=dict(command=command or self.command))
        env = dict(os.environ, HOME=str(self.home))
        run = subprocess.run(['python3', '-I', '-B', str(self.adapter), 'human-confirm'], input=json.dumps(payload),
                             text=True, capture_output=True, env=env, timeout=30)
        self.assertEqual((run.returncode, run.stderr), (0, ''))
        decision = json.loads(run.stdout).get('hookSpecificOutput', {}).get('permissionDecision')
        return decision or 'allow'

    def test_lease_push_denies_without_a_token_and_allows_with_one_bound_to_the_codex_session(self):
        self.assertEqual(self.run_codex(), 'deny')
        path = self.token(session_id=SESSION)
        self.assertEqual(self.run_codex(), 'allow')
        self.assertFalse(path.exists())  # one use
        self.assertEqual(self.run_codex(), 'deny')

    def test_a_token_for_another_session_or_a_plain_push_decides_as_on_claude(self):
        self.token(session_id='worker')
        self.assertEqual(self.run_codex(), 'deny')
        self.assertEqual(self.run_codex(command='git push origin topic'), 'allow')

    def test_apply_patch_is_projected_never_parsed_as_shell(self):
        policy = self.home / '.config/golems/human-confirm/forged.json'
        config = self.repo / '.git/config'
        patch = lambda body: '*** Begin Patch\n' + body + '*** End Patch'
        cases = [
            ('add into the policy store', patch(f'*** Add File: {policy}\n+{{}}\n'), 'deny'),
            ('delete in the policy store', patch(f'*** Delete File: {policy}\n'), 'deny'),
            ('destructive push route into git config',
             patch(f'*** Update File: {config}\n@@\n+[remote "origin"]\n+\tpush = +refs/heads/*:refs/heads/*\n'), 'deny'),
            ('ordinary file', patch(f'*** Add File: {self.repo}/notes.txt\n+hello\n'), 'allow'),
            ('benign git config edit', patch(f'*** Update File: {config}\n@@\n+[user]\n+\tname = fixture\n'), 'allow'),
        ]
        for label, body, expected in cases:
            with self.subTest(label):
                self.assertEqual(self.run_codex(tool='apply_patch', command=body), expected)


if __name__ == '__main__':
    unittest.main()
