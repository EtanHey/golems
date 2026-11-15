"""Offline timing eval: real ffmpeg, invented transcript, generated color video."""
import importlib.util
import json
from pathlib import Path
import re
import shutil
import subprocess

import tempfile
import unittest

SKILL = Path(__file__).resolve().parents[1]
FIXTURE = Path(__file__).resolve().parent / 'fixtures/cue-bracket'


def planner():
    spec = importlib.util.spec_from_file_location('debrief', SKILL/'scripts/debrief.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def short_screen_cue_is_bracketed(tmp_path):
    if not shutil.which('ffmpeg'):
        raise unittest.SkipTest('real ffmpeg required')
    cue = json.loads((FIXTURE/'cues.json').read_text())['cues'][0]
    selected = planner().plan((FIXTURE/'transcript.srt').read_text(), 3)
    assert len(selected['moments']) == 1
    moment = selected['moments'][0]
    assert moment['start'] == cue['anchor_s']
    # The historical single-still fallback makes this same eval executable on master.
    times = moment.get('frame_times_s', [moment['start']])
    video = tmp_path/'generated.mp4'
    subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i',
                    'color=black:s=160x90:r=10:d=8', '-vf',
                    'drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:enable=between(t\\,3.5\\,4.5)',
                    '-pix_fmt', 'yuv420p', str(video)], check=True)
    pts = []
    for i, requested in enumerate(times):
        image = tmp_path/f'frame-{i}.pgm'
        run = subprocess.run(['ffmpeg', '-hide_banner', '-nostdin', '-ss', str(requested),
                              '-copyts', '-i', str(video), '-vf', 'showinfo,format=gray',
                              '-frames:v', '1', str(image)], capture_output=True, text=True, check=True)
        pts.append(float(re.search(r'pts_time:([\d.]+)', run.stderr)[1]))
        # Check actual decoded pixels, without OCR/model inference.
        if cue['visible_window_s'][0] <= pts[-1] <= cue['visible_window_s'][1]:
            assert image.read_bytes()[-160*90:] == bytes([255]) * (160*90)
    print(f'requested={times}, decoded={pts}, target={cue["visible_window_s"]}')
    assert any(cue['visible_window_s'][0] <= t <= cue['visible_window_s'][1] for t in pts), \
        'single topic-start still missed the brief on-screen cue'
    assert times == [0.0, 4.0]
    assert selected['frame_count'] == 2


def first_segment_and_unscored_predecessors():
    module = planner()
    early = module.plan('1\n00:00:00,000 --> 00:00:00,100\nWhy this code?', 3)
    assert early['moments'][0]['frame_times_s'] == [0, .05]
    late = module.plan((FIXTURE/'transcript.srt').read_text(), 1)
    assert late['moments'][0]['window_start_s'] == 0
    assert late['moments'][0]['window_end_s'] == 8
    assert late['call_waves'] == 2


def only_three_preceding_segments_are_used():
    transcript = '\n\n'.join(
        f'{i+1}\n00:00:{i*2:02d},000 --> 00:00:{i*2+2:02d},000\n'
        + ('Why this code?' if i == 5 else 'Neutral sentence.')
        for i in range(6))
    moment = planner().plan(transcript, 3)['moments'][0]
    assert moment['start'] == 10
    assert [moment['window_start_s'], moment['window_end_s']] == [4, 12]
    assert moment['frame_times_s'] == [4, 8]


class CueBracketTests(unittest.TestCase):
    def test_short_screen_cue_is_bracketed(self):
        with tempfile.TemporaryDirectory(prefix='qa-video-cue-') as directory:
            short_screen_cue_is_bracketed(Path(directory))

    def test_first_segment_and_unscored_predecessors(self):
        first_segment_and_unscored_predecessors()

    def test_only_three_preceding_segments_are_used(self):
        only_three_preceding_segments_are_used()


if __name__ == '__main__':
    unittest.main()
