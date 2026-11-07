"""The plan scorer rejects the two original thin captures and false coverage."""
import copy
import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location('full_pass', Path(__file__).parents[1]/'evals/full-pass-score.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def capture():
    frames = [f'F{i}' for i in range(1, 49)]
    batches = [{'frame_ids': frames[max(0, i-1):i+5]} for i in range(0, len(frames), 5)]
    return {'case': 'silent-visual-catalog', 'available_frame_ids': frames,
            'dispatches': [{'input': {'role': 'claude.judgment image reader'}} for _ in batches], 'plan': {
                'selected_frame_ids': frames, 'own_frame_ids': [],
                'helper_batches': batches,
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
        lambda c: c['plan'].__setitem__('helper_batches', [{'frame_ids': c['available_frame_ids'][:24]}, {'frame_ids': c['available_frame_ids'][24:]}]),
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


def test_historical_plans_replay_without_claiming_current_text():
    import json
    skill = Path(__file__).parents[1]
    evidence = json.loads((skill/'evals/results/2026-11-04-full-pass.json').read_text())
    assert len(evidence['runs']) == 10
    assert evidence['historical_only'] and evidence['source_ref'] == '9cef80ad'
    for run in evidence['runs']:
        assert module.score(run['capture'], batch_limit=None) == run['score']
        if run['arm'] == 'candidate':
            for source in run['capture']['source_hashes']:
                assert len(source['sha256']) == 64 and int(source['sha256'], 16) >= 0
            assert run['score']['pass']
        elif run['capture']['case'] != 'ordinary-debrief':
            assert not run['score']['pass']


def test_unseeded_semantic_records_and_source_hashes():
    import hashlib
    import json
    skill = Path(__file__).parents[1]
    evidence = json.loads((skill/'evals/results/2026-11-04-full-pass-r2.json').read_text())
    assert len(evidence['runs']) == 12
    for run in evidence['runs']:
        c = run['capture']
        assert module.replay_semantic(c, run['assertion'], run['judgment'], evidence['semantic_judge_pin']) == run['score']
        assert run['score']['trusted']
        assert all(token not in c['prompt_redacted'] for token in
                   ['selected_frame_ids', 'helper_batches', 'partial_causes', 'deadline_exhausted', 'context_pressure', 'scroll', 'hover'])
        if run['arm'] == 'candidate':
            # The measured text is pinned as committed snapshots, so later edits to the live
            # skill files can't break this evidence check (and can't silently "match" it either).
            snapshots = skill/'evals/results/sources/2026-11-04-full-pass-r2'
            for s in c['source_hashes']:
                assert hashlib.sha256((snapshots/(s['file'] + '.snapshot')).read_bytes()).hexdigest() == s['sha256']
        altered = dict(c, text=c['text']+' changed')
        assert not module.replay_semantic(altered, run['assertion'], run['judgment'], evidence['semantic_judge_pin'])['trusted']
    silent = [r for r in evidence['runs'] if r['arm'] == 'candidate' and r['capture']['case'] == 'silent-visual-catalog']
    assert [r['score']['pass'] for r in silent] == [True, False, True]
