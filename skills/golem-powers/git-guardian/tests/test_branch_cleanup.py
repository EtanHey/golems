"""Synthetic GitHub receipts plus a real Git DAG; never delete a real branch."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'git-guardian'))
import git_safety


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class BranchCleanup(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=os.environ.get('W68_TEST_ROOT', '.'))
        self.addCleanup(self.temp.cleanup)
        self.repo = str(Path(self.temp.name).resolve())
        self.git('init', '-q', '-b', 'main')
        self.git('config', 'user.name', 'Fixture')
        self.git('config', 'user.email', 'fixture@example.com')
        self.git('commit', '-qm', 'base', '--allow-empty')
        self.base = self.git('rev-parse', 'HEAD')
        self.git('branch', 'topic')
        self.git('update-ref', 'refs/remotes/origin/main', self.base)
        self.head = self.base
        self.owner, self.default, self.protected, self.rules = 'EtanHey', 'main', False, []
        self.prs, self.failure, self.calls = [], None, []
        source = ROOT / '_shared/branch_cleanup.py'
        self.policy = load('w68_policy', source) if source.exists() else None
        if self.policy:
            self.addCleanup(patch.stopall)
            patch.object(self.policy, '_run', side_effect=self.transport).start()
            patch.object(git_safety._pkg, 'branch_cleanup', self.policy).start()
        self.hook = load('w68_hook', ROOT / 'git-guardian/hooks/pre_tool_use.py')

    def git(self, *args):
        return subprocess.check_output(['/usr/bin/git', '-C', self.repo, *args], text=True).strip()

    def transport(self, argv, cwd):
        self.calls.append(argv)
        if self.failure and self.failure in ' '.join(argv):
            raise ValueError('fixture transport failure')
        if argv[0] == 'gh':
            if 'graphql' in argv:
                return json.dumps({'data': {'repository': {'nameWithOwner': self.owner + '/example',
                    'defaultBranchRef': {'name': self.default}, 'branchProtectionRules': {
                    'nodes': [{'pattern': 'topic'}] if self.protected else [], 'pageInfo': {'hasNextPage': False}}}}})
            route = argv[-1]
            if '/rules/branches/' in route: return json.dumps(self.rules)
            if '/pulls?' in route: return json.dumps(self.prs)
            raise AssertionError(argv)
        args = argv[1:]
        if args[:2] == ['remote', 'get-url']: return 'https://github.com/EtanHey/example.git'
        if args[:1] == ['fetch']: return ''
        if args[:1] == ['ls-remote']: return self.head + '\trefs/heads/topic'
        return self.git(*args)

    def verdict(self, command):
        with patch.dict(os.environ, {}, clear=False):
            previous = os.getcwd()
            try:
                os.chdir(self.repo)
                return self.hook.classify_tool('Bash', {'command': command})[0] != 'RED'
            finally:
                os.chdir(previous)

    def moved(self):
        self.git('checkout', '-q', 'topic')
        self.git('commit', '-qm', 'unique', '--allow-empty')
        self.head = self.git('rev-parse', 'HEAD')

    def merged(self):
        self.prs = [{'merged_at': '2026-11-01T00:00:00Z', 'head': {
            'sha': self.head, 'ref': 'topic', 'repo': {'full_name': 'EtanHey/example'}}}]

    def test_contained_local(self):
        self.assertTrue(self.verdict('git branch -D topic'))

    def test_contained_remote(self):
        self.assertTrue(self.verdict('git push origin --delete topic'))

    def test_squash_merged_at_head(self):
        self.moved(); self.merged()
        self.assertTrue(self.verdict('git push origin :refs/heads/topic'))

    def test_unmerged_local_denied(self):
        self.moved()
        self.assertFalse(self.verdict('git branch -D topic'))

    def test_moved_after_merge_denied(self):
        self.merged(); self.moved()
        self.assertFalse(self.verdict('git push --delete origin topic'))

    def test_default_local_denied(self):
        self.assertFalse(self.verdict('git branch -D main'))

    def test_protected_denied(self):
        self.protected = True
        self.assertFalse(self.verdict('git branch -d topic'))

    def test_ruleset_denied(self):
        self.rules = [{'type': 'deletion'}]
        self.assertFalse(self.verdict('git branch -D topic'))

    def test_foreign_denied(self):
        self.owner = 'pingdotgg'
        self.assertFalse(self.verdict('git branch -D topic'))

    def test_unknown_default_denied(self):
        self.default = ''
        self.assertFalse(self.verdict('git branch -D topic'))

    def test_failures_deny(self):
        for failure in ('fetch', 'gh', 'rules/branches', 'rev-list', 'ls-remote'):
            with self.subTest(failure=failure):
                self.failure = failure
                self.assertFalse(self.verdict('git push --delete origin topic' if failure == 'ls-remote' else 'git branch -D topic'))

    def test_quoted_data_and_heredoc(self):
        for command in ["cat > brief.md <<'EOF'\ngit push origin --delete topic\nEOF\n",
                        "printf '%s' 'git push origin --delete topic'",
                        "cat >> brief.md <<'EOF'\n`git push origin --delete topic`\nEOF\n"]:
            with self.subTest(command=command): self.assertTrue(self.verdict(command))

    def test_executable_substitution_denied(self):
        self.moved()
        for command in ["cat <<EOF\n$(git push origin --delete topic)\nEOF\n",
                        "echo $(git branch -D topic)", "bash <<'EOF'\ngit branch -D topic\nEOF"]:
            with self.subTest(command=command): self.assertFalse(self.verdict(command))

    def test_no_bulk_force_tags_or_extra_command_exemption(self):
        for command in ['git push --mirror origin', 'git push origin :refs/tags/v1',
                        'git push -f --delete origin topic', 'git branch -D topic; git reset --hard']:
            with self.subTest(command=command): self.assertFalse(self.verdict(command))

    def test_push_mirror_configuration_denied(self):
        self.git('config', 'remote.origin.mirror', 'true')
        self.assertFalse(self.verdict('git push origin --delete topic'))

    def test_confirmation_entrypoint(self):
        if self.policy is None: self.skipTest('verifier not implemented on base')
        patch.dict(sys.modules, {'branch_cleanup': self.policy}).start()
        old_prefix, old_bytecode = sys.pycache_prefix, sys.dont_write_bytecode
        gate = load('w68_confirm', ROOT / 'human-confirm-gate/hooks/human-confirm-pretooluse.py')
        self.addCleanup(setattr, sys, 'pycache_prefix', old_prefix)
        self.addCleanup(setattr, sys, 'dont_write_bytecode', old_bytecode)
        payload = {'tool_name': 'Bash', 'cwd': self.repo, 'tool_input': {'command':
                   'gh api -X DELETE repos/EtanHey/example/git/refs/heads/topic'}}
        gate.evaluate(payload, Path(self.repo))
        self.moved()
        with self.assertRaises(gate.ConfirmationRequired): gate.evaluate(payload, Path(self.repo))

    def test_default_checkout_hook_wiring(self):
        hook = load('w68_block', ROOT.parents[1] / '.claude/hooks/block-dangerous-commands.py')
        if not hasattr(hook, '_verified_branch_cleanup'): self.fail('default-checkout gate has no verified cleanup exemption')
        with patch.object(hook, '_on_protected_branch', return_value=True), patch.object(hook, 'AUTONOMOUS', False):
            with patch.object(hook, '_verified_branch_cleanup', return_value=True):
                hook.check_bash('git push origin --delete topic')
            with patch.object(hook, '_verified_branch_cleanup', return_value=False), patch('sys.stdout'):
                with self.assertRaises(SystemExit): hook.check_bash('git push origin --delete topic')

    def test_pr_delete_flag_denied(self):
        policy = load('w68_gh', ROOT / 'human-confirm-gate/hooks/gh_policy.py')
        for flag in ('--delete-branch', '--delete-branch=true', '-sd'):
            self.assertTrue(policy.operations(['pr', 'merge', '123', flag], self.repo))
        self.assertEqual(policy.operations(['pr', 'merge', '123', '--body', '--delete-branch'], self.repo), [])

    def test_head_changes_during_metadata_denied(self):
        if self.policy is None: self.skipTest('verifier not implemented on base')
        self.merged()
        original = self.transport
        def moving(argv, cwd):
            result = original(argv, cwd)
            if argv[0] == 'gh' and '/pulls?' in argv[-1]: self.moved()
            return result
        with patch.object(self.policy, '_run', side_effect=moving):
            self.assertFalse(self.verdict('git push origin --delete topic'))

    def test_verifier_gh_and_scope(self):
        if self.policy is None: self.skipTest('verifier not implemented on base')
        for command in ['gh api -X DELETE repos/EtanHey/example/git/refs/heads/topic',
                        'gh api repos/EtanHey/example/git/refs/heads/topic --method=DELETE']:
            self.assertTrue(self.policy.allowed(command, self.repo))
        for command in ['gh api -X DELETE repos/pingdotgg/t3code/git/refs/heads/topic',
                        'git -c remote.origin.mirror=true push --delete origin topic',
                        'git push upstream --delete topic', 'git branch -Dr origin/topic',
                        'git -C ~/foreign branch -D topic', 'git -C */foreign branch -D topic']:
            self.assertFalse(self.policy.allowed(command, self.repo))


if __name__ == '__main__':
    unittest.main()
