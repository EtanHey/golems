"""The corpus gate must reject unclassified new denials and never execute input."""
import importlib.util
from pathlib import Path
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
    assert command not in __import__('json').dumps(snapshot)
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
