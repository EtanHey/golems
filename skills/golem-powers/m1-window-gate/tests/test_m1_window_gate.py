"""Real entrypoint fixtures; no remote command is executed."""
import ast
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
# During an OPEN window only work naming the install's leased paths (or a golems installer) is blocked.
LEASED_SSH = 'ssh m1 touch ~/.claude/skills/x'
# Another account's home (the M1's `/Users/<name>`). Joined at runtime: the name is synthetic, and the
# publish-boundary scan rejects any literal macOS home path in public files.
OTHER_HOME = os.path.join('/Users', 'fixture-user')
DISPATCH_REASON = ("Blocked: a golems install is running on the M1 and owns ~/.claude/skills. "
                   "Wait for it to finish, or work outside the install's paths.")


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


def call(cell, command=LEASED_SSH, ti=None, name='Bash', codex=False, hook=HOOK, mode=None, cwd=ROOT):
    argv = ([str(ROOT / 'scripts/hooks/codex-policy-hook.py'), 'm1-window-gate'] if codex
            else [str(ROOT / 'scripts/hooks/fail-open.py'), str(hook)])
    if mode:
        argv += ['--mode', mode]
    payload = dict(tool_name=name, tool_input=ti if ti is not None else dict(command=command))
    if cwd is not None:
        payload['cwd'] = str(cwd)
    p = subprocess.run([sys.executable, '-I', '-B', *argv], input=json.dumps(payload),
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
    # Same host-binding shapes as before; an OPEN window now blocks only work naming a leased path.
    denied, value = call(cell, command + ' # ~/.claude/skills')
    assert denied and value['hookSpecificOutput']['permissionDecisionReason'] == DISPATCH_REASON
    assert not call(cell, command)[0]


@pytest.mark.parametrize('command', ['ssh fixture-other true', 'ssh -- fixture-other m1', 'echo "ssh m1 true"',
    "printf '%s' 'scp file m1:/dest'", 'ssh -i m1 fixture-other true',
    'ssh fixture-other "ssh m1 true"', 'rsync --exclude m1:/data local dest'])
def test_unrelated_allows(cell, command):
    assert not call(cell, command)[0]
    assert not call(cell, command + ' # ~/.claude/skills')[0]


@pytest.mark.parametrize('prefix', ['mcp__t3-code__', 'mcp__t3_code__'])
@pytest.mark.parametrize('tool', ['delegate_task', 't3_thread_send', 't3_thread_launch', 'create_threads',
    'schedule_task', 'run_scheduled_task_now', 't3_thread_send_attachments', 't3_thread_configure'])
def test_mcp(cell, tool, prefix):
    name = prefix + tool
    leased = 'edit ~/.claude/skills/x/SKILL.md'
    assert call(cell, name=name, ti={'target': {'environmentId': 'fixture-env'}, 'task': leased})[0]
    assert not call(cell, name=name, ti={'target': {'environmentId': 'fixture-env'}, 'task': 'fix the repo'})[0]
    assert not call(cell, name=name, ti={'environmentId': 'fixture-other-env', 'task': leased})[0]
    assert not call(cell, name=name, ti={'environmentId': 'fixture-env', 'task': leased + ' ' + STEM})[0]


@pytest.mark.parametrize('token', [STEM, 'lane=' + LANE, 'M1-LANE:' + LANE])
def test_authorized(cell, token):
    assert not call(cell, LEASED_SSH + ' # ' + token)[0]


@pytest.mark.parametrize('row', [f'EVENT | older-time | SETTLED | lane={LANE}\n',
    f'EVENT | older-time | RESUMED | lane={LANE}\n'])
def test_latest_lane_must_be_started(cell, row):
    cell[2].write_text(OPEN + row)
    assert call(cell, LEASED_SSH + ' # lane=' + LANE)[0]


@pytest.mark.parametrize('token', [LANE + '-other', 'other-' + LANE, STEM + '-other'])
def test_token_boundaries(cell, token):
    assert call(cell, LEASED_SSH + ' # ' + token)[0]


def test_closed_and_no_config(cell):
    cell[2].write_text(OPEN + CLOSED)
    assert call(cell)[1] == {}  # silent: no advisory when every window is CLOSED
    assert not call(cell, LEASED_SSH + ' # lane=fixture')[1]
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
    assert call(cell, LEASED_SSH + ' # lane=fixture-other')[0]
    cell[2].write_text(OPEN + CLOSED + OPEN)
    assert call(cell)[0]


@pytest.mark.parametrize('codex', [False, True])
def test_transport(cell, codex):
    assert call(cell, codex=codex)[0]
    assert not call(cell, LEASED_SSH + ' # ' + STEM, codex=codex)[0]
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
    for folder in ['Gits/x', '.claude/skills/foo', '.golems/current', '.codex', '.config/brainlayer']:
        (cell[0] / folder).mkdir(parents=True, exist_ok=True)
    return cell


SEAT_REASON = ("Blocked: a golems install is running on this Mac and owns ~/.claude/skills. "
               "Wait for it to finish, or work outside the install's paths.")
LEASED_BASH = 'touch ~/.claude/skills/x'


@pytest.mark.parametrize('command', ['bun test', 'npm run build', 'brew install fixture-package',
    'launchctl kickstart fixture-service', 'ls; npm run build', 'echo ok > output',
    'find . -delete', r'find . -exec touch output \;', 'find . -fprint output',
    'rg --pre=touch pattern', 'git diff --output=output', 'git log --output output',
    'git diff --ext-diff', 'git -c alias.status=anything status', 'du .',
    'date 010100002030', 'env X=y ls', 'bash -c "ls"', 'echo "$(touch output)"',
    'echo `touch output`', 'cat <(touch output)', './ls'])
def test_seat_mutation_outside_lease_allows(seat, command):
    # These were whole-machine denials; none names or runs inside a leased path.
    assert not call(seat, command, mode='seat', cwd=seat[0] / 'Gits/x')[0]


@pytest.mark.parametrize('command', ['ls', '/bin/ls -l', 'git status', 'git log -1',
    'git diff', 'git show HEAD', 'git rev-parse HEAD', 'ps', 'pgrep fixture',
    'cat file | head -2; tail file && wc file', 'stat file', 'uptime', 'df -h',
    'du -s .', 'grep pattern file', 'rg pattern .', 'find . -type f',
    'echo "npm run build > output"', 'date -u +%Y', 'pwd', 'whoami'])
def test_seat_read_only(seat, command):
    assert not call(seat, command, mode='seat')[0]


@pytest.mark.parametrize('name', ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
def test_seat_writes(seat, name):
    key = 'notebook_path' if name == 'NotebookEdit' else 'file_path'
    leased = str(seat[0] / '.claude/skills/x/SKILL.md')
    denied, value = call(seat, name=name, ti={key: leased}, mode='seat')
    assert denied and value['hookSpecificOutput']['permissionDecisionReason'] == SEAT_REASON
    assert not call(seat, name=name, ti={key: leased, 'description': STEM}, mode='seat')[0]
    assert not call(seat, name=name, ti={key: 'fixture'}, mode='seat')[0]  # was denied: not leased


@pytest.mark.parametrize('token', [STEM, 'lane=' + LANE, 'M1-LANE:' + LANE])
def test_seat_own_lane(seat, token):
    assert not call(seat, LEASED_BASH + ' # ' + token, mode='seat')[0]
    assert call(seat, LEASED_BASH + ' # ' + token + '-other', mode='seat')[0]


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
    # An untrusted lock still triggers the gate; its stem grants no exemption.
    assert call(cell, LEASED_BASH + ' # ' + STEM, mode='seat')[0]
    assert not call(cell, 'ls', mode='seat')[0]
    assert not call(cell, 'bun test', mode='seat')[0]


@pytest.mark.parametrize('codex', [False, True])
def test_seat_transport_and_no_lock(cell, codex):
    leased = 'touch ~/.claude/skills/x'
    assert not call(cell, leased, codex=codex, mode='seat')[0]
    lock = cell[0] / '.golems/m1-procedure.lock'
    lock.mkdir()
    (lock / 'owner.json').write_text(json.dumps(dict(stem=STEM, uid=os.getuid())))
    assert call(cell, leased, codex=codex, mode='seat')[0]
    assert not call(cell, 'bun test', codex=codex, mode='seat')[0]
    assert not call(cell, 'ls', codex=codex, mode='seat')[0]
    assert not call(cell, leased + ' # ' + LANE, codex=codex, mode='seat')[0]


@pytest.mark.parametrize('prefix', ['mcp__t3-code__', 'mcp__t3_code__'])
@pytest.mark.parametrize('mode', [None, 'auto', 'queue', 'steer'])
def test_message_to_m1_lead_is_allowed_during_window(cell, prefix, mode):
    # orc and leads can still talk to an M1 lead (a top-level thread) mid-run.
    ti = {'environmentId': 'fixture-env', 'threadId': 'f51dafcd-5547-4317-8f8e-9fa754600af4', 'message': 'hi'}
    if mode:
        ti['mode'] = mode
    assert not call(cell, name=prefix + 't3_thread_send', ti=ti)[0]


@pytest.mark.parametrize('ti', [
    {'environmentId': 'fixture-env', 'threadId': 'thread:delegated-task:command%3Ax', 'message': 'go'},
    {'environmentId': 'fixture-env', 'threadId': 'thread:provider:codex:native-thread:01a116c8-d7e1-7011-ace4-c33ebadffed7', 'message': 'go'},
    {'environmentId': 'fixture-env', 'threadId': 'thread:provider:claudeAgent:native-thread:x', 'message': 'go'},
    {'environmentId': 'fixture-env', 'threadId': 'thread:project:mcp%3Ap:d2b16d65-96db-48f2-bcd7-e80c14aba21b', 'message': 'go'},
    {'environmentId': 'fixture-env', 'threadId': 'not-a-thread-shape', 'message': 'go'},
    {'environmentId': 'fixture-env', 'threadId': 'mcp:lead-thread', 'message': 'go', 'mode': 'restart'},
    {'environmentId': 'fixture-env', 'message': 'no thread id'},
    {'environmentId': 'fixture-env', 'threadId': '', 'message': 'empty thread id'}])
def test_work_starting_sends_need_a_leased_path(cell, ti):
    # A send to a child starts a task: allowed during a window unless it names a leased path.
    assert not call(cell, name='mcp__t3-code__t3_thread_send', ti=ti)[0]
    assert call(cell, name='mcp__t3-code__t3_thread_send', ti={**ti, 'message': 'rm -rf ~/.agents/skills/x'})[0]


@pytest.mark.parametrize('label', ['run2', 'run3'])
def test_seat_own_lane_any_run_label(seat, label):
    lane = LANE.replace('-run1-', '-' + label + '-')
    assert not call(seat, LEASED_BASH + ' # lane=' + lane, mode='seat')[0]
    assert call(seat, LEASED_BASH + ' # lane=' + lane + '-other', mode='seat')[0]
    assert call(seat, LEASED_BASH + ' # lane=' + lane.replace(STEM.rsplit('-', 1)[-1], '20990101T000000000000'), mode='seat')[0]


@pytest.mark.parametrize('label', ['run2.4', 'run_2', 'run-2', 'run:2'])
def test_lane_label_grammar_matches_across_modes(cell, seat, label):
    # Seat and dispatch accept the same labels; the stem's timestamp is what must match.
    lane = LANE.replace('-run1-', '-' + label + '-')
    assert not call(seat, LEASED_BASH + ' # lane=' + lane, mode='seat')[0]
    cell[2].write_text(f'EVENT | opened-at | STARTED | lane={lane}\nEVENT | opened-at | WINDOW | OPEN | stem={STEM}\n')
    assert not call(cell, LEASED_SSH + ' # lane=' + lane)[0]


@pytest.mark.parametrize('thread', ['mcp:2d70c7ac-5124-4b11-a863-fa3c5b6327ed',
    'mcp:launch:1cc19ea61442c8d53977d98ca0c03ac13bc3742c08a90712a0ad3056f1c8ce56',
    'import:claudeAgent:697CED41-A173-4DF4-B9C7-C8EFFFD9D581', '5de712f0-a1fa-4985-87ca-bdcd7dc23db7'])
def test_lead_thread_shapes_pass(cell, thread):
    assert not call(cell, name='mcp__t3-code__t3_thread_send',
                    ti={'environmentId': 'fixture-env', 'threadId': thread, 'message': 'hi'})[0]


def test_leased_list_is_pinned():
    # Mirrors the M1 procedure's FIXED lease list plus the `.golems/releases` superset; change both together.
    tree = ast.parse(HOOK.read_text())
    leased = next(ast.literal_eval(n.value) for n in tree.body if isinstance(n, ast.Assign)
                  and [t.id for t in n.targets if isinstance(t, ast.Name)] == ['LEASED'])
    assert leased == ('.claude/skills', '.agents/skills', '.codex/skills', '.cursor/skills',
        '.gemini/config/skills', '.golems/bin', '.golems/vendor', '.golems/current', '.golems/release.json',
        '.golems/release-history', '.golems/releases', '.claude/hooks', '.claude/settings.json',
        '.codex/hooks.json', '.local/state/golems/install-receipts/golems',
        '.golems/ratchet/installed-skills.json', '.golems/ratchet/requirements.json')


@pytest.mark.parametrize('command,where', [('brew upgrade', 'Gits/x'), ('brew upgrade', ''),
    ('git pull', 'Gits/x'), ('cd ~ && brew upgrade', 'Gits/x'), ('touch ~/.claude/CLAUDE.md', 'Gits/x'),
    ('echo x > ~/.config/brainlayer/x', 'Gits/x'), ('git commit -m "docs: fix"', 'Gits/x'),
    ('bun test scripts/tests/install-hooks.test.mjs', 'Gits/x'), ('touch x', '.claude')])
def test_seat_lock_allows_outside_lease(seat, command, where):
    assert not call(seat, command, mode='seat', cwd=seat[0] / where)[0]


@pytest.mark.parametrize('path', ['Gits/x/file', '.config/brainlayer/x', '.codex/config.toml'])
@pytest.mark.parametrize('name', ['Write', 'Edit'])
def test_seat_lock_allows_writes_outside_lease(seat, name, path):
    assert not call(seat, name=name, ti={'file_path': str(seat[0] / path)}, mode='seat')[0]
    assert not call(seat, name=name, ti={'file_path': '~/' + path}, mode='seat')[0]


def test_seat_lock_denies_leased_writes(seat):
    home = seat[0]
    (home / 'Gits/link').symlink_to(home / '.golems/current')
    (home / '.golems/releases/v1').mkdir(parents=True)
    (home / 'Gits/release').symlink_to(home / '.golems/releases/v1')
    (home / 'Gits/dangling').symlink_to(home / '.claude/hooks/new.py')  # a write would create the target
    (home / 'Gits/src').mkdir()
    (home / '.cursor').mkdir()
    (home / '.cursor/skills').symlink_to(home / 'Gits/src')  # a leased symlink owns its target
    for ti, cwd in [({'file_path': '~/.claude/skills/x/SKILL.md'}, ROOT),
                    ({'file_path': str(home / 'Gits/link/x')}, ROOT),  # symlinked parent into .golems/current
                    ({'file_path': str(home / 'Gits/release/x')}, ROOT),  # any release directory
                    ({'file_path': 'settings.json'}, home / '.claude'),
                    ({'file_path': '../hooks/x.py'}, home / '.claude/skills'),
                    ({'file_path': str(home / 'Gits/dangling')}, ROOT),
                    ({'file_path': str(home / 'Gits/src/x')}, ROOT)]:
        denied, value = call(seat, name='Edit', ti=ti, mode='seat', cwd=cwd)
        assert denied and 'owns ~/.' in value['hookSpecificOutput']['permissionDecisionReason'], ti


@pytest.mark.parametrize('ti,cwd', [({'file_path': '~fixture-no-such-user/x'}, ROOT), ({'file_path': ''}, ROOT),
    ({}, ROOT), ({'file_path': 7}, ROOT), ({'file_path': 'relative'}, None), ({'file_path': 'a\u0000b'}, ROOT)])
def test_seat_lock_denies_unresolvable_paths(seat, ti, cwd):
    denied, value = call(seat, name='Write', ti=ti, mode='seat', cwd=cwd)
    assert denied and "can't be checked" in value['hookSpecificOutput']['permissionDecisionReason']


@pytest.mark.parametrize('command,where', [('rm -rf ~/.agents/skills/foo', 'Gits/x'),
    ('cd ~/.golems && touch x', 'Gits/x'), ('touch "$HOME/.claude/skills/x"', 'Gits/x'),
    ('touch ${HOME}/.codex/skills/x', 'Gits/x'), ('cp a ' + OTHER_HOME + '/.claude/settings.json', 'Gits/x'),
    ('touch .claude/skills/x', ''), ('touch skills/x', '.claude'), ('touch x', '.claude/skills/foo'),
    ('bash -c "rm -rf ~/.claude/hooks"', 'Gits/x'), ('echo x > ~/.codex/hooks.json', 'Gits/x'),
    ('rm -rf ~/.claude', 'Gits/x'), ('rm ~/.claude/sk*', 'Gits/x'), ('touch ~/.local/state/golems/install-receipts/golems/r', 'Gits/x'),
    ("python3 - <<'PY'\nopen(__import__('os').path.expanduser('~/.golems/bin/x'), 'w')\nPY", 'Gits/x'),
    ('echo "$(rm ~/.golems/vendor/x)"', 'Gits/x'), ('rm -rf "$X"/y', ''), ('sort -o~/.claude/skills/x in', 'Gits/x'),
    ('rm ${HOME}/.claude/sk*', 'Gits/x'), ('rm -rf ${HOME}/.claude/{skills,hooks}', 'Gits/x'), ('rm $HOME/.golems/b*', 'Gits/x'),
    ('cd .claude && cd hooks && touch x', '')])
def test_seat_lock_denies_leased_bash(seat, command, where):
    denied, value = call(seat, command, mode='seat', cwd=seat[0] / where)
    assert denied and 'owns ~/.' in value['hookSpecificOutput']['permissionDecisionReason'], command


@pytest.mark.parametrize('command', ['bash scripts/release/install.sh', './scripts/release/install.sh --yes',
    'scripts/hooks/install-hooks.sh --host m1 --apply', 'node scripts/hooks/install-hooks.mjs --status',
    'bash skills/golem-powers/golem-install/scripts/wizard-preflight.sh', 'golems update',
    'golems-cli skills install --all', '~/.bun/bin/golems skills update', 'golems wizard',
    'bun packages/golem-skills/src/index.ts skills install pr-loop'])
def test_seat_lock_denies_installers(seat, command):
    denied, value = call(seat, command, mode='seat', cwd=seat[0] / 'Gits/x')
    assert denied and 'already running' in value['hookSpecificOutput']['permissionDecisionReason'], command


@pytest.mark.parametrize('command', ['echo "unterminated', 'touch x'])
def test_seat_lock_denies_uncheckable_bash(seat, command):
    cwd = None if command == 'touch x' else seat[0] / 'Gits/x'
    denied, value = call(seat, command, mode='seat', cwd=cwd)
    assert denied and "can't be checked" in value['hookSpecificOutput']['permissionDecisionReason']


@pytest.mark.parametrize('ti', [{'environmentId': 'fixture-env', 'task': 'update the brainlayer docs'},
    {'target': {'environmentId': 'fixture-env'}, 'prompt': 'run brew upgrade'}])
def test_dispatch_open_window_allows_unleased_work(cell, ti):
    assert not call(cell, name='mcp__t3-code__delegate_task', ti=ti)[0]


@pytest.mark.parametrize('task', ['edit ~/.claude/skills/x/SKILL.md', 'rm -rf $HOME/.golems/current',
    'touch ' + OTHER_HOME + '/.claude/settings.json', 'cd ~ && touch .codex/hooks.json',
    'clean ~/.golems/', 'run scripts/release/install.sh', 'run golems update'])
def test_dispatch_open_window_denies_leased_work(cell, task):
    assert call(cell, name='mcp__t3-code__delegate_task', ti={'environmentId': 'fixture-env', 'task': task})[0]
    cell[2].write_text(OPEN + CLOSED)
    assert not call(cell, name='mcp__t3-code__delegate_task', ti={'environmentId': 'fixture-env', 'task': task})[0]


@pytest.mark.parametrize('command', ['ssh m1 "rm -rf .claude/skills/x"', 'rsync -a src/ m1:.agents/skills/',
    'scp file m1:~/.claude/hooks/x', 'ssh m1 bash scripts/release/install.sh', 'ssh m1 "rm -rf ~/.claude"',
    'ssh m1 "rm -rf .golems"'])
def test_dispatch_open_window_denies_leased_ssh(cell, command):
    assert call(cell, command)[0]


def test_lead_message_naming_lease_is_still_allowed(cell):
    # Unchanged: a message to an M1 lead passes; the lead's own seat gate guards the paths.
    assert not call(cell, name='mcp__t3-code__t3_thread_send', ti={'environmentId': 'fixture-env',
        'threadId': 'f51dafcd-5547-4317-8f8e-9fa754600af4', 'message': 'rm -rf ~/.claude/skills'})[0]
