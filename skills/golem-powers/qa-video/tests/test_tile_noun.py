"""Bare tile-noun recovery only; T syntax is held to an executed base oracle.

All texts are synthetic reviewer repros. No provider calls or private data.
The base script is read at the PR's pinned origin/master SHA, not a hand-coded
T verdict table. QA_VIDEO_TEST_BASE=1 replays candidate checks on that base.
"""
import json
import os
from pathlib import Path
import subprocess
import sys

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/visual-batch.py'
BASE_SHA = 'f25ed72f9a504e30f275607d64b65c6807fd5468'
BASE_PATH = 'skills/golem-powers/qa-video/scripts/visual-batch.py'


@pytest.fixture(scope='session')
def base_script(tmp_path_factory):
    directory = tmp_path_factory.mktemp('tile-noun-base')
    source = subprocess.check_output(['git', 'show', BASE_SHA + ':' + BASE_PATH], cwd=SCRIPT.parents[4])
    target = directory / SCRIPT.name
    target.write_bytes(source)
    # Only the parser script differs. Borrow unchanged helper dependencies;
    # never rewrite the base script or fall back when its commit is missing.
    for dependency in SCRIPT.parent.glob('*.py'):
        if dependency.name != SCRIPT.name:
            (directory / dependency.name).symlink_to(dependency)
    return target


@pytest.fixture(scope='session')
def candidate_script(base_script):
    return base_script if os.environ.get('QA_VIDEO_TEST_BASE') == '1' else SCRIPT


def cli(script, work, finding, tile_count=20):
    work.mkdir(parents=True)
    image = work / 'sheet.png'
    image.write_bytes(b'offline synthetic image')
    (work / 'frames.tsv').write_text(''.join(
        f'sheet.png\t{i}\t{2+i/10:.3f}\tframe-{i}.jpg\t{2+i/10:.3f}\tdense\tsheet.png\tsha\t\t\n'
        for i in range(tile_count)))
    helper = work / 'helper.py'
    helper.write_text("print('Coverage: 1/1; complete;')\nprint(" + repr(finding) + ")\n")
    result = subprocess.run([
        sys.executable, str(script), '--helper', str(helper),
        '--workdir', str(work), '--question', 'facts', str(image),
    ], capture_output=True, text=True, timeout=10)
    summary = json.loads(result.stdout)
    item, = summary['sheets']
    return result.returncode, item['state']


