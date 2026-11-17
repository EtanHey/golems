"""Real hook output; command text is never executed."""
import json
import os
from pathlib import Path
import subprocess
import sys

import pytest

HOOK = Path(__file__).resolve().parents[1] / 'hooks/human-confirm-pretooluse.py'


@pytest.mark.parametrize('command,action', [
    ('git push -f origin topic', 'force-pushing'),
    ('git push origin :topic', 'deleting a remote branch'),
    ('git filter-branch HEAD', 'rewriting git history'),
    ('gh repo edit o/r --enable-wiki', 'changing repo settings'),
    ('gh secret set KEY', 'changing GitHub secrets or keys'),
    ('gh workflow disable build', 'disabling a workflow'),
    ('gh variable set KEY', 'changing GitHub variables'),
    ('git push "$FLAGS"', None),
])
def test_plain_denial(tmp_path, command, action):
    env = {**os.environ, 'HOME': str(tmp_path)}
    repo = tmp_path / 'repo'
    # Push inspection reads Git config and HEAD; never inherit the host checkout.
    subprocess.run(['git', 'init', '-q', '-b', 'topic', str(repo)], check=True, env=env)
    subprocess.run(['git', '-C', str(repo), 'remote', 'add', 'origin',
                    'git@github.com:o/r.git'], check=True, env=env)
    result = subprocess.run([sys.executable, '-I', '-B', str(HOOK)],
        input=json.dumps(dict(tool_name='Bash', cwd=str(repo), tool_input=dict(command=command))),
        cwd=repo, text=True, capture_output=True, env=env, timeout=10)
    assert result.returncode == 2 and not result.stderr
    reason = json.loads(result.stdout)['hookSpecificOutput']['permissionDecisionReason']
    expected = (f"Blocked: {action} can't be undone, so Etan has to approve it. Ask the lead to route it to him."
                      if action else "Blocked: this command couldn't be checked safely. Rewrite it as a plain, literal command.")
    if action == 'deleting a remote branch':
        expected += (' To delete a fleet branch: run scripts/fleet/archive-and-delete-branch.sh, '
                     'then the command it prints.')
    assert reason == expected


@pytest.mark.parametrize('tool', ['Bash', 'Monitor'])
@pytest.mark.parametrize('command', [
    'cp -p ~/.config/golems/ratchet-relay.json ~/.config/golems/ratchet-relay.json.bak',
    'echo fake > ~/.config/golems/config.json',
    'rm ~/.config/golems/human-confirm/a.spent',
    'mv source ~/.config/golems/config.json',
    'echo fake | tee -a ~/.config/golems/config.json',
])
def test_policy_write_names_the_rule(tmp_path, tool, command):
    result = subprocess.run([sys.executable, '-I', '-B', str(HOOK)],
        input=json.dumps(dict(tool_name=tool, cwd=str(tmp_path), tool_input=dict(command=command))),
        text=True, capture_output=True, env={**os.environ, 'HOME': str(tmp_path)}, timeout=10)
    assert result.returncode == 2 and not result.stderr
    output = json.loads(result.stdout)['hookSpecificOutput']
    assert output['permissionDecision'] == 'deny'
    assert output['permissionDecisionReason'] == (
        'Blocked: agents never write or delete under ~/.config/golems '
        '(approval settings and tokens live there). Ask the lead; routing or other settings belong elsewhere.')


def test_parse_failure_keeps_generic_message(tmp_path):
    result = subprocess.run([sys.executable, '-I', '-B', str(HOOK)],
        input=json.dumps(dict(tool_name='Bash', cwd=str(tmp_path), tool_input=dict(command="echo 'unterminated"))),
        text=True, capture_output=True, env={**os.environ, 'HOME': str(tmp_path)}, timeout=10)
    assert result.returncode == 2 and not result.stderr
    assert json.loads(result.stdout)['hookSpecificOutput']['permissionDecisionReason'] == (
        "Blocked: this command couldn't be checked safely. Rewrite it as a plain, literal command.")


@pytest.mark.parametrize('tool', ['Bash', 'Monitor'])
@pytest.mark.parametrize('tree', ['human-confirm-gate/hooks', '_shared'])
@pytest.mark.parametrize('command', ['echo fake > {target}', 'rm {target}', 'ln -s source {target}'])
@pytest.mark.parametrize('symlink', [False, True])
def test_pinned_gate_write_names_the_rule(tmp_path, tool, tree, command, symlink):
    directory = HOOK.parents[2] / tree
    if symlink:
        alias = tmp_path / 'gate-alias'
        alias.symlink_to(directory, target_is_directory=True)
        directory = alias
    # These strings are inspected, never executed against the real gate tree.
    import shlex
    command = command.format(target=shlex.quote(str(directory / 'fixture.py')))
    result = subprocess.run([sys.executable, '-I', '-B', str(HOOK)],
        input=json.dumps(dict(tool_name=tool, cwd=str(tmp_path), tool_input=dict(command=command))),
        text=True, capture_output=True, env={**os.environ, 'HOME': str(tmp_path)}, timeout=10)
    assert result.returncode == 2 and not result.stderr
    output = json.loads(result.stdout)['hookSpecificOutput']
    assert output['permissionDecision'] == 'deny'
    assert output['permissionDecisionReason'] == (
        "Blocked: agents never change the approval trust anchor or the installed approval gate's files. Ask the lead.")
