"""Synthetic narration and real ffmpeg; no provider calls or real recordings."""
import csv
import os
from pathlib import Path
import subprocess

import pytest

S = Path(__file__).resolve().parents[1] / 'scripts'
SRT = '''1
00:00:01,000 --> 00:00:02,000
This PR ships this morning.

2
00:00:04,000 --> 00:00:05,000
This, that I'm currently hovering over.

3
00:00:08,000 --> 00:00:09,000
Look at that one right here.
'''

def call(name, *args, **kw):
    return subprocess.run(['bash' if name.endswith('.sh') else 'python3',
                           str(S/name), *map(str, args)], capture_output=True, text=True, **kw)

@pytest.fixture
def run(tmp_path):
    work = tmp_path/'run'; work.mkdir()
    (work/'transcript.srt').write_text(SRT)
    video = tmp_path/'synthetic.mp4'
    subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i',
                    'testsrc=size=160x90:rate=10', '-t', '12', '-pix_fmt',
                    'yuv420p', str(video)], check=True)
    return work, video

def test_cues(run):
    work, _ = run
    r = call('deixis-cues.py', work/'transcript.srt')
    assert r.returncode == 0, r.stderr
    rows = list(csv.reader(r.stdout.splitlines(), delimiter='\t'))
    assert [row[4] for row in rows] == ['2', '3']
    assert rows[0][:3] == ['4.000', '3.000', '6.000']

def test_plan_merges_omitted_pointer(run):
    work, video = run
    (work/'cues.tsv').write_text('10\t11\tmeasurement\n')
    r = call('default.sh', 'plan', video, work)
    assert r.returncode == 0, r.stderr
    assert '3.000\t6.000\tmust-read:2' in (work/'cues.tsv').read_text()
    assert (work/'must-read.tsv').exists()

def test_qa_rejects_low_padding(run):
    work, video = run
    cues = work/'cues.tsv'; cues.write_text('4\t5\tmust-read:2\n')
    r = call('dense-windows.sh', video, cues, work/'dense', 2, 0, 0)
    assert r.returncode == 2, r.stderr
    assert 'QA coverage' in r.stderr

def prepare(work, video):
    assert call('must-read.py', 'plan', work).returncode == 0
    r = call('must-read.py', 'extract', video, work)
    assert r.returncode == 0, r.stderr

def report(work):
    rows = list(csv.DictReader((work/'must-read-frames.tsv').open(), delimiter='\t'))
    return '\n'.join(f'MUST_READ\t{r["srt_index"]}\t{r["frame"]}\t{r["pts_s"]}\tPointer targets the synthetic coloured grid.\t{r["frame"]}.crop.png'
                     for r in rows), rows

def test_check_requires_every_open_and_crop(run):
    work, video = run
    prepare(work, video)
    text, rows = report(work)
    assert len(rows) == 6
    size = subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries',
        'stream=width,height', '-of', 'csv=p=0', rows[0]['frame']], text=True)
    assert size.strip() == '160,90', 'must-read frames retain source resolution'
    out = work/'qa-report.md'; out.write_text('INCONCLUSIVE\n'+text)
    assert call('must-read-check.sh', work, out).returncode == 3
    for r in rows:
        assert call('inspected.sh', work, r['frame'], 'judge: pointer grid', r['srt_index']).returncode == 0
        assert call('crop.sh', r['frame'], 0, 0, 20, 20, r['frame']+'.crop.png').returncode == 0
    assert call('must-read-check.sh', work, out).returncode == 0
    out.write_text('INCONCLUSIVE\n'+'\n'.join(text.splitlines()[:-1]))
    assert call('must-read-check.sh', work, out).returncode == 3
    out.write_text('INCONCLUSIVE\n'+text)
    # A valid crop/read cannot be reused after its original frame bytes change.
    Path(rows[0]['frame']).write_bytes(b'changed frame')
    assert call('must-read-check.sh', work, out).returncode == 3

def test_downgrade_is_recorded_and_blocks_verdict(run):
    work, video = run
    prepare(work, video)
    r = call('dense-windows.sh', video, work/'cues.tsv', work/'dense', 2, 0, 0,
             env={**os.environ, 'QA_COVERAGE_DOWNGRADE': '1', 'DENSE_SLOTS': '0'})
    assert r.returncode == 0, r.stderr
    assert 'COVERAGE FAIL' in (work/'coverage-downgrades.jsonl').read_text()
    out = work/'qa-report.md'; out.write_text('INCONCLUSIVE\n')
    assert call('must-read-check.sh', work, out).returncode == 3

@pytest.mark.parametrize('phrase', ['this', 'see this', 'that one', 'here', 'right here',
    'over here', 'where my mouse is', 'where my cursor is', "I'm hovering", 'hovering over',
    'as you can see', 'look at', 'pointing at', 'This, that I’m currently hovering over'])
def test_phrase_list(tmp_path, phrase):
    srt = tmp_path/'test.srt'
    srt.write_text('1\n00:00:02,000 --> 00:00:03,000\n'+phrase+'\n')
    r = call('deixis-cues.py', srt)
    assert r.returncode == 0 and len(r.stdout.splitlines()) == 1

@pytest.mark.parametrize('phrase', ['this PR', 'this morning', 'this is useful', 'hereafter',
                                   'there', 'look atlas', 'hovering overhead'])
def test_false_positives(tmp_path, phrase):
    srt = tmp_path/'test.srt'
    srt.write_text('1\n00:00:02,000 --> 00:00:03,000\n'+phrase+'\n')
    r = call('deixis-cues.py', srt)
    assert r.returncode == 0 and r.stdout == ''

def test_dense_remerges_and_refuses_fps_even_with_valid_padding(run):
    work, video = run
    assert call('must-read.py', 'plan', work).returncode == 0
    (work/'cues.tsv').write_text('10\t11\tmeasurement\n')
    r = call('dense-windows.sh', video, work/'cues.tsv', work/'dense', 2, 1, 2)
    assert r.returncode == 2 and 'fps >= 10' in r.stderr
    assert 'must-read:2' in (work/'cues.tsv').read_text()
