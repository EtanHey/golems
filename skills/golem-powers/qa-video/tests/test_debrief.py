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

@pytest.fixture
def failure_pipeline(tmp_path, monkeypatch):
    module = load()
    scripts = tmp_path/'scripts'; scripts.mkdir()
    for name in ('visual-batch.py', 'visual-gather.py'):
        (scripts/name).symlink_to(SCRIPT.with_name(name))
    transcript = ('1\n00:00:00,000 --> 00:00:05,000\nThe claim is 42 percent.\n\n'
                  '2\n00:07:00,000 --> 00:07:05,000\nWhy should we verify 99 percent?\n')
    extract = scripts/'extract.sh'
    extract.write_text('#!/bin/bash\ncat > "$2/transcript.srt" <<\'SRT\'\n'+transcript+'SRT\n')
    probe = scripts/'ffprobe'; probe.write_text('#!/bin/bash\necho 5400\n'); probe.chmod(0o755)
    frame = scripts/'ffmpeg'
    frame.write_text('#!/bin/bash\necho "pts_time:0" >&2\nprintf synthetic > "${@: -1}"\n')
    frame.chmod(0o755)
    monkeypatch.setattr(module, 'HERE', scripts)
    import os
    monkeypatch.setenv('PATH', str(scripts)+':'+os.environ['PATH'])
    video = tmp_path/'synthetic.mp4'; video.touch()
    work = tmp_path/'work'
    return module, scripts, video, work

@pytest.mark.parametrize('stage,status', [('extract_timeout', 'BUDGET_EXCEEDED'),
                                         ('reserve', 'BUDGET_EXCEEDED'), ('frame_failure', 'PARTIAL')])
def test_failure_preserves_transcript_note(failure_pipeline, monkeypatch, stage, status):
    import json
    module, scripts, video, work = failure_pipeline
    if stage == 'extract_timeout':
        with (scripts/'extract.sh').open('a') as f:
            f.write('sleep 2\n')
    if stage == 'frame_failure':
        (scripts/'ffmpeg').write_text('#!/bin/bash\nexit 1\n')
    monkeypatch.setattr(sys, 'argv', [str(SCRIPT), str(video), '--workdir', str(work),
                                    '--budget-seconds', '.15' if stage == 'extract_timeout' else '1'])
    assert module.main() == 2
    assert json.loads((work/'timing.json').read_text())['status'] == status
    assert json.loads((work/'timing.json').read_text())['budget_seconds'] == (.15 if stage == 'extract_timeout' else 1)
    note = (work/'debrief.md').read_text()
    assert 'Status: '+status in note and '42 percent' in note and '99 percent' in note
    assert note.count('visual: NOT DETERMINED (budget/failed)') == 2
    assert not (work/'visual/findings.jsonl').exists()
    assert len(json.loads((work/'plan.json').read_text())['moments']) == 2

@pytest.mark.parametrize('seconds,budget', [('5400', 2160), ('1500', 600)])
def test_duration_scales_default_budget(failure_pipeline, monkeypatch, seconds, budget):
    import json
    module, scripts, video, work = failure_pipeline
    (scripts/'ffprobe').write_text('#!/bin/bash\necho '+seconds+'\n')
    (scripts/'extract.sh').write_text('#!/bin/bash\ncat > "$2/transcript.srt" <<\'SRT\'\n'
                                    '1\n00:00:00,000 --> 00:00:05,000\nHello friend.\nSRT\n')
    monkeypatch.setattr(sys, 'argv', [str(SCRIPT), str(video), '--workdir', str(work)])
    assert module.main() == 0
    timing = json.loads((work/'timing.json').read_text())
    assert timing['budget_seconds'] == budget and timing['status'] == 'TRANSCRIPT_ONLY'
    assert any('transcribing' in p and f'budget {budget}s' in p for p in timing['phases'])
    assert f'budget {budget}s' in (work/'progress.txt').read_text()

def test_partial_visuals_keep_transcript_note(failure_pipeline, setup, monkeypatch):
    import json
    module, _, video, work = failure_pipeline
    helper = setup[0]/'helper.py'
    helper.write_text(helper.read_text().replace("print('Coverage: 1/1; complete; 0 image findings omitted by output cap.')",
                                              "print('NOT DETERMINED: missing response'); sys.exit(1)"))
    monkeypatch.setattr(sys, 'argv', [str(SCRIPT), str(video), '--workdir', str(work),
                                    '--budget-seconds', '300', '--helper', str(helper)])
    assert module.main() == 2
    assert json.loads((work/'timing.json').read_text())['status'] == 'PARTIAL'
    assert len((work/'visual/findings.jsonl').read_text().splitlines()) == 2
    note = (work/'debrief.md').read_text()
    assert '42 percent' in note and '99 percent' in note and 'Status: PARTIAL' in note
    assert note.count('visual: NOT DETERMINED (budget/failed)') == 2
