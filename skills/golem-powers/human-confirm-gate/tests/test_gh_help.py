"""Public argv classification only: no gh process, token or real configuration."""
import unittest
from test_false_positives import decide


class HelpFlags(unittest.TestCase):
    def decisions(self, expected, commands):
        for command in commands:
            with self.subTest(command=command):
                self.assertEqual(decide(command), expected)

    def test_homepage_short_option_is_a_settings_value(self):
        self.decisions('deny', [
            'gh repo edit o/r -h https://example.test',
            'gh repo edit o/r -hhttps://example.test',
            'gh repo edit o/r -h=https://example.test',
            'gh repo edit o/r --homepage=https://example.test',
            'gh repo edit o/r -h --help',
            'gh repo edit o/r -dh -h --help',
        ])

    def test_help_words_consumed_as_option_values_are_data(self):
        self.decisions('deny', [
            'gh repo edit o/r --description --help',
            'gh repo edit o/r -d --help',
            'gh repo edit o/r --homepage --help',
            'gh repo edit o/r --default-branch -h',
            'gh repo edit o/r --visibility --help',
            'gh repo edit o/r --add-topic --help',
            'gh repo edit o/r --description=--help',
            'gh repo edit o/r --description $DESCRIPTION --help',
            'gh secret set NAME --body --help',
            'gh variable set NAME -b --help',
            'gh ssh-key add key.pub --title --help',
            'gh repo deploy-key add key.pub -t --help',
        ])

    def test_genuine_help_remains_allowed(self):
        self.decisions('allow', [
            'gh --help', 'gh help repo edit', 'gh repo --help',
            'gh repo edit --help', 'gh repo edit o/r --help',
            'gh repo edit o/r --help=true', 'gh repo edit o/r --help=1',
            'gh repo edit o/r -h https://example.test --help',
            'gh repo edit o/r --description --help --help',
            'gh repo edit o/r -dh --help',
            "gh repo edit o/r --description 'literal$description' --help",
            'gh repo edit o/r --enable-issues --help',
            'gh repo edit o/r --enable-issues=false --help',
            'gh repo archive o/r -yh', 'gh repo delete o/r --yes --help',
            'gh repo sync o/r --force --help',
            'gh secret set NAME -b value -h',
            'gh variable set NAME --body=value --help',
            'gh repo deploy-key add key.pub -wt title -h',
            'gh workflow disable build.yml -h',
        ])

    def test_false_or_terminated_help_never_exempts_settings(self):
        self.decisions('deny', [
            'gh repo edit o/r --help=false',
            'gh repo edit o/r --help=0',
            'gh repo edit o/r -- --help',
            'gh repo edit o/r -- -h',
            'gh repo edit o/r -h',
            'gh repo edit o/r --homepage',
        ])


if __name__ == '__main__':
    unittest.main()
