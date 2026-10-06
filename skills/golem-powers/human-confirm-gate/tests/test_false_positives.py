"""R2 false-positive classes (FP-a..e) from the real fleet corpus, each with deny controls.

In-process and platform-independent: the decision mirrors the hook (any
operation or inspection error denies without a token)."""
import json
import unittest
from test_commands import ROOT  # puts hooks/ on sys.path


def decide(command, cwd='/repo'):
    from commands import operations
    try:
        return 'deny' if operations(command, cwd, alias_lookup=lambda *_: None) else 'allow'
    except Exception:
        return 'deny'


class FalsePositives(unittest.TestCase):
    def assertDecisions(self, expected, commands):
        for command in commands:
            with self.subTest(command=command):
                self.assertEqual(decide(command), expected)

    def test_fp_a_quoted_heredoc_prose_is_data(self):
        self.assertDecisions('allow', [
            "cat >> collab.md <<'EOF'\nan earlier `/<path>` route\nEOF",
            "cat >> collab.md <<'EOF'\nrun `git push -f origin topic` later\nEOF",
            'cat > note.md <<"EOF"\n`a | b` and $(c) stay text\nEOF',
            "cat <<-'EOF'\n\tit's `x`\n\tEOF",
            "python3 - <<'PY'\nold = '''it's ${v} `b`'''\nPY\necho done",
            "cat > a.md <<'A' && cat > b.md <<'B'\n`x >`\nA\n`y <`\nB",
        ])

    def test_fp_a_executable_text_around_heredocs_still_denies(self):
        self.assertDecisions('deny', [
            'cat <<EOF\n$(git push -f origin topic)\nEOF',
            'cat <<EOF\n`git push -f origin topic`\nEOF',
            "cat <<EOF\nit's\n$(git push -f\n origin topic)\nEOF",
            "cat <<'EOF'\nit's\nEOF\necho $(git push -f origin topic)",
            "cat <<'EOF'; echo $(git push -f origin topic)\n`x`\nEOF",
            "cat <<'A' <<B\n`a`\nA\n$(git push -f origin topic)\nB",
        ])

    def test_fp_a_ambiguous_heredoc_views_keep_the_full_scan(self):
        # `<<` inside ${...}, arithmetic or a multi-line quote is not a heredoc
        # to bash; when the views disagree nothing is masked.
        import commands, syntax
        for command in ["echo ${v//<<'X'/}\n$(true)\n", 'echo $((1<<2))\n$(true)',
                        "echo 'a\n<<\"X\"\n'; $(true)\n", "cat <<'E' \\\n x\n$(true)\nE"]:
            with self.subTest(command=command):
                self.assertEqual(syntax.mask_heredoc_bodies(command, commands.shell), command)
        self.assertEqual(syntax.mask_heredoc_bodies("cat <<'E'\n`x`\nE", commands.shell), "cat <<'E'\n   \nE")
        unquoted = "cat <<E\n`x` it's\nE"  # bash runs these substitutions: never masked
        self.assertEqual(syntax.mask_heredoc_bodies(unquoted, commands.shell), unquoted)
        self.assertEqual(syntax.mask_heredoc_bodies("cat <<'A' <<B\n`a`\nA\n`b`\nB", commands.shell),
                         "cat <<'A' <<B\n   \nA\n`b`\nB")

    def test_fp_b_apostrophes_in_quoted_args(self):
        self.assertDecisions('allow', ['bun test -t "doesn\'t crash"', 'npx vitest -t "user\'s flow"',
                                       'python3 tool.py "it\'s fine"'])
        self.assertDecisions('deny', ['runner "cd x && gh repo delete o/r it\'s"'])

    def test_fp_c_script_operands_are_not_stdin(self):
        self.assertDecisions('allow', ['cat a | head -3; bash scripts/check.sh',
                                       'git log | head -1; sh ./run.sh',
                                       'diff <(sort a) <(sort b); bash x.sh',
                                       'bash .githooks/pre-push < /dev/null',
                                       'echo data | bash scripts/consume.sh', 'bash --version',
                                       'bash -eo pipefail scripts/x.sh', 'bash -n < script.sh'])
        self.assertDecisions('deny', ['echo x | bash', 'echo x | bash -s', 'bash < script.sh',
                                      'bash -s arg < script.sh', 'echo x | nice bash', 'echo x | bash -',
                                      'bash <(echo x)', 'bash /dev/stdin < script.sh', 'bash -o pipefail < x',
                                      'zsh -f', 'command -p bash'])  # a bare shell runs whatever stdin later brings

    def test_command_lookup_runs_nothing(self):
        self.assertDecisions('allow', ['command -v bash', 'command -V git', 'command -pv bash && bash --version'])
        self.assertDecisions('deny', ['command -p git push -f origin topic', 'command git push -f origin topic'])

    def test_fp_d_assignment_prefixes_are_not_executables(self):
        self.assertDecisions('allow', ['TMPDIR="$HOME/.cache/x" bash scripts/verify.sh --force',
                                       'FOO="$HOME/x" rm -f out.txt', 'X=$PWD/a bun run build -- --force',
                                       'SHELL=/bin/bash'])
        self.assertDecisions('deny', ['X="$HOME/x" git push -f origin topic', 'X=1 > ~/.config/golems/human-confirm/x'])

    def test_fp_e_shell_ids_under_comment_families(self):
        self.assertDecisions('allow', [
            'for id in $(gh api repos/o/r/pulls/1/comments --jq ".[].id"); do '
            'gh api -X POST repos/o/r/pulls/1/comments/"$id"/replies -f body=ok; done',
            'gh api repos/o/r/pulls/$N/comments', 'gh api -X PATCH repos/o/r/issues/comments/${C} -f body=x',
            'gh api repos/$O/$R/actions/runs',
        ])
        self.assertDecisions('deny', ['gh api -X DELETE repos/o/"$R"', 'gh api -X PUT repos/o/r/branches/$B/protection',
                                      'gh api -X POST repos/o/r/$X', 'gh api -X POST repos/o/r/pulls/1/$X',
                                      'gh api -X POST repos/o/r/issues/$(echo 1/x)', 'gh api -X POST "$URL"'])

    def test_graphql_variables_are_graphql_syntax(self):
        self.assertDecisions('allow', [
            "gh api graphql -f query='mutation($threadId:ID!){resolveReviewThread(input:{threadId:$threadId}){thread{id}}}' -F threadId=PRRT_x",
            "gh api graphql -F owner=o -F name=r -f query='query($owner:String!,$name:String!){repository(owner:$owner,name:$name){id}}'",
            'gh api graphql -f query=\'mutation($id:ID!,$body:String!){addPullRequestReviewThreadReply(input:{pullRequestReviewThreadId:$id,body:$body}){comment{id}}}\' -f id=PRRT_x -f body="$(cat reply.md)"',
        ])
        self.assertDecisions('deny', [
            'gh api graphql -f query="$Q"', 'gh api graphql -f "$K=x"',
            'for p in 1 2; do gh api graphql -f query="{repository(owner:\\"o\\",name:\\"r\\"){pullRequest(number:$p){id}}}"; done',
            't=x; echo "$(gh api graphql -f query="mutation(\\$t:ID!){addComment(input:{body:$t}){clientMutationId}}")"',
        ])

    def test_git_local_commands_need_no_alias_lookup(self):
        from commands import operations
        for command in ['git -C .worktrees/new merge-base --is-ancestor a b', 'git -C "$T" check-ignore -q x']:
            with self.subTest(command=command):
                self.assertEqual(operations(command, '/repo', alias_lookup=lambda *_: self.fail('alias lookup')), [])
        self.assertEqual(decide('git -C "$T" frobnicate --force'), 'deny')


