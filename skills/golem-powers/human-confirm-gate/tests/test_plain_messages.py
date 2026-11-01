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
    assert reason == (f"Blocked: {action} can't be undone, so Etan has to approve it. Ask the lead to route it to him."
                      if action else "Blocked: this command couldn't be checked safely. Rewrite it as a plain, literal command.")
