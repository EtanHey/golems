"""Retired launchers refuse before any vendor executable or setup runs."""
import os
from pathlib import Path
import subprocess

import pytest

ROOT = Path(os.environ.get('RETIRE_TEST_ROOT', Path(__file__).resolve().parents[4]))


@pytest.mark.parametrize('flags', [[], ['--worker'], ['-p', 'gather'], ['-c'], ['-m', 'auto']])
def test_repogolem_cursor_refuses_without_setup(flags):
    script = '''
source "$1"
_golem_parse_unified_flags() { print SETUP_MUST_NOT_RUN; return 1; }
cursor() { print VENDOR_MUST_NOT_RUN; }
shift
_golem_launch_cursor fixture /missing "$@"
'''
    result = subprocess.run(['zsh', '-f', '-c', script, '_',
        str(ROOT / 'scripts/repogolem/dispatch/cursor.zsh'), *flags], capture_output=True, text=True)
    assert result.returncode != 0
    assert 'T3 delegate_task' in result.stderr
    assert 'providerInstanceId: "cursor", model: "default"' in result.stderr
    assert 'MUST_NOT_RUN' not in result.stdout + result.stderr


@pytest.mark.parametrize('flags', [[], ['--work'], ['--free']])
def test_cmux_cursor_refuses_without_launch(tmp_path, flags):
    binary = tmp_path / 'cursor'
    binary.write_text('#!/bin/sh\necho VENDOR_MUST_NOT_RUN\nexit 99\n')
    binary.chmod(0o755)
    output = tmp_path / 'output'
    result = subprocess.run(['bash', str(ROOT / 'skills/golem-powers/cmux-agents/scripts/run.sh'),
        *flags, 'cursor', 'gather', str(output)], env={**os.environ, 'PATH': f'{tmp_path}:{os.environ["PATH"]}'},
        capture_output=True, text=True)
    assert result.returncode != 0
    assert 'T3 delegate_task' in result.stderr
    assert not output.exists()
