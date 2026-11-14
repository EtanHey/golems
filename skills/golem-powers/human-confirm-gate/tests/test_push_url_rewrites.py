"""Real Git routes and disposable signed tokens; no network or owner key."""
import hashlib
import json
import subprocess
import unittest
import uuid
import test_gate


class PushURLRewrites(unittest.TestCase):
    setUp = test_gate.Gate.setUp
    tearDown = test_gate.Gate.tearDown
    token = test_gate.Gate.token
    run_hook = test_gate.Gate.run_hook
    unlock = test_gate.Gate.unlock
    commit_pins = test_gate.Gate.commit_pins

    def test_rewrites_refuse_signed_token(self):
        for scope, kind in (('local', 'pushInsteadOf'), ('global', 'pushInsteadOf'),
                            ('local', 'insteadOf'), ('global', 'insteadOf')):
            with self.subTest(scope=scope, kind=kind):
                self.set_route()
                path = self.token(nonce=uuid.uuid4().hex)
                key = 'url.' + str(self.other) + '.' + kind
                self.git('config', '--' + scope, key, str(self.target))
                try:
                    self.assertEqual(self.git('remote', 'get-url', '--push', 'origin'), str(self.other))
                    self.assertEqual(self.run_hook()[0], 2)
                    self.assertTrue(path.exists())  # Mismatch must not spend the token.
                finally:
                    self.git('config', '--' + scope, '--unset-all', key)
                self.assertEqual(self.run_hook()[0], 0)

    def git(self, *args):
        return subprocess.run(['/usr/bin/git', '-C', str(self.repo), *args],
                              check=True, capture_output=True, text=True).stdout.strip()

    def set_route(self):
        self.target, self.other = self.home / 'A.git', self.home / 'B.git'
        for repo in (self.target, self.other):
            if not repo.exists():
                self.git('init', '--bare', str(repo))
        self.git('config', 'remote.origin.url', str(self.target))
        self.command = 'git push --delete origin refs/heads/topic'

    def test_wider_digest_expires_legacy_and_binds_all_rewrites(self):
        from git_config import CONFIG_KEYS, read
        self.set_route()
        # Round 2 deliberately expires older tokens by binding binary/env/URLs.
        # They live at most 300 seconds; no legacy fallback may reopen scope.
        selected = {}
        for item in read(str(self.repo), 'config', '--null', '--get-regexp', CONFIG_KEYS).split('\0'):
            if item:
                key, _, value = item.partition('\n')
                selected.setdefault(key, []).append(value)
        digest = hashlib.sha256(json.dumps(selected, sort_keys=True).encode()).hexdigest()
        path = self.token()
        token = json.loads(path.read_text())
        self.assertNotEqual(token['operations'][0]['push_config_sha256'], digest)
        self.assertEqual(self.run_hook()[0], 0)
        self.token(nonce=uuid.uuid4().hex)
        self.git('config', 'url.' + str(self.other) + '.pushInsteadOf', 'unrelated:')
        self.assertEqual(self.run_hook()[0], 2)

    def test_multiple_push_urls_and_explicit_pushurl(self):
        self.set_route()
        self.git('config', 'remote.origin.pushurl', str(self.target))
        self.token()
        # Git ignores pushInsteadOf when an explicit pushurl is configured.
        self.git('config', 'url.' + str(self.other) + '.pushInsteadOf', str(self.target))
        self.assertEqual(self.git('remote', 'get-url', '--push', 'origin'), str(self.target))
        self.assertEqual(self.run_hook()[0], 2)
        self.token(nonce='b' * 32)
        self.git('config', '--add', 'remote.origin.pushurl', str(self.other))
        self.assertEqual(self.run_hook()[0], 2)

    def test_second_push_url_rewrite_invalidates_token(self):
        self.set_route()
        third = self.home / 'C.git'
        self.git('init', '--bare', str(third))
        self.git('config', 'remote.origin.pushurl', str(self.target))
        self.git('config', '--add', 'remote.origin.pushurl', str(self.other))
        self.token()
        self.git('config', 'url.' + str(third) + '.insteadOf', str(self.other))
        self.assertEqual(self.git('remote', 'get-url', '--push', '--all', 'origin').splitlines(),
                         [str(self.target), str(third)])
        self.assertEqual(self.run_hook()[0], 2)

    def test_token_issued_with_rewrite_allows_unchanged_route(self):
        self.set_route()
        self.git('config', 'url.' + str(self.other) + '.pushInsteadOf', str(self.target))
        self.token()
        self.assertEqual(self.run_hook()[0], 0)

    def test_literal_destination_rewrite_invalidates_token(self):
        import shlex
        self.set_route()
        self.command = 'git push --delete ' + shlex.quote(str(self.target)) + ' refs/heads/topic'
        self.token()
        self.git('config', 'url.' + str(self.other) + '.pushInsteadOf', str(self.target))
        self.assertEqual(self.run_hook()[0], 2)
