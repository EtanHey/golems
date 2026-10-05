"""The corpus gate must reject unclassified new denials and never execute input."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import pytest

MODULE = Path(__file__).parents[1] / 'scripts/cleanup_corpus_gate.py'
spec = importlib.util.spec_from_file_location('cleanup_corpus_gate', MODULE)
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


def test_new_denial_requires_true_positive_evidence():
    rows = [('synthetic-cwd', 'mv config.tmp config')]
    result = gate.audit(rows, lambda *_: None, lambda *_: 'static block', {})
    assert result['unclassified_new_denies'] == 1
    identity = gate.fingerprint(*rows[0])
    assert gate.audit(rows, lambda *_: None, lambda *_: 'static block',
                      {identity: {'reason': 'synthetic protected directory', 'evidence': 'synthetic regression'}})['unclassified_new_denies'] == 0
    assert gate.audit(rows, lambda *_: None, lambda *_: 'static block',
                      {identity: {'reason': '', 'evidence': 'synthetic'}})['unclassified_new_denies'] == 1


def test_snapshot_roundtrip_does_not_execute_or_retain_commands(tmp_path):
    source = tmp_path / 'session.jsonl'
    marker = tmp_path / 'must-not-exist'
    command = f'touch "{marker}"; rm -rf docs.local/scratch'
    source.write_text(__import__('json').dumps({'cwd': str(tmp_path), 'message': {'content':
        [{'type': 'tool_use', 'name': 'Bash', 'input': {'command': command}}]}}) + '\n')
    snapshot, rows = gate.capture([source], count=1)
    assert all(set(entry) == {'source', 'identity'} for entry in snapshot['entries'])
    assert all(command not in entry.values() for entry in snapshot['entries'])
    assert list(gate.replay(snapshot)) == rows
    assert not marker.exists()


def test_cli_rejects_truncated_frozen_sample(tmp_path, monkeypatch):
    snapshot = tmp_path / 'snapshot.json'
    snapshot.write_text('{}')
    monkeypatch.setattr(gate, 'replay', lambda _: [('synthetic-cwd', 'rm -r deep/scratch')])
    monkeypatch.setattr(gate, '_classifier', lambda _: lambda *_: None)
    monkeypatch.setattr(__import__('sys'), 'argv', ['gate', '--snapshot', str(snapshot),
                      '--baseline-lib', 'synthetic-base', '--candidate-lib', 'synthetic-head'])
    with pytest.raises(ValueError, match='200'):
        gate.main()


@pytest.mark.parametrize('new_denial,exit_code', [(False, 0), (True, 1)])
def test_cli_exit_code_reflects_new_unclassified_denial(tmp_path, new_denial, exit_code):
    source = tmp_path / 'session.jsonl'
    source.write_text(''.join(json.dumps({'cwd': str(tmp_path), 'message': {'content': [
        {'type': 'tool_use', 'name': 'Bash', 'input': {'command': f'rm -rf docs.local/item-{i}'}}
    ]}}) + '\n' for i in range(200)))
    snapshot, _rows = gate.capture([source])
    frozen = tmp_path / 'snapshot.json'
    frozen.write_text(json.dumps(snapshot))
    baseline = tmp_path / 'baseline.py'
    baseline.write_text('def dangerous_shell_reason(command, cwd=None): return None\n')
    candidate = tmp_path / 'candidate.py'
    candidate.write_text('def dangerous_shell_reason(command, cwd=None): return ' +
                         ("'synthetic block'" if new_denial else 'None') + '\n')
    process = subprocess.run([sys.executable, str(MODULE), '--snapshot', str(frozen),
        '--baseline-lib', str(baseline), '--candidate-lib', str(candidate)],
        text=True, capture_output=True, timeout=15)
    assert process.returncode == exit_code, process.stdout + process.stderr
    assert json.loads(process.stdout)['unclassified_new_denies'] == (200 if new_denial else 0)


def test_capture_preserves_existing_frozen_snapshot(tmp_path, monkeypatch):
    frozen = tmp_path / 'snapshot.json'
    frozen.write_text('existing immutable sample\n')
    monkeypatch.setattr(gate, 'capture', lambda _: ({'version': 1, 'entries': []}, []))
    monkeypatch.setattr(gate, '_classifier', lambda _: lambda *_: None)
    monkeypatch.setattr(sys, 'argv', ['gate', '--capture-projects', str(tmp_path),
        '--snapshot', str(frozen), '--baseline-lib', 'base', '--candidate-lib', 'head'])
    with pytest.raises(FileExistsError):
        gate.main()
    assert frozen.read_text() == 'existing immutable sample\n'


def test_failed_capture_audit_leaves_no_snapshot(tmp_path, monkeypatch):
    frozen = tmp_path / 'snapshot.json'
    monkeypatch.setattr(gate, 'capture', lambda _: ({'version': 1, 'entries': []}, []))
    monkeypatch.setattr(gate, '_classifier', lambda _: lambda *_: None)
    monkeypatch.setattr(sys, 'argv', ['gate', '--capture-projects', str(tmp_path),
        '--snapshot', str(frozen), '--baseline-lib', 'base', '--candidate-lib', 'head'])
    with pytest.raises(ValueError, match='200'):
        gate.main()
    assert not frozen.exists()
