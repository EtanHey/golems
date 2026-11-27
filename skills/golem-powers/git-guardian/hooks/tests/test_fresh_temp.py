"""Real-hook regression rows: payloads are classified, never executed."""
import json
import os
from pathlib import Path
import subprocess
import sys
import pytest

ROOT = Path(__file__).resolve().parents[5]
GUARD = ROOT / 'skills/golem-powers/git-guardian/hooks/pre_tool_use.py'
TMP = ROOT / 'skills/golem-powers/tmp-block/hooks/tmp-block-pretooluse.py'


def run(command, hook=GUARD, env=None):
    env = dict(os.environ, TMPDIR=os.environ.get('TMPDIR') or '/tmp') if env is None else env
    result = subprocess.run([sys.executable, '-B', str(hook)], text=True,
        input=json.dumps({'tool_name': 'Bash', 'tool_input': {'command': command, 'cwd': str(ROOT)},
                         'session_id': 'fresh-temp-proof'}), capture_output=True, timeout=15, env=env)
    assert not result.stderr, result.stderr
    assert result.returncode in (0, 2), result.stdout
    return result.returncode, result.stdout


@pytest.mark.parametrize('creation', ['mktemp', 'mktemp -d', 'mktemp -dq',
    'mktemp -dt agent-proof', 'mktemp -p"$TMPDIR"', 'mktemp -t agent-proof', 'mktemp -d -p "$TMPDIR"',
    'mktemp -d -p "$TMPDIR" cell.XXXXXX', 'mktemp "$TMPDIR/cell.XXXXXX"'])
@pytest.mark.parametrize('action', ['rm -r "$scratch"', 'rmdir "$scratch"',
                                  'find "$scratch" -delete', 'mv "$scratch" ./docs.local/proof'])
def test_fresh_cleanup(creation, action):
    assert run(f'scratch=$({creation}); echo ready; {action}')[0] == 0


def test_quoted_assignment():
    assert run('scratch="$(mktemp -d)"; rm -r "$scratch"')[0] == 0


def test_fresh_file():
    assert run('f=$(mktemp); rm -f "$f"')[0] == 0


@pytest.mark.parametrize('target', ['$TMPDIR', '$TMPDIR/', '/tmp', '/private/tmp',
    os.path.realpath(os.environ.get('TMPDIR', '/tmp')), '/private/var/folders/ab/synthetic/T'])
def test_temp_root(target):
    assert run(f'rm -r "{target}"')[0] == 2


@pytest.mark.parametrize('command', [
    'scratch=$(mktemp -d); rm -r "$scratch/.."',
    'scratch=$(mktemp -d); rm -r "$scratch"/*',
    'scratch=$(mktemp -d); scratch=/etc; rm -r "$scratch"',
    'scratch=$(mktemp -d); scratch="$TMPDIR/other"; rm -r "$scratch"',
    "scratch='$(mktemp -d)'; rm -r \"$scratch\"",
    'mktemp() { echo /etc; }; scratch=$(mktemp -d); rm -r "$scratch"',
    'scratch=$(mktemp -d); eval \'scratch=/etc\'; rm -r "$scratch"',
    'scratch=$(mktemp -d); unset scratch; rm -r "$scratch"',
    'scratch=$(mktemp -d); export scratch="$TMPDIR/other"; rm -r "$scratch"',
    'scratch=$(mktemp -d) | cat; rm -r "$scratch"',
    'scratch=$(mktemp -d); rmdir -p "$scratch"',
    'scratch=$(mktemp -d); rm -rf "$scratch"',
    'scratch=$(mktemp -d); rm -r "$missing"',
    'TMPDIR=/etc; scratch=$(mktemp -d); rm -r "$scratch"',
    'scratch=$(mktemp -d -p /etc); rm -r "$scratch"',
    'scratch=$(mktemp -d; echo /etc); rm -r "$scratch"',
    'scratch=$(echo /etc); rm -r "$scratch"',
    'scratch=$(mktemp -d); ln -s /etc "$scratch"; rm -r "$scratch"',
])
def test_uncertain_cleanup(command):
    assert run(command)[0] == 2


def test_unresolved_hint():
    code, output = run('rm -r "$unresolved_scratch"')
    assert code == 2
    assert 'name the path literally (e.g. rm -r' in output
    assert 'or assign it from mktemp in the same command' in output


def test_literal_child_unchanged():
    assert run('rm -r "$TMPDIR/unlisted-proof"')[0] == 0


@pytest.mark.parametrize('command', ['echo durable > "$TMPDIR/unlisted-proof.md"',
    'scratch=$(mktemp -d); echo durable > "$scratch/report.md"'])
def test_writes_still_denied(command):
    assert run(command, TMP)[0] == 2


def test_temp_root_symlink(tmp_path):
    alias = tmp_path / 'temp-alias'
    alias.symlink_to(os.environ.get('TMPDIR', '/tmp'), target_is_directory=True)
    assert run(f'rm -r "{alias}"')[0] == 2


def test_mktemp_parent_symlink_out(tmp_path):
    temp_parent = tmp_path / 'temp'
    temp_parent.mkdir()
    (temp_parent / 'out').symlink_to('/etc', target_is_directory=True)
    env = dict(os.environ, TMPDIR=str(temp_parent))
    assert run('scratch=$(mktemp -d -p "$TMPDIR/out"); rm -r "$scratch"', env=env)[0] == 2


@pytest.mark.parametrize('command,denied', [
    ('scratch=$(mktemp -d); rm -r "$scratch"', False),
    ('rm -r "$TMPDIR"', True), ('rm -r "$missing_scratch"', True)])
def test_codex_transport(command, denied):
    result = subprocess.run([sys.executable, '-B', str(ROOT / 'scripts/hooks/codex-policy-hook.py'),
                             'git-guardian'], text=True, capture_output=True, timeout=15,
        env=dict(os.environ, TMPDIR=os.environ.get('TMPDIR') or '/tmp'),
        input=json.dumps({'tool_name': 'Bash', 'cwd': str(ROOT), 'tool_input': {'command': command}}))
    assert result.returncode == 0 and not result.stderr, result.stdout + result.stderr
    decision = json.loads(result.stdout).get('hookSpecificOutput', {}).get('permissionDecision')
    assert (decision == 'deny') == denied
