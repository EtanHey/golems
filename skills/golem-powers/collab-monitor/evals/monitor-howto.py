#!/usr/bin/env python3
"""Deterministic teaching and synthetic command checks; no native Monitor claim."""
from pathlib import Path
import re
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
TEXT = (ROOT / 'SKILL.md').read_text()

def block(label):
    match = re.search(r'```bash ' + re.escape(label) + r'\n(.*?)\n```', TEXT, re.S)
    assert match, label
    return match.group(1)

def run_watch(command, update, expected):
    proc = subprocess.Popen(['/bin/bash', '-c', command], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        time.sleep(.2)
        assert proc.poll() is None, 'watch reported success before the required state'
        update()
        output, errors = proc.communicate(timeout=5)
        assert proc.returncode == 0 and expected in output, (output, errors)
    finally:
        if proc.poll() is None:
            proc.terminate()
            proc.communicate(timeout=5)

FRONT = TEXT.split('---', 2)[1]
assert 'packaged detached fallback on Codex seats' not in FRONT
assert 'Codex/T3 seats' in FRONT and 'completion' in FRONT
seats = TEXT.index('## Codex and T3 seats')
native = TEXT.index('## Native Monitor first')
fallback = TEXT.index('## Legacy cmux-only adapter')
assert '## Codex fallback' not in TEXT
assert seats < native < fallback
RULE = TEXT[seats:native]
assert 'Codex seats must not poll collabs; T3 delegate completions already wake you.' in RULE
assert 'No collab-monitor wakes in Codex' in RULE
assert 'watch_pull_request' in RULE and 'codex.subagent.mechanical' in RULE
assert '/agent-routing' in RULE
assert 'no T3 parent' in TEXT[fallback:]
assert 'timeout_ms: 1800000' in TEXT[native:fallback]
assert 'persistent' not in TEXT[native:fallback]
assert 'TaskStop' in TEXT[native:fallback]
assert 'hard expiry' in TEXT[native:fallback]
assert '/agent-routing' in TEXT and 'Routing rules (SSOT)' in TEXT
assert '$HOME/.golems/skills/' not in TEXT
assert ' run --alias ' in TEXT[native:fallback]
assert ' start ' not in TEXT[native:fallback]
assert '30 minutes' in TEXT and 'after every compaction' in TEXT
assert 'exact final line' in TEXT and 'real-client smoke' in TEXT
assert 'CronCreate' not in TEXT and 'CronDelete' not in TEXT
assert ' start ' in TEXT[fallback:] and ' follow ' in TEXT[fallback:]
assert 'node scripts/model-roles.mjs codex.subagent.mechanical --use watcher' in RULE
# Lead rules §1 (2026-10-30): every T3 lead keeps one name waiter on the leads+orc collab.
assert 'lead name waiter' in FRONT
for needle in ('exactly one name waiter', 'orc-inbox.md', '@all-leads', 't3_background_wait', 're-arm it on every wake', 'no model turns', 'Workers and children never arm it'):
    assert needle in RULE, needle

# References carry the same seat rule: any section that arms or follows the
# packaged monitor, or keeps it alive, must exclude Codex/T3 seats and stay cmux-scoped.
ARMING = re.compile(r'collab-monitor\.sh (start|follow|run)|arming `/collab-monitor`|keeps the monitor running')
for ref in sorted((ROOT / 'references').glob('*.md')):
    body = ref.read_text()
    head = body[:body.index('\n## ')]
    assert 'No polling turns' in head and 'SKILL.md#codex-and-t3-seats' in head, ref.name
    for section in re.split(r'\n(?=#{2,3} )', body):
        if ARMING.search(section):
            title = section.splitlines()[0]
            assert 'Codex and T3 seats' in section and 'never arm' in section, (ref.name, title)
            assert 'cmux' in section and 'no T3 parent' in section, (ref.name, title)
            assert 'SKILL.md#codex-and-t3-seats' in section, (ref.name, title)
CRON = (ROOT / 'references/cron-payloads.md').read_text()
GATE = CRON[CRON.index('### 9. '):CRON.index('## Rewrite Protocol')]
assert 'collab-monitor.sh start' in GATE and '`follow`' in GATE, 'cmux path must be preserved'
print('PASS no Codex/T3 polling, native-first, bounded filter, legacy cmux-only adapter, Codex/T3-excluded references, re-arm and evidence teaching')

# Watch commands run only against synthetic private fixtures.
parent = ROOT.parents[2] / 'docs.local/structure-proof/monitor-howto'
parent.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(dir=parent) as temp:
    temp = Path(temp)
    report = temp / 'report.md'
    report.write_text('DONE_FIXTURE in the introduction\nWORKING\n')
    command = block('report-done').replace('/absolute/private/report.md', str(report)).replace('DONE_LANE', 'DONE_FIXTURE')
    run_watch(command, lambda: report.write_text('Verified synthetic artifact\nDONE_FIXTURE\n'), 'REPORT_DONE')
    tool = temp / 'installed-command'
    tool.write_text('#!/bin/sh\nprintf "old-version\\n"\n')
    tool.chmod(0o700)
    command = block('installed-version').replace('/absolute/path/installed-command', str(tool)).replace('expected exact version output', 'new-version')
    run_watch(command, lambda: tool.write_text('#!/bin/sh\nprintf "new-version\\n"\n'), 'VERSION_MATCH')
print('PASS exact report DONE and installed-version transitions; native tool untested')
