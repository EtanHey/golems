"""Config-side redirect regressions with real Git and disposable signing keys."""
import os
import shlex
import unittest
import uuid
from unittest.mock import patch
import test_gate
import test_push_url_rewrites as fixtures


class PushTransport(unittest.TestCase):
    setUp = test_gate.Gate.setUp
    tearDown = test_gate.Gate.tearDown
    token = test_gate.Gate.token
    run_hook = test_gate.Gate.run_hook
    unlock = test_gate.Gate.unlock
    commit_pins = test_gate.Gate.commit_pins
    git = fixtures.PushURLRewrites.git
    set_route = fixtures.PushURLRewrites.set_route

    def test_legacy_remote_files(self):
        for directory, first, second in (
                ('remotes', 'URL: {url}\n', 'URL: {url}\n'),
                ('branches', '{url}#topic\n', '{url}#topic\n')):
            with self.subTest(directory=directory):
                self.set_route()
                self.git('config', '--unset-all', 'remote.origin.url')
                path = self.repo / '.git' / directory / 'origin'
                path.parent.mkdir(exist_ok=True)
                path.write_text(first.format(url=self.target))
                self.token(nonce=uuid.uuid4().hex)
                path.write_text(second.format(url=self.other))
                self.assertEqual(self.git('remote', 'get-url', '--push', 'origin'), str(self.other))
                try:
                    self.assertEqual(self.run_hook()[0], 2)
                finally:
                    path.unlink()

    def test_receivepack_and_ssh_command(self):
        for key in ('remote.origin.receivepack', 'core.sshCommand'):
            with self.subTest(key=key):
                self.set_route()
                self.token(nonce=uuid.uuid4().hex)
                self.git('config', key, 'git receive-pack ' + shlex.quote(str(self.other)) + ' #')
                try:
                    self.assertEqual(self.run_hook()[0], 2)
                finally:
                    self.git('config', '--unset-all', key)

    def test_path_git_uses_its_system_config(self):
        self.set_route()
        system = self.home / 'second-system-config'
        system.write_text('')
        bin_dir = self.home / 'bin'
        bin_dir.mkdir()
        binary = bin_dir / 'git'
        binary.write_text('#!/bin/sh\nGIT_CONFIG_SYSTEM=' + shlex.quote(str(system))
                          + ' exec /usr/bin/git "$@"\n')
        binary.chmod(0o755)
        with patch.dict(os.environ, PATH=str(bin_dir) + os.pathsep + os.environ['PATH']):
            self.token()
            system.write_text('[url "' + str(self.other) + '"]\n pushInsteadOf = ' + str(self.target) + '\n')
            self.assertEqual(self.run_hook()[0], 2)

    def test_hook_environment_redirect(self):
        self.set_route()
        self.token()
        with patch.dict(os.environ, GIT_SSH_COMMAND='fixture-ssh'):
            self.assertEqual(self.run_hook()[0], 2)

    def test_binary_path_is_bound(self):
        self.set_route()
        self.token()
        bin_dir = self.home / 'bin'
        bin_dir.mkdir()
        (bin_dir / 'git').symlink_to('/usr/bin/git')
        with patch.dict(os.environ, PATH=str(bin_dir) + os.pathsep + os.environ['PATH']):
            self.assertEqual(self.run_hook()[0], 2)

    def test_explicit_git_does_not_use_path_git(self):
        self.set_route()
        self.command = '/usr/bin/git push --delete origin refs/heads/topic'
        self.token()
        bin_dir = self.home / 'bin'
        bin_dir.mkdir()
        binary = bin_dir / 'git'
        binary.write_text('#!/bin/sh\nexit 99\n')
        binary.chmod(0o755)
        with patch.dict(os.environ, PATH=str(bin_dir) + os.pathsep + os.environ['PATH']):
            self.assertEqual(self.run_hook()[0], 0)

    def test_all_transport_config_and_environment_are_bound(self):
        self.set_route()
        for key in ('remote.origin.uploadpack', 'remote.origin.vcs', 'remote.origin.proxy',
                    'ssh.variant', 'protocol.file.allow', 'http.proxy',
                    'http.https://fixture.invalid.proxy', 'url.unrelated.insteadOf'):
            with self.subTest(key=key):
                self.token(nonce=uuid.uuid4().hex)
                self.git('config', key, 'fixture')
                try:
                    self.assertEqual(self.run_hook()[0], 2)
                finally:
                    self.git('config', '--unset-all', key)
        for key in ('GIT_SSH', 'GIT_SSH_COMMAND', 'GIT_SSH_VARIANT', 'GIT_PROXY_COMMAND',
                    'GIT_CONFIG_COUNT', 'GIT_CONFIG_SYSTEM', 'GIT_CONFIG_GLOBAL',
                    'GIT_CONFIG_NOSYSTEM', 'GIT_EXEC_PATH'):
            with self.subTest(key=key):
                self.token(nonce=uuid.uuid4().hex)
                # Empty config count is invalid to Git; use zero, still a binding change.
                with patch.dict(os.environ, {key: '0' if key == 'GIT_CONFIG_COUNT' else 'fixture'}):
                    self.assertEqual(self.run_hook()[0], 2)

    def test_relative_executable_resolves_before_git_c(self):
        self.set_route()
        nested = self.repo / 'nested'
        self.git('init', str(nested))
        self.git('-C', str(nested), 'config', 'remote.origin.url', str(self.target))
        bin_dir = self.repo / 'bin'
        bin_dir.mkdir()
        (bin_dir / 'git').symlink_to('/usr/bin/git')
        self.command = './bin/git -C nested push --delete origin refs/heads/topic'
        self.token()
        self.assertEqual(self.run_hook()[0], 0)