class FleetCorpus(unittest.TestCase):
    """tests/fleet_commands.json: values-stripped shapes of real Claude and Codex Bash
    commands (a random sample of the mined fleet transcripts). Shell syntax, command
    names, git/gh verbs and flags are kept; every other word is a placeholder (x1, x2...),
    digits collapse to 1s and hex ids to a's. A shape is kept only when it gets the same
    decision as the raw command it came from."""

    def test_real_fleet_shapes(self):
        rows = json.loads((ROOT / 'tests/fleet_commands.json').read_text())
        self.assertGreaterEqual(len(rows), 5000)
        self.assertEqual([r['command'][:80] for r in rows if decide(r['command']) != r['expected']], [])
        denies = [r for r in rows if r['expected'] == 'deny']
        self.assertLessEqual(len(denies), len(rows) * 0.005)
        self.assertTrue(all(r.get('why') for r in denies))


class GhMutants(unittest.TestCase):
    """Public mechanism tests for the R2 surviving mutants."""

    def test_api_host_is_checked(self):
        self.assertEqual(decide('gh api -X DELETE https://api.github.com/repos/o/r'), 'deny')
        self.assertEqual(decide('gh api -X DELETE https://other.localhost/repos/o/r'), 'deny')
        self.assertEqual(decide('gh api -X POST https://other.localhost/repos/o/r/pulls/1/comments -f body=x'), 'deny')
        self.assertEqual(decide('gh api -X POST https://api.github.com/repos/o/r/pulls/1/comments -f body=x'), 'allow')
        import gh_policy
        with self.assertRaisesRegex(ValueError, 'host'):
            gh_policy.endpoint_path('https://other.localhost/repos/o/r')

    def test_graphql_input_is_opaque(self):
        self.assertEqual(decide('gh api graphql --input query.json'), 'deny')
        self.assertEqual(decide('gh api graphql --input=query.json'), 'deny')

    def test_transfer_is_settings(self):
        self.assertEqual(decide('gh api -X POST repos/o/r/transfer -f new_owner=x'), 'deny')


if __name__ == '__main__':
    unittest.main()
