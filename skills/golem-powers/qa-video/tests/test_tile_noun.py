"""Synthetic lost-read shapes from #1363's review, plus citation controls.

No client text/images or provider calls. Exercise the real batch CLI and its
headerless production ledger shape; T<n> means tile n, never decoded seconds.
"""
import json
from pathlib import Path
import subprocess
import sys

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/visual-batch.py'

CASES = [
    ('tile 0: ok. Changes between tiles: none clear.', True),
    ('tile 0: ok. Tile-to-tile changes are minimal.', True),
    ('tile 0: ok. Tile-by-tile detail is NOT DETERMINED.', True),
    ('Every tile (tile 0 onward) shows the panel.', True),
    ('tile 0: ok. Pointer: NOT DETERMINED in all tiles (a tiny mark near the top of tile 0).', True),
    ('tile 0: ok. Pointer near the hint in the right-hand tiles (e.g. tile 4).', True),
    ("tile 0: ok. One line is highlighted in every tile: '<quoted label>'.", True),
    ('T0: panel open. T1: panel open. T2-T19: same layout.', True),
    ('tile 0 and T3: panel open.', True),
    ('tile 4: the T3 Code sidebar is open.', True),
    ('Panel open in every tile.', True),
    ('Panel open, no change.', True),
    ('tile 2: highlight on row [364] of the list.', True),
    ('(tiles 0-19, row-major): panel open.', True),
    ('tile 0: label "T999" visible.', True),
    ('T20: panel open.', False),
    ('T-1: panel open.', False),
    ('T2-T20: same layout.', False),
    ('T19-T2: same layout.', False),
    ('T0.5: panel open.', False),
    ('T0-: panel open.', False),
    ('tile 0 and T25: panel open.', False),
    ('tile 0: Changes between tiles: none; tile 25: visible.', False),
    ('Every tile (tile 25 onward) shows the panel.', False),
    ('tile: 25 visible', False),
    ('tile (25): visible', False),
    ('tile twenty-five: visible', False),
    ('tiles [25]: visible', False),
    ('tiles 1/25: visible', False),
    ('tiles 18-25: visible', False),
    ('tile -1: visible', False),
    ('tiles 19-0: visible', False),
]


@pytest.mark.parametrize('finding,valid', CASES)
def test_tile_noun_cli(tmp_path, finding, valid):
    run_citation_cli(tmp_path, finding, valid)


def run_citation_cli(tmp_path, finding, valid, tile_count=20):
    (tmp_path / 'sheet.png').write_bytes(b'offline synthetic image')
    # No index: tile_count must be recovered from the headerless frames ledger.
    (tmp_path / 'frames.tsv').write_text(''.join(
        f'sheet.png\t{i}\t{2+i/10:.3f}\tframe-{i}.jpg\t{2+i/10:.3f}\tdense\tsheet.png\tsha\t\t\n'
        for i in range(tile_count)))
    helper = tmp_path / 'helper.py'
    helper.write_text("print('Coverage: 1/1; complete;')\nprint(" + repr(finding) + ")\n")
    result = subprocess.run([
        sys.executable, str(SCRIPT), '--helper', str(helper),
        '--workdir', str(tmp_path), '--question', 'facts', str(tmp_path / 'sheet.png'),
    ], capture_output=True, text=True, timeout=10)
    summary = json.loads(result.stdout)
    item, = summary['sheets']
    assert item['state'] == ('READ' if valid else 'INVALID'), summary
    assert result.returncode == (0 if valid else 2), result.stderr
    if finding.startswith('T20:'):
        assert item['offending_indexes'] == [20]
    if finding.startswith('T-1:'):
        assert item['offending_indexes'] == [-1]


def test_abbreviation_is_tile_index_not_seconds():
    import importlib.util
    spec = importlib.util.spec_from_file_location('tile_noun_batch', SCRIPT)
    batch = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(batch)
    # T1 must mean tile 1 even if that tile is at a fractional/nonzero PTS.
    assert batch.validate(dict(ok=True, finding='T1: panel open.'), 2)['state'] == 'READ'
    assert batch.validate(dict(ok=True, finding='T2: panel open.'), 2)['offending_indexes'] == [2]


