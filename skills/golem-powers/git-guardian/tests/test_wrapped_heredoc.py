"""Synthetic commands go through the real hook; no command is executed."""
import json
import os
from pathlib import Path
import subprocess
import sys

import pytest

HOOK = Path(__file__).resolve().parents[1] / 'hooks/pre_tool_use.py'


def hook(command):
    env = {k: v for k, v in os.environ.items()
           if k not in {'CLAUDE_WORKER', 'GIT_GUARDIAN_LIB'}}
    result = subprocess.run([sys.executable, str(HOOK)], env=env, text=True,
                            input=json.dumps({'tool_name': 'Bash', 'tool_input': {'command': command}}),
                            capture_output=True)
    assert result.stderr == ''
    return result.returncode, json.loads(result.stdout)


@pytest.mark.parametrize('reader', [
    "ssh -o BatchMode=yes h '/opt/homebrew/bin/timeout 90 python3 -I -'",
    'timeout 90 python3 -', 'timeout -s TERM -k 2 90 python3 -',
    '/usr/bin/nice -n 5 nohup env MODE=x command exec python3 -',
    "ssh h 'node -'", "ssh -p 22 -i key -l user -J jump h 'python3 -'",
    "ssh -op=value -p22 h 'python3 -'", "ssh -- h 'python3 -'",
    "ssh -o BatchMode=yes h 'cat >> /path/inbox.md'",
    "ssh h 'cat > f'", "ssh h 'tee -a f'", "ssh h 'tee f'",
    *[f"ssh -{opt} value h 'python3 -'" for opt in 'opilFJELRDbcmSwBeI'],
])
@pytest.mark.parametrize('body', ['odd ` data', 'const message = `hello`;'])
def test_wrapped_quoted_heredoc_is_data(reader, body):
    assert hook(f"{reader} <<'EOF'\n{body}\nEOF\n") == (0, {})


@pytest.mark.parametrize('reader', [
    'ssh h', "ssh h 'bash -s'", "ssh h 'python3 -; bash'",
    "ssh h 'python3 - && bash'", "ssh h 'python3 - | sh'",
    "ssh h 'cat >> f; bash'", "ssh h 'cat | sh'",
    "ssh h 'python3 - $(echo x)'", "ssh h 'python3 - `echo x`'",
    "ssh -n h 'python3 -'", "ssh -W host:22 h 'python3 -'",
    "env -S 'bash -s' python3 -", "command -v python3 -",
    "ssh -O check h 'python3 -'", "ssh -Q cipher h 'python3 -'",
    "ssh -o RemoteCommand=bash h 'python3 -'", "ssh -unknown h 'python3 -'",
    "ssh h 'python3 -\nbash'", "ssh h 'tee f; bash'",
])
def test_uncertain_reader_keeps_destructive_body(reader):
    assert hook(f"{reader} <<'EOF'\ngit push --force origin main\nEOF\n")[0] == 2


@pytest.mark.parametrize('remote', [
    'python3 -#x; bash', 'python3 -#x && sh', 'cat >> a#b; bash',
])
def test_midword_hash_cannot_hide_remote_shell_reader(remote):
    command = f"ssh h '{remote}' <<'EOF'\ngit push --force origin main\nEOF\n"
    assert hook(command)[0] == 2


@pytest.mark.parametrize('reader', ["ssh h 'python3 -'", "ssh h 'cat >> f'"])
def test_piped_output_and_unquoted_expansions_still_block(reader):
    assert hook(f"{reader} <<'EOF' | sh\ngit push --force origin main\nEOF\n")[0] == 2
    assert hook(f"{reader} <<EOF\n$(git push --force origin main)\nEOF\n")[0] == 2


def test_parse_failure_is_honest_and_destructive_label_is_preserved():
    code, denial = hook('echo `unterminated')
    assert code == 2 and "couldn't parse this command" in denial['reason']
    assert 'can destroy work' not in denial['reason']
    assert 'force-push' in hook('git push --force origin main')[1]['reason']
