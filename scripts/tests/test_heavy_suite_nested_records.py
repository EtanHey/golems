"""Real nested wrappers, with scoped observation faults; cleanup itself stays native."""
import json
import os
import subprocess
import sys
import uuid

import pytest
from test_heavy_suite_lock import SCRIPT, env, load_module


def inner_command(fault):
    return [sys.executable, '-c', f'''
import importlib.util, os, sys
spec = importlib.util.spec_from_file_location('heavy_suite', {str(SCRIPT)!r})
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
native_snapshot, native_identity = m.proc.children_snapshot, m.proc.identity
target = None
injected = False
def snapshot():
    global target, injected
    rows = native_snapshot()
    if not injected:
        injected = True
        if {fault!r} == 'exception':
            raise OSError('injected observation failure')
        target = next(pid for pid, row in rows.items() if row[0] == os.getpid() and row[1] == pid)
        row = rows.pop(target)
        rows.unavailable[target] = m.proc.ProcIdentityUnavailable(
            'injected permission failure', reason='permission', uid=0, ruid=os.getuid(),
            ppid=row[0], pgid=row[1])
    return rows
def identity(pid):
    if pid == target:
        raise m.proc.ProcIdentityUnavailable('injected permission failure', reason='permission', uid=0)
    return native_identity(pid)
m.proc.children_snapshot, m.proc.identity = snapshot, identity
sys.exit(m.run_command([sys.executable, '-c', 'pass'], timeout=5, grace=.1))
''']


@pytest.mark.parametrize('fault', ['permission', 'exception'])
def test_nested_failure_survives_outer_cleanup_and_is_announced(tmp_path, fault):
    result = subprocess.run([sys.executable, str(SCRIPT), '--', *inner_command(fault)],
                            env=env(tmp_path), capture_output=True, text=True, timeout=15)
    assert result.returncode == 70, result.stderr
    directory = tmp_path / '.local/state/golems/runs'
    outer_path, = directory.glob('*.cleanup.json')
    outer = json.loads(outer_path.read_text())
    assert outer['cleanup'] == 'ok' and outer['survivors'] == []
    assert not (directory / (outer['suite_id'] + '.json')).exists()
    inner_path, = directory.glob(outer['suite_id'] + '.inner-*.json')
    inner = json.loads(inner_path.read_text())
    assert inner['nested'] is True and inner['cleanup'] == 'failed'
    assert inner['suite_id'] == outer['suite_id'] and inner['survivors'] == []
    assert inner['wrapper_pid'] != outer['wrapper_pid']
    assert inner_path.name.startswith(f"{inner['suite_id']}.inner-{inner['wrapper_pid']}-")
    assert inner['wrapper_birth'] and inner['leader_birth'] and inner['members_seen']
    assert inner['members_seen_count'] >= len(inner['members_seen'])
    if fault == 'permission':
        assert inner['reason'] == 'child-exit'
        assert f"identity-unavailable:{inner['leader_pid']}" in inner['incomplete']
        assert inner['identity_unavailable_reasons'][str(inner['leader_pid'])] == [
            {'reason': 'permission', 'uid': 0}]
    else:
        assert inner['reason'] == 'supervision-unavailable'
        assert 'supervision-unavailable' in inner['incomplete']
    assert inner['unattributed_marker_processes'] == []
    assert inner_path.stat().st_mode & 0o777 == 0o600
    assert directory.stat().st_mode & 0o777 == 0o700
    assert len(list(directory.iterdir())) == 2, 'one inner record plus outer cleanup receipt'
    done, = (line for line in result.stderr.splitlines() if 'SUITE DONE' in line)
    assert f"inner_failures=1 (see {directory}/{outer['suite_id']}.inner-*.json)" in done


@pytest.mark.parametrize('status', [0, 7])
def test_nested_successful_cleanup_has_no_record_io(monkeypatch, tmp_path, status):
    m = load_module()
    monkeypatch.setenv('HOME', str(tmp_path))
    monkeypatch.setenv('GOLEMS_HEAVY_SUITE_ID', uuid.uuid4().hex)
    def unexpected_write(*args):
        pytest.fail('successful nested cleanup attempted a record write')
    monkeypatch.setattr(m, 'save_run', unexpected_write)
    assert m.run_command([sys.executable, '-c', f'raise SystemExit({status})'], grace=.1) == status
    assert not (tmp_path / '.local').exists()


