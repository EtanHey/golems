#!/usr/bin/env python3
"""Source-contract regression checks, not behavioral A/B or native delivery proof."""
import argparse
from pathlib import Path


def sections(repo):
    plan = repo / 'skills/golem-powers/large-plan'
    skill = (plan / 'SKILL.md').read_text()
    claude = (plan / 'adapters/claude.md').read_text()
    collab = (plan / 'workflows/collab.md').read_text()

    def between(text, start, end):
        # A removed section fails closed instead of searching unrelated prose.
        return text.partition(start)[2].partition(end)[0]

    scopes = {
        'round': between(skill, 'When a round has parallel phases,', '### Plan Lifecycle'),
        'parallel': between(skill, '**The orchestrator MUST:**', 'Fleet law for claim/guard'),
        'claude': between(claude, '## Collab Monitoring', '## Plan Mode'),
        'arm': between(collab, '### 4. Arm addressed watches', '### 5. Launch agents'),
        'guard': between(collab, '### WATCH RULE', '### TASK USAGE'),
        'participation': collab.partition('## Participation law')[2],
    }
    return {name: ' '.join(text.split()) for name, text in scopes.items()}


# Literal source requirements pin this repair's teaching contract; these do not
# grade an agent's English response. Case 7 retains the routing/runtime checks.
REQUIRED = {
    'round': {
        'routing': ('Claude uses native Monitor', 'Codex uses packaged `start`/`status`/`follow`'),
        'attachment': ('consumer attached', 'before dispatching any worker'),
        'readiness': ('native Monitor returns its task ID', 'Codex fallback: `STARTED`/`FOLLOWING`'),
        'liveness': ('MUST NOT be the only worker-liveness guard', 'separate liveness watchers are armed'),
    },
    'parallel': {
        'routing': ('Claude uses native Monitor', 'Codex uses packaged `start`/`status`/`follow`'),
        'attachment': ('consumer attached', 'before dispatching any worker'),
        'readiness': ('native Monitor returns its task ID', 'Codex fallback: `STARTED`/`FOLLOWING`'),
        'liveness': ('MUST NOT be the only worker-liveness guard', 'separate liveness watchers are armed'),
        'expiry': ('30-minute expiry', 'after every compaction', 're-arm'),
        'cleanup': ('returned watch identifier', 'TaskStop before replacing', 'closing its lane'),
        'state': ('same routing state', 'do not attach duplicate streams', 'Stop the Codex fallback by listen name'),
        'evidence': ('unique ISO timestamp', 'verify the report and requested artifact'),
    },
    'claude': {
        'routing': ('/collab-monitor', 'native Monitor', 'Codex seats', 'packaged fallback', 'attached consumer'),
        'attachment': ('before dispatch',),
        'expiry': ('30-minute expiry', 'after every compaction', 're-arm'),
        'cleanup': ('returned task ID', 'TaskStop before replacing', 'plan closes'),
        'state': ('routing state', 'avoid duplicate streams'),
        'liveness': ('separate process-exit', 'MUST NOT be the only worker-liveness guard'),
        'evidence': ('artifact or real-client verification',),
    },
    'arm': {
        'routing': ('/collab-monitor', 'native Monitor', 'Codex seats', 'packaged `start`/`status`/`follow`'),
        'attachment': ('attached consumer before dispatch',),
        'expiry': ('30-minute expiry', 'after every compaction', 're-arm'),
        'cleanup': ('returned task ID', 'TaskStop', 'before replacing', 'closing its lane', '`stop` by listen name'),
        'state': ('routing state', 'avoid duplicate streams'),
        'liveness': ('separate process-exit', 'liveness watcher before dispatch'),
        'evidence': ('unique ISO timestamp', 'requested artifact before advancing'),
    },
    'guard': {
        'routing': ('/collab-monitor', 'native Monitor (Claude)', 'packaged fallback', 'attached consumer (Codex)'),
        'liveness': ('Before sending a task, arm a process-exit', 'MUST NOT be the only worker-liveness guard'),
        'lifecycle': ('lifecycle in step 4', 'expiry, compaction re-arm and cleanup'),
    },
    'participation': {
        'routing': ('/collab-monitor', 'Claude: native Monitor', 'Codex: packaged `start`/`status`/`follow`'),
        'attachment': ('attached consumer', 'engine-issued mailbox contract'),
        'lifecycle': ('Re-arm on expiry and after every compaction', 'Stop the watcher'),
    },
}
FORBIDDEN = ('run --once @<listen-name>', '/loop ', 'tail -n0 -F', 'grep done collab.md')


