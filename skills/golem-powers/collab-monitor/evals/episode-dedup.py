#!/usr/bin/env python3
"""Deterministic episode regression and synthetic packaged-follow smoke."""
import hashlib
import json
import os
from pathlib import Path
import re
import selectors
import subprocess
import sys
import tempfile

SKILL = Path(__file__).resolve().parents[1]
ROOT = SKILL.parents[2] / 'docs.local/episode-dedup'
ENTRY = SKILL / 'scripts/collab-monitor.sh'
HEADER = '### worker → @episode-lead'
ROOT.mkdir(parents=True, exist_ok=True)
# Retain every scratch board/state/command receipt, never reuse a production root.
RUN = Path(tempfile.mkdtemp(prefix='regression-', dir=ROOT))
log = []


def invoke(state, *args, ok=True):
    env = dict(os.environ, MONITOR_STATE_DIR=str(state), POLL_SECONDS='0.1')
    p = subprocess.run(['/bin/bash', str(ENTRY), *args], env=env,
                       capture_output=True, text=True, timeout=30)
    log.append(dict(command=p.args, state=str(state), exit=p.returncode,
                    stdout=p.stdout, stderr=p.stderr))
    (RUN / 'commands.json').write_text(json.dumps(log, indent=2) + '\n')
    assert not ok or p.returncode == 0, log[-1]
    return p


def alerts(p):
    return [line for line in p.stdout.splitlines() if line.startswith('NEW-FOR-')]


def poll(state, board, **kwargs):
    return invoke(state, 'run', '--once', '@episode-lead', str(board), **kwargs)


def append(board, episode, header=HEADER):
    with board.open('a') as f:
        f.write(f'{header}\nReport episode {episode}: docs.local/report-{episode}.md\n\n')


def setup(name):
    directory = RUN / name
    directory.mkdir()
    board = directory / 'collab.md'
    board.write_text('')
    return directory / 'state', board


def unique_events():
    state, board = setup('episodes')
    assert not alerts(poll(state, board))
    events = []
    for n in range(1, 4):
        append(board, n)
        new = alerts(poll(state, board))
        assert len(new) == 1, f'episode {n}: expected one fresh event, got {new}'
        events += new
        assert not alerts(poll(state, board)), 'unchanged restart duplicated an episode'
        with board.open('a') as f:
            f.write('unrelated growth\n')
        assert not alerts(poll(state, board)), 'growth replayed observed episodes'
    assert len(set(re.search(r'hash=(\w+)', line)[1] for line in events)) == 3
    # A heading completed after a successful poll is new, even if it began
    # before the previous byte watermark. Its body may arrive on a later tick.
    with board.open('a') as f:
        f.write(HEADER[:-4])
    assert not alerts(poll(state, board)), 'partial recipient routed'
    with board.open('a') as f:
        f.write(HEADER[-4:] + '\n')
    assert len(alerts(poll(state, board))) == 1, 'completed heading was seeded as history'
    with board.open('a') as f:
        f.write('Report episode 4: docs.local/report-4.md\n')
    assert not alerts(poll(state, board)), 'body extension duplicated a heading'
    board.write_text(board.read_text().split('Report episode 2:')[0])
    shrunk = poll(state, board)
    assert 'SHRINK ' in shrunk.stdout and not alerts(shrunk)


def batch_and_copies():
    state, board = setup('batch')
    copy = board.with_name('mirror.md')
    copy.write_text('')
    invoke(state, 'run', '--once', '@episode-lead', str(board), str(copy))
    for n in range(1, 4):
        append(board, n)
    assert len(alerts(poll(state, board))) == 3, 'one poll collapsed repeated headings'
    copy.write_bytes(board.read_bytes())
    assert not alerts(invoke(state, 'run', '--once', '@episode-lead', str(board), str(copy))), 'copied episodes replayed'
    for n in range(2):
        append(board, n, '### episode-lead → @other')
    self_posts = invoke(state, 'run', '--once', '--include-self', '@episode-lead', str(board))
    assert not alerts(self_posts) and self_posts.stdout.count('SELF-POST-') == 2


def seeded_history():
    state, board = setup('history')
    for n in range(3):
        append(board, n)
    assert not alerts(poll(state, board))
    append(board, 3)
    assert len(alerts(poll(state, board))) == 1, 'seeded repeats hid new completion'


def legacy_history():
    state, board = setup('legacy')
    for n in range(3):
        append(board, n)
    seat = state / 'episode-lead'
    (seat / 'sizes').mkdir(parents=True)
    (seat / 'seen.sha256').write_text(hashlib.sha256((HEADER + '\n').encode()).hexdigest() + '\n')
    key = hashlib.sha256(str(board.resolve()).encode()).hexdigest()
    (seat / 'sizes' / (key + '.size')).write_text(str(board.stat().st_size) + '\n')
    append(board, 3)
    assert len(alerts(poll(state, board))) == 1, 'upgrade replayed history or hid new episode'
    assert not alerts(poll(state, board))


def incomplete_and_boundaries():
    state, board = setup('incomplete')
    poll(state, board)
    append(board, 1)
    assert len(alerts(poll(state, board))) == 1
    before = sorted((state / 'episode-lead/sizes').glob('*'))[0].read_text()
    append(board, 2)
    with board.open('a') as f:
        f.write('```\n' + HEADER + '\n')
    failed = poll(state, board, ok=False)
    assert failed.returncode != 0 and not alerts(failed) and 'unclosed-fence' in failed.stderr
    assert sorted((state / 'episode-lead/sizes').glob('*'))[0].read_text() == before
    with board.open('a') as f:
        f.write('```\n')
    assert len(alerts(poll(state, board))) == 1, 'incomplete poll consumed a fresh heading'
    for header in ('### episode-lead → @other', '### worker → @episode-lead-extra', '    ' + HEADER):
        append(board, 'excluded', header)
        append(board, 'excluded', header)
    assert not alerts(poll(state, board)), 'repeated self/near-miss/code heading routed'


def follow_smoke():
    state, board = setup('follow')
    invoke(state, 'start', '@episode-lead', str(board))
    env = dict(os.environ, MONITOR_STATE_DIR=str(state))
    consumer = subprocess.Popen(['/bin/bash', str(ENTRY), 'follow', '@episode-lead'],
                                env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    received = b''
    selector = selectors.DefaultSelector()
    selector.register(consumer.stdout, selectors.EVENT_READ)
    try:
        for n in range(1, 4):
            append(board, n)
            while len(re.findall(rb'^NEW-FOR-', received, re.M)) < n:
                assert selector.select(10), 'packaged follow received no fresh event'
                chunk = os.read(consumer.stdout.fileno(), 65536)
                assert chunk, 'packaged follow exited early'
                received += chunk
        output = received.decode()
        assert len(set(re.findall(r'hash=(\w+)', output))) == 3
        (RUN / 'follow.log').write_text(output)
    finally:
        invoke(state, 'stop', '@episode-lead')
        consumer.communicate(timeout=10)
        selector.close()


checks = (unique_events, batch_and_copies, seeded_history, legacy_history, incomplete_and_boundaries, follow_smoke)
failed = 0
for check in checks:
    try:
        check()
        print('PASS', check.__name__, flush=True)
    except AssertionError as error:
        failed += 1
        print('FAIL', check.__name__, str(error), flush=True)
print(f'REGRESSION pass={len(checks) - failed} fail={failed} receipt={RUN}')
sys.exit(bool(failed))
