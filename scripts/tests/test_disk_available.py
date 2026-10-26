"""Disk readers distinguish Available from bytes immediately allocatable."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]


def fake_brain(tmp_path, payload):
    binary = tmp_path / 'brainlayer'
    binary.write_text('#!/bin/sh\ncat <<\'JSON\'\n' + json.dumps(payload) + '\nJSON\n')
    binary.chmod(0o755)
    df = tmp_path / 'df'
    df.write_text('#!/bin/sh\nprintf "Filesystem blocks Used Available\\nfixture 99999999 0 13183593\\n"\n')
    df.chmod(0o755)
    return str(tmp_path) + os.pathsep + os.environ['PATH']


def test_ratchet_uses_available(tmp_path):
    path = fake_brain(tmp_path, dict(available_bytes=131_000_000_000,
                     free_now_bytes=13_500_000_000, purgeable_bytes=117_500_000_000))
    result = subprocess.run(['bash', str(ROOT/'scripts/ratchet/mac/disk-free-floor.sh')],
        env=dict(os.environ, PATH=path, RATCHET_GITS_ROOT=str(tmp_path)), capture_output=True, text=True)
    assert result.returncode == 0, result.stdout + result.stderr
    assert 'Available 131.0 GB (13.5 GB free now + 117.5 GB purgeable)' in result.stdout
    assert json.loads(result.stdout.splitlines()[-1])['health'] is True


def test_ratchet_fallback_is_labelled(tmp_path):
    path = fake_brain(tmp_path, {})
    result = subprocess.run(['bash', str(ROOT/'scripts/ratchet/mac/disk-free-floor.sh')],
        env=dict(os.environ, PATH=path, RATCHET_GITS_ROOT=str(tmp_path), DISK_FREE_FLOOR_GB='0'),
        capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    assert 'free-now only; purgeable unknown' in result.stdout
    data = json.loads(result.stdout.splitlines()[-1])
    assert data['purgeable_bytes'] is None
    assert data['source'] == 'free_now_only'


def test_allocation_still_refuses_with_high_available(tmp_path, monkeypatch):
    monkeypatch.setenv('PATH', fake_brain(tmp_path, dict(available_bytes=131_000_000_000,
        free_now_bytes=13_500_000_000, purgeable_bytes=117_500_000_000)))
    monkeypatch.setenv('GOLEMS_WORKTREE_MIN_FREE_GB', '15')
    spec = importlib.util.spec_from_file_location('allocation', ROOT/'scripts/repogolem/worktree-disk-floor.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    with mock.patch.object(module.shutil, 'disk_usage', return_value=mock.Mock(free=13_500_000_000)):
        try:
            module.check_space(tmp_path)
        except ValueError as exc:
            assert 'Available 131.0 GB' in str(exc)
            assert 'immediate allocation' in str(exc)
        else:
            raise AssertionError('must preserve free-now allocation gate')


def test_missing_command_is_optional(tmp_path, capsys):
    spec = importlib.util.spec_from_file_location('missing', ROOT/'scripts/repogolem/worktree-disk-floor.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    for error in (FileNotFoundError(), subprocess.TimeoutExpired('brainlayer', 8)):
        with mock.patch.object(module.shutil, 'which', return_value=None), mock.patch.object(
                module.subprocess, 'run', side_effect=error):
            assert module.disk_report(tmp_path) is None
            with mock.patch.object(module.subprocess, 'check_output', return_value=
                    'Filesystem blocks Used Available\nfixture 99999999 0 13183593\n'):
                module.measure(tmp_path)
            assert 'free-now only; purgeable unknown' in capsys.readouterr().out
