"""Synthetic planner and deadline tests; no model or private recording."""
import importlib.util
import math
from pathlib import Path
import subprocess
import sys

import pytest
SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/debrief.py'
def load():
    spec = importlib.util.spec_from_file_location('debrief', SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

def test_25_minute_planner():
    transcript = '\n\n'.join(f'{i+1}\n00:{i:02d}:00,000 --> 00:{i+1:02d}:00,000\n'
                            f'Why does this slide claim {i+10} percent improvement?'
                            for i in range(25))
    plan = load().plan(transcript, 3)
    assert 0 < len(plan['moments']) <= 12
    assert plan['call_waves'] <= math.ceil(12/3)
    assert plan['estimated_wall_seconds'] < 600
    assert plan['scene_sweep'] is False
    assert all(m['sampling'] == 'one still' for m in plan['moments'])
    assert len({m['start'] for m in plan['moments']}) == len(plan['moments'])
    assert plan['moments'][-1]['start'] >= 1200, 'do not spend the cap entirely on early speech'

def test_no_visual_reference_does_not_sweep():
    plan = load().plan('1\n00:01:00,000 --> 00:01:05,000\nThe budget is 300 dollars.', 99)
    assert len(plan['moments']) == 1 and plan['concurrency'] == 4
    assert not plan['moments'][0]['visual_reference'] and not plan['scene_sweep']
    assert load().plan('', 3)['moments'] == []

def test_whole_run_deadline_kills_child(tmp_path):
    import time
    module = load()
    started = time.monotonic()
    with pytest.raises(subprocess.TimeoutExpired):
        module.command([sys.executable, '-c', 'import time; time.sleep(10)'], tmp_path/'log', started+.1)
    assert time.monotonic()-started < 2

@pytest.mark.parametrize('collision', [False, True])
def test_cli_requires_fresh_workdir(tmp_path, collision):
    work = tmp_path/'used'; work.mkdir()
    (work/'transcript.srt').write_text('stale')
    video = str(work/'transcript.srt') if collision else '/missing.mp4'
    result = subprocess.run([sys.executable, str(SCRIPT), video, '--workdir', str(work)],
                            capture_output=True, text=True)
    assert result.returncode != 0 and 'fresh' in result.stderr
    assert (work/'transcript.srt').read_text() == 'stale'

from test_prepare import media  # real ffmpeg, synthetic speech-transcriber fixture
from test_visual_batch import setup

def test_end_to_end_evidence_and_phase_progress(media, setup, monkeypatch):
    import json
    video, work, env = media
    import shutil
    work.mkdir(); shutil.copy(video, work/'source.mp4'); video = work/'source.mp4'
    (work/'source.info.json').write_text('{"synthetic":true}')
    module = load()
    whisper = Path(env['PATH'].split(':')[0])/'whisper-cli'
    whisper.write_text(whisper.read_text().replace('Now I click here.', 'The slide is 42 percent.'))
    monkeypatch.setenv('PATH', env['PATH']); monkeypatch.setenv('WHISPER_MODEL', env['WHISPER_MODEL'])
    monkeypatch.setattr(sys, 'argv', [str(SCRIPT), str(video), '--workdir', str(work), '--helper', str(setup[0]/'helper.py')])
    assert module.main() == 0
    receipt = json.loads((work/'timing.json').read_text())
    assert receipt['status'] == 'COMPLETE' and receipt['wall_seconds'] < 600
    assert any('transcribed' in phase for phase in receipt['phases'])
    assert any('compiling' in phase for phase in receipt['phases'])
    assert len((work/'visual/findings.jsonl').read_text().splitlines()) == 1
    assert float((work/'frames.tsv').read_text().split('\t')[2]) >= .5
    assert '42 percent' in (work/'debrief.md').read_text()
