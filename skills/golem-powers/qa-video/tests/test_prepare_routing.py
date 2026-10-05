"""Offline tool-capture scorer; no claim of live/model-based trigger routing.

Run this file with <capture.json> to score parent AND pipeline traces.
Schema: {case: qa|gems|visible, image_paths: [...], calls: [
 {actor: parent|pipeline, tool: Agent|Read|Bash|mcp__cmuxlayer__spawn_agent,
  arguments: {...}}]}. Visible spawn arguments use cli=gemini and a brief
containing the exact `agy --agent video-qa` launcher contract.
"""
import copy
import json
from pathlib import Path
import sys

import pytest

IMAGE_SUFFIXES = {'.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.heic',
                  '.avif', '.tif', '.tiff'}
PROMPTS = {'qa': 'QA this screen recording for bugs',
           'gems': 'extract gems from this YouTube talk',
           'visible': 'show me a visible Gemini worker doing the QA'}


def score(capture):
    case = capture['case']
    assert case in PROMPTS
    agents, panes, helpers = [], [], []
    for call in capture['calls']:
        tool, args = call['tool'], call.get('arguments', {})
        actor = call.get('actor', 'parent')
        assert actor in {'parent', 'pipeline'}, 'unknown trace actor'
        if tool == 'Agent':
            assert actor == 'parent', 'nested sub-agent dispatch'
            agents.append(args.get('subagent_type'))
        if 'cmux' in tool:
            assert case == 'visible' and actor == 'parent', 'unrequested pane access'
            if tool.endswith(('list_agents', 'list_surfaces')):
                continue  # Parent discovers topology before the explicit visible spawn.
            assert tool.endswith('spawn_agent'), 'media commands sent to surface'
            assert args.get('cli') == 'gemini' and 'agy --agent video-qa' in args.get('prompt', '')
            panes.append(call)
        if tool in {'Read', 'view_image', 'mcp__cua_repl__js'}:
            assert tool == 'Read', 'image tool in text-only context'
            path = args.get('file_path', '')
            assert path and path not in capture.get('image_paths', [])
            assert Path(path).suffix.lower() not in IMAGE_SUFFIXES, 'direct image Read'
        if tool == 'Bash' and 'visual-gather.py' in args.get('command', ''):
            assert actor == 'pipeline', 'lead owns default visual work'
            helpers.append(call)
    if case == 'visible':
        assert len(panes) == 1 and not agents, 'visible route missing or mixed'
    else:
        assert agents == [{'qa': 'qa-video-runner', 'gems': 'video-gems'}[case]]
        assert helpers, 'pipeline must call visual helper from Bash'


def accepted(case):
    calls = ([{'tool': 'mcp__cmuxlayer__spawn_agent', 'arguments':
               {'cli': 'gemini', 'prompt': 'Use agy --agent video-qa for this visible worker.'}}]
             if case == 'visible' else [
                 {'tool': 'Agent', 'arguments': {'subagent_type':
                  {'qa': 'qa-video-runner', 'gems': 'video-gems'}[case]}},
                 {'actor': 'pipeline', 'tool': 'Bash', 'arguments':
                  {'command': 'python3 /skill/scripts/visual-gather.py --question facts /frame.png'}}])
    if case == 'visible':
        calls.insert(0, {'tool': 'mcp__cmuxlayer__list_surfaces', 'arguments': {}})
    return {'case': case, 'prompt': PROMPTS[case], 'image_paths': ['/frame.png', '/extensionless'], 'calls': calls}


@pytest.mark.parametrize('case', PROMPTS)
def test_accept_triggers(case):
    score(accepted(case))


@pytest.mark.parametrize('actor', ['parent', 'pipeline'])
@pytest.mark.parametrize('path', ['/frame.png', '/other.JPG', '/extensionless', ''])
def test_reject_image_reads(actor, path):
    capture = accepted('qa')
    capture['calls'].append({'actor': actor, 'tool': 'Read', 'arguments': {'file_path': path}})
    with pytest.raises(AssertionError):
        score(capture)


def test_reject_route_counterexamples():
    bad = []
    for case in ('qa', 'gems'):
        c = accepted(case); c['calls'] += accepted('visible')['calls']; bad.append(c)
        c = accepted(case); c['calls'][0]['arguments']['subagent_type'] = 'visual-gatherer'; bad.append(c)
        c = accepted(case); c['calls'].pop(); bad.append(c)
    c = accepted('visible'); c['calls'] = accepted('qa')['calls']; bad.append(c)
    c = accepted('qa'); c['calls'][0]['actor'] = 'pipeline'; bad.append(c)
    c = accepted('qa'); c['calls'].append({'tool': 'view_image'}); bad.append(c)
    c = accepted('visible'); c['calls'].append({'tool': 'mcp__cmuxlayer__send_to', 'arguments': {'text': 'ffmpeg'}}); bad.append(c)
    c = accepted('visible'); c['calls'].pop(); bad.append(c)
    for c in bad:
        with pytest.raises(AssertionError):
            score(copy.deepcopy(c))
    c = accepted('qa'); c['calls'].append({'tool': 'Read', 'arguments': {'file_path': '/transcript.srt'}})
    score(c)


if __name__ == '__main__':
    score(json.loads(Path(sys.argv[1]).read_text()))
    print('PASS captured pipeline routing (offline scorer; not live dispatch proof)')
