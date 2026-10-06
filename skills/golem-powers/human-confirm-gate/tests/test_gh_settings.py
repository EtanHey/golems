"""R2 N5 (lead ruling: guard them): repository writes are settings unless they are routine
collaboration traffic; credential and security-switch CLI verbs need a token too."""
import unittest
from test_commands import ROOT  # noqa: F401  (puts hooks/ on sys.path)
from test_false_positives import decide


class SettingsRoutes(unittest.TestCase):
    def test_repository_writes_are_settings_by_default(self):
        from gh_policy import settings_path
        for path, method in [('repos/o/r/keys', 'POST'), ('repos/o/r/keys/1', 'DELETE'),
                             ('repos/o/r/branches/main/rename', 'POST'), ('repos/o/r/vulnerability-alerts', 'DELETE'),
                             ('repos/o/r/automated-security-fixes', 'DELETE'), ('repos/o/r/private-vulnerability-reporting', 'DELETE'),
                             ('repos/o/r/actions/secrets/X', 'PUT'), ('repos/o/r/actions/variables', 'POST'),
                             ('repos/o/r/actions/permissions', 'PUT'), ('repos/o/r/actions/workflows/1/disable', 'PUT'),
                             ('repos/o/r/secret-scanning/alerts/1', 'PATCH'), ('repos/o/r/code-scanning/default-setup', 'PATCH'),
                             ('repos/o/r/pages', 'DELETE'), ('repos/o/r/invitations/1', 'PATCH'), ('repos/o/r/topics', 'PUT'),
                             ('repos/o/r/git/refs/heads/x', 'DELETE'), ('repositories/1/keys', 'POST'),
                             ('orgs/o/actions/secrets/X', 'PUT'), ('user/keys', 'POST'), ('teams/1/repos/o/r', 'PUT'), ('repos/o/r', 'PATCH')]:
            with self.subTest(path=path, method=method):
                self.assertTrue(settings_path(path, method))

    def test_routine_collaboration_stays_allowed(self):
        from gh_policy import settings_path
        for path, method in [('repos/o/r/pulls/1/comments/2/replies', 'POST'), ('repos/o/r/pulls/1/merge', 'PUT'),
                             ('repos/o/r/issues/1/labels', 'POST'), ('repos/o/r/issues/comments/1', 'DELETE'),
                             ('repos/o/r/statuses/abc', 'POST'), ('repos/o/r/check-runs', 'POST'),
                             ('repos/o/r/actions/runs/1/rerun-failed-jobs', 'POST'), ('repos/o/r/actions/jobs/1/rerun', 'POST'),
                             ('repos/o/r/actions/workflows/ci.yml/dispatches', 'POST'), ('repos/o/r/actions/caches/1', 'DELETE'),
                             ('repos/o/r/git/refs', 'POST'), ('repos/o/r/git/tags', 'POST'), ('repos/o/r/commits/abc/comments', 'POST'),
                             ('repos/o/r/dispatches', 'POST'), ('repos/o/r/keys', 'GET'), ('markdown', 'POST'), ('gists', 'POST')]:
            with self.subTest(path=path, method=method):
                self.assertFalse(settings_path(path, method))

    def test_r2_n5_shapes_deny(self):
        for command in ['gh api -X DELETE repos/o/r/vulnerability-alerts', 'gh api -X POST repos/o/r/keys -F read_only=false',
                        'gh api -X POST repos/o/r/branches/main/rename -f new_name=x', 'gh api -X PUT repos/o/r/actions/secrets/X']:
            with self.subTest(command=command):
                self.assertEqual(decide(command), 'deny')


class SettingsVerbs(unittest.TestCase):
    def test_cli_settings_verbs_deny(self):
        for command in ['gh repo edit --enable-issues=false --delete-branch-on-merge', 'gh repo edit o/r --description x',
                        'gh repo edit', 'gh repo deploy-key add key.pub --allow-write', 'gh repo deploy-key delete 1',
                        'gh repo unarchive o/r', 'gh secret set X --body y', 'gh secret delete X', 'gh secret remove X --org o',
                        'gh variable set X --body y', 'gh variable delete X', 'gh ssh-key add key.pub', 'gh ssh-key delete 1',
                        'gh gpg-key add key.asc', 'gh workflow disable ci.yml']:
            with self.subTest(command=command):
                self.assertEqual(decide(command), 'deny')

    def test_reads_and_help_stay_allowed(self):
        for command in ['gh repo view o/r', 'gh repo deploy-key list', 'gh secret list', 'gh variable get X',
                        'gh ssh-key list', 'gh workflow enable ci.yml', 'gh workflow run ci.yml', 'gh variable set --help',
                        'gh repo edit --help', 'gh workflow list']:
            with self.subTest(command=command):
                self.assertEqual(decide(command), 'allow')


if __name__ == '__main__':
    unittest.main()
