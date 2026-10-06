"""human-confirm through the Codex adapter (scripts/hooks/codex-policy-hook.py),
with Codex 0.160's PreToolUse payload shape: the token binds the payload's
session_id (Codex: the root thread id), cwd and command, exactly as on Claude."""
import importlib.util
import json
import os
import re
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

    def decide(self, tool='Bash', command=None):
        payload = dict(session_id=SESSION, turn_id='turn-1', cwd=str(self.repo), hook_event_name='PreToolUse',
                       model='fixture', permission_mode='default', tool_name=tool, tool_use_id='call-1',
                       transcript_path=None, tool_input=dict(command=command or self.command))
        env = dict(os.environ, HOME=str(self.home))
        run = subprocess.run(['python3', '-I', '-B', str(self.adapter), 'human-confirm'], input=json.dumps(payload),
                             text=True, capture_output=True, env=env, timeout=30)
        self.assertEqual((run.returncode, run.stderr), (0, ''))
        return json.loads(run.stdout).get('hookSpecificOutput', {})

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


    def test_a_git_config_patch_that_does_not_apply_exactly_is_denied(self):
        config = self.repo / '.git/config'
        body = f'*** Begin Patch\n*** Update File: {config}\n@@\n [section-not-in-this-file]\n+\tkey = value\n*** End Patch'
        out = self.decide(tool='apply_patch', command=body)
        self.assertEqual(out.get('permissionDecision'), 'deny')
        self.assertIn('must apply exactly', out.get('permissionDecisionReason', ''))

    def test_a_config_update_is_judged_on_its_real_post_patch_content(self):
        # Context and removed lines change the result; the projection must carry the exact file.
        config = self.repo / '.git/config'
        config.write_text(config.read_text() + '[user]\n\tname = before\n\temail = fixture@localhost\n')
        spec = importlib.util.spec_from_file_location('codex_adapter_under_test', self.adapter)
        adapter = importlib.util.module_from_spec(spec); spec.loader.exec_module(adapter)
        body = f'*** Begin Patch\n*** Update File: {config}\n@@ [user]\n-\tname = before\n+\tname = after\n \temail = fixture@localhost\n*** End Patch'
        payload = dict(tool_name='apply_patch', cwd=str(self.repo), session_id=SESSION, tool_input=dict(command=body))
        [item] = adapter.confirm_inputs(payload)
        expected = config.read_text().replace('\tname = before\n', '\tname = after\n')
        self.assertEqual((item['tool_name'], item['tool_input']['content']), ('Write', expected))
        self.assertEqual(self.run_codex(tool='apply_patch', command=body), 'allow')

    # Lead tokens resolve gh from fixed trusted paths. Only the fixture COPY of the gate is pointed
    # at a fixture gh (production keeps no seam); the real /usr/bin/git reads the fixture repo.
    def lead_fixture(self, head=None):
        tokens = self.home / 'live/skills/golem-powers/human-confirm-gate/hooks/tokens.py'
        fake = self.home / 'bin/gh'
        fake.parent.mkdir(exist_ok=True)
        pr = dict(number=7, state='OPEN', mergedAt=None, headRefName='topic', isCrossRepository=False, headRefOid=head or self.sha)
        fake.write_text('#!/bin/sh\ncase "$1 $2" in\n'
                        f"  'repo view') printf '%s' '{json.dumps(dict(defaultBranchRef=dict(name='main')))}' ;;\n"
                        f"  'pr view') printf '%s' '{json.dumps(pr)}' ;;\n  *) exit 1 ;;\nesac\n")
        fake.chmod(0o755)
        if getattr(self, 'lead_ready', False):
            return  # only the fake PR response changes between calls
        self.lead_ready = True
        source = tokens.read_text()
        rewritten = re.sub(r"GH_CANDIDATES = tuple\([^\n]*\n[^\n]*\n", f"GH_CANDIDATES = ({str(fake)!r},)\n", source, count=1)
        self.assertNotEqual(rewritten, source)
        tokens.write_text(rewritten)
        for args in (['symbolic-ref', 'HEAD', 'refs/heads/topic'], ['remote', 'add', 'origin', 'https://github.com/fixture/repo.git']):
            subprocess.run(['git', '-C', str(self.repo), *args], check=True)

    def test_a_lead_token_bound_to_the_codex_session_allows_once(self):
        self.lead_fixture()
        path = self.token('lead', session_id=SESSION)
        self.assertEqual(self.run_codex(), 'allow')
        self.assertFalse(path.exists())
        self.assertEqual(self.run_codex(), 'deny')  # replay

    def test_a_lead_token_for_another_session_or_another_pr_head_denies(self):
        self.lead_fixture()
        self.token('lead', session_id='other-session')
        self.assertEqual(self.run_codex(), 'deny')
        self.lead_fixture(head='b' * 40)
        path = self.token('lead', session_id=SESSION)
        self.assertEqual(self.run_codex(), 'deny')
        self.assertTrue(path.exists())  # an out-of-scope lease never burns the token


if __name__ == '__main__':
    unittest.main()