T_COMPAT_CASES = [
    ('original-unit-T1', 'T1: panel open.', 2),
    ('original-unit-T2', 'T2: panel open.', 2),
    ('original-7', 'T0: panel open. T1: panel open. T2-T19: same layout.', 20),
    ('original-8', 'tile 0 and T3: panel open.', 20),
    ('original-9', 'tile 4: the T3 Code sidebar is open.', 20),
    ('original-14', 'tile 0: label "T999" visible.', 20),
    ('original-15', 'T20: panel open.', 20),
    ('original-16', 'T-1: panel open.', 20),
    ('original-17', 'T2-T20: same layout.', 20),
    ('original-18', 'T19-T2: same layout.', 20),
    ('original-19', 'T0.5: panel open.', 20),
    ('original-20', 'T0-: panel open.', 20),
    ('original-21', 'tile 0 and T25: panel open.', 20),
    ('r1-A-colon-T-verb', 'tile: T25 shows the panel.', 20),
    ('r1-A-paren-T-verb', 'tiles (T25 shows the panel).', 20),
    ('r1-A-colon-lower-t', 'tile: t25 visible', 20),
    ('r1-B-T-verb', 'T20 shows the panel.', 20),
    ('r1-B-T-is', 'T25 is blank.', 20),
    ('r1-B-in-T-the', 'In T25 the sidebar is open.', 20),
    ('r1-B-T-paren', 'T20 (blank)', 20),
    ('r1-B-T-and-T-verb', 'T0 and T25 show the panel.', 20),
    ('r1-B-T-comma-T-verb', 'T0, T25 show the panel.', 20),
    ('r1-B-T-slash-T-oob', 'T0/T25: panel open.', 20),
    ('r1-B-T-multiline', 'T20\npanel open.', 20),
    ('r1-B-T-question', 'T20? panel open.', 20),
    ('r1-B-T-exclaim', 'T20! panel open.', 20),
    ('r1-B-lower-t-oob', 't25: blank', 20),
    ('r1-B-T-range-dec-end', 'T2-T20.5: panel open.', 20),
    ('r1-B-T-range-dec-start', 'T0.5-T2: panel open.', 20),
    ('r1-B-T-range-neg-end', 'T2-T-1: panel open.', 20),
    ('r1-B-T-range-neg-both', 'T-2-T-1: panel open.', 20),
    ('r1-B-T-unfinished-dot', 'T0..: panel open.', 20),
    ('r1-B-T-unfinished-to', 'T0 to: panel open.', 20),
    ('r1-C-valid-T-range-verb', 'T0-T19 show the panel.', 20),
    ('r1-C-valid-T-range-are', 'T2-T5 are identical.', 20),
    ('r1-C-valid-T-dotdot-verb', 'T0..T19 show the panel.', 20),
    ('r1-C-valid-T-to-verb', 'T2 to T5 show the panel.', 20),
    ('r1-C-valid-T-endash-verb', 'T2–T5 show the panel.', 20),
    ('r1-C-valid-T-range-paren', 'T0-T19 (same layout)', 20),
    ('r1-C-valid-T-spaced-slash', 'T0 / T1: panel open.', 20),
    ('r1-C-prose-T3-hyphen', 'tile 0: T3-Code sidebar is open.', 20),
    ('r1-C-prose-T3-period-2t', 'tile 0: sidebar is T3.', 2),
    ('r1-C-prose-T3-paren-2t', 'tile 0: app (T3) is open.', 2),
    ('r1-C-prose-T3-comma-2t', 'tile 0: T3, Claude, and Codex are open.', 2),
    ('r1-C-prose-T3-and-2t', 'tile 0: T3 and Codex are open.', 2),
    ('r1-C-prose-T3-slash-sp', 'tile 0: T3 / Codex split view.', 20),
    ('r1-E-guillemet-T-oob', 'tile 0: label «T99» visible.', 20),
    ('r1-E-guillemet-T-dot', 'tile 0: label «T99.» visible.', 20),
    ('r2-G1-tiles-colon-T3-hyphen', 'tile 0: ok. Changes between tiles: T3-Code sidebar is open.', 20),
    ('r2-G1-tiles-colon-T3-2t', 'tile 0: ok. Changes between tiles: T3 Code sidebar is open.', 2),
    ('r2-G1-tiles-paren-T3-hyphen', 'tile 0: ok. In all tiles (T3-Code is open).', 20),
    ('r2-G1-tiles-paren-T3-2t', 'tile 0: ok. In all tiles (T3 Code is open).', 2),
    ('r2-G1-T3-dash-1-err', 'tile 0: T3 - 1 error shown.', 20),
    ('r2-G1-T3-endash-2-tabs', 'tile 0: T3 – 2 tabs open.', 20),
    ('r2-G1-T3-dash-date', 'tile 0: T3 - 2026-11-27.', 20),
    ('r2-G1-T3-to-100pct', 'tile 0: set T3 to 100% width.', 20),
    ('r2-G1-T3-to-2col', 'tile 0: T3 to 2-column layout.', 20),
    ('r2-G1-T3-to-0.5x', 'tile 0: T3 to 0.5x zoom.', 20),
    ('r2-G1-T3-to-25pct', 'tile 0: T3 to 25% opacity.', 20),
    ('r2-G1-T3-to-2x', 'tile 0: set T3 to 2x.', 20),
    ('r2-G1-T3-start-hyphen', 'T3-Code is open.', 2),
    ('r2-G1-T3-start-space', 'T3 Code is open.', 2),
    ('r2-G1-T3-colon-2t', 'T3: panel open.', 2),
    ('r2-G1-tile-T3-2t', 'tile T3: panel open.', 2),
    ('r2-G1-T3-colon-T3-Code', 'tile: (25) visible in T3-Code.', 20),
    ('r2-G1-tile25-paren-T3', 'tile 25: app (T3) open.', 2),
    ('r2-G2-T3-comma-T0-2t', 'T3, T0: panel open.', 2),
    ('r2-G2-T3-and-T0-2t', 'T3 and T0: panel open.', 2),
    ('r2-G2-T3-slash-T0-2t', 'T3/T0: panel open.', 2),
    ('r2-G2-T3-spslash-T0-2t', 'T3 / T0: panel open.', 2),
    ('r2-G2-T3-semi-T0-2t', 'T3; T0: panel open.', 2),
    ('r2-G2-T3-T1-T2-3t', 'T3, T1, T2: panel open.', 3),
    ('r2-G2-T3-slash-T0-T1-3t', 'T3/T0/T1: panel open.', 3),
    ('r2-G2-T3-dangling-dash', 'T3-: panel open.', 20),
    ('r2-G2-T3-dangling-dotdot', 'T3..: panel open.', 20),
    ('r2-G2-T3-dangling-to', 'T3 to: panel open.', 20),
    ('r2-G2-ctrl-T0-comma-T3-2t', 'T0, T3: panel open.', 2),
    ('r2-G2-ctrl-T0-slash-T3-2t', 'T0/T3: panel open.', 2),
    ('r2-G3-slash-period', 'T0/T25. panel open.', 20),
    ('r2-G3-slash-comma', 'T0/T25, panel open.', 20),
    ('r2-G3-slash-semi', 'T0/T25; panel open.', 20),
    ('r2-G3-in-slash-comma', 'In T0/T25, panel open.', 20),
    ('r2-G3-paren-slash-colon', '(T0/T25): panel open.', 20),
    ('r2-G3-paren-slash-end', 'Panel open (T0/T25).', 20),
    ('r2-G3-slash-comma-T1', 'T0/T25, T1: panel open.', 20),
    ('r2-G3-slash-dec-lo', 'T0.5/T1: panel open.', 20),
    ('r2-G3-slash-dec-hi', 'T0/T2.5: panel open.', 20),
    ('r2-G3-range-slash-oob', 'T0-T1/T25: panel open.', 20),
    ('r2-G3-slash-range-oob', 'T0/T1-T25: panel open.', 20),
    ('r2-G3-triple-slash-colon', 'T0/T1/T25: panel open.', 20),
    ('r2-G3-triple-slash-dot', 'T0/T1/T25.', 20),
    ('r2-G3-midline-T25-slash-T0', 'tile 0: see T25/T0 now.', 20),
    ('r2-G3-midline-T25-spslash', 'tile 0: see T25 / T0 now.', 20),
    ('r2-G3-valid-triple-slash', 'T0/T1/T2: panel open.', 20),
    ('r2-G3-valid-T3-Codex', 'tile 0: T3/Codex split.', 20),
    ('r2-G3-valid-path-T', 'tile 0: /var/T0/T25/file.png', 20),
    ('r2-G3-valid-relpath-T', 'tile 0: dir/T0/T25', 20),
    ('r2-G4-oxford-comma-verb', 'T0, T1, and T25 show the panel.', 20),
    ('r2-G4-oxford-comma-colon', 'T0, T1, and T25: panel open.', 20),
    ('r2-G4-mixed-and-verb', 'tile 0 and T25 show the panel.', 20),
    ('r2-G4-mixed-comma-verb', 'tile 0, T25 show the panel.', 20),
    ('r2-G4-range-noT-and-verb', 'T0-2 and T25 show the panel.', 20),
    ('r2-G4-range-T-and-verb', 'T0-T2 and T25 show the panel.', 20),
    ('r2-G4-midline-comma-T25', 'tile 0: see T25, T0 now.', 20),
    ('r2-G4-midline-and-T25', 'tile 0: see T25 and T0 now.', 20),
    ('r2-G4-bullet-T25-verb', '- T25 shows the panel.', 20),
    ('r2-G4-bullet-T25-colon', '- T25: panel open.', 20),
    ('r2-G4-lower-in-T25', 'tile 0: in T25 the sidebar is open.', 20),
    ('r2-G5-colon-lower-t-neg', 'tile: t-1 visible', 20),
    ('r2-G5-colon-upper-T-neg', 'tile: T-1 visible', 20),
    ('r2-G5-colon-upper-T1-ok', 'tile: T1 shows the panel.', 20),
    ('r2-G5-mid-T1-weighted', 'tile 0: ok. T1-weighted image.', 20),
    ('r2-G5-start-T1-weighted', 'T1-weighted image.', 20),
    ('r2-G5-every-tile-nl-T0', 'Every tile\nT0: panel open.', 20),
    ('r2-G5-first-tile-nl-T0', 'First tile\nT0: panel open.', 20),
    ('r2-G5-iso-timestamp', 'tile 0: 2026-11-27T25:00:00Z logged.', 20),
    ('r2-cli-T3-first-comma', 'T3, T0: panel open.', 2),
    ('r2-cli-T3-first-and', 'T3 and T0: panel open.', 2),
    ('r2-cli-T3-first-slash', 'T3/T0: panel open.', 2),
    ('r2-cli-T3-first-spslash', 'T3 / T0: panel open.', 2),
    ('r2-cli-T3-dangling-dash', 'T3-: panel open.', 20),
    ('r2-cli-midline-T25-slash', 'tile 0: see T25 / T0 now.', 20),
    ('r2-cli-oxford-comma-T25', 'T0, T1, and T25 show the panel.', 20),
    ('r2-cli-tiles-colon-T3-2t', 'tile 0: ok. Changes between tiles: T3 Code sidebar is open.', 2),
    ('r2-cli-tiles-paren-T3-2t', 'tile 0: ok. In all tiles (T3 Code is open).', 2),
    ('r2-cli-tiles-colon-T3-hyp', 'tile 0: ok. Changes between tiles: T3-Code sidebar is open.', 20),
    ('r2-cli-T3-to-100pct', 'tile 0: set T3 to 100% width.', 20),
    ('r2-cli-T3-endash-2-tabs', 'tile 0: T3 – 2 tabs open.', 20),
    ('r2-cli-T3-dash-1-err', 'tile 0: T3 - 1 error shown.', 20),
    ('r2-cli-slash-period', 'T0/T25. panel open.', 20),
    ('r2-cli-slash-comma-T1', 'T0/T25, T1: panel open.', 20),
    ('r2-cli-slash-paren', '(T0/T25): panel open.', 20),
    ('r2-cli-slash-decimal', 'T0.5/T1: panel open.', 20),
    ('r2-cli-slash-range', 'T0/T1-T25: panel open.', 20),
]


