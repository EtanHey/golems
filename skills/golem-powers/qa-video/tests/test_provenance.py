"""Real media and exact-byte provenance; public synthetic inputs only."""
import hashlib
import importlib.util
from pathlib import Path
import subprocess

import pytest
from test_prepare import media

SCRIPTS = Path(__file__).resolve().parents[1]/'scripts'
spec = importlib.util.spec_from_file_location('provenance', SCRIPTS/'provenance.py')
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)

def call(name, *args, **kwargs):
    return subprocess.run(['bash', str(SCRIPTS/name), *map(str, args)],
                          capture_output=True, text=True, **kwargs)

def test_exact_hash_first_match_and_run_scope(tmp_path):
    a, b, c = [tmp_path/name for name in ('a.png', 'b.png', 'c.png')]
    a.write_bytes(b'pixels'); b.write_bytes(a.read_bytes()); c.write_bytes(b'other')
    p.record(tmp_path, [(a, 1.23456, 'coverage', '', '', ''),
                        (b, 2, 'dense', 'sheet.jpg', 0, ''),
                        (c, 3, 'refine', '', '', '')])
    rows = p.rows(tmp_path)
    assert list(rows[0]) == p.FIELDS
    assert len(p.FIELDS) == 10 and p.FIELDS[:3] == ['sheet_file', 'tile', 't_s']
    assert set('frame pts_s source sheet tile sha256 repeat_of crop_of'.split()) <= set(p.FIELDS)
    assert rows[0]['pts_s'] == rows[0]['t_s'] == '1.235'
    assert rows[0]['sha256'] == hashlib.sha256(b'pixels').hexdigest()
    assert [r['repeat_of'] for r in rows] == ['', str(a), '']
    child = tmp_path/'dense'; child.mkdir()
    d = child/'d.png'; d.write_bytes(a.read_bytes())
    p.record(child, [(d, 4, 'dense', 'sheet.jpg', 1, '')])
    assert p.rows(child)[0]['repeat_of'] == str(a)
    assert p.rows(tmp_path)[-1]['frame'] == str(d)
    # Explicitly isolate the second run (not a child extraction).
    sibling = tmp_path.with_name(tmp_path.name+'-run'); sibling.mkdir()
    p.record(sibling, [(b, 2, 'coverage', '', '', '')])
    assert p.rows(sibling)[0]['repeat_of'] == ''
    with pytest.raises(ValueError, match='already recorded'):
        p.record(tmp_path, [(a, 4, 'crop', '', '', '')])

def test_real_coverage_dense_refine_crop_and_inspection(media):
    video, work, env = media
    assert call('source-fps.sh', video).stdout.strip() == '10.000'
    result = call('coverage.sh', video, work)
    assert result.returncode == 0, result.stderr
    cues = work/'cues.tsv'; cues.write_text('0.5\t0.9\taction\n')
    dense = work/'dense'
    result = call('dense-windows.sh', video, cues, dense, 50, 0, 0)
    assert result.returncode == 0, result.stderr
    assert 'WARN: requested 50 fps exceeds source 10.000 fps; frames will repeat' in result.stderr
    rows = p.rows(dense)
    assert len(rows) == 20 and all(Path(r['frame']).exists() for r in rows)
    assert sum(bool(r['repeat_of']) for r in rows) >= 15
    assert float(rows[1]['pts_s'])-float(rows[0]['pts_s']) == pytest.approx(.02)
    assert all(r['sha256'] == hashlib.sha256(Path(r['frame']).read_bytes()).hexdigest() for r in rows)
    frame = rows[0]['frame']; crop = work/'crop.png'
    full_size = subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries',
                                         'stream=width,height', '-of', 'csv=p=0', frame], text=True)
    assert full_size.strip() == '160,90'
    assert call('crop.sh', frame, 1, 1, 31, 21, crop).returncode == 0
    size = subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries',
                                    'stream=width,height', '-of', 'csv=p=0', str(crop)], text=True)
    assert size.strip() == '31,21'
    last = p.rows(work)[-1]
    assert last['source'] == 'crop' and last['crop_of'] == frame
    assert last['pts_s'] == rows[0]['pts_s']
    assert call('crop.sh', frame, 0, 0, 999, 999, work/'bad.png').returncode != 0
    assert not (work/'bad.png').exists()
    for why in ('before', 'recheck'):
        assert call('inspected.sh', work, frame, why, 'F1').returncode == 0
    assert call('inspected.sh', work, work/'unknown.png', 'why').returncode != 0
    assert (work/'inspected.tsv').read_text().splitlines()[0].split('\t') == [rows[0]['pts_s'], frame, 'before', 'F1']
    visual = work/'visual'; visual.mkdir()
    import json
    (visual/'findings.jsonl').write_text(json.dumps({'ok': True, 'sheet': str(dense/'sheet_001.jpg')})+'\n')
    counts = call('coverage-count.sh', work).stdout.strip()
    repeated = sum(bool(r['repeat_of']) for r in p.rows(work))
    assert counts == f'extracted=22 unique={22-repeated} repeated={repeated} inspected=1 pre-sorted-only=19'
    result = call('dense-windows.sh', video, cues, work/'refine', 10, 0, 0,
                  env=env)
    assert result.returncode == 0, result.stderr
    assert all(r['source'] == 'refine' for r in p.rows(work/'refine'))


def test_coverage_uses_decoded_timestamp_not_seek(media):
    video, work, env = media
    video = video.with_name('fractional.mp4')
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-n',
                    '-f', 'lavfi', '-i', 'testsrc=size=64x48:rate=30000/1001',
                    '-t', '31', '-pix_fmt', 'yuv420p', str(video)], check=True)
    result = call('coverage.sh', video, work)
    assert result.returncode == 0, result.stderr
    rows = p.rows(work)
    assert len(rows) == 2
    assert rows[1]['pts_s'] == '30.030', 'requested seek=30 is not decoded PTS'
