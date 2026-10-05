import importlib.util
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'hooks'))


class Commands(unittest.TestCase):
    def check(self, command):
        from commands import operations
        return operations(command, '/repo', alias_lookup=lambda *_: None)

    def test_deny_shapes(self):
        cases = [
            'git push --force origin main', 'git push -f origin main',
            'git push --force-with-lease origin feature',
            'git push --force-if-includes origin feature',
            'git push origin +HEAD:refs/heads/main',
            'git push --delete origin feature', 'git push origin :refs/tags/v1',
            'git filter-repo --force', 'git filter-branch HEAD',
            'git replace HEAD HEAD~1; git push origin refs/replace/abc',
            'gh api -X PATCH repos/owner/repo/rulesets/1',
            'gh api --method=PUT repos/owner/repo/branches/main/protection',
            'gh repo edit owner/repo --visibility private', 'gh repo delete owner/repo',
            'env X=1 bash -lc "git -C /repo push -f origin main"',
            "shopt -s expand_aliases\nalias gp='git push -f'\ngp origin main",
            "git -c alias.fp='push -f' fp origin main",
            'git push -vf origin main', 'git push --mirror origin',
            'git push --prune origin', 'gh api repos/o/r -f private=true',
            'git push --fo origin main', 'gh api -XPATCH repos/o/r/rulesets/1',
            'gh api repos/o/r -fprivate=true', 'gh -R o/r repo delete',
        ]
        for command in cases:
            with self.subTest(command=command):
                self.assertTrue(self.check(command))

    def test_normal_and_prose(self):
        for command in ['git push origin feature', 'git status',
                        'echo "git push --force origin main"',
                        'gh api repos/owner/repo/rulesets',
                        'gh pr create --body "mentions $token in prose"',
                        "cat <<'EOF'\ngit push -f origin main\nEOF"]:
            with self.subTest(command=command):
                self.assertEqual(self.check(command), [])

    def test_scope(self):
        sha = 'a' * 40
        self.assertEqual(self.check(f'git -C /other push --force-with-lease=refs/heads/topic:{sha} origin HEAD:refs/heads/topic'),
                         [{'class': 'lease', 'repo': '/other', 'remote': 'origin',
                           'ref': 'refs/heads/topic', 'sha': sha, 'source': 'HEAD'}])

    def test_unknown_fails_closed(self):
        for command in ['git push --force "unterminated', '$GIT push --force origin main', 'git push "$FLAGS" origin main',
                        'git "$SUBCOMMAND" origin main', 'git push -f origin "$REF"', "env -S 'git push -f origin main'", "GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=remote.origin.push GIT_CONFIG_VALUE_0=+HEAD:main git push origin"]:
            with self.subTest(command=command), self.assertRaises(ValueError):
                self.check(command)

    def test_configured_alias(self):
        from commands import operations
        self.assertTrue(operations('git fp origin main', '/repo',
                                   alias_lookup=lambda repo, name: 'push -f' if name == 'fp' else None))


if __name__ == '__main__':
    unittest.main()
