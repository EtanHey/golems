"""Exercise reconciliation through the CLI and real ffmpeg cut extraction."""
import csv
import shutil
import subprocess
from pathlib import Path

import pytest
from test_provenance import p

SCRIPTS = Path(__file__).resolve().parents[1]/'scripts'


def run(tmp_path, draft, cuts='', duration=20, *flags, overrides=None):
    source, scores, out = [tmp_path/n for n in ('draft.tsv', 'cuts.tsv', 'sections.tsv')]
    source.write_text(draft)
    scores.write_text(cuts)
    args = ['python3', str(SCRIPTS/'sections.py'), str(source), str(scores), str(duration), *flags]
    if overrides is not None:
        changes = tmp_path/'overrides.tsv'; changes.write_text(overrides)
        args += ['--overrides', str(changes)]
    result = subprocess.run(args, capture_output=True, text=True)
    rows = list(csv.DictReader(out.open(), delimiter='\t')) if out.exists() else []
    if result.returncode == 0:
        assert result.stdout == out.read_text()
        assert rows[0]['start_s'] == '0.0' and float(rows[-1]['end_s']) == duration
        assert all(a['end_s'] == b['start_s'] for a, b in zip(rows, rows[1:]))
    return result, rows


def test_snap_window_strongest_tie_and_no_cut(tmp_path):
    result, rows = run(tmp_path, 'A\t0\t10\tx\twhy\nB\t10\t20\ty\twhy\n',
                       '7.9\t1\n8\t0.8\n11\t0.8\n12.1\t1\n')
    assert result.returncode == 0, result.stderr
    assert rows[1]['start_s'] == rows[1]['cut_pts_s'] == '8.0'
    assert rows[1]['cut_score'] == '0.8' and rows[1]['boundary_source'] == 'cut'
    _, rows = run(tmp_path, 'A\t0\t10\tx\twhy\nB\t10\t20\ty\twhy\n', '7.9\t1\n10\t0\n')
    assert rows[1]['start_s'] == '10.0' and rows[1]['boundary_source'] == 'transcript'


def test_recursive_split_and_merge_closer_original_topic_boundary(tmp_path):
    result, rows = run(tmp_path, 'A\t0\t250\tx\twhy\n', '80\t0.4\n150\t0.9\n220\t0.3\n', 250)
    assert result.returncode == 0, result.stderr
    assert [float(r['end_s']) for r in rows] == [80, 150, 220, 250]
    assert [r['id'] for r in rows] == ['S01', 'S02', 'S03', 'S04']
    assert [r['origin_id'] for r in rows] == ['A'] * 4
    # Snaps leave B=[9,11], closer to original right topic boundary=14 than left=5.
    result, rows = run(tmp_path, 'A\t0\t5\tx\tx\nB\t5\t14\ty\ty\nC\t14\t20\tz\tz\n',
                       '9\t0.9\n11\t0.8\n', 20, '--snap-window', '4')
    assert result.returncode == 0, result.stderr
    assert [r['id'] for r in rows] == ['S01', 'S02']
    assert [r['origin_id'] for r in rows] == ['A', 'C']
    assert rows[1]['topic'] == 'y | z'
    assert rows[1]['start_s'] == '9.0' and rows[1]['cut_pts_s'] == '9.0'


def test_overrides_propagate_log_and_conflicts(tmp_path):
    draft = 'A\t0\t10\tx\twhy\nB\t10\t20\ty\twhy\n'
    result, rows = run(tmp_path, draft, '11\t0.8\n', overrides='id\tstart_s\tend_s\nS02\t12\t20\n')
    assert result.returncode == 0, result.stderr
    assert rows[0]['end_s'] == rows[1]['start_s'] == '12.0'
    assert rows[1]['boundary_source'] == 'transcript' and not rows[1]['cut_score']
    assert (tmp_path/'sections-overrides.log').read_text() == 'S02\tB\t11.0\t20.0\t12.0\t20.0\n'
    for changes, error in [('S01\t0\t8\nS02\t9\t20\n', 'OVERRIDE_CONFLICT'),
                           ('missing\t0\t20\n', 'INVALID_OVERRIDE_ID'), ('B\t10\t20\n', 'INVALID_OVERRIDE_ID'), ('S02\t10\t21\n', 'INVALID_INTERVAL')]:
        result, _ = run(tmp_path, draft, overrides=changes)
        assert result.returncode and error in result.stderr
        assert rows == list(csv.DictReader((tmp_path/'sections.tsv').open(), delimiter='\t'))


