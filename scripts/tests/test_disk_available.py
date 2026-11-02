"""Disk readers distinguish Available from bytes immediately allocatable."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
from unittest import mock

import pytest

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
            assert '13.5 GB free now' in str(exc)
            assert 'GiB' not in str(exc)
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


@pytest.mark.parametrize('available,healthy', [(131_000_000_000, True),
    (49_999_999_999, False), (50_000_000_000, True), (None, False)])
def test_last_line_survives_ratchet_consumers(tmp_path, available, healthy):
    payload = {} if available is None else dict(available_bytes=available,
        free_now_bytes=13_500_000_000, purgeable_bytes=available-13_500_000_000)
    env = dict(os.environ, PATH=fake_brain(tmp_path, payload), RATCHET_GITS_ROOT=str(tmp_path))
    env.pop('DISK_FREE_FLOOR_GB', None)
    command = str(ROOT/'scripts/ratchet/mac/disk-free-floor.sh')
    script = subprocess.run(['bash', command], env=env, capture_output=True, text=True)
    measurement = json.loads(script.stdout.splitlines()[-1])
    consumer = subprocess.run(['node', '--input-type=module', '-e', '''
        import {validDiskMeasurement, evaluate, renderTable} from './scripts/ratchet/table.mjs';
        import {runRows} from './scripts/ratchet/run-rows.mjs';
        import {readFileSync} from 'node:fs';
        const m=JSON.parse(readFileSync(0,'utf8'));
        const row=JSON.parse(readFileSync('scripts/ratchet/rows.json')).rows.find(r=>r.id==='disk-free-floor');
        row.command=process.argv[1];
        const rows={schema:1,rows:[row]}, head='c'.repeat(40);
        const results=runRows({rows,head});
        const table=evaluate({rows,baseRows:rows,results,head});
        console.log(JSON.stringify({valid:validDiskMeasurement(m),results,ok:table.ok,
            body:renderTable(table,{marker:'fixture'})}));
        ''', command], input=json.dumps(measurement), cwd=ROOT, env=env, capture_output=True, text=True)
    assert consumer.returncode == 0, consumer.stderr
    data = json.loads(consumer.stdout)
    assert data['valid'] is True
    assert data['results']['results']['disk-free-floor']['value'] is healthy
    assert data['ok'] is True  # Unhealthy measurement stays report-only WARN.
    assert measurement['floor'] == 50
    assert measurement['source'] == ('free_now_only' if available is None else 'brainlayer')
    assert measurement['available_gb'] == (None if available is None else available/1e9)
    assert 'GB free now' in data['body']
    assert 'Available' in data['body']
    if available is None:
        assert 'available_gb=unknown' in script.stdout
