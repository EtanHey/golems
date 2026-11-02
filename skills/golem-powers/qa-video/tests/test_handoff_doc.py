"""Pin handoff.md's seat order: T3 is the default, cmux is terminal-only.

A T3 QA worker once asked for a cmux pane and the lead's thread id because
handoff.md was written only for cmux. These checks keep the T3 route first.
"""
from pathlib import Path

SKILL = Path(__file__).resolve().parents[1]
DOC = (SKILL/'workflows'/'handoff.md').read_text()


def headings():
    return [line[3:].strip() for line in DOC.splitlines() if line.startswith('## ')]


def section(title):
    start = DOC.index(f'## {title}\n')
    end = DOC.find('\n## ', start + 1)
    return DOC[start:] if end == -1 else DOC[start:end]


def test_t3_section_exists_and_comes_first():
    h = headings()
    assert 'T3 seats (default)' in h
    assert 'Terminal (cmux) seats only' in h
    assert h.index('T3 seats (default)') < h.index('Terminal (cmux) seats only')
    assert DOC.index('## T3 seats (default)') < DOC.index('cmuxlayer')


def test_t3_section_never_routes_to_cmux():
    t3 = section('T3 seats (default)')
    assert 'cmuxlayer' not in t3
    for phrase in ('qa-findings.md', 'collab', 'End your task', 'delegate_task', 'absolute path',
                   'thread id your brief gave you', 'Never ask for a cmux pane'):
        assert phrase in t3, phrase


def test_every_cmuxlayer_call_is_in_terminal_rows_or_section():
    terminal = section('Terminal (cmux) seats only')
    for line in DOC.splitlines():
        if 'cmuxlayer' in line and line not in terminal:
            assert line.startswith('| Terminal (cmux) |'), line


def test_agent_type_table_lists_t3_rows_first():
    rows = [l for l in section('Handoff to Different Agent Types').splitlines()
            if l.startswith('| ') and not l.startswith('| Seat') and not l.startswith('|---')]
    seats = [r.split('|')[1].strip() for r in rows]
    assert seats[:2] == ['T3 lead', 'T3 worker']
    first_terminal = seats.index('Terminal (cmux)')
    assert all(s == 'Terminal (cmux)' for s in seats[first_terminal:])
