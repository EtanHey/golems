import shlex
import subprocess
import unittest
import test_gate


class GitRoutes(unittest.TestCase):
    setUp = test_gate.Gate.setUp
    tearDown = test_gate.Gate.tearDown
    token = test_gate.Gate.token
    run_hook = test_gate.Gate.run_hook
    unlock = test_gate.Gate.unlock
    lock = test_gate.Gate.lock
    commit_pins = test_gate.Gate.commit_pins

    def config(self, key, value):
        subprocess.run(['/usr/bin/git', '-C', str(self.repo), 'config', key, value], check=True)

    def test_casefolded_executors_and_wrappers_deny(self):
        for command in ('GIT push -f origin topic', 'Git push --force origin topic',
                        '/USR/BIN/GIT push -f origin topic', 'GH repo delete o/r --yes',
                        'TIMEOUT 5 Git push -f origin topic',
                        'COMMAND GIT push -f origin topic',
                        'BASH -c "GIT push -f origin topic"',
                        'G=GIT; $G push -f origin topic'):
            with self.subTest(command=command): self.assertEqual(self.run_hook(command)[0], 2)
        for command in ('GIT --version', 'GH --version', 'ECHO "GIT push -f origin topic"'):
            with self.subTest(command=command): self.assertEqual(self.run_hook(command)[0], 0)

    def test_per_subcommand_executables_map_to_git(self):
        # Class-level only (made-up subcommand); live regressions are private.
        from syntax import executable
        self.assertEqual(executable('git-frobnicate'), ('git', 'frobnicate'))
        self.assertEqual(executable('/opt/x/libexec/GIT-FROBNICATE'), ('git', 'frobnicate'))
        self.assertEqual(executable('/usr/bin/GIT'), ('git', None))
        for word in ('gitk', 'github', 'git-', 'ls'):
            self.assertNotEqual(executable(word)[0], 'git', word)

    def test_configured_delete_and_force_deny_on_next_call(self):
        for refspec in (':refs/heads/topic', '  :refs/heads/topic', '+HEAD:refs/heads/topic'):
            with self.subTest(refspec=refspec):
                self.config('remote.origin.push', refspec)
                self.assertEqual(self.run_hook('git push origin')[0], 2)

    def test_effective_remote_and_explicit_refs(self):
        self.config('remote.unused.push', ':refs/heads/topic')
        self.assertEqual(self.run_hook('git push origin topic')[0], 0)
        self.config('branch.master.pushRemote', 'unused')
        with self.subTest(route='branch.pushRemote'): self.assertEqual(self.run_hook('git push')[0], 2)
        self.config('remote.origin.push', ':refs/heads/topic')
        self.assertEqual(self.run_hook('git push origin topic')[0], 0)
        self.assertEqual(self.run_hook('git push --repo=origin')[0], 2)
        self.config('remote.origin.mirror', 'true')
        self.assertEqual(self.run_hook('git push origin topic')[0], 2)

    def test_push_default_and_option_values(self):
        self.config('remote.backup.push', ':refs/heads/topic')
        self.config('remote.pushDefault', 'backup')
        with self.subTest(route='pushDefault'): self.assertEqual(self.run_hook('git push')[0], 2)
        for command in ('git push -o --force origin topic', 'git push -vof origin topic'):
            with self.subTest(command=command): self.assertEqual(self.run_hook(command)[0], 0)
        self.config('push.default', 'matching')
        self.assertEqual(self.run_hook('git push origin')[0], 0)
        self.config('remote.origin.push', ':')  # matching, not an empty-source delete
        self.assertEqual(self.run_hook('git push origin')[0], 0)

    def test_destructive_config_setters_deny(self):
        for command in ("git config remote.origin.push ':refs/heads/topic'",
                        "git config --add remote.origin.push '+HEAD:refs/heads/topic'",
                        'git config remote.origin.mirror true'):
            with self.subTest(command=command): self.assertEqual(self.run_hook(command)[0], 2)
        self.assertEqual(self.run_hook('git config user.name Fixture')[0], 0)
        self.assertEqual(self.run_hook('git config --get remote.origin.push')[0], 0)
        self.assertEqual(self.run_hook("git config remote.origin.push ':'")[0], 0)  # matching, not a delete

    def test_edit_and_write_destructive_git_config_deny(self):
        # The RESULTING config is judged (the edit is simulated on the real file).
        self.config('remote.origin.push', 'HEAD')
        self.config('remote.origin.mirror', 'false')
        target = str(self.repo / '.git/config')
        for edit in (dict(old_string='HEAD', new_string='+HEAD'),             # partial edit, no "push =" in it
                     dict(old_string='push = HEAD', new_string='push = :refs/heads/topic')):
            with self.subTest(edit=edit):
                self.assertEqual(self.run_hook(tool='Edit', tool_input=dict(file_path=target, **edit))[0], 2)
        # An old_string that is not in the file changes nothing (the real Edit would fail).
        self.assertEqual(self.run_hook(tool='Edit', tool_input=dict(
            file_path=target, old_string='absent', new_string='push = +x'))[0], 0)
        for tool, value in (('Write', dict(content='[remote "origin"]\n push = :refs/heads/topic\n')),
                            ('Edit', dict(old_string='push = HEAD', new_string='push = +HEAD:topic')),
                            ('MultiEdit', dict(edits=[dict(old_string='mirror = false', new_string='mirror = true')]))):
            with self.subTest(tool=tool):
                self.assertEqual(self.run_hook(tool=tool, tool_input=dict(file_path=target, **value))[0], 2)
        self.assertEqual(self.run_hook(tool='Edit', tool_input=dict(file_path=target, new_string='name = Fixture'))[0], 0)

    def test_remote_config_change_invalidates_prior_token(self):
        self.token()
        self.config('remote.origin.url', 'https://github.com/fixture/other.git')
        self.assertEqual(self.run_hook()[0], 2)

    def test_configured_delete_can_use_exact_human_scope(self):
        self.config('remote.origin.push', ':refs/heads/topic')
        self.command = 'git push origin'
        path = self.token()
        self.assertEqual(self.run_hook()[0], 0)
        self.assertFalse(path.exists())
        self.assertEqual(self.run_hook()[0], 2)