@pytest.mark.parametrize('status', [0, 7, 124])
def test_nested_failure_caps_members_without_dropping_total(monkeypatch, tmp_path, status):
    m = load_module()
    monkeypatch.setenv('HOME', str(tmp_path))
    suite_id = uuid.uuid4().hex
    monkeypatch.setenv('GOLEMS_HEAVY_SUITE_ID', suite_id)
    native_cleanup = m.cleanup_tree
    def cleanup(tree, child, *args):
        ok, survivors = native_cleanup(tree, child, *args)
        assert ok and not survivors
        # Grow only the historical diagnostic set after native cleanup has finished.
        for pid in range(500000, 517000):
            row = m.proc.ProcIdentity(pid, 1, pid, os.geteuid(), os.getuid(), tree.leader.start)
            tree.known[(pid, row.start)] = row
        tree.incomplete.add('diagnostic-fixture')
        return False, [500000]
    monkeypatch.setattr(m, 'cleanup_tree', cleanup)
    assert m.run_command([sys.executable, '-c', f'raise SystemExit({status})'], grace=.1) == (status or 70)
    path, = (tmp_path / '.local/state/golems/runs').glob(suite_id + '.inner-*.json')
    receipt = json.loads(path.read_text())
    assert len(receipt['members_seen']) == 200
    assert receipt['members_seen_count'] >= 17001
    assert receipt['members_seen'][0]['pid'] == receipt['leader_pid']
    assert receipt['survivors'] == [500000] and receipt['incomplete'] == ['diagnostic-fixture']
    assert path.stat().st_size < 100000


def test_inner_non_oserror_write_keeps_exit(monkeypatch, tmp_path, capsys):
    m = load_module()
    monkeypatch.setenv('HOME', str(tmp_path))
    monkeypatch.setenv('GOLEMS_HEAVY_SUITE_ID', uuid.uuid4().hex)
    native_cleanup = m.cleanup_tree
    def cleanup(*args):
        native_cleanup(*args)
        return False, []
    def broken(*args):
        raise TypeError('injected write failure')
    monkeypatch.setattr(m, 'cleanup_tree', cleanup)
    monkeypatch.setattr(m, 'save_run', broken)
    assert m.run_command([sys.executable, '-c', 'pass'], grace=.1) == 70
    assert capsys.readouterr().err.count('WARNING inner failure record unavailable') == 1


def test_pointer_non_oserror_warns(monkeypatch, capsys):
    m = load_module()
    def broken(*args):
        raise TypeError('injected glob failure')
    monkeypatch.setattr(m.Path, 'glob', broken)
    assert m.inner_failure_pointer(uuid.uuid4().hex) == ''
    assert capsys.readouterr().err.count('WARNING inner failure pointer unavailable') == 1


@pytest.mark.parametrize('nested', [True, False])
def test_all_diagnostic_collections_capped(monkeypatch, tmp_path, nested):
    m = load_module()
    monkeypatch.setenv('HOME', str(tmp_path))
    if nested:
        monkeypatch.setenv('GOLEMS_HEAVY_SUITE_ID', uuid.uuid4().hex)
    else:
        monkeypatch.delenv('GOLEMS_HEAVY_SUITE_ID', raising=False)
    native_cleanup = m.cleanup_tree
    def cleanup(tree, child, *args):
        native_cleanup(tree, child, *args)
        for pid in range(500000, 500250):
            row = m.proc.ProcIdentity(pid, 1, pid, os.geteuid(), os.getuid(), tree.leader.start)
            tree.known[(pid, row.start)] = row
            tree.signalled.append({'pid': pid})
            tree.incomplete.add(str(pid))
            tree.identity_reasons[pid] = [{'reason': str(i)} for i in range(250)]
            tree.unattributed[pid] = {'pid': pid}
        return False, list(range(250))
    monkeypatch.setattr(m, 'cleanup_tree', cleanup)
    assert m.run_command([sys.executable, '-c', 'pass'], grace=.1) == 70
    pattern = '*.inner-*.json' if nested else '*.cleanup.json'
    path, = (tmp_path / '.local/state/golems/runs').glob(pattern)
    record = json.loads(path.read_text())
    for field in ('members_seen', 'signalled', 'survivors', 'incomplete',
                  'identity_unavailable_reasons', 'unattributed_marker_processes'):
        assert len(record[field]) == 200, field
        assert record[field + '_total'] >= 250, field
    for key, reasons in record['identity_unavailable_reasons'].items():
        assert len(reasons) == 200
        assert record['identity_unavailable_reasons_totals'][key] == 250


@pytest.mark.parametrize('error', [KeyboardInterrupt, SystemExit])
def test_diagnostics_preserve_base_exceptions(monkeypatch, error):
    m = load_module()
    def broken(*args):
        raise error()
    monkeypatch.setattr(m.Path, 'home', broken)
    with pytest.raises(error):
        m.inner_failure_pointer(uuid.uuid4().hex)
    with pytest.raises(error):
        m.save_inner_failure({}, None, 'fixture', [])
