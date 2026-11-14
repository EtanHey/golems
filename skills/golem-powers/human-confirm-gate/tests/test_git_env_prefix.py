"""Command-local Git scope: real hook, invented config and disposable keys."""
import os
import shlex
import unittest
import test_gate
import test_push_url_rewrites as fixtures


class GitEnvironmentPrefix(unittest.TestCase):
    setUp = test_gate.Gate.setUp
    tearDown = test_gate.Gate.tearDown
    run_hook = test_gate.Gate.run_hook
    unlock = test_gate.Gate.unlock
    commit_pins = test_gate.Gate.commit_pins
    git = fixtures.PushURLRewrites.git
    set_route = fixtures.PushURLRewrites.set_route

    @staticmethod
    def forms(assignment, push):
        return (f'{assignment} git {push}', f'env {assignment} git {push}',
                f'export {assignment}; git {push}')

    def test_xdg_configured_delete_and_plain_control(self):
        self.set_route()
        xdg = self.home / 'xdg'
        (xdg / 'git').mkdir(parents=True)
        config = xdg / 'git/config'
        assignment = 'XDG_CONFIG_HOME=' + shlex.quote(str(xdg))
        for value, expected in ((':refs/heads/topic', 2), ('HEAD:refs/heads/topic', 0)):
            config.write_text('[remote "origin"]\n push = ' + value + '\n')
            for command in self.forms(assignment, 'push origin'):
                with self.subTest(command=command, expected=expected):
                    self.assertEqual(self.run_hook(command)[0], expected)

    def test_new_scope_prefixes_refuse_one_way_allow_plain(self):
        from commands import operations
        self.set_route()
        values = {
            'XDG_CONFIG_HOME': str(self.home / 'empty-config'),
            'GIT_EXEC_PATH': '/usr/libexec/git-core',
            'PATH': os.environ['PATH'],
            'GIT_SSH': '/usr/bin/ssh',
            'GIT_SSH_COMMAND': '/usr/bin/ssh',
            'GIT_SSH_VARIANT': 'ssh',
            'GIT_PROXY_COMMAND': '/usr/bin/false',
        }
        for name, value in values.items():
            assignment = name + '=' + shlex.quote(value)
            for push, expected in (('push --delete origin topic', 2),
                                   ('push origin HEAD:refs/heads/topic', 0)):
                for command in self.forms(assignment, push):
                    with self.subTest(command=command):
                        self.assertEqual(self.run_hook(command)[0], expected)
                        if expected == 2:
                            # Refuse parsing even before a token could be issued;
                            # absence of a token alone would also deny on old code.
                            with self.assertRaises(ValueError):
                                operations(command, str(self.repo))

    def test_existing_scope_prefixes_stay_refused(self):
        self.set_route()
        for name in ('HOME', 'GIT_CONFIG', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM',
                     'GIT_CONFIG_NOSYSTEM', 'GIT_CONFIG_COUNT', 'GIT_DIR', 'GIT_WORK_TREE'):
            for command in self.forms(name + '=fixture', 'push --delete origin topic'):
                with self.subTest(command=command):
                    self.assertEqual(self.run_hook(command)[0], 2)

    def test_askpass_does_not_change_classification(self):
        self.set_route()
        commands = self.forms('GIT_ASKPASS=/invented/askpass', 'push origin HEAD:refs/heads/topic')
        commands += ('echo XDG_CONFIG_HOME=fixture; git push origin HEAD:refs/heads/topic',)
        for command in commands:
            self.assertEqual(self.run_hook(command)[0], 0)