BARE_NOUN_CASES = [
    'tile 0: ok. Changes between tiles: none clear.',
    'tile 0: ok. Tile-to-tile changes are minimal.',
    'tile 0: ok. Tile-by-tile detail is NOT DETERMINED.',
    'Every tile (tile 0 onward) shows the panel.',
    'tile 0: ok. Pointer: NOT DETERMINED in all tiles (a tiny mark near the top of tile 0).',
    'tile 0: ok. Pointer near the hint in the right-hand tiles (e.g. tile 4).',
    "tile 0: ok. One line is highlighted in every tile: '<quoted label>'.",
]


MALFORMED_CASES = [
    ('A-nested-paren-colon', 'tile: (25) visible', 20),
    ('A-nested-paren-range', 'tiles: (0-25) visible', 20),
    ('A-nested-paren-neg', 'tile: (-1) visible', 20),
    ('A-nested-paren-word', 'tile: (first) visible', 20),
    ('A-nested-paren-hyphen', 'tile-(25): visible', 20),
    ('A-double-paren', 'tile ((25)): visible', 20),
    ('A-count-colon-paren', '20 tiles: (0-25) visible', 20),
    ('A-colon-coord-paren', 'tile: (x=1, y=2)', 20),
    ('A-colon-T-verb', 'tile: T25 shows the panel.', 20),
    ('A-paren-T-verb', 'tiles (T25 shows the panel).', 20),
    ('A-colon-lower-t', 'tile: t25 visible', 20),
    ('A-colon-index-word', 'tile: index 25 visible', 20),
    ('A-paren-index-word', 'tile (index 25) visible', 20),
    ('A-paren-eg-num', 'tiles (e.g. 25, 26) visible', 20),
    ('A-colon-eleventh', 'tile: eleventh visible', 20),
    ('A-dangling-colon', 'tile:', 20),
    ('A-dangling-hyphen', 'tile-', 20),
    ('A-dangling-paren', 'tile(', 20),
]


