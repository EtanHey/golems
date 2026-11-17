"""Pixel-coordinate prose is not a frame index. No provider calls."""
import importlib.util
from pathlib import Path

import pytest

SPEC = importlib.util.spec_from_file_location(
    'batch', Path(__file__).parents[1] / 'scripts/visual-batch.py')
batch = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(batch)


@pytest.mark.parametrize('text', [
    'Tile 0 shows a panel. Crop bounds in the 1920×1080 frame: x=575–1620, y=110–212.',
    'frame: x=10-30, y=20-40; tile 0 is visible.',
    'frames: x=575–1620, y=110–212.',
    'frame: x=1, y=2',
])
def test_crop_bounds_are_not_frame_indexes(text):
    assert batch.validate(dict(ok=True, finding=text), 1)['state'] == 'READ'


@pytest.mark.parametrize('text', [
    'frame: 3',
    'frame: x=10-30, y=20-40; tile 99: visible.',
    'frame 99: x=10-30, y=20-40',
    'frame: x=10-30, y=20-40; frame 1: visible.',
    'frame: x=10, y=20 99',
    'frame: x=1, y=2 and 99',
    'frame: x=1, y=2 to 99',
    'frame: x=10, y=20, 5',
    'frame: x=1, y=2-3-4',
    'frame: x=1, y=2.5',
    'Frame: X=1, y=2',
    'frame: y=2, x=1',
    'frame: x=1..2, y=3',
    'frame: x=-1, y=2',
    'tile: x=1, y=2',
])
def test_coordinates_cannot_hide_bad_indexes(text):
    assert batch.validate(dict(ok=True, finding=text), 1)['state'] == 'INVALID'