def failures(texts):
    failed = []
    for scope, requirements in REQUIRED.items():
        for name, fragments in requirements.items():
            if any(fragment not in texts[scope] for fragment in fragments):
                failed.append(f'{scope}:{name}')
        if any(fragment in texts[scope] for fragment in FORBIDDEN):
            failed.append(f'{scope}:obsolete-recipe')
    return failed


# Independent fault scenarios exercise the accepted lifecycle, not just the old
# two string assertions. All mutations are in memory; no live watches are armed.
NEGATIVE_CONTROLS = (
    ('round', 'Claude uses native Monitor', 'routing'),
    ('parallel', 'Codex uses packaged `start`/`status`/`follow`', 'routing'),
    ('round', 'consumer attached', 'attachment'),
    ('parallel', 'before dispatching any worker', 'attachment'),
    ('round', 'native Monitor returns its task ID', 'readiness'),
    ('parallel', 'MUST NOT be the only worker-liveness guard', 'liveness'),
    ('parallel', '30-minute expiry', 'expiry'),
    ('parallel', 'after every compaction', 'expiry'),
    ('parallel', 'TaskStop before replacing', 'cleanup'),
    ('parallel', 'same routing state', 'state'),
    ('parallel', 'unique ISO timestamp', 'evidence'),
    ('claude', '/collab-monitor', 'routing'),
    ('claude', 'native Monitor', 'routing'),
    ('claude', 'attached consumer', 'routing'),
    ('claude', 'before dispatch', 'attachment'),
    ('claude', '30-minute expiry', 'expiry'),
    ('claude', 'after every compaction', 'expiry'),
    ('claude', 'TaskStop before replacing', 'cleanup'),
    ('claude', 'routing state', 'state'),
    ('claude', 'MUST NOT be the only worker-liveness guard', 'liveness'),
    ('arm', 'native Monitor', 'routing'),
    ('arm', 'packaged `start`/`status`/`follow`', 'routing'),
    ('arm', 'attached consumer before dispatch', 'attachment'),
    ('arm', '30-minute expiry', 'expiry'),
    ('arm', 'after every compaction', 'expiry'),
    ('arm', 'TaskStop', 'cleanup'),
    ('arm', 'routing state', 'state'),
    ('arm', 'liveness watcher before dispatch', 'liveness'),
    ('arm', 'unique ISO timestamp', 'evidence'),
    ('guard', 'attached consumer (Codex)', 'routing'),
    ('guard', 'MUST NOT be the only worker-liveness guard', 'liveness'),
    ('participation', 'attached consumer', 'attachment'),
    ('participation', 'Re-arm on expiry and after every compaction', 'lifecycle'),
)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, default=Path(__file__).resolve().parents[4])
    args = parser.parse_args()
    texts = sections(args.repo)
    failed = failures(texts)
    if failed:
        for name in failed:
            print('FAIL teaching ' + name)
        return 1
    for scope, fragment, name in NEGATIVE_CONTROLS:
        if fragment not in texts[scope]:
            raise RuntimeError(f'negative control missing its target: {scope}:{fragment}')
        mutant = dict(texts, **{scope: texts[scope].replace(fragment, '')})
        if f'{scope}:{name}' not in failures(mutant):
            raise RuntimeError(f'negative control falsely passed: {scope}:{fragment}')
        print(f'PASS negative control {scope}:{name} remove={fragment}')
    # Old recipe alone must not satisfy the replacement assertions.
    for scope in ('claude', 'arm'):
        mutant = dict(texts, **{scope: 'collab-monitor/scripts/collab-monitor.sh run --once @<listen-name>'})
        assert f'{scope}:routing' in failures(mutant)
        assert f'{scope}:obsolete-recipe' in failures(mutant)
        print(f'PASS negative control {scope}:obsolete-only')
    print(f'PASS teaching contract; negative_controls={len(NEGATIVE_CONTROLS) + 2}; native delivery untested')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
