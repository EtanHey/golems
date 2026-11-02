"""Offline tool-capture scorer; no claim of live/model-based trigger routing.

Run this file with <capture.json> to score parent AND pipeline traces.
Schema: {case: qa|gems|visible, image_paths: [...], calls: [
 {actor: parent|pipeline, tool: Agent|mcp__t3-code__delegate_task|Read|Bash|mcp__cmuxlayer__spawn_agent,
  arguments: {...}}]}. Visible spawn arguments use cli=gemini and a brief
containing the exact `agy --agent video-qa` launcher contract. The pipeline
must view at least one image itself; a visual-batch.py call is optional pre-sort.
QA/debrief (2026-11-02 rule): the parent (the QA seat) fans out >=2 judgment-tier
helpers itself plus >=1 mechanical-tier verifier, and never one qa-video-runner.
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
           'debrief': 'debrief this interview',
           'visible': 'show me a visible Gemini worker doing the QA'}


DISPATCH = {'Agent', 'mcp__t3-code__delegate_task'}
TIERS = {'opus': 'helper', 'claude-opus-5-5': 'helper', 'haiku': 'verifier', 'claude-haiku-5-5': 'verifier'}


def tier(tool, args):
    model = args.get('model') if tool == 'Agent' else (args.get('target') or {}).get('model')
    if tool == 'Agent' and args.get('subagent_type') in {'qa-video-runner', 'video-gems', 'visual-gatherer'}:
        return args['subagent_type']
    return TIERS.get(model, f'other:{model}')


def score(capture):
    case = capture['case']
    assert case in PROMPTS
    agents, panes, viewed = [], [], []
    for call in capture['calls']:
        tool, args = call['tool'], call.get('arguments', {})
        actor = call.get('actor', 'parent')
        assert actor in {'parent', 'pipeline'}, 'unknown trace actor'
        if tool in DISPATCH:
            assert actor == 'parent', 'nested sub-agent dispatch'
            agents.append(tier(tool, args))
        if 'cmux' in tool:
            assert case == 'visible' and actor == 'parent', 'unrequested pane access'
            if tool.endswith(('list_agents', 'list_surfaces')):
                continue  # Parent discovers topology before the explicit visible spawn.
            assert tool.endswith('spawn_agent'), 'media commands sent to surface'
            assert args.get('cli') == 'gemini' and 'agy --agent video-qa' in args.get('prompt', '')
            panes.append(call)
        if tool in {'Read', 'view_image', 'mcp__cua_repl__js'}:
            assert tool == 'Read', 'non-Read image tool'
            path = args.get('file_path', '')
            assert path, 'Read without an auditable path'
            if path in capture.get('image_paths', []) or Path(path).suffix.lower() in IMAGE_SUFFIXES:
                assert actor == 'pipeline', 'lead image Read'
                viewed.append(path)
        if tool == 'Bash' and any(name in args.get('command', '') for name in ('visual-batch.py', 'debrief.py')):
            import re
            assert not re.search(r'(?:^|[;\n])\s*(?:for|while)\s|\b(?:mapfile|readarray)\b', args['command']), 'hand-rolled sheet loop'
            # QA/debrief: the QA seat (parent) runs extraction, including debrief.py, in its own
            # shell (2026-11-02 route). Gems keeps debrief.py inside the video-gems pipeline.
            # The exemption covers debrief.py alone: a seat command that also runs visual-batch.py
            # is seat-owned visual work and must still fail (review r2 counterexample).
            seat_extraction = (case in {'qa', 'debrief'} and 'debrief.py' in args['command']
                               and 'visual-batch.py' not in args['command'])
            assert actor == 'pipeline' or seat_extraction, 'lead owns default visual work'
    if case == 'visible':
        assert len(panes) == 1 and not agents, 'visible route missing or mixed'
    else:
        if case == 'gems':
            assert agents == ['video-gems']
        else:
            assert 'qa-video-runner' not in agents, 'single runner instead of the fan-out'
            assert agents.count('helper') >= 2, 'QA seat did not fan out >=2 helpers'
            assert 'verifier' in agents, 'no verifier re-read the findings'
            assert set(agents) <= {'helper', 'verifier'}, 'unexpected dispatch'
        assert viewed, 'pipeline never viewed a frame itself (helper text is not evidence)'


HELPER = {'actor': 'pipeline', 'tool': 'Bash', 'arguments':
          {'command': 'python3 /skill/scripts/visual-batch.py --workdir /run --question facts /frame.png'}}


def accepted(case):
    calls = ([{'tool': 'mcp__cmuxlayer__spawn_agent', 'arguments':
               {'cli': 'gemini', 'prompt': 'Use agy --agent video-qa for this visible worker.'}}]
             if case == 'visible' else ([
                 {'tool': 'Agent', 'arguments': {'subagent_type': 'video-gems'}}] if case == 'gems' else [
                 {'tool': 'Agent', 'arguments': {'subagent_type': 'general-purpose', 'model': 'opus'}},
                 {'tool': 'mcp__t3-code__delegate_task', 'arguments': {'target': {'model': 'claude-opus-5-5'}}},
                 {'tool': 'Agent', 'arguments': {'subagent_type': 'general-purpose', 'model': 'haiku'}}]) + [
                 {'actor': 'pipeline', 'tool': 'Read', 'arguments': {'file_path': '/frame.png'}}])
    if case == 'visible':
        calls.insert(0, {'tool': 'mcp__cmuxlayer__list_surfaces', 'arguments': {}})
    if case == 'debrief':
        calls.insert(0, {'tool': 'Bash', 'arguments': {'command':
                         'bash /skill/scripts/run-step.sh /run debrief -- python3 /skill/scripts/debrief.py /v.mov --workdir /run --mode debrief'}})
    return {'case': case, 'prompt': PROMPTS[case], 'image_paths': ['/frame.png', '/extensionless'], 'calls': calls}


@pytest.mark.parametrize('case', PROMPTS)
def test_accept_triggers(case):
    score(accepted(case))


@pytest.mark.parametrize('path', ['/frame.png', '/other.JPG', '/extensionless', ''])
def test_reject_lead_image_reads(path):
    capture = accepted('qa')
    capture['calls'].append({'actor': 'parent', 'tool': 'Read', 'arguments': {'file_path': path}})
    with pytest.raises(AssertionError):
        score(capture)


@pytest.mark.parametrize('case', ['qa', 'debrief', 'gems'])
def test_pipeline_views_frames_itself_helper_optional(case):
    capture = accepted(case)
    capture['calls'] += [{'actor': 'pipeline', 'tool': 'Read', 'arguments': {'file_path': p}}
                         for p in ('/other.JPG', '/extensionless')]
    score(capture)
    capture['calls'].insert(1, HELPER)
    score(capture)
    helper_only = accepted(case)
    helper_only['calls'][-1] = HELPER
    with pytest.raises(AssertionError, match='never viewed'):
        score(helper_only)
    capture['calls'].append({'actor': 'pipeline', 'tool': 'Read', 'arguments': {'file_path': ''}})
    with pytest.raises(AssertionError, match='auditable'):
        score(capture)


def test_reject_route_counterexamples():
    bad = []
    for case in ('qa', 'gems'):
        c = accepted(case); c['calls'] += accepted('visible')['calls']; bad.append(c)
        c = accepted(case); c['calls'][0]['arguments'] = {'subagent_type': 'visual-gatherer'}; bad.append(c)
        c = accepted(case); c['calls'].pop(); bad.append(c)
    c = accepted('visible'); c['calls'] = accepted('qa')['calls']; bad.append(c)
    c = accepted('qa'); c['calls'][0]['actor'] = 'pipeline'; bad.append(c)
    c = accepted('qa'); c['calls'].append({'tool': 'view_image'}); bad.append(c)
    c = accepted('visible'); c['calls'].append({'tool': 'mcp__cmuxlayer__send_to', 'arguments': {'text': 'ffmpeg'}}); bad.append(c)
    c = accepted('visible'); c['calls'].pop(); bad.append(c)
    runner = accepted('qa'); runner['calls'][:3] = [{'tool': 'Agent', 'arguments': {'subagent_type': 'qa-video-runner'}}]
    one = accepted('qa'); del one['calls'][1]
    unverified = accepted('debrief'); del unverified['calls'][2]
    bad += [runner, one, unverified]
    gems_seat = accepted('gems'); gems_seat['calls'].insert(0, {'tool': 'Bash', 'arguments':
                 {'command': 'python3 /skill/scripts/debrief.py /v.mov --workdir /run --mode gems'}})
    seat_batch = accepted('qa'); seat_batch['calls'].insert(0, {'tool': 'Bash', 'arguments':
                 {'command': 'python3 /skill/scripts/visual-batch.py --workdir /run --question q /f.png'}})
    seat_combined = accepted('qa'); seat_combined['calls'].insert(0, {'tool': 'Bash', 'arguments':
                 {'command': 'python3 /skill/scripts/debrief.py /v.mov --workdir /run --mode qa && python3 /skill/scripts/visual-batch.py --workdir /run --question q /f.png'}})
    bad += [gems_seat, seat_batch, seat_combined]
    for c in bad:
        with pytest.raises(AssertionError):
            score(copy.deepcopy(c))
    c = accepted('qa'); c['calls'].append({'tool': 'Read', 'arguments': {'file_path': '/transcript.srt'}})
    score(c)


if __name__ == '__main__':
    score(json.loads(Path(sys.argv[1]).read_text()))
    print('PASS captured pipeline routing (offline scorer; not live dispatch proof)')


def test_reject_handrolled_visual_loop():
    capture = accepted('debrief')
    capture['calls'].append({'actor': 'pipeline', 'tool': 'Bash', 'arguments':
                             {'command': 'for sheet in sheets; do python3 visual-batch.py; done'}})
    with pytest.raises(AssertionError, match='hand-rolled'):
        score(capture)
