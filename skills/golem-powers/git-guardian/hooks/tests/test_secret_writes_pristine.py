"""Pristine regressions: syntax brackets do not imply a guarded target."""
import json
from pathlib import Path

import pytest

from test_secret_writes import hook


CASES = json.loads((Path(__file__).resolve().parents[5] /
                    'scripts/tests/fixtures/pristine-harness/corpus.json').read_text())
IDS = {f'git-guardian-{number:03d}' for number in (46, 47, 48, 50, 54)}
ROWS = [(case['id'], json.loads(case['input'])['tool_input']['command'])
        for case in CASES if case['id'] in IDS]


@pytest.mark.parametrize('case,command', ROWS, ids=[case for case, _ in ROWS])
def test_pristine_variable_redirect_without_guarded_name(tmp_path, case, command):
    assert hook(tmp_path, 'Bash', command=command) == 0, case


@pytest.mark.parametrize('command', [
    'if [[ -n "$X" ]]; then printf x > "$OUT"; fi',
    'sh -c \'if [ -n "$X" ]; then printf x > "$OUT"; fi\'',
])
def test_test_brackets_do_not_create_guarded_context(tmp_path, command):
    assert hook(tmp_path, 'Bash', command=command) == 0


@pytest.mark.parametrize('command', [
    'grep FOO .env.example > "$OUT"',
    'for f in a b; do echo $f > "$f.txt"; done; cat .env',
    'cat .env; sh -c \'printf x > "$OUT"\'',
    'rm secret.yaml',
])
def test_guarded_name_keeps_fail_closed_context(tmp_path, command):
    assert hook(tmp_path, 'Bash', command=command) == 2
