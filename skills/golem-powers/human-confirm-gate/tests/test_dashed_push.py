"""Public controls for plain dashed pushes and token-bound Git providers."""
import os
import shlex
import unittest
from unittest.mock import patch
import test_gate
import test_push_url_rewrites as fixtures


class DashedPush(unittest.TestCase):
    setUp = test_gate.Gate.setUp
    tearDown = test_gate.Gate.tearDown
    token = test_gate.Gate.token
    run_hook = test_gate.Gate.run_hook
    unlock = test_gate.Gate.unlock
    commit_pins = test_gate.Gate.commit_pins
    git = fixtures.PushURLRewrites.git
    set_route = fixtures.PushURLRewrites.set_route

    def provider(self):
        self.set_route()
        bindir, execdir = self.home / 'bin', self.home / 'git-core'
        bindir.mkdir(); execdir.mkdir()
        binary = bindir / 'git'
        binary.write_text('#!/bin/sh\nif [ "$1" = --exec-path ]; then\n printf "%s\\n" '
                          + shlex.quote(str(execdir)) + '\nelse\n exec /usr/bin/git "$@"\nfi\n')
        binary.chmod(0o755)
        dashed = execdir / 'git-push'
        dashed.write_text('#!/bin/sh\nexec /usr/bin/git push "$@"\n')
        dashed.chmod(0o755)
        return bindir, execdir

    def test_plain_dashed_push_needs_no_token_or_binary_resolution(self):
        from commands import operations
        self.set_route()
        self.assertEqual(self.run_hook('git-push origin topic')[0], 0)
        with patch('git_config.resolve_git', side_effect=ValueError('unresolvable')):
            self.assertEqual(operations('git-push origin topic', str(self.repo)), [])
            self.assertEqual(operations('git push origin topic', str(self.repo)), [])

    def test_dashed_token_binds_destination_and_restores(self):
        bindir, _ = self.provider()
        with patch.dict(os.environ, PATH=str(bindir) + os.pathsep + os.environ['PATH']):
            self.command = 'git-push --delete origin refs/heads/topic'
            token = self.token()
            self.git('config', 'url.' + str(self.other) + '.pushInsteadOf', str(self.target))
            self.assertEqual(self.run_hook()[0], 2)
            self.assertTrue(token.exists())
            self.git('config', '--unset-all', 'url.' + str(self.other) + '.pushInsteadOf')
            self.assertEqual(self.run_hook()[0], 0)

    def test_explicit_dashed_path_and_path_lookup(self):
        bindir, execdir = self.provider()
        with patch.dict(os.environ, PATH=str(bindir) + os.pathsep + os.environ['PATH']):
            self.command = shlex.quote(str(execdir / 'git-push')) + ' --delete origin refs/heads/topic'
            self.token()
            self.assertEqual(self.run_hook()[0], 0)
        with patch.dict(os.environ, PATH=str(execdir) + os.pathsep + str(bindir) + os.pathsep + os.environ['PATH']):
            self.command = 'git-push --delete origin refs/heads/topic'
            self.token(nonce='b' * 32)
            self.assertEqual(self.run_hook()[0], 0)

    def test_unresolvable_dashed_protected_push_refuses(self):
        bindir, execdir = self.provider()
        (execdir / 'git-push').unlink()
        with patch.dict(os.environ, PATH=str(bindir)):
            from commands import operations
            with self.assertRaises(ValueError):
                operations('git-push --delete origin refs/heads/topic', str(self.repo))

    def test_plain_configured_delete_still_requires_token(self):
        self.set_route()
        self.git('config', 'remote.origin.push', ':refs/heads/topic')
        self.assertEqual(self.run_hook('git-push origin')[0], 2)
        self.assertEqual(self.run_hook('git push origin')[0], 2)

    def test_matching_provider_beyond_first_path_git(self):
        bindir, execdir = self.provider()
        earlier = self.home / 'earlier'
        earlier.mkdir()
        wrong = earlier / 'git'
        wrong.write_text('#!/bin/sh\nexec /usr/bin/git "$@"\n')
        wrong.chmod(0o755)
        with patch.dict(os.environ, PATH=str(earlier) + os.pathsep + str(bindir) + os.pathsep + os.environ['PATH']):
            self.command = shlex.quote(str(execdir / 'git-push')) + ' --delete origin refs/heads/topic'
            self.token()
            self.assertEqual(self.run_hook()[0], 0)

    def test_dashed_send_pack_binds_provider(self):
        bindir, execdir = self.provider()
        (execdir / 'git-send-pack').symlink_to(execdir / 'git-push')
        with patch.dict(os.environ, PATH=str(bindir) + os.pathsep + os.environ['PATH']):
            self.command = 'git-send-pack --force ' + shlex.quote(str(self.target)) + ' HEAD:refs/heads/topic'
            self.token()
            self.assertEqual(self.run_hook()[0], 0)

    def test_relative_path_configured_delete_still_refuses(self):
        self.set_route()
        bindir = self.repo / 'bin'
        bindir.mkdir()
        system = self.home / 'system-config'
        system.write_text('[remote "origin"]\n push = :refs/heads/topic\n')
        binary = bindir / 'git'
        binary.write_text('#!/bin/sh\nGIT_CONFIG_SYSTEM=' + shlex.quote(str(system)) + ' exec /usr/bin/git "$@"\n')
        binary.chmod(0o755)
        with patch.dict(os.environ, PATH='bin' + os.pathsep + os.environ['PATH']):
            self.assertEqual(self.run_hook('git push origin')[0], 2)
