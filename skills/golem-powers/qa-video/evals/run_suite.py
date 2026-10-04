#!/usr/bin/env python3
"""Routing capture scorer; --live runs serial synthetic-only agy probes."""
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SKILL = HERE.parent


def score(capture):
    calls = capture['calls']
    targets = [c.get('arguments', {}).get('subagent_type') for c in calls if c['tool'] == 'Agent']
    if capture['case'] == 'judgment':
        assert 'visual-gatherer' not in targets, 'judgment delegated to gatherer'
    else:
        assert capture['case'] == 'screenshots'
        assert 'visual-gatherer' in targets, 'missing visual-gatherer dispatch'
        for call in calls:
            if call['tool'] == 'Read':
                path = call.get('arguments', {}).get('file_path', '')
                assert path and path not in capture.get('image_paths', []) and Path(path).suffix.lower() not in {
                    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.heic', '.avif', '.tif', '.tiff'
                }, 'lead reads images or Read path missing'


def contracts():
    agent = (SKILL / 'agents/visual-gatherer.md').read_text()
    assert '\ntools: Bash\n' in agent and '\nrole: claude.subagent.cheap\n' in agent
    repo = SKILL.parents[2]
    roles = json.loads((repo / 'standards/model-roles.json').read_text())
    assert '\nmodel: ' + roles['roles']['claude.subagent.cheap']['alias'] + '\n' in agent
    yes = {'case': 'screenshots', 'calls': [{'tool': 'Agent', 'arguments': {'subagent_type': 'visual-gatherer'}}]}
    score(yes)
    score(dict(yes, calls=yes['calls'] + [{'tool': 'Read', 'arguments': {'file_path': '/routing.md'}}]))
    score({'case': 'judgment', 'calls': []})
    for bad in [dict(yes, calls=[{'tool': 'Read'}]),
                dict(yes, calls=yes['calls'] + [{'tool': 'Read'}]),
                dict(yes, calls=yes['calls'] + [{'tool': 'Read', 'arguments': {'file_path': '/image.png'}}]),
                dict(yes, image_paths=['/frame'], calls=yes['calls'] + [{'tool': 'Read', 'arguments': {'file_path': '/frame'}}]),
                dict(yes, case='judgment')]:
        try:
            score(bad)
        except AssertionError:
            continue
        raise AssertionError('routing counterexample accepted')


def live():
    images = [str((HERE / 'fixtures' / (n + '.png')).resolve()) for n in ('alpha', 'beta')]
    command = [sys.executable, str(SKILL / 'scripts/visual-gather.py'), '--question',
               'For each image return finding exactly as: label=<visible label>; '
               'banner=<exact text or absent>; blue_circles=<integer count>.']
    for timeout in ('90', '0.001'):
        result = subprocess.run(command + ['--timeout', timeout, *images], text=True, capture_output=True, timeout=360)
        print(result.stderr, end='', file=sys.stderr)
        print(result.stdout, end='')
        assert result.returncode == 0
        if timeout == '90':
            assert 'Coverage: 2/2; complete' in result.stdout
            expected = ['label=ALPHA; banner=ERROR: OFFLINE; blue_circles=3',
                        'label=BETA; banner=absent; blue_circles=5']
            assert result.stdout.splitlines()[1:] == [p + ': ' + e for p, e in zip(images, expected)]
        else:
            assert 'Coverage: 0/2; partial' in result.stdout
            assert result.stdout.count('NOT DETERMINED') == 2


if __name__ == '__main__':
    contracts()
    if '--live' in sys.argv:
        live()
    elif len(sys.argv) == 2:
        score(json.loads(Path(sys.argv[1]).read_text()))
    print('PASS visual-gatherer contracts' + (' and live probes' if '--live' in sys.argv else ' (no model calls)'))
