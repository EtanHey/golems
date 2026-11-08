"""Dense windows clean their own real media intermediates (DW)."""
import csv
import os
from pathlib import Path
import shutil
import subprocess

import pytest
from test_prepare import media

SCRIPTS = Path(__file__).resolve().parents[1]/'scripts'


def run(media, name='dense', args=(), **overrides):
    video, work, env = media
    work.mkdir(exist_ok=True)
    cues = work/'cues.tsv'
    cues.write_text('0\t2.5\tfirst\n3\t3.5\tsecond\n')
    out = work/name
    result = subprocess.run(['sh', str(SCRIPTS/'dense-windows.sh'), str(video),
                             str(cues), str(out), '10', '0', '0', *args],
                            env=dict(env, **overrides), capture_output=True, text=True)
    return result, out


def frames(out):
    return sorted(out.glob('window_*-f_*'))


def test_cleanup_preserves_sheet_index_and_provenance(media):
    result, out = run(media)
    assert result.returncode == 0, result.stderr
    leftovers = frames(out)
    assert not leftovers, f'{len(leftovers)} per-frame files remain'
    index = list(csv.reader((out/'index.tsv').open(), delimiter='\t'))
    assert index == [['sheet_001.jpg', '0.000', '10', '20', 'first'],
                     ['sheet_002.jpg', '2.000', '10', '5', 'first'],
                     ['sheet_003.jpg', '3.000', '10', '5', 'second']]
    rows = list(csv.reader((out/'frames.tsv').open(), delimiter='\t'))
    assert len(rows) == 30 and all(len(row) == 10 for row in rows)
    assert all(len(row[7]) == 64 and row[5] == 'dense' for row in rows)
    assert all((out/row[0]).stat().st_size > 0 for row in index)
    kept, other = run(media, 'kept', DENSE_KEEP_FRAMES='1')
    assert kept.returncode == 0, kept.stderr
    assert (other/'index.tsv').read_bytes() == (out/'index.tsv').read_bytes()
    # Absolute paths differ; the legacy positional prefix stays byte-identical.
    assert [r[:3] for r in rows] == [r.split('\t')[:3] for r in (other/'frames.tsv').read_text().splitlines()]


@pytest.mark.parametrize('flag,format', [(True, 'jpg'), (False, 'jpg'), (False, 'png')])
def test_keep_all(media, flag, format):
    result, out = run(media, args=('--keep-frames',) if flag else (),
                      DENSE_KEEP_FRAMES='0' if flag else '1', DENSE_FRAME_FORMAT=format)
    assert result.returncode == 0, result.stderr
    assert len(frames(out)) == 30 and all(p.suffix == '.'+format for p in frames(out))
    rows = [r.split('\t') for r in (out/'frames.tsv').read_text().splitlines()]
    import hashlib
    assert all(hashlib.sha256(Path(r[3]).read_bytes()).hexdigest() == r[7] for r in rows)


def test_keep_list_exact_paths_and_sheet_tiles(media):
    _, work, _ = media
    work.mkdir()
    keep = work/'keep.tsv'
    out = work/'dense'
    keep.write_text(f'{out}/window_1-f_00002.jpg\nsheet_002.jpg\t1\nsheet_003.jpg\t0\n')
    result, out = run(media, DENSE_KEEP_LIST=str(keep))
    assert result.returncode == 0, result.stderr
    assert [p.name for p in frames(out)] == ['window_1-f_00002.jpg',
                                           'window_1-f_00022.jpg', 'window_2-f_00001.jpg']


def test_budget_refuses_before_window(media):
    _, work, _ = media
    out = work/'dense'
    out.mkdir(parents=True)
    (out/'existing').write_bytes(b'x'*8192)
    result, out = run(media, DENSE_MAX_GB='0.000001')
    assert result.returncode != 0
    assert 'DENSE_BUDGET_EXCEEDED' in result.stderr
    assert 'used_kib=' in result.stderr and 'max_kib=' in result.stderr
    assert not frames(out) and not list(out.glob('sheet_*.jpg'))
    assert not list(out.glob('window_*'))


def test_tile_failure_cleans_partial_window(media):
    _, _, env = media
    wrapper = Path(env['PATH'].split(os.pathsep)[0])/'ffmpeg'
    real = shutil.which('ffmpeg')
    wrapper.write_text('#!/usr/bin/env python3\nimport os,sys\n'
                       'if any("tile=" in arg for arg in sys.argv): sys.exit(19)\n'
                       f'os.execv({real!r}, [{real!r}, *sys.argv[1:]])\n')
    wrapper.chmod(0o755)
    result, out = run(media)
    assert result.returncode != 0 and 'tiling failed' in result.stderr
    assert not frames(out), 'failed windows must clean up too'
