import hashlib
import json
import os
import subprocess
import tempfile
import time
import unittest
from pathlib import Path
from test_commands import ROOT

HOOK = ROOT / 'hooks' / 'human-confirm-pretooluse.py'


class Gate(unittest.TestCase):
    def setUp(self):
        scratch_root = ROOT.parents[2] / 'docs.local/human-confirm-gate'
        scratch_root.mkdir(parents=True, exist_ok=True)
        self.scratch = tempfile.TemporaryDirectory(dir=scratch_root)
        self.home = Path(self.scratch.name)
        from unittest.mock import patch
        isolated = patch.dict(os.environ, dict(HOME=str(self.home), SSH_AUTH_SOCK=str(self.home / 'no-agent.sock')))
        isolated.start(); self.addCleanup(isolated.stop)
        self.store = self.home / '.config/golems/human-confirm'
        self.store.mkdir(parents=True, mode=0o700)
        self.policy = self.store.parent / 'human-confirm.allowed_signers'
        self.key = self.home / 'key'
        subprocess.run(['ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-f', str(self.key)], check=True)
        self.policy.write_text('human ' + self.key.with_suffix('.pub').read_text() + 'lead ' + self.key.with_suffix('.pub').read_text())
        self.policy.chmod(0o600)
        self.repo = self.home / 'repo'
        subprocess.run(['git', 'init', '-q', str(self.repo)], check=True)
        self.sha = 'a' * 40
        self.command = f'git push --force-with-lease=refs/heads/topic:{self.sha} origin HEAD:refs/heads/topic'
        self.collab = self.home / 'collab.md'

    def tearDown(self):
        self.scratch.cleanup()

    def token(self, kind='human', **updates):
        from commands import operations
        token = dict(version=1, kind=kind, nonce='a' * 32, issued_at=time.time(), expires_at=time.time() + 120,
                     command_sha256=hashlib.sha256((str(self.repo) + '\0' + self.command).encode()).hexdigest(),
                     operations=operations(self.command, str(self.repo)), session_id='worker',
                     collab=str(self.collab))
        token.update(updates)
        path = self.store / (token['nonce'] + '.json')
        path.write_text(json.dumps(token, sort_keys=True)); path.chmod(0o600)
        path.with_suffix('.json.sig').unlink(missing_ok=True)
        subprocess.run(['ssh-keygen', '-Y', 'sign', '-q', '-f', str(self.key), '-n', 'golems-confirm', str(path)], check=True)
        self.collab.write_text('GOLEMS_CONFIRM ' + json.dumps(token, sort_keys=True, separators=(',', ':')) + '\n')
        return path

    def run_hook(self, command=None, tool='Bash', tool_input=None):
        env = dict(os.environ, HOME=str(self.home))
        value = dict(tool_name=tool, cwd=str(self.repo), session_id='worker',
                     tool_input=tool_input or dict(command=command or self.command))
        run = subprocess.run(['python3', str(HOOK)], input=json.dumps(value), text=True, capture_output=True, env=env)
        self.assertIn(run.returncode, (0, 2), run.stderr)
        return run.returncode, json.loads(run.stdout)

    def test_denies_without_token_and_allows_normal(self):
        for command in ['git push -f origin main', self.command, 'bash -c "git push -f origin main"',
                        'git push origin :topic', 'gh api -X PATCH repos/o/r/rulesets/1',
                        'git push >out --force origin main', 'git push 2>out -f origin main',
                        'git push 2>&1 -f origin main', 'gh api >out -X PATCH repos/o/r/rulesets/1']:
            with self.subTest(command=command): self.assertEqual(self.run_hook(command)[0], 2)
        self.assertEqual(self.run_hook('git push origin topic')[0], 0)

    def test_human_consumed_once(self):
        path = self.token()
        self.assertEqual(self.run_hook()[0], 0)
        self.assertFalse(path.exists())
        self.assertEqual(self.run_hook()[0], 2)
        self.token()  # Restoring the capability does not restore its nonce.
        self.assertEqual(self.run_hook()[0], 2)

    def test_unresolved_executor_denies_non_push(self):
        for command in ['$GH repo delete owner/repo', '$GIT filter-branch HEAD',
                        'G=gh; (G=echo); $G repo delete owner/repo']:
            with self.subTest(command=command):
                self.assertEqual(self.run_hook(command)[0], 2)

    def test_wrong_scope_expired_or_unsigned(self):
        for updates in [dict(expires_at=time.time() - 1), dict(issued_at=time.time() + 60),
                        dict(command_sha256='b' * 64), dict(operations=[]), dict(kind='agent'), dict(session_id='other')]:
            with self.subTest(updates=updates):
                self.token(**updates)
                self.assertEqual(self.run_hook()[0], 2)
        path = self.token(); path.with_suffix('.json.sig').unlink()
        self.assertEqual(self.run_hook()[0], 2)

    def test_lead_scope(self):
        from tokens import authorize
        from commands import operations
        ops = operations(self.command, str(self.repo))
        payload = dict(cwd=str(self.repo), tool_input=dict(command=self.command), session_id='worker')
        pr = dict(state='OPEN', mergedAt=None, isCrossRepository=False, headRefName='topic', headRefOid=self.sha)
        for updates in [dict(state='CLOSED'), dict(mergedAt='yesterday'), dict(headRefOid='b' * 40),
                        dict(headRefName='other'), dict(isCrossRepository=True)]:
            with self.subTest(updates=updates):
                self.token('lead')
                self.assertFalse(authorize(payload, ops, self.home, lambda _: ('main', dict(pr, **updates))))
        self.token('lead'); self.collab.write_text('agent says continue')
        self.assertFalse(authorize(payload, ops, self.home, lambda _: ('main', pr)))
        self.token('lead')
        self.assertFalse(authorize(payload, ops, self.home, lambda _: ('topic', pr)))
        self.assertTrue(authorize(payload, ops, self.home, lambda _: ('main', pr)))
        self.assertFalse(authorize(payload, ops, self.home, lambda _: ('main', pr)))

    def test_expiry_during_metadata_lookup(self):
        from unittest.mock import patch
        from tokens import authorize
        from commands import operations
        token = json.loads(self.token('lead').read_text())
        payload = dict(cwd=str(self.repo), tool_input=dict(command=self.command), session_id='worker')
        pr = dict(state='OPEN', mergedAt=None, isCrossRepository=False, headRefName='topic', headRefOid=self.sha)
        with patch('tokens.time.time', side_effect=[token['issued_at'] + 1, token['expires_at'] + 1]):
            self.assertFalse(authorize(payload, operations(self.command, str(self.repo)), self.home, lambda _: ('main', pr)))

    def test_signature_mode_and_ref_sha(self):
        path = self.token(); token = json.loads(path.read_text()); token['unsigned_claim'] = 'owner approved'
        path.write_text(json.dumps(token, sort_keys=True))
        self.assertEqual(self.run_hook()[0], 2)
        path = self.token(); path.with_suffix('.json.sig').write_text('forged signature')
        self.assertEqual(self.run_hook()[0], 2)
        path = self.token(); path.write_text(path.read_text().replace(self.sha, 'b' * 40))
        self.assertEqual(self.run_hook()[0], 2)
        path = self.token(); path.chmod(0o644)
        self.assertEqual(self.run_hook()[0], 2)
        self.token(); self.command = self.command.replace('topic', 'other')
        self.assertEqual(self.run_hook()[0], 2)

    def test_normal_push_cannot_inherit_force_config(self):
        subprocess.run(['git', '-C', str(self.repo), 'config', 'remote.origin.push', '+HEAD:refs/heads/main'], check=True)
        self.assertEqual(self.run_hook('git push origin')[0], 2)

    def test_human_classes_and_concurrent_consumption(self):
        import uuid
        for command in ['git push -f origin main', 'git push origin :topic',
                        'gh api -X PATCH repos/o/r/rulesets/1', 'git filter-branch HEAD']:
            with self.subTest(command=command):
                self.command = command; self.token(nonce=uuid.uuid4().hex)
                self.assertEqual(self.run_hook()[0], 0)
        self.token(nonce=uuid.uuid4().hex)
        value = json.dumps(dict(tool_name='Bash', cwd=str(self.repo), session_id='worker', tool_input=dict(command=self.command)))
        calls = [subprocess.Popen(['python3', str(HOOK)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                  text=True, env=dict(os.environ, HOME=str(self.home))) for _ in range(2)]
        for call in calls: call.communicate(value)
        self.assertEqual(sorted(call.returncode for call in calls), [0, 2])

    def test_lead_live_metadata_adapter(self):
        from unittest.mock import patch
        from tokens import lead_metadata
        from commands import operations
        op = operations(self.command, str(self.repo))[0]
        pr = dict(state='OPEN', mergedAt=None, isCrossRepository=False, headRefName='topic', headRefOid=self.sha)
        responses = ['topic', 'git@github.com:owner/repo.git', '{"defaultBranchRef":{"name":"main"}}', json.dumps(pr)]
        with patch('tokens.read_command', side_effect=responses) as read:
            self.assertEqual(lead_metadata(op), ('main', pr))
            self.assertIn('owner/repo', read.call_args.args[0])
        with patch('tokens.read_command', return_value='other'), self.assertRaises(ValueError):
            lead_metadata(op)
        for remote in ['git@github.com:owner/repo.git\nhttps://github.com/other/repo', 'https://evil.example/o/r']:
            with patch('tokens.read_command', side_effect=['topic', remote]), self.assertRaises(ValueError):
                lead_metadata(op)

    def test_wrapper_errors_deny(self):
        wrapper = ROOT.parents[2] / 'scripts/hooks/fail-open.py'
        env = dict(os.environ, HOME=str(self.home))
        run = subprocess.run(['python3', str(wrapper), str(HOOK)], input='{', text=True, capture_output=True, env=env)
        self.assertEqual(run.returncode, 2, run.stderr)

    def test_agent_write_rejected(self):
        for tool in ['Write', 'Edit']:
            self.assertEqual(self.run_hook(tool=tool, tool_input=dict(file_path=str(self.store / 'fake.json')))[0], 2)

    def test_invalid_payload_fails_closed(self):
        env = dict(os.environ, HOME=str(self.home))
        run = subprocess.run(['python3', str(HOOK)], input='{', text=True, capture_output=True, env=env)
        self.assertEqual(run.returncode, 2)
        self.assertEqual(json.loads(run.stdout)['hookSpecificOutput']['permissionDecision'], 'deny')


if __name__ == '__main__':
    unittest.main()