CONTROL_CASES = [
    ('A-nested-paren-colon', 'tile: (25) visible', 20, 'INVALID'),
    ('A-nested-paren-range', 'tiles: (0-25) visible', 20, 'INVALID'),
    ('A-nested-paren-neg', 'tile: (-1) visible', 20, 'INVALID'),
    ('A-nested-paren-word', 'tile: (first) visible', 20, 'INVALID'),
    ('A-nested-paren-hyphen', 'tile-(25): visible', 20, 'INVALID'),
    ('A-double-paren', 'tile ((25)): visible', 20, 'INVALID'),
    ('A-count-colon-paren', '20 tiles: (0-25) visible', 20, 'INVALID'),
    ('A-colon-coord-paren', 'tile: (x=1, y=2)', 20, 'INVALID'),
    ('A-colon-index-word', 'tile: index 25 visible', 20, 'INVALID'),
    ('A-paren-index-word', 'tile (index 25) visible', 20, 'INVALID'),
    ('A-paren-eg-num', 'tiles (e.g. 25, 26) visible', 20, 'INVALID'),
    ('A-colon-eleventh', 'tile: eleventh visible', 20, 'INVALID'),
    ('A-dangling-colon', 'tile:', 20, 'INVALID'),
    ('A-dangling-hyphen', 'tile-', 20, 'INVALID'),
    ('A-dangling-paren', 'tile(', 20, 'INVALID'),
    ('D-tiles-colon-one', 'tile 0: ok. Changes between tiles: one button moves.', 20, 'INVALID'),
    ('D-tiles-colon-digit', 'tile 0: ok. Changes between tiles: 2 lines shift.', 20, 'INVALID'),
    ('D-tiles-colon-bullet', 'tile 0: ok. Changes between tiles:\n- cursor blinks', 20, 'INVALID'),
    ('D-tiles-paren-first', 'tile 0: ok. In all tiles (first row highlighted).', 20, 'INVALID'),
    ('D-tiles-paren-next', 'tile 0: ok. Pointer in all tiles (next to icon).', 20, 'INVALID'),
    ('D-tile-hyphen-first', 'tile 0: ok. Tile-first layout is visible.', 20, 'INVALID'),
    ('D-frames-colon-none', 'tile 0: ok. Changes between frames: none clear.', 20, 'INVALID'),
    ('D-frame-by-frame', 'tile 0: ok. Frame-by-frame detail is NOT DETERMINED.', 20, 'INVALID'),
    ('E-tile-space-3-ok', 'tile 3: panel open.', 20, 'READ'),
    ('E-tile-space-25-oob', 'tile 25: panel open.', 20, 'INVALID'),
    ('E-tile3-nospace', 'tile3: panel open.', 20, 'READ'),
    ('E-tile25-nospace', 'tile25: panel open.', 20, 'READ'),
    ('E-Tile-hash-3-ok', 'Tile #3: panel open.', 20, 'READ'),
    ('E-Tile-hash-25-oob', 'Tile #25: panel open.', 20, 'INVALID'),
    ('E-tiles-2-4-ok', 'tiles 2-4: panel open.', 20, 'READ'),
    ('E-tiles-2-25-oob', 'tiles 2-25: panel open.', 20, 'INVALID'),
    ('E-tiles-4-2-rev', 'tiles 4-2: panel open.', 20, 'INVALID'),
    ('E-tile-at-time', 'the tile at 00:12 shows a modal.', 20, 'READ'),
    ('E-tile-at-time-oob', 'the tile at 99:99 shows a modal.', 20, 'READ'),
    ('E-start-prose', 'Tile shows a modal.', 20, 'READ'),
    ('E-start-colon-prose', 'Tile: shows a modal.', 20, 'READ'),
    ('E-start-colon-num', 'Tile: 25 shows a modal.', 20, 'INVALID'),
    ('E-end-period', 'Modal visible in every tile.', 20, 'READ'),
    ('E-end-question', 'Is modal visible in every tile?', 20, 'READ'),
    ('E-end-exclaim', 'Modal visible in every tile!', 20, 'READ'),
    ('E-hyphen-based', 'A tile-based layout is used.', 20, 'READ'),
    ('E-hyphen-multi', 'A multi-tile layout is used.', 20, 'READ'),
    ('E-hyphen-3-neg', 'tile-3: visible', 20, 'INVALID'),
    ('E-hyphen-25-neg', 'tile-25: visible', 20, 'INVALID'),
    ('E-endash-25', 'tile–25: visible', 20, 'READ'),
    ('E-plural-opt-prose', 'tile(s): none visible.', 20, 'READ'),
    ('E-plural-opt-oob', 'tile(s): 25 visible.', 20, 'INVALID'),
    ('E-guillemet-oob', 'tile 0: label «tile 99» visible.', 20, 'INVALID'),
    ('E-guillemet-prose', 'tile 0: label «tiles: none» visible.', 20, 'READ'),
    ('E-cjk-quote-oob', 'tile 0: label 「tile 99」 visible.', 20, 'INVALID'),
    ('E-german-quote-oob', 'tile 0: label „tile 99“ visible.', 20, 'INVALID'),
]


@pytest.mark.parametrize('name,finding,tile_count', T_COMPAT_CASES)
def test_t_base_parity(tmp_path, base_script, candidate_script, name, finding, tile_count):
    expected = cli(base_script, tmp_path / 'base', finding, tile_count)
    actual = cli(candidate_script, tmp_path / 'candidate', finding, tile_count)
    assert actual == expected, (name, finding, expected, actual)


@pytest.mark.parametrize('finding', BARE_NOUN_CASES)
def test_bare_noun_read(tmp_path, candidate_script, finding):
    assert cli(candidate_script, tmp_path / 'candidate', finding) == (0, 'READ')


@pytest.mark.parametrize('name,finding,tile_count', MALFORMED_CASES)
def test_malformed_punctuation(tmp_path, candidate_script, name, finding, tile_count):
    assert cli(candidate_script, tmp_path / 'candidate', finding, tile_count) == (2, 'INVALID')


@pytest.mark.parametrize('name,finding,tile_count,state', CONTROL_CASES)
def test_non_t_controls(tmp_path, candidate_script, name, finding, tile_count, state):
    assert cli(candidate_script, tmp_path / 'candidate', finding, tile_count) == (0 if state == 'READ' else 2, state)
