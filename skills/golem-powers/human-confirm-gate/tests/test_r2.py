"""Opus R1 reproductions: real hook, disposable HOME, no inspected command runs."""
from test_gate import Gate
from test_commands import ROOT
import json


class R2(Gate):
    def test_recent_fleet_command_corpus(self):
        # The full corpus is judged in-process (test_false_positives.FleetCorpus); a
        # deterministic slice goes through the real hook subprocess as well.
        rows = json.loads((ROOT / 'tests/fleet_commands.json').read_text())[::100]
        for row in rows:
            with self.subTest(command=row['command'][:80]):
                self.assertEqual(self.run_hook(row['command'])[0], 2 if row['expected'] == 'deny' else 0)

    def test_r1_wrappers(self):
        for prefix in ['timeout 30', 'gtimeout -k 1 30', 'builtin command',
                       'arch -arm64', 'xcrun', 'script -q /dev/null',
                       'watch -n 1', 'parallel', 'unknown-wrapper',
                       'nice -n 5', 'nohup', 'env -i', 'sudo', 'stdbuf -o L',
                       'caffeinate -i', 'time', 'exec', 'command']:
            with self.subTest(prefix=prefix):
                self.assertEqual(self.run_hook(prefix + ' git push -f origin topic')[0], 2)
        for flag in ['-exec', '-execdir', '-ok', '-okdir']:
            with self.subTest(flag=flag):
                self.assertEqual(self.run_hook('find . -maxdepth 0 ' + flag + ' git push -f origin topic \\;')[0], 2)

    def test_r1_ordinary_commands(self):
        for command in ['git push origin topic 2>&1 | tail -5', 'git push origin topic > out.log',
                        'gh api repos/o/r/pulls/1/comments -f body=hi',
                        'gh api repos/o/r/issues/1/comments -f body=hi',
                        'gh api repos/o/r/pulls/1/reviews -f body=hi',
                        'gh api -X PATCH repos/o/r/issues/comments/1 -f body=hi',
                        'gh api repos/o/r/issues/1/labels -f labels=bug',
                        'cd "$HOME/Gits/golems" && git status',
                        'cd "$(git rev-parse --show-toplevel)" && ls',
                        'cd $REPO && bun test', '"$HOME/bin/x" --version',
                        '$EDITOR f', '"$(git rev-parse --show-toplevel)/scripts/x.sh"',
                        'git --version', 'git --no-optional-locks status',
                        'git -c core.quotepath=off status',
                        'git -c user.name=x -c user.email=y commit -m fixture',
                        'git -C ~/x status']:
            with self.subTest(command=command): self.assertEqual(self.run_hook(command)[0], 0)
        self.assertEqual(self.run_hook("gh api graphql -f 'query=mutation{addComment(input:{body:fixture}){clientMutationId}}'")[0], 0)

    def test_r1_shell_inputs_and_git_executors(self):
        for command in ["bash <<'X'\ngit push -f origin topic\nX",
                        "sh <<< 'git push -f origin topic'",
                        "echo 'git push -f origin topic' | sh",
                        "printf '%s' 'git push -f origin topic' | bash -s",
                        'bash <(echo git push -f origin topic)',
                        "bash -c -- 'git push -f origin topic'",
                        "fish -c 'git push -f origin topic'",
                        "trap 'git push -f origin topic' EXIT",
                        'git send-pack --force URL topic', 'git send-pack URL +topic',
                        "git rebase -x 'git push -f origin topic' HEAD",
                        "git rebase --exec='git push -f origin topic' HEAD",
                        "git submodule foreach 'git push -f origin topic'",
                        'git bisect run git push -f origin topic']:
            with self.subTest(command=command): self.assertEqual(self.run_hook(command)[0], 2)

    def test_r1_same_call_config_and_gh(self):
        for command in ["git config alias.fp 'push -f' && git fp origin topic",
                        "git config remote.origin.push '+refs/heads/*:refs/heads/*' && git push origin",
                        'git config remote.origin.mirror true && git push origin',
                        'git remote add --mirror=push m URL && git push m',
                        "echo fake >> .git/config; git push origin",
                        "bash -c 'git config remote.origin.mirror true'; git push origin",
                        "git -c alias.FP='push -f' fp origin topic",
                        'export S=repo; gh $S delete o/r --yes',
                        'export A=api; gh $A -X DELETE repos/o/r',
                        "gh alias set rd 'repo delete' && gh rd o/r --yes",
                        "gh api graphql -f query='mutation{deleteRef(input:{id:1}){clientMutationId}}'",
                        'gh api https://api.github.com:443/repos/o/r -X DELETE',
                        'gh api https://API.github.com/repos/o/r -X DELETE',
                        'gh api //repos/o/r -X DELETE', 'gh api repositories/123 -X DELETE',
                        'gh api orgs/o/rulesets/1 -X PATCH',
                        'gh repo sync o/fork --force', 'gh repo archive o/r',
                        'gh repo rename new-name', 'gh repo edit --default-branch main']:
            with self.subTest(command=command): self.assertEqual(self.run_hook(command)[0], 2)
        self.assertEqual(self.run_hook("gh api graphql -f 'query=mutation{deleteBranchProtectionRule(input:{id:1}){clientMutationId}}'")[0], 2)
