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

native = TEXT.index('## Native Monitor first')
fallback = TEXT.index('## Codex fallback')
assert native < fallback
assert 'persistent: true' in TEXT[native:fallback]
assert ' run --alias ' in TEXT[native:fallback]
assert ' start ' not in TEXT[native:fallback]
assert '30 minutes' in TEXT and 'after every compaction' in TEXT
assert 'exact final line' in TEXT and 'real-client smoke' in TEXT
assert 'CronCreate' not in TEXT and 'CronDelete' not in TEXT
assert ' start ' in TEXT[fallback:] and ' follow ' in TEXT[fallback:]
print('PASS native-first, bounded filter, Codex fallback, re-arm and evidence teaching')

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