# Every adversarial repro from Neon r1 probe.out. Synthetic, no client data.
ROUND1_CASES = [
    ('A-nested-paren-colon', 'tile: (25) visible', 20, 'INVALID'),
    ('A-nested-paren-range', 'tiles: (0-25) visible', 20, 'INVALID'),
    ('A-nested-paren-neg', 'tile: (-1) visible', 20, 'INVALID'),
    ('A-nested-paren-word', 'tile: (first) visible', 20, 'INVALID'),
    ('A-nested-paren-hyphen', 'tile-(25): visible', 20, 'INVALID'),
    ('A-double-paren', 'tile ((25)): visible', 20, 'INVALID'),
    ('A-count-colon-paren', '20 tiles: (0-25) visible', 20, 'INVALID'),
    ('A-colon-coord-paren', 'tile: (x=1, y=2)', 20, 'INVALID'),
    ('A-colon-T-verb', 'tile: T25 shows the panel.', 20, 'INVALID'),
    ('A-paren-T-verb', 'tiles (T25 shows the panel).', 20, 'INVALID'),
    ('A-colon-lower-t', 'tile: t25 visible', 20, 'INVALID'),
    ('A-colon-index-word', 'tile: index 25 visible', 20, 'INVALID'),
    ('A-paren-index-word', 'tile (index 25) visible', 20, 'INVALID'),
    ('A-paren-eg-num', 'tiles (e.g. 25, 26) visible', 20, 'INVALID'),
    ('A-colon-eleventh', 'tile: eleventh visible', 20, 'INVALID'),
    ('A-dangling-colon', 'tile:', 20, 'INVALID'),
    ('A-dangling-hyphen', 'tile-', 20, 'INVALID'),
    ('A-dangling-paren', 'tile(', 20, 'INVALID'),
    ('B-T-verb', 'T20 shows the panel.', 20, 'INVALID'),
    ('B-T-is', 'T25 is blank.', 20, 'INVALID'),
    ('B-in-T-the', 'In T25 the sidebar is open.', 20, 'INVALID'),
    ('B-T-paren', 'T20 (blank)', 20, 'INVALID'),
    ('B-T-and-T-verb', 'T0 and T25 show the panel.', 20, 'INVALID'),
    ('B-T-comma-T-verb', 'T0, T25 show the panel.', 20, 'INVALID'),
    ('B-T-slash-T-oob', 'T0/T25: panel open.', 20, 'INVALID'),
    ('B-T-multiline', 'T20\npanel open.', 20, 'INVALID'),
    ('B-T-question', 'T20? panel open.', 20, 'INVALID'),
    ('B-T-exclaim', 'T20! panel open.', 20, 'INVALID'),
    ('B-lower-t-oob', 't25: blank', 20, 'READ'),
    ('B-T-range-dec-end', 'T2-T20.5: panel open.', 20, 'INVALID'),
    ('B-T-range-dec-start', 'T0.5-T2: panel open.', 20, 'INVALID'),
    ('B-T-range-neg-end', 'T2-T-1: panel open.', 20, 'INVALID'),
    ('B-T-range-neg-both', 'T-2-T-1: panel open.', 20, 'INVALID'),
    ('B-T-unfinished-dot', 'T0..: panel open.', 20, 'INVALID'),
    ('B-T-unfinished-to', 'T0 to: panel open.', 20, 'INVALID'),
    ('C-valid-T-range-verb', 'T0-T19 show the panel.', 20, 'READ'),
    ('C-valid-T-range-are', 'T2-T5 are identical.', 20, 'READ'),
    ('C-valid-T-dotdot-verb', 'T0..T19 show the panel.', 20, 'READ'),
    ('C-valid-T-to-verb', 'T2 to T5 show the panel.', 20, 'READ'),
    ('C-valid-T-endash-verb', 'T2–T5 show the panel.', 20, 'READ'),
    ('C-valid-T-range-paren', 'T0-T19 (same layout)', 20, 'READ'),
    ('C-valid-T-spaced-slash', 'T0 / T1: panel open.', 20, 'READ'),
    ('C-prose-T3-hyphen', 'tile 0: T3-Code sidebar is open.', 20, 'READ'),
    ('C-prose-T3-period-2t', 'tile 0: sidebar is T3.', 2, 'READ'),
    ('C-prose-T3-paren-2t', 'tile 0: app (T3) is open.', 2, 'READ'),
    ('C-prose-T3-comma-2t', 'tile 0: T3, Claude, and Codex are open.', 2, 'READ'),
    ('C-prose-T3-and-2t', 'tile 0: T3 and Codex are open.', 2, 'READ'),
    ('C-prose-T3-slash-sp', 'tile 0: T3 / Codex split view.', 20, 'READ'),
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
    ('E-guillemet-T-oob', 'tile 0: label «T99» visible.', 20, 'READ'),
    ('E-guillemet-T-dot', 'tile 0: label «T99.» visible.', 20, 'READ'),
]


@pytest.mark.parametrize("name,finding,tile_count,state", ROUND1_CASES)
def test_round1_probe_cli(tmp_path, name, finding, tile_count, state):
    run_citation_cli(tmp_path, finding, state == "READ", tile_count)
