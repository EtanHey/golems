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
    out = work/'qa-video'/name
    result = subprocess.run(['sh', str(SCRIPTS/'dense-windows.sh'), str(video),
                             str(cues), str(out), '10', '0', '0', *args],
                            env=dict(env, **overrides), capture_output=True, text=True)
    return result, out


def frames(out):
    return sorted(out.glob('window_*-f_*'))


def test_cleanup_preserves_sheet_index_and_provenance(media):
    result, out = run(media)
    assert result.returncode == 0, result.stderr
    leftovers = list(out.glob('window_*-f_*.png'))
    assert not leftovers, f'{len(leftovers)} PNG intermediates remain'
    assert len(frames(out)) == 30 and all(p.suffix == '.jpg' for p in frames(out))
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
    out = work/'qa-video/dense'
    keep.write_text(f'{out}/window_1-f_00002.jpg\nsheet_002.jpg\t1\nsheet_003.jpg\t0\n')
    result, out = run(media, DENSE_KEEP_LIST=str(keep))
    assert result.returncode == 0, result.stderr
    # The scope correction preserves every ledger target, beyond the keep list.
    assert len(frames(out)) == 30
    assert all(Path(row.split('\t')[3]).exists()
               for row in (out/'frames.tsv').read_text().splitlines())


def test_budget_refuses_before_window(media):
    _, work, _ = media
    out = work/'qa-video/dense'
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


def test_inspection_after_cleanup_uses_durable_jpeg(media):
    result, out = run(media)
    assert result.returncode == 0, result.stderr
    row = (out/'frames.tsv').read_text().splitlines()[0].split('\t')
    frame = Path(row[3])
    assert frame.suffix == '.jpg' and frame.exists()
    assert row[5] == 'dense' and row[9] == ''  # No PNG crop indirection.
    inspected = subprocess.run(['bash', str(SCRIPTS/'inspected.sh'), str(out),
                                str(frame), 'dw: before', 'F1'],
                               capture_output=True, text=True)
    assert inspected.returncode == 0, inspected.stderr
    assert (out/'inspected.tsv').read_text().strip().split('\t') == [row[4], str(frame), 'dw: before', 'F1', row[7]]
    counted = subprocess.run(['bash', str(SCRIPTS/'coverage-count.sh'), str(out)],
                             capture_output=True, text=True)
    assert counted.returncode == 0 and 'inspected=1 ' in counted.stdout
    # Feed #1182 the real inspected.sh bytes after cleanup, not a fabricated row.
    import json
    report = '- [x] Before inspected\n- [x] After checked\nF1 FAIL\n'
    (out/'qa-report.md').write_text(report)
    evidence = subprocess.run(['bash', str(SCRIPTS/'fail-evidence.sh'), str(out)],
                              capture_output=True, text=True)
    assert evidence.returncode == 0, evidence.stderr
    assert evidence.stdout == (out/'inspected.tsv').read_text()
    events = [{'role': 'user', 'text': 'QA the recording.'},
              {'role': 'assistant', 'tools': [{'name': 'Write', 'input': {
                  'file_path': str(out/'qa-report.md'), 'content': report}}]},
              {'role': 'tool', 'text': evidence.stdout},
              {'role': 'assistant', 'text': 'Verdict: FAIL — F1 FAIL.'}]
    gate = SCRIPTS.parents[1]/'qa-verdict-gate/scripts/qa-verdict-gate-cli.mjs'
    checked = subprocess.run(['node', str(gate), '-'], input=json.dumps({'events': events}),
                             capture_output=True, text=True)
    assert checked.returncode == 0, checked.stdout+checked.stderr


def test_failure_preserves_registered_frames_and_keep_list(media):
    _, work, env = media
    work.mkdir()
    out = work/'qa-video/dense'
    keep = work/'keep.tsv'
    keep.write_text(f'{out}/window_1-f_00022.jpg\n')
    wrapper = Path(env['PATH'].split(os.pathsep)[0])/'ffmpeg'
    real = shutil.which('ffmpeg')
    wrapper.write_text('#!/usr/bin/env python3\nimport os,sys\n'
                       'if sys.argv[-1].endswith("sheet_002.jpg"): sys.exit(19)\n'
                       f'os.execv({real!r}, [{real!r}, *sys.argv[1:]])\n')
    wrapper.chmod(0o755)
    result, out = run(media, DENSE_KEEP_LIST=str(keep))
    assert result.returncode != 0 and 'tiling failed' in result.stderr
    rows = [r.split('\t') for r in (out/'frames.tsv').read_text().splitlines()]
    assert len(rows) == 20 and all(Path(r[3]).exists() for r in rows)
    assert {p.name for p in frames(out)} == {Path(r[3]).name for r in rows} | {'window_1-f_00022.jpg'}
