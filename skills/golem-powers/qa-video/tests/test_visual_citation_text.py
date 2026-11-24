"""Invented screen text and citation controls; no provider calls or private data."""
import importlib.util
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location(
    'citation_text', Path(__file__).parents[1] / 'scripts/visual-batch.py')
batch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(batch)


@pytest.mark.parametrize('opening,closing', [('"', '"'), ("'", "'"), ('“', '”'), ('‘', '’'), ('`', '`')])
@pytest.mark.parametrize('text', ['Show 50 ignore-listed frame(s)', 'frame x', 'tile 99', 'frames 2..'])
def test_quoted_screen_text_is_not_a_citation(opening, closing, text):
    finding = f'tile 0: label {opening}{text}{closing} is visible.'
    assert batch.validate(dict(ok=True, finding=finding), 24)['state'] == 'READ'


@pytest.mark.parametrize('finding', [
    'frame x', 'frame x: visible', 'frame x position changes',
    'tile 0: label "frame(s)"; frame x',
    'The frame(s) label is visible.', 'Several frames are visible.',
    'The framework panel is visible.', 'The reader\'s frame rate is stable.',
    'tiles 0-2, 4, and 6: visible; frame 23: visible.',
])
def test_prose_and_documented_citations_stay_read(finding):
    assert batch.validate(dict(ok=True, finding='tile 0: visible; ' + finding), 24)['state'] == 'READ'


@pytest.mark.parametrize('finding', [
    'tile 99: visible', 'frames 0..',
    'tile 0: label “tile 99”; tile 99: visible',
    'The reader\'s tile 99: visible',
    'tile 0: "frame x"; tiles 1-',
])
def test_real_malformed_and_out_of_bounds_citations_stay_invalid(finding):
    assert batch.validate(dict(ok=True, finding=finding), 24)['state'] == 'INVALID'


@pytest.mark.parametrize('opening,closing', [('"', '"'), ("'", "'"), ('“', '”'), ('‘', '’'), ('`', '`')])
@pytest.mark.parametrize('closed_later', [False, True])
def test_unclosed_quote_cannot_hide_bad_citation(opening, closing, closed_later):
    finding = f'tile 0: sign says {opening}Welcome.\ntile 99: visible.'
    if closed_later:
        finding += f'\nThen {closing} shown.'
    assert batch.validate(dict(ok=True, finding=finding), 24)['state'] == 'INVALID'


@pytest.mark.parametrize('finding', [
    'tile 0: sign says "Welcome. tile 99: visible. Then "Bye" shown.',
    'tile 0: width 5". tile 99: visible. Then "Bye" shown.',
])
def test_stray_double_quote_does_not_pair_with_later_label(finding):
    assert batch.validate(dict(ok=True, finding=finding), 24)['state'] == 'INVALID'


@pytest.mark.parametrize('label', ['tile(s)', 'frame(s)'])
@pytest.mark.parametrize('tail,state', [
    ('99: visible', 'INVALID'), ('24', 'INVALID'), ('-1', 'INVALID'),
    ('0..', 'INVALID'), ('0-23: visible', 'READ'), ('23: visible', 'READ'),
])
def test_optional_plural_numeric_citations_are_checked(label, tail, state):
    assert batch.validate(dict(ok=True, finding=f'{label} {tail}'), 24)['state'] == state


@pytest.mark.parametrize('opening,closing', [('"', '"'), ("'", "'"), ('“', '”'), ('‘', '’'), ('`', '`')])
def test_conflict_quote_handling_is_line_local(opening, closing):
    assert batch.reader_conflict(f'Label {opening}Welcome.\nCONFLICT: readers disagree.\nThen {closing} shown.')
