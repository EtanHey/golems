"""Real ffmpeg media preparation; whisper output is deterministic in tests."""
import os
from pathlib import Path
import shutil
import subprocess
import time

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts' / 'extract.sh'


@pytest.fixture
def media(tmp_path):
    if not shutil.which('ffmpeg'):
        pytest.skip('ffmpeg missing: synthetic media prep requires ffmpeg')
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


def background(scripts, work, step, command, env):
    result = subprocess.run(['bash', str(scripts/'run-step.sh'), str(work), step, '--', *command],
                            env=env, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    logs = work/'logs'
    assert int((logs/f'{step}.pid').read_text()) > 0
    deadline = time.monotonic() + 20
    receipt = logs/f'{step}.exit'
    while not receipt.exists() and time.monotonic() < deadline:
        time.sleep(0.02)
    assert receipt.exists(), f'missing exit receipt: {step}'
    assert (logs/f'{step}.log').is_file()
    return int(receipt.read_text())


def test_extract_and_redensify(media):
    video, work, env = media
    scripts = SCRIPT.parent
    assert background(scripts, work, 'extract', ['bash', str(scripts/'extract.sh'), str(video), str(work)], env) == 0
    assert (work/'audio.wav').stat().st_size > 0
    assert 'Now I click' in (work/'transcript.srt').read_text()
    assert (work/'transcript.txt').is_file()
    scene = subprocess.run(['bash', str(scripts/'scene-cues.sh'), str(video)],
                           env=env, capture_output=True, text=True)
    assert scene.returncode == 0, scene.stderr
    cues = work/'cues.tsv'
    cues.write_text('0.5\t1.5\taction\n' + scene.stdout)
    for fps, start, end, name in [(10, 0.5, 1.5, 'dense'), (20, 1, 1.5, 'refine')]:
        cues.write_text(f'{start}\t{end}\t{name}\n')
        out = work/name
        assert background(scripts, work, name,
                          ['bash', str(scripts/'dense-windows.sh'), str(video),
                           str(cues), str(out), str(fps), '0', '0'], env) == 0
        rows = [row.split('\t') for row in (out/'index.tsv').read_text().splitlines()]
        assert rows and all(int(row[2]) == fps for row in rows)
        assert all((out/row[0]).stat().st_size > 0 for row in rows)
        times = [float(row.split('\t')[2]) for row in (out/'frames.tsv').read_text().splitlines()]
        assert times and min(times) >= start and max(times) < end
        assert times[1] - times[0] == pytest.approx(1/fps)
    env['WHISPER_TEST_FAIL'] = '1'
    assert background(scripts, work, 'extract', ['bash', str(scripts/'extract.sh'), str(video), str(work)], env) != 0
    assert not (work/'transcript.srt').exists()


def test_missing_model(media):
    video, work, env = media
    work.mkdir()
    (work/'transcript.srt').write_text('stale')
    (work/'transcript.txt').write_text('stale')
    env['WHISPER_MODEL'] = '/nonexistent/ggml-small.bin'
    result = subprocess.run(['bash', str(SCRIPT.parent/'extract.sh'), str(video), str(work)],
                            env=env, capture_output=True, text=True)
    assert result.returncode != 0 and 'model' in result.stderr
    assert not (work/'transcript.srt').exists() and not (work/'transcript.txt').exists()


def test_skill_owns_iterative_loop():
    root = SCRIPT.parents[1]
    for relative in ['SKILL.md', 'workflows/process.md', 'workflows/gems.md']:
        text = (root/relative).read_text()
        assert 'own shell' in text
        assert 'never open a terminal pane' in text.lower()
        assert 'video-qa' in text
        assert 'qa-video-runner' in text and 'video-gems' in text
        assert 'visual-gather.py' in text
        assert 'explicitly' in text and 'visible worker' in text
        assert 'never read images' in text.lower()
        assert 'run-step.sh' in text and '.log' in text and '.pid' in text and '.exit' in text
        assert 'run_command' in text and 'view_file' in text
        assert 'pending confirmation' not in text
        assert 're-densify' in text
        assert 'NOT DETERMINED' in text
        assert 'sheet' in text and 'tile' in text and 'timestamp' in text
        assert 'ready: true' not in text and 'prepare.sh' not in text


def test_qa_pipeline_agent_contract():
    root = SCRIPT.parents[1]
    agent = (root/'agents/qa-video-runner.md').read_text()
    import json
    roles = json.loads((root.parents[2]/'standards/model-roles.json').read_text())
    assert '\nrole: claude.subagent.cheap\n' in agent
    assert '\nmodel: ' + roles['roles']['claude.subagent.cheap']['alias'] + '\n' in agent
    assert '\ntools: Bash, Write, Read\n' in agent
    assert 'never read images' in agent.lower()
    assert 'visual-gather.py' in agent and 'NOT DETERMINED' in agent
    assert 'Agent tool' in agent and 're-densify' in agent.lower()