@pytest.mark.parametrize('draft,cuts,duration,error', [
    ('', '', 20, 'EMPTY_SECTIONS'), ('A\t0\t20\tx\n', '', 20, 'INVALID_COLUMNS'),
    ('A\t1\t20\tx\tx\n', '', 20, 'COVERAGE'), ('A\t0\t0\tx\tx\n', '', 20, 'INVALID_INTERVAL'),
    ('A\t0\t9\tx\tx\nB\t10\t20\ty\ty\n', '', 20, 'GAP'),
    ('A\t0\t11\tx\tx\nB\t10\t20\ty\ty\n', '', 20, 'OVERLAP'),
    ('A\t0\t10\tx\tx\nA\t10\t20\ty\ty\n', '', 20, 'INVALID_ID'),
    ('A\t0\tnan\tx\tx\n', '', 20, 'INVALID_NUMBER'),
    ('A\t0\t20\tx\tx\n', '2\t0.5\n1\t1\n', 20, 'INVALID_CUTS'),
    ('A\t0\t20\tx\tx\n', '20\t1\n', 20, 'INVALID_CUTS'),
    ('A\t0\t100\tx\tx\n', '', 100, 'LONG_SECTION_NO_CUT'),
    ('A\t0\t1\tx\tx\nB\t1\t2\ty\ty\nC\t2\t20\tz\tz\n', '1.5\t1\n', 20, 'INVALID_INTERVAL'),
])
def test_validation(tmp_path, draft, cuts, duration, error):
    result, rows = run(tmp_path, draft, cuts, duration)
    assert result.returncode and error in result.stderr and not rows


def test_real_cut_source_cap_repeat_and_determinism(tmp_path):
    for binary in ('ffmpeg', 'ffprobe'):
        if not shutil.which(binary):
            pytest.skip(f'{binary} missing: synthetic media prep requires {binary}')
    video = tmp_path/'hard cut.mp4'
    subprocess.run(['ffmpeg', '-v', 'error', '-n', '-f', 'lavfi', '-i', 'testsrc=s=96x64:r=2:d=2',
                    '-f', 'lavfi', '-i', 'color=white:s=96x64:r=2:d=2', '-filter_complex',
                    '[0:v][1:v]concat=n=2:v=1', '-pix_fmt', 'yuv420p', str(video)], check=True)
    outputs = [tmp_path/'one', tmp_path/'two']
    for work in outputs:
        result = subprocess.run(['/bin/bash', str(SCRIPTS/'cut-pass.sh'), str(video), str(work)],
                                capture_output=True, text=True)
        assert result.returncode == 0, result.stderr
        cuts = [(float(t), float(s)) for t, s in csv.reader((work/'cuts.tsv').open(), delimiter='\t')]
        assert len(cuts) == 8 and max(cuts, key=lambda c: c[1])[0] == 2
        assert dict(cuts)[2] > 0.3
        rows = p.rows(work)
        assert len(rows) == 8 and all(r['source'] == 'cut' and Path(r['frame']).is_file() for r in rows)
        assert rows[-1]['repeat_of'] and not rows[0]['repeat_of']
        assert [float(r['pts_s']) for r in rows] == [t for t, _ in cuts]
    assert (outputs[0]/'cuts.tsv').read_bytes() == (outputs[1]/'cuts.tsv').read_bytes()
    for fps, error in [('nan', 'INVALID_FPS'), ('5', 'OUTPUT_EXISTS')]:
        result = subprocess.run(['/bin/bash', str(SCRIPTS/'cut-pass.sh'), str(video), str(outputs[0]), fps],
                                capture_output=True, text=True)
        assert result.returncode and error in result.stderr


def test_length_flags_endpoint_merge_and_invalid_threshold(tmp_path):
    result, rows = run(tmp_path, 'A\t0\t1\tx\tx\nB\t1\t20\ty\ty\n', '', 20,
                       '--max-section', '30', '--min-section', '2', '--snap-window', '0')
    assert result.returncode == 0 and len(rows) == 1 and rows[0]['id'] == 'S01' and rows[0]['origin_id'] == 'B'
    result, rows = run(tmp_path, 'A\t0\t20\tx\tx\n', '10\t1\n', 20, '--max-section', '10')
    assert result.returncode == 0 and len(rows) == 2
    for flag, value, error in [('--min-section', '90', 'INVALID_THRESHOLDS'),
                               ('--snap-window', 'nan', 'INVALID_NUMBER')]:
        result, _ = run(tmp_path, 'A\t0\t20\tx\tx\n', '', 20, flag, value)
        assert result.returncode and error in result.stderr


@pytest.mark.parametrize('count', [1, 100])
def test_final_ids_are_sequential_in_time_order(tmp_path, count):
    origins = [f'draft-{count-i}' for i in range(count)]
    draft = ''.join(f'{origin}\t{i*3}\t{(i+1)*3}\ttopic\twhy\n' for i, origin in enumerate(origins))
    result, rows = run(tmp_path, draft, duration=count*3)
    assert result.returncode == 0, result.stderr
    width = max(2, len(str(count)))
    assert [r['id'] for r in rows] == [f'S{i:0{width}d}' for i in range(1, count+1)]
    assert [float(r['start_s']) for r in rows] == list(range(0, count*3, 3))
    assert [r['origin_id'] for r in rows] == origins and list(rows[0])[-1] == 'origin_id'
