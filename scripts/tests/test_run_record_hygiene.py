import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def load(path):
    spec = importlib.util.spec_from_file_location(path.stem, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_gate_prunes_only_old_owned_completed_records(tmp_path):
    gate = load(ROOT / 'hooks/private-regression-gate.py')
    root = tmp_path / 'docs.local/hooks-private-gate-runs'
    root.mkdir(parents=True)
    runs = []
    for i in range(8):
        run = root / f'{i:032x}'
        run.mkdir()
        (run / 'candidate.json').write_text('{}')
        import os
        os.utime(run, (i, i))
        runs.append(run)
    (root / 'unrelated').mkdir()
    (root / 'pending.json').write_text(json.dumps({'receipt': str(runs[0])}))
    tree = tmp_path / '.worktrees' / ('hooks-private-gate-' + runs[1].name)
    tree.mkdir(parents=True)
    (tree / 'dirty').write_text('preserve')
    gate.prune_runs(tmp_path, keep=2)
    assert runs[0].exists() and runs[1].exists()
    assert not runs[2].exists()
    assert runs[6].exists() and runs[7].exists()
    assert (tree / 'dirty').read_text() == 'preserve'
    assert (root / 'unrelated').exists()


def test_gc_reports_interrupted_intent_without_mutation(tmp_path):
    state = load(ROOT / 'lib/worktree-gc-state.py')
    journal = tmp_path / 'worktree-gc-current.log.rows.jsonl'
    journal.write_text('')
    old = tmp_path / 'worktree-gc-old.log'
    old.write_text('repo · /kept · branch · dirty=0 · ahead=0 · REMOVING · archive\n'
                   'repo · /done · branch · dirty=0 · ahead=0 · REMOVING · archive\n'
                   'repo · /done · branch · dirty=0 · ahead=0 · REMOVED · done\n')
    state.finish_report(str(journal), str(tmp_path / 'report'), '0', '1')
    report = json.loads((tmp_path / 'report/latest.json').read_text())
    assert report['orphaned_removals'][0]['path'] == '/kept'
    assert len(report['orphaned_removals']) == 1
    assert 'REMOVING-without-REMOVED' in (tmp_path / 'report/latest.md').read_text()
    assert 'REMOVING' in old.read_text()
