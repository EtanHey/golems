"""Real entrypoint fixtures; no remote command is executed."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

import pytest

ROOT = Path(__file__).resolve().parents[4]
HOOK = ROOT / 'skills/golem-powers/m1-window-gate/hooks/m1-window-pretooluse.py'
STEM = 'a' * 40 + '-20300101T010203000000'
LANE = 'm1-golems-sync-run1-20300101T010203000000'
OPEN = f'EVENT | opened-at | STARTED | lane={LANE}\nEVENT | opened-at | WINDOW | OPEN | stem={STEM}\n'
CLOSED = f'EVENT | closed-at | WINDOW | CLOSED | stem={STEM}\n'


@pytest.fixture
def cell():
    scratch = ROOT / 'docs.local/m1-window-tests'
    scratch.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=scratch) as folder:
        home = Path(folder)
        (home / '.golems').mkdir()
        registry = home / 'lanes.md'
        registry.write_text(OPEN)
        config = home / '.golems/m1-window-gate.json'
        config.write_text(json.dumps(dict(schema=1, registry=str(registry),
            m1_ssh_targets=['m1', 'fixture-user@fixture-host'], m1_environment_ids=['fixture-env'])))
        config.chmod(0o600)
        yield home, config, registry


def call(cell, command='ssh m1 true', ti=None, name='Bash', codex=False, hook=HOOK, mode=None):
    argv = ([str(ROOT / 'scripts/hooks/codex-policy-hook.py'), 'm1-window-gate'] if codex
            else [str(ROOT / 'scripts/hooks/fail-open.py'), str(hook)])
    if mode:
        argv += ['--mode', mode]
    p = subprocess.run([sys.executable, '-I', '-B', *argv], input=json.dumps(
        dict(tool_name=name, tool_input=ti if ti is not None else dict(command=command), cwd=str(ROOT))),
        capture_output=True, text=True, env={**os.environ, 'HOME': str(cell[0])}, timeout=10)
    assert not p.stderr, p.stderr
    value = json.loads(p.stdout)
    denied = value.get('hookSpecificOutput', {}).get('permissionDecision') == 'deny'
    assert p.returncode == (0 if codex or not denied else 2)
    return denied, value


@pytest.mark.parametrize('command', ['ssh m1 true', '/usr/bin/ssh -o BatchMode=yes -i key m1 true',
    'ssh -p2222 fixture-user@fixture-host true', 'scp -P 22 -i key file fixture-user@fixture-host:/dest',
    'rsync -av -e "ssh -i key" m1:/src dest', 'sftp -o BatchMode=yes m1', 'mosh --server fixture-server m1', 'mosh --ssh "ssh -i key" m1',
    'echo ready && ssh m1 true', 'env X=y ssh m1 true', 'bash -c "ssh m1 true"', 'echo "$(ssh m1 true)"'])
def test_open_denies(cell, command):
    denied, value = call(cell, command)
    assert denied and STEM in str(value) and 'opened-at' in str(value) and 'CLOSED' in str(value)


@pytest.mark.parametrize('command', ['ssh fixture-other true', 'ssh -- fixture-other m1', 'echo "ssh m1 true"',
    "printf '%s' 'scp file m1:/dest'", 'ssh -i m1 fixture-other true',
    'ssh fixture-other "ssh m1 true"', 'rsync --exclude m1:/data local dest'])
def test_unrelated_allows(cell, command):
    assert not call(cell, command)[0]


@pytest.mark.parametrize('prefix', ['mcp__t3-code__', 'mcp__t3_code__'])
@pytest.mark.parametrize('tool', ['delegate_task', 't3_thread_send', 't3_thread_launch', 'create_threads',
    'schedule_task', 'run_scheduled_task_now', 't3_thread_send_attachments', 't3_thread_configure'])
def test_mcp(cell, tool, prefix):
    name = prefix + tool
    assert call(cell, name=name, ti={'target': {'environmentId': 'fixture-env'}})[0]
    assert not call(cell, name=name, ti={'environmentId': 'fixture-other-env'})[0]
    assert not call(cell, name=name, ti={'environmentId': 'fixture-env', 'task': STEM})[0]


@pytest.mark.parametrize('token', [STEM, 'lane=' + LANE, 'M1-LANE:' + LANE])
def test_authorized(cell, token):
    assert not call(cell, 'ssh m1 true # ' + token)[0]


@pytest.mark.parametrize('row', [f'EVENT | older-time | SETTLED | lane={LANE}\n',
    f'EVENT | older-time | RESUMED | lane={LANE}\n'])
def test_latest_lane_must_be_started(cell, row):
    cell[2].write_text(OPEN + row)
    assert call(cell, 'ssh m1 true # lane=' + LANE)[0]


@pytest.mark.parametrize('token', [LANE + '-other', 'other-' + LANE, STEM + '-other'])
def test_token_boundaries(cell, token):
    assert call(cell, 'ssh m1 true # ' + token)[0]


def test_closed_and_no_config(cell):
    cell[2].write_text(OPEN + CLOSED)
    assert call(cell)[1] == {}  # silent: no advisory when every window is CLOSED
    assert not call(cell, 'ssh m1 true # lane=fixture')[1]
    cell[1].unlink()
    assert call(cell)[1] == {}


@pytest.mark.parametrize('damage', ['missing', 'unreadable', 'directory', 'invalid-schema', 'truncated', 'json', 'mode'])
def test_bad_inputs_scoped(cell, damage):
    if damage == 'missing': cell[2].unlink()
    elif damage == 'unreadable': cell[2].chmod(0)
    elif damage == 'directory': cell[2].unlink(); cell[2].mkdir()
    elif damage == 'invalid-schema': cell[1].write_text(cell[1].read_text().replace('"schema": 1', '"schema": 2'))
    elif damage == 'json': cell[1].write_text('{ broken')
    elif damage == 'truncated': cell[1].write_text(cell[1].read_text()[:-1])
    else: cell[1].chmod(0o644)
    assert call(cell)[0]
    assert not call(cell, 'ssh fixture-other true')[0]
    assert not call(cell, 'echo hello')[0]
    if damage != 'json': assert call(cell, name='mcp__t3_code__delegate_task', ti={'environmentId': 'fixture-env'})[0]


def test_other_started_lane_and_multiple_stems(cell):
    cell[2].write_text(OPEN + 'EVENT | now | STARTED | lane=fixture-other\n'
                      + 'EVENT | now | WINDOW | CLOSED | stem=fixture-other\n')
    assert call(cell, 'ssh m1 true # lane=fixture-other')[0]
    cell[2].write_text(OPEN + CLOSED + OPEN)
    assert call(cell)[0]


@pytest.mark.parametrize('codex', [False, True])
def test_transport(cell, codex):
    assert call(cell, codex=codex)[0]
    assert not call(cell, 'ssh m1 true # ' + STEM, codex=codex)[0]
    assert not call(cell, 'ssh fixture-other true', codex=codex)[0]


def test_without_gate_baseline(cell):
    for relative in ['tmp-block/hooks/tmp-block-pretooluse.py', 'git-guardian/hooks/pre_tool_use.py',
                     'human-confirm-gate/hooks/human-confirm-pretooluse.py']:
        assert not call(cell, hook=ROOT / 'skills/golem-powers' / relative)[0]


@pytest.fixture
def seat(cell):
    lock = cell[0] / '.golems/m1-procedure.lock'
    lock.mkdir()
    (lock / 'owner.json').write_text(json.dumps(dict(stem=STEM, uid=os.getuid())))
    return cell


@pytest.mark.parametrize('command', ['bun test', 'npm run build', 'brew install fixture-package',
    'launchctl kickstart fixture-service', 'ls; npm run build', 'echo ok > output',
    'find . -delete', r'find . -exec touch output \;', 'find . -fprint output',
    'rg --pre=touch pattern', 'git diff --output=output', 'git log --output output',
    'git diff --ext-diff', 'git -c alias.status=anything status', 'du .',
    'date 010100002030', 'env X=y ls', 'bash -c "ls"', 'echo "$(touch output)"',
    'echo `touch output`', 'cat <(touch output)', './ls', 'echo "unterminated'])
def test_seat_denies(seat, command):
    denied, value = call(seat, command, mode='seat')
    assert denied and STEM in str(value)


@pytest.mark.parametrize('command', ['ls', '/bin/ls -l', 'git status', 'git log -1',
    'git diff', 'git show HEAD', 'git rev-parse HEAD', 'ps', 'pgrep fixture',
    'cat file | head -2; tail file && wc file', 'stat file', 'uptime', 'df -h',
    'du -s .', 'grep pattern file', 'rg pattern .', 'find . -type f',
    'echo "npm run build > output"', 'date -u +%Y', 'pwd', 'whoami'])
def test_seat_read_only(seat, command):
    assert not call(seat, command, mode='seat')[0]


@pytest.mark.parametrize('name', ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
def test_seat_writes(seat, name):
    assert call(seat, name=name, ti={'file_path': 'fixture'}, mode='seat')[0]
    assert not call(seat, name=name, ti={'file_path': 'fixture', 'description': STEM}, mode='seat')[0]


@pytest.mark.parametrize('token', [STEM, 'lane=' + LANE, 'M1-LANE:' + LANE])
def test_seat_own_lane(seat, token):
    assert not call(seat, 'bun test # ' + token, mode='seat')[0]
    assert call(seat, 'bun test # ' + token + '-other', mode='seat')[0]


@pytest.mark.parametrize('shape', ['symlink', 'file', 'garbage', 'missing-owner', 'owner-link', 'uid', 'stem'])
def test_seat_invalid_lock(cell, shape):
    lock = cell[0] / '.golems/m1-procedure.lock'
    if shape == 'symlink': lock.symlink_to(cell[2])
    elif shape == 'file': lock.write_text('fixture')
    else:
        lock.mkdir()
        owner = lock / 'owner.json'
        if shape == 'garbage': owner.write_text('{')
        elif shape == 'owner-link': owner.symlink_to(cell[2])
        elif shape == 'uid': owner.write_text(json.dumps(dict(stem=STEM, uid=-1)))
        elif shape == 'stem': owner.write_text(json.dumps(dict(stem='invalid', uid=os.getuid())))
    assert call(cell, 'bun test # ' + STEM, mode='seat')[0]
    assert not call(cell, 'ls', mode='seat')[0]


@pytest.mark.parametrize('codex', [False, True])
def test_seat_transport_and_no_lock(cell, codex):
    assert not call(cell, 'bun test', codex=codex, mode='seat')[0]
    lock = cell[0] / '.golems/m1-procedure.lock'
    lock.mkdir()
    (lock / 'owner.json').write_text(json.dumps(dict(stem=STEM, uid=os.getuid())))
    assert call(cell, 'bun test', codex=codex, mode='seat')[0]
    assert not call(cell, 'ls', codex=codex, mode='seat')[0]
    assert not call(cell, 'bun test # ' + LANE, codex=codex, mode='seat')[0]
