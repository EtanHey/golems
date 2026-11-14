"""Invented approvals only; no owner's key, SSH agent, native prompt or remote writes."""
import importlib.machinery
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import unittest
from unittest.mock import patch

REPO = Path(__file__).resolve().parents[4]


def load(name):
    loader = importlib.machinery.SourceFileLoader(name.replace('-', '_'), str(REPO / 'scripts' / name))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    module = importlib.util.module_from_spec(spec); loader.exec_module(module)
    return module


class ApprovalCarry(unittest.TestCase):
    def setUp(self):
        scratch = REPO / 'docs.local/w132'; scratch.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=scratch); self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        self.repo = self.home / 'repo'; self.repo.mkdir()
        subprocess.run(['/usr/bin/git', 'init', '-q', str(self.repo)], check=True)
        self.remote = 'https://github.com/example-invented/widget.git'
        subprocess.run(['/usr/bin/git', '-C', str(self.repo), 'remote', 'add', 'origin', self.remote], check=True)
        self.confirm = load('golems-confirm')
        # This import must be absent on master: the new mode is the regression target.
        self.approval = load('golems-approval')
        import approvals
        self.approvals = approvals
        self.record = dict(question='Delete ' + self.remote + ' refs/heads/invented?', answer='Approve deletion',
                           answer_kind='option', affirmative_option='Approve deletion',
                           t3_request_id='invented-request', t3_thread_id='invented-thread', asked_by='invented-seat',
                           command='git push --delete origin refs/heads/invented', repo_remote=self.remote,
                           ref='refs/heads/invented', expected_remote_sha='a' * 40)
        self.path = self.approval.record(self.record, home=self.home)
        self.key = self.home / 'key.pub'; self.key.write_text('ssh-ed25519 AAAA invented\n')
        self.argv = ['--approval', self.path.stem, '--session', 'invented-session', '--command', self.record['command'],
                     '--key', str(self.key)]
        self.oldcwd = os.getcwd(); os.chdir(self.repo); self.addCleanup(os.chdir, self.oldcwd)
        self.presence = patch.object(self.confirm, 'human_presence', return_value=True).start()
        self.addCleanup(patch.stopall)
        patch.object(self.confirm, 'anchor_bytes', return_value=b'invented').start()
        patch.object(self.confirm, 'verify_signature', return_value=True).start()
        patch.object(self.confirm, 'sign', return_value=None).start()
        patch.object(self.approvals, 'remote_tip', return_value='a' * 40).start()

    def issue(self):
        return self.confirm.issue(self.argv, home=self.home)

    def mutate(self, **updates):
        value = json.loads(self.path.read_text()); value.update(updates); self.path.write_text(json.dumps(value))

    def refuses(self, name):
        with self.assertRaisesRegex(ValueError, name): self.issue()
        self.assertEqual(list((self.home / '.config/golems/human-confirm').glob('*.json')), [])

    def test_carry_inside_agent_and_same_token_format(self):
        with patch.dict(os.environ, {'CODEX_THREAD_ID': 'invented'}): result = self.issue()
        token = json.loads(result.read_text())
        self.assertEqual(token['kind'], 'human'); self.assertEqual(token['session_id'], 'invented-session')
        self.assertLessEqual(token['expires_at'] - token['issued_at'], 300)
        self.presence.assert_called_once()
        ledger = self.path.parent / 'consumed.jsonl'
        self.assertEqual(json.loads(ledger.read_text())['id'], self.path.stem)

    def test_concurrent_carry_consumes_once(self):
        from concurrent.futures import ThreadPoolExecutor
        from threading import Event
        entered, release, second_started = Event(), Event(), Event()
        def presence(value):
            entered.set()
            if not release.wait(10): raise AssertionError('test release missing')
            return True
        self.presence.side_effect = presence
        def second():
            second_started.set()
            try: self.issue()
            except ValueError as exc: return str(exc)
            self.fail('concurrent reuse must refuse')
        with ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(self.issue)
            self.assertTrue(entered.wait(10))
            other = pool.submit(second)
            self.assertTrue(second_started.wait(10)); release.set()
            self.assertTrue(first.result(timeout=10).is_file())
            self.assertIn('already consumed', other.result(timeout=10))
        self.assertEqual(self.presence.call_count, 1)
        self.assertEqual(len((self.path.parent / 'consumed.jsonl').read_text().splitlines()), 1)

    def test_missing(self):
        self.path.unlink(); self.refuses('record missing')

    def test_malformed(self):
        self.path.write_text('{'); self.refuses('record parse')

    def test_expired(self):
        self.mutate(created_at=time.time() - 100, expires_at=time.time() - 1); self.refuses('record expired')

    def test_reused(self):
        result = self.issue(); result.unlink(); self.refuses('already consumed')

    def test_byte_different(self):
        self.argv[self.argv.index('--command') + 1] += ' '; self.refuses('command mismatch')

    def test_wrong_remote(self):
        self.mutate(repo_remote='https://github.com/example-invented/other.git', question=self.record['command'])
        self.refuses('origin mismatch')

    def test_moved_tip(self):
        self.approvals.remote_tip.return_value = 'b' * 40; self.refuses('remote tip mismatch')

    def test_non_delete(self):
        for command in ('git push -f origin refs/heads/invented', 'git filter-branch HEAD', 'gh repo edit --private',
                        'git push --force-with-lease origin HEAD:refs/heads/invented'):
            self.mutate(command=command, question=command)
            self.argv[self.argv.index('--command') + 1] = command
            self.refuses('operation class')

    def test_question_scope(self):
        self.mutate(question='Do something invented?'); self.refuses('question scope')

    def test_free_text(self):
        self.mutate(answer_kind='free_text'); self.refuses('affirmative option')

    def test_negative_option(self):
        self.mutate(answer='Cancel'); self.refuses('affirmative option')

    def test_cancel(self):
        self.presence.return_value = False; self.refuses('presence cancelled')

    def test_prompt_timeout(self):
        import sys
        with patch.object(self.confirm.sys, 'platform', 'darwin'), patch.object(self.confirm.subprocess, 'run',
                side_effect=subprocess.TimeoutExpired('invented-helper', 90)):
            # Call the production seam, saved before the test-only patch.
            original = load('golems-confirm').human_presence
            self.assertFalse(original(json.loads(self.path.read_text())))

    def test_expiry_after_prompt(self):
        def expire(*args): self.mutate(created_at=time.time() - 100, expires_at=time.time() - 1); return True
        self.presence.side_effect = expire; self.refuses('record expired')

    def test_default_still_refuses_agent(self):
        with patch.dict(os.environ, {'CODEX_THREAD_ID': 'invented'}), self.assertRaisesRegex(ValueError, 'owner terminal'):
            self.confirm.issue([str(self.repo), 'invented', 'delete', '--session', 'invented'], home=self.home)

    def test_record_modes_and_exclusive(self):
        self.assertEqual(self.path.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.path.parent.stat().st_mode & 0o777, 0o700)
        with patch.object(self.approval.uuid, 'uuid4', return_value=type('ID', (), {'hex': self.path.stem})()), self.assertRaises(FileExistsError):
            self.approval.record(self.record, home=self.home)

    def test_record_rejects_bad_scope_and_answer(self):
        for updates in (dict(question='Nothing specific?'), dict(answer_kind='free_text'), dict(answer='Cancel'),
                        dict(ttl_hours=73), dict(expected_remote_sha='short')):
            with self.subTest(updates=updates), self.assertRaises(ValueError):
                self.approval.record(dict(self.record, **updates), home=self.home)

    def test_symlink_record(self):
        other = self.home / 'other'; self.path.rename(other); self.path.symlink_to(other)
        with self.assertRaises((OSError, ValueError)): self.issue()

    def test_extra_shell_command(self):
        command = self.record['command'] + '; echo invented'
        self.mutate(command=command, question=command); self.argv[self.argv.index('--command') + 1] = command
        self.refuses('command grammar')

    def test_wrong_push_url(self):
        subprocess.run(['/usr/bin/git', '-C', str(self.repo), 'remote', 'set-url', '--push', 'origin',
                        'https://github.com/example-invented/other.git'], check=True)
        self.refuses('origin mismatch')

    def test_ledger_precedes_sign_and_failure_stays_spent(self):
        def fail(*args, **kwargs):
            self.assertIn(self.path.stem, (self.path.parent / 'consumed.jsonl').read_text())
            raise ValueError('invented signing failure')
        self.confirm.sign.side_effect = fail; self.refuses('signing failure'); self.refuses('already consumed')


