"""Values-stripped fleet shapes: git-guardian owns local branch cleanup."""
import pytest

from test_commands import ROOT  # noqa: F401 -- installs the hooks import path
from commands import operations


FLEET_SHAPES = [
    pytest.param('gh pr view 412 --json state --jq .state && '
                 'gh pr merge 412 --squash --delete-branch 2>&1', id='view-and-merge'),
    pytest.param('gh pr merge 412 --repo fixture/project --merge --delete-branch',
                 id='merge-repo'),
    pytest.param('gh pr merge 412 --repo fixture/project --merge --delete-branch && '
                 'gh pr view 412 --repo fixture/project --json state', id='merge-and-view'),
    pytest.param('gh pr merge 412 -R fixture/project --squash --admin --delete-branch '
                 '2>&1 | tail -1; gh pr view 412 --json state', id='admin-pipeline'),
    pytest.param('cd ~/fixture/project; sleep 4; gh pr view 412 --json state -q .state; '
                 'h=$(gh pr view 412 --json headRefOid -q .headRefOid); '
                 'gh pr merge 412 --squash --delete-branch', id='capture-before-merge'),
    pytest.param('for N in 412 413; do case $N in 412) echo ready;; esac; '
                 'gh pr merge "$N" --squash --delete-branch; done', id='loop-merge'),
    pytest.param('git reset -q --hard && git checkout -q topic/base && '
                 'git branch -D topic/old -q && git checkout -q -b topic/next',
                 id='forced-local-chain'),
    pytest.param('cd ~/fixture/golems || exit 1\n'
                 'gh pr comment 412 --repo fixture/golems --body '
                 '"Use `gh pr merge 412 --squash --delete-branch`, not another action - ready."',
                 id='comment-command-substitution'),
    pytest.param('cd ~/fixture/golems || exit 1\n'
                 'gh pr comment 412 --repo fixture/golems --body '
                 '"Use gh pr merge, not gh pr close -d --delete-branch."', id='comment-prose'),
    pytest.param('cd ~/fixture/golems || exit 1\n'
                 'gh pr comment 412 --repo fixture/golems --body '
                 r'"Use \`gh pr merge 412 --squash --delete-branch\`, not another action - ready."',
                 id='comment-escaped-markdown'),
]


@pytest.mark.parametrize('command', FLEET_SHAPES)
def test_fleet_cleanup_adds_no_human_confirmation(command):
    assert operations(command, '/repo', alias_lookup=lambda *_: None) == []


@pytest.mark.parametrize('command', [
    'gh pr close 412 -d',
    'gh pr close 412 --delete-branch',
    'git push --delete origin topic',
    'git push origin :refs/heads/topic',
    'gh api -X DELETE repos/fixture/project/git/refs/heads/topic',
])
def test_close_and_unproven_remote_deletes_keep_confirmation(command):
    assert operations(command, '/repo', alias_lookup=lambda *_: None)
