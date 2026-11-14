"""Classification must use the shell command's Git; errors never change provider."""
import os
import shlex
import unittest
from unittest.mock import patch
import test_gate
import test_push_url_rewrites as fixtures


class ClassificationProvider(unittest.TestCase):
    setUp = test_gate.Gate.setUp
    tearDown = test_gate.Gate.tearDown
    token = test_gate.Gate.token
    run_hook = test_gate.Gate.run_hook
    unlock = test_gate.Gate.unlock
    commit_pins = test_gate.Gate.commit_pins
    git = fixtures.PushURLRewrites.git
    set_route = fixtures.PushURLRewrites.set_route

    def second_git(self, config):
        root = self.home / 'second'
        binary, dashed = root / 'bin/git', root / 'libexec/git-core/git-push'
        binary.parent.mkdir(parents=True); dashed.parent.mkdir(parents=True)
        system = root / 'gitconfig'
        system.write_text(config)
        env = 'GIT_CONFIG_SYSTEM=' + shlex.quote(str(system))
        binary.write_text('#!/bin/sh\nif [ "$1" = --exec-path ]; then printf "%s\\n" '
                          + shlex.quote(str(dashed.parent)) + '; exit 0; fi\n'
                          + env + ' exec /usr/bin/git "$@"\n')
        dashed.write_text('#!/bin/sh\n' + env + ' exec /usr/bin/git push "$@"\n')
        binary.chmod(0o755); dashed.chmod(0o755)
        return binary, dashed, system

    def test_unreadable_config_never_falls_back(self):
        self.set_route()
        binary, _, system = self.second_git('')
        for text in ('[http]\n sslVerify\n[remote "origin"]\n push = :refs/heads/topic\n',
                     '[remote "origin"]\n mirror\n'):
            with self.subTest(config=text):
                system.write_text(text)
                with patch.dict(os.environ, PATH=str(binary.parent) + os.pathsep + os.environ['PATH']):
                    self.assertEqual(self.run_hook('git push origin')[0], 2)

    def test_explicit_other_install_uses_own_config(self):
        self.set_route()
        _, dashed, system = self.second_git('[remote "origin"]\n push = :refs/heads/topic\n')
        # The owning binary is deliberately absent from PATH.
        command = shlex.quote(str(dashed)) + ' origin'
        self.assertEqual(self.run_hook(command)[0], 2)
        system.write_text('')
        self.assertEqual(self.run_hook(shlex.quote(str(dashed)) + ' origin topic')[0], 0)

    def test_inspection_error_refuses_plain_found_command(self):
        self.set_route()
        binary, _, _ = self.second_git('')
        binary.write_text('#!/bin/sh\nexit 99\n')
        with patch.dict(os.environ, PATH=str(binary.parent) + os.pathsep + os.environ['PATH']):
            self.assertEqual(self.run_hook('git push origin topic')[0], 2)

    def test_plain_controls_allow_without_token(self):
        self.set_route()
        self.assertEqual(self.run_hook('git push origin main')[0], 0)
        self.assertEqual(self.run_hook('git-push origin topic')[0], 0)
