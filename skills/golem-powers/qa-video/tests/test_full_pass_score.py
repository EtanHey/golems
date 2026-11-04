"""The plan scorer rejects the two original thin captures and false coverage."""
import copy
import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location('full_pass', Path(__file__).parents[1]/'evals/full-pass-score.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def capture():
    frames = [f'F{i}' for i in range(1, 49)]
    return {'case': 'silent-visual-catalog', 'available_frame_ids': frames,
            'dispatches': [{'input': {'role': 'claude.judgment'}}, {'input': {'role': 'claude.judgment image reader'}}], 'plan': {
                'selected_frame_ids': frames, 'own_frame_ids': [],
                'helper_batches': [{'frame_ids': frames[:24]}, {'frame_ids': frames[24:]}],
                'densify_windows': ['scroll', 'hover'], 'continue_with_unread_and_time': True,
                'partial_causes': ['deadline_exhausted', 'hard_error'],
                'coverage_line_template': 'frames read N/N, helpers K, budget used X/Y s'}}


def test_complete_plan_is_never_read_receipt():
    result = module.score(capture())
    assert result['pass']
    assert result['actual_frames_read'] == result['actual_helpers_completed'] == 0


def test_original_thin_runs_fail():
    for n in (7, 12, 15):
        c = capture()
        c['plan']['selected_frame_ids'] = c['plan']['own_frame_ids'] = c['available_frame_ids'][:n]
        c['plan']['helper_batches'] = []
        c['dispatches'] = []
        assert not module.score(c)['pass']


def test_early_partial_unassigned_and_invented_frames_fail():
    for mutate in (
        lambda c: c['plan']['partial_causes'].append('context_pressure'),
        lambda c: c['plan'].__setitem__('continue_with_unread_and_time', False),
        lambda c: c['plan']['selected_frame_ids'].append('NOT_IN_MANIFEST'),
        lambda c: c['plan']['helper_batches'].pop(),
        lambda c: c['dispatches'].pop(),
        lambda c: c.__setitem__('dispatches', [{'input': {'subagent_type': 'video-gems'}}]*2),
        lambda c: c['plan'].__setitem__('coverage_line_template', ''),
    ):
        c = copy.deepcopy(capture())
        mutate(c)
        assert not module.score(c)['pass']


def test_ordinary_debrief_keeps_cap():
    c = capture()
    c['case'] = 'ordinary-debrief'
    c['plan']['selected_frame_ids'] = c['plan']['own_frame_ids'] = c['available_frame_ids'][:12]
    c['plan']['helper_batches'] = []
    c['dispatches'] = []
    assert module.score(c)['pass']
    c['plan']['selected_frame_ids'] = c['available_frame_ids']
    assert not module.score(c)['pass']


def test_recorded_live_plans_replay_with_their_source_hashes():
    import hashlib
    import json
    skill = Path(__file__).parents[1]
    evidence = json.loads((skill/'evals/results/2026-11-04-full-pass.json').read_text())
    assert len(evidence['runs']) == 10
    for run in evidence['runs']:
        assert module.score(run['capture']) == run['score']
        if run['arm'] == 'candidate':
            for source in run['capture']['source_hashes']:
                assert hashlib.sha256((skill/source['file']).read_bytes()).hexdigest() == source['sha256']
            assert run['score']['pass']
        elif run['capture']['case'] != 'ordinary-debrief':
            assert not run['score']['pass']
