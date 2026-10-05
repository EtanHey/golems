import unittest
from test_commands import ROOT
import gh_policy
import syntax
from commands import shell


class Helpers(unittest.TestCase):
    def test_redirects_preserve_later_arguments(self):
        tokens, _, segments, scopes = shell._parse_bash('git push 2>&1 -f origin topic | tail -5')
        args, redirects = syntax.argv_at(tokens, segments, scopes, 0)
        self.assertEqual(args, ['push', '-f', 'origin', 'topic'])
        self.assertEqual(redirects, [('>', '1')])

    def test_wrapper_argv(self):
        for base, args in [('timeout', ['30', 'git', 'status']),
                           ('script', ['-q', '/dev/null', 'git', 'status']),
                           ('find', ['.', '-execdir', 'git', 'status', ';'])]:
            self.assertEqual(list(syntax.wrapper_payload(base, args)), [['git', 'status']])
        self.assertEqual(syntax.shell_payload('bash', ['-c', '--', 'git status']), 'git status')

    def test_settings_and_ordinary_api_routes(self):
        for endpoint in ['https://API.github.com:443/repos/o/r', '//repos/o/r', 'repositories/123', 'orgs/o/rulesets/1']:
            self.assertTrue(gh_policy.operations(['api', endpoint, '-X', 'DELETE'], '/repo'))
        for endpoint in ['repos/o/r/pulls/1/comments', 'repos/o/r/issues/comments/1', 'repos/o/r/pulls/1/reviews', 'repos/o/r/issues/1/labels']:
            self.assertEqual(gh_policy.operations(['api', endpoint, '-f', 'body=fixture'], '/repo'), [])

    def test_unresolved_settings_options_deny(self):
        for args in [['repo', '$ACTION', 'o/r'], ['repo', 'edit', '$FLAGS'], ['api', 'repos/o/r', '-X', '$METHOD']]:
            with self.subTest(args=args), self.assertRaises(ValueError):
                gh_policy.operations(args, '/repo')
