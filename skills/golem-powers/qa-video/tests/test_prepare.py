"""Real ffmpeg media preparation; whisper output is deterministic in tests."""
import json
import os
from pathlib import Path
import shutil
import subprocess

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts' / 'prepare.sh'
pytestmark = pytest.mark.skipif(not shutil.which('ffmpeg'), reason='ffmpeg missing: synthetic media prep requires ffmpeg')


@pytest.fixture
def media(tmp_path):
    video = tmp_path / 'synthetic video.mp4'
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y',
                    '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=10',
                    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=16000',
                    '-t', '4', '-pix_fmt', 'yuv420p', str(video)], check=True)
    bin_dir = tmp_path / 'bin'
    bin_dir.mkdir()
    whisper = bin_dir / 'whisper-cli'
    whisper.write_text('''#!/usr/bin/env python3
import os, sys
from pathlib import Path
if '--version' in sys.argv:
    print('whisper test stub version 1.0'); sys.exit(0)
if os.environ.get('WHISPER_TEST_FAIL'):
    sys.exit(7)
p = sys.argv[sys.argv.index('-of') + 1]
Path(p + '.srt').write_text('1\\n00:00:00,500 --> 00:00:01,500\\nNow I click here.\\n\\n')
Path(p + '.txt').write_text('Now I click here.\\n')
''')
    whisper.chmod(0o755)
    model = tmp_path / 'ggml-small.bin'
    model.write_text('synthetic model placeholder')
    env = dict(os.environ, PATH=str(bin_dir) + os.pathsep + os.environ['PATH'],
               WHISPER_MODEL=str(model))
    return video, tmp_path / 'work dir', env


def run(media, *args):
    video, work, env = media
    return subprocess.run(['bash', str(SCRIPT), str(video), str(work), *args],
                          env=env, capture_output=True, text=True)


def test_manifest_and_repeat(media):
    for mode, fps in [('qa', 10), ('gems', 5)]:
        result = run(media, '--mode', mode, '--fps', str(fps))
        assert result.returncode == 0, result.stderr
        manifest = json.loads((media[1] / 'manifest.json').read_text())
        assert manifest['ready'] is True
        assert manifest['mode'] == mode and manifest['fps'] == fps
        assert 3.9 <= manifest['duration_seconds'] <= 4.1
        assert manifest['contact_sheets'] and manifest['coverage_frames']
        paths = (manifest['contact_sheets'] + manifest['coverage_frames'] +
                 list(manifest['transcript'].values()) +
                 [manifest['cues'], manifest['index'], manifest['frame_timestamps']])
        assert all(Path(p).is_absolute() and Path(p).is_file() for p in paths)
        assert all(manifest['tool_versions'][t] for t in ['ffmpeg', 'ffprobe', 'whisper-cli'])
        assert ('action' if mode == 'qa' else 'coverage-fallback') in Path(manifest['cues']).read_text()
        assert len(manifest['contact_sheets']) == len(Path(manifest['index']).read_text().splitlines())
    media[2]['WHISPER_TEST_FAIL'] = '1'
    assert run(media).returncode != 0
    assert not (media[1] / 'manifest.json').exists(), 'failed rerun must invalidate ready'


def test_missing_model_and_bad_options(media):
    media[2]['WHISPER_MODEL'] = '/nonexistent/ggml-small.bin'
    result = run(media)
    assert result.returncode != 0 and 'model' in result.stderr
    assert not (media[1] / 'manifest.json').exists()
    assert run(media, '--fps', '0').returncode == 2
    assert run(media, '--mode', 'other').returncode == 2
