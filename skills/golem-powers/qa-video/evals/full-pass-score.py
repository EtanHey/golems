#!/usr/bin/env python3
"""Score structured planning captures, never pretend requested work was executed."""
import json
import sys
from pathlib import Path


def score(capture, batch_limit=6):
    plan = capture['plan']
    available = set(capture['available_frame_ids'])
    selected = plan['selected_frame_ids']
    batches = plan['helper_batches']
    # Whole-pass video-gems dispatch is not image-reader fan-out.
    dispatches = []
    for event in capture['dispatches']:
        args = event.get('input', event.get('item', {}).get('arguments', {}))
        if str(args.get('role', '')).split(' ', 1)[0] == 'claude.judgment' or args.get('subagent_type') in {'general-purpose', 'visual-reader'}:
            dispatches.append(event)
    assigned = [f for batch in batches for f in batch['frame_ids']]
    own = plan['own_frame_ids']
    exhaustive = capture['case'] != 'ordinary-debrief'
    valid = (set(selected) <= available and len(selected) == len(set(selected))
             and set(assigned + own) == set(selected))
    assertions = {
        'frame-plan': valid and (set(selected) == available if exhaustive else 0 < len(selected) <= 12),
        'helper-dispatch': len(dispatches) >= max(2, len(batches)) if exhaustive else True,
        'batch-plan': (len(batches) >= 2 and all(b['frame_ids'] and (batch_limit is None or len(b['frame_ids']) <= batch_limit) for b in batches)) if exhaustive else True,
        'refinement': all(x in plan['densify_windows'] for x in ['scroll', 'hover']) if exhaustive else True,
        'budget-continuation': plan['continue_with_unread_and_time'] is True if exhaustive else True,
        'partial-gate': set(plan['partial_causes']) == {'deadline_exhausted', 'hard_error'} if exhaustive else True,
        'coverage-line': all(x in plan['coverage_line_template'] for x in
                             ['frames read', 'helpers', 'budget used']) if exhaustive else bool(plan['coverage_line_template']),
    }
    return {'assertions': assertions, 'pass': all(assertions.values()),
            'planned': len(selected), 'available': len(available),
            'helper_dispatch_attempts': len(dispatches), 'planned_helpers': len(batches),
            'actual_frames_read': 0, 'actual_helpers_completed': 0,
            'proof_kind': 'stubbed-plan-only; no media reading or helper execution'}


if __name__ == '__main__':
    result = score(json.loads(Path(sys.argv[1]).read_text()))
    print(json.dumps(result, indent=2))
    sys.exit(0 if result['pass'] else 1)


def replay_semantic(capture, assertion, judgment, pin):
    """Verify a recorded semantic verdict; an untrusted baseline is not a FAIL."""
    import hashlib
    digest = lambda s: hashlib.sha256(s.encode()).hexdigest()
    judge = judgment.get('judge', {})
    quotes = judgment.get('quotes', [])
    trusted = (
        judge.get('transcriptSha256') == digest(capture['text'])
        and judge.get('claimSha256') == digest(assertion['claim'])
        and judge.get('promptSha256') == pin['prompt_sha256']
        and judge.get('model') == judge.get('modelEffective') == pin['model']
        and judge.get('effort') == pin['effort']
        and judge.get('apiKeySource') == 'ANTHROPIC_API_KEY'
        and isinstance(judgment.get('verdict'), bool)
        and isinstance(quotes, list)
        and all(isinstance(q, str) and q.strip() and q in capture['text'] for q in quotes)
        and (not judgment.get('verdict') or bool(quotes)))
    return {'trusted': bool(trusted), 'pass': bool(trusted and judgment['verdict'])}
