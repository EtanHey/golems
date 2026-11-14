"""Review regressions: broad deny-only scope, narrow plain-push invocation scope."""
import shlex
import unittest
import test_git_env_prefix as fixtures


class CompoundScope(unittest.TestCase):
    setUp = fixtures.GitEnvironmentPrefix.setUp
    tearDown = fixtures.GitEnvironmentPrefix.tearDown
    run_hook = fixtures.GitEnvironmentPrefix.run_hook
    unlock = fixtures.GitEnvironmentPrefix.unlock
    commit_pins = fixtures.GitEnvironmentPrefix.commit_pins
    git = fixtures.GitEnvironmentPrefix.git
    set_route = fixtures.GitEnvironmentPrefix.set_route

    def test_export_equivalents_cannot_hide_configured_delete(self):
        self.set_route()
        xdg = self.home / 'xdg'
        (xdg / 'git').mkdir(parents=True)
        (xdg / 'git/config').write_text('[remote "origin"]\n push = :refs/heads/topic\n')
        assignment = 'XDG_CONFIG_HOME=' + shlex.quote(str(xdg))
        value = shlex.quote(str(xdg))
        commands = [
            f'{assignment} git push origin',
            f'declare -x {assignment}; git push origin',
            f'typeset -x {assignment}; git push origin',
            f'if true; then export {assignment}; fi; git push origin',
            f'{{ export {assignment}; }}; git push origin',
            f'read XDG_CONFIG_HOME <<< {value}; export XDG_CONFIG_HOME; git push origin',
            f'printf -v XDG_CONFIG_HOME %s {value}; export XDG_CONFIG_HOME; git push origin',
            f'set -a; {assignment}; git push origin',
            f'export {assignment}; git push origin',
            f'export {assignment} && git push origin',
            f'time {assignment} git push origin',
            f'command env {assignment} git push origin',
            f'nice env {assignment} git push origin',
            f'exec env {assignment} git push origin',
            f"env -S '{assignment} git push origin'",
            f'env -i PATH=/usr/bin:/bin {assignment} git push origin',
            f'export A=1 {assignment}; git push origin',
            f'export -- {assignment}; git push origin',
            f"{assignment} sh -c 'git push origin'",
            f"export {assignment}; bash -c 'git push origin'",
            f'f() {{ local -x {assignment}; git push origin; }}; f',
            f'readonly {assignment}; export XDG_CONFIG_HOME; git push origin',
            f'(export {assignment}; git push origin)',
            f'declare -gx {assignment}; git push origin',
            f"eval 'export {assignment}'; git push origin",
        ]
        for command in commands:
            with self.subTest(command=command):
                self.assertEqual(self.run_hook(command)[0], 2)

    def test_plain_compounds_keep_their_allowance(self):
        self.set_route()
        repo = shlex.quote(str(self.repo))
        for command in (
                'PATH=/usr/bin:/bin true && git push origin main',
                'GIT_SSH_COMMAND=ssh git fetch origin && git push origin main',
                f'cd {repo} && GIT_SSH_COMMAND=ssh git push origin main',
                f'cd {repo}; export PATH=/usr/bin:/bin; git push origin main',
                'PATH=/usr/bin:/bin true; git push origin main',
                'export PATH=/usr/bin:/bin; git lfs version'):
            with self.subTest(command=command):
                self.assertEqual(self.run_hook(command)[0], 0)

    def test_common_dir_and_env_scope_options(self):
        self.set_route()
        other = self.home / 'other'
        self.git('init', '-q', str(other))
        # `git config --file` writes only this fixture repository's config.
        config = other / '.git/config'
        self.git('config', '--file', str(config), 'remote.origin.push', ':refs/heads/topic')
        value = shlex.quote(str(other / '.git'))
        for command in (
                f'GIT_COMMON_DIR={value} git push origin',
                f'export GIT_COMMON_DIR={value}; git push origin',
                'env -u HOME git push origin', 'unset HOME; git push origin',
                f'env -C {shlex.quote(str(other))} git push origin',
                'env -P /invented/bin git push origin',
                "env -S 'git push --delete origin topic'"):
            with self.subTest(command=command):
                self.assertEqual(self.run_hook(command)[0], 2)

    def test_plain_wrapper_and_heredoc_data_are_not_scope_writers(self):
        self.set_route()
        for command in (
                'HOME=$UNRESOLVED bash scripts/check.sh',
                "cat <<'TEXT'\nread PATH from this report\nTEXT\ngit push origin main"):
            with self.subTest(command=command):
                self.assertEqual(self.run_hook(command)[0], 0)
