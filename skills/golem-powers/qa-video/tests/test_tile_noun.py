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
    (tmp_path / 'sheet.png').write_bytes(b'offline synthetic image')
    # No index: tile_count must be recovered from the headerless frames ledger.
    (tmp_path / 'frames.tsv').write_text(''.join(
        f'sheet.png\t{i}\t{2+i/10:.3f}\tframe-{i}.jpg\t{2+i/10:.3f}\tdense\tsheet.png\tsha\t\t\n'
        for i in range(20)))
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