class SignedCarry(unittest.TestCase):
    # Disposable keys + the existing immutable-anchor fixture; production verifier/hook.
    from test_gate import Gate
    setUp = Gate.setUp
    tearDown = Gate.tearDown
    run_hook = Gate.run_hook

    def test_existing_gate_accepts_signed_carry_once(self):
        confirm = load('golems-confirm'); approval = load('golems-approval')
        remote = 'https://github.com/example-invented/widget.git'
        subprocess.run(['/usr/bin/git', '-C', str(self.repo), 'remote', 'add', 'origin', remote], check=True)
        self.command = 'git push --delete origin refs/heads/invented'
        value = dict(question=self.command, answer='Approve', affirmative_option='Approve', answer_kind='option',
                     t3_request_id='invented', t3_thread_id='invented', asked_by='invented', command=self.command,
                     repo_remote=remote, ref='refs/heads/invented', expected_remote_sha='a' * 40)
        record = approval.record(value, home=self.home)
        oldcwd = os.getcwd(); os.chdir(self.repo); self.addCleanup(os.chdir, oldcwd)
        def signer(argv, **kwargs):
            self.assertIn('-U', argv)
            argv = list(argv); argv.remove('-U'); argv[argv.index('-f') + 1] = str(self.key)
            return subprocess.run(argv, **kwargs)
        with patch.object(confirm, 'human_presence', return_value=True), patch.object(confirm, 'sign', side_effect=signer), \
                patch('approvals.remote_tip', return_value='a' * 40):
            confirm.issue(['--approval', record.stem, '--session', 'worker', '--command', self.command,
                           '--key', str(self.key.with_suffix('.pub'))], home=self.home)
        self.assertEqual(self.run_hook()[0], 0)
        self.assertEqual(self.run_hook()[0], 2)


if __name__ == '__main__': unittest.main()
