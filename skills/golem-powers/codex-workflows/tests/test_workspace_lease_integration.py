"""The workflow CLI owns a durable lease and retirement receipt per allocation."""
import json
import os
from pathlib import Path
import subprocess
import tempfile

import pytest

ROOT = Path(__file__).resolve().parents[4]
CLI = ROOT / 'skills/golem-powers/codex-workflows/scripts/codex-workflows.sh'


@pytest.fixture
def workflow(tmp_path):
    scratch = ROOT / 'docs.local'
    scratch.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='workflow-lease-test-', dir=scratch) as directory:
        ledger = Path(directory) / 'ledger'
        env = {**os.environ, 'GOLEMS_WORKSPACE_LEASES': str(ledger), 'GOLEMS_WORKTREE_MIN_FREE_GB': '0', 'GIT_CONFIG_GLOBAL': os.devnull, 'GIT_CONFIG_NOSYSTEM': '1'}
        def git(*args, cwd=None):
            return subprocess.run(['git', *map(str, args)], cwd=cwd, env=env, check=True, capture_output=True, text=True)
        source, origin, repo = (tmp_path / x for x in ('source', 'origin.git', 'repo'))
        git('init', '--initial-branch=main', source)
        git('config', 'user.email', 'fixture@example.com', cwd=source)
        git('config', 'user.name', 'Fixture', cwd=source)
        (source / 'README').write_text('fixture\n')
        (source / '.gitignore').write_text('.worktrees/\n')
        git('add', 'README', '.gitignore', cwd=source)
        git('commit', '-m', 'fixture', cwd=source)
        git('clone', '--bare', source, origin)
        git('clone', origin, repo)
        codex = tmp_path / 'codex'
        codex.write_text('#!/bin/sh\nprintf \'%s\\n\' \'{"type":"item.completed","item":{"id":"a","type":"agent_message","text":"TASK_DONE"}}\'\nsleep 1\n')
        codex.chmod(0o755)
        env['CODEX_BIN'] = str(codex)
        brief = tmp_path / 'brief'
        brief.write_text('fixture')
        manifest = repo / '.worktrees' / 'run' / 'manifest.json'
        def cli(*args):
            return subprocess.run([str(CLI), *map(str, args)], cwd=tmp_path, env=env, capture_output=True, text=True, timeout=30)
        def launch():
            return cli('agent', '--repo', repo, '--name', 'worker', '--brief', brief, '--lead', 'lead', '--manifest', manifest, '--model', 'fixture', '--launch-timeout', '0.2')
        yield type('Workflow', (), {'ledger': ledger, 'env': env, 'repo': repo, 'manifest': manifest, 'cli': staticmethod(cli), 'launch': staticmethod(launch), 'git': staticmethod(git)})


def test_bound_lease_matches_worker(workflow):
    result = workflow.launch()
    assert result.returncode == 0, result.stderr
    worker = json.loads(workflow.manifest.read_text())['workers']['worker']
    lease = json.loads((workflow.ledger / (worker['lease_id'] + '.json')).read_text())
    assert lease['state'] == 'bound'
    assert lease['path'] == worker['worktree']
    assert lease['head'] == workflow.git('rev-parse', 'HEAD', cwd=worker['worktree']).stdout.strip() == worker['head']
    assert lease['allocator'] == 'codex-workflows'


def test_reserve_failure_does_not_allocate(workflow):
    workflow.ledger.mkdir(mode=0o500)
    try:
        result = workflow.launch()
        worker = json.loads(workflow.manifest.read_text())['workers']['worker']
        assert result.returncode != 0
        assert worker['status'] == 'failed_launch' and 'do not allocate' in worker['reason']
        assert not Path(worker['worktree']).exists()
    finally:
        workflow.ledger.chmod(0o700)


@pytest.mark.parametrize('dirty', [False, True])
def test_cleanup_records_disposition_and_closes_lease(workflow, dirty):
    result = workflow.launch()
    assert result.returncode == 0, result.stderr
    watched = workflow.cli('watch', '--manifest', workflow.manifest, '--timeout', '5', '--interval', '0.05')
    assert watched.returncode == 0, watched.stderr
    worker = json.loads(workflow.manifest.read_text())['workers']['worker']
    path = Path(worker['worktree'])
    if dirty:
        (path / 'untracked').write_text('preserve')
    harvested = workflow.cli('harvest', '--manifest', workflow.manifest)
    assert harvested.returncode == 0, harvested.stderr
    cleanup = workflow.cli('cleanup', '--manifest', workflow.manifest)
    assert (cleanup.returncode != 0) is dirty
    worker = json.loads(workflow.manifest.read_text())['workers']['worker']
    receipt = json.loads((workflow.manifest.parent / 'worker.retire.json').read_text())
    lease = json.loads((workflow.ledger / (worker['lease_id'] + '.json')).read_text())
    disposition = 'RETAINED' if dirty else 'REMOVED'
    assert receipt['disposition'] == worker['retirement_disposition'] == disposition
    assert lease['state'] == ('bound' if dirty else 'closed')
    if not dirty:
        assert lease['disposition'] == disposition
    assert path.exists() is dirty
    if dirty:
        assert worker['retirement_reason'] == receipt['reason']


@pytest.mark.parametrize('invalid', [None, 'schema', 'path', 'repo_common_dir', 'physical_after', 'recreated'])
def test_close_failure_recovers_without_repeating_retirement(workflow, monkeypatch, invalid):
    import importlib.util

    result = workflow.launch()
    assert result.returncode == 0, result.stderr
    assert workflow.cli('watch', '--manifest', workflow.manifest, '--timeout', '5', '--interval', '0.05').returncode == 0
    assert workflow.cli('harvest', '--manifest', workflow.manifest).returncode == 0
    module_path = CLI.parent / 'codex_workflows.py'
    spec = importlib.util.spec_from_file_location('recovery_workflow', module_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    monkeypatch.setenv("GOLEMS_WORKSPACE_LEASES", str(workflow.ledger))
    real_tool = module._workers.lifecycle_tool
    calls = []

    def interrupted(tool, *args, **kwargs):
        calls.append((tool, args[0]))
        if tool == 'lease.py' and args[0] == 'close':
            if sum(call == ('lease.py', 'close') for call in calls) == 1:
                workflow.ledger.chmod(0o500)
                try:
                    return real_tool(tool, *args, **kwargs)
                finally:
                    workflow.ledger.chmod(0o700)
        return real_tool(tool, *args, **kwargs)

    monkeypatch.setattr(module._workers, 'lifecycle_tool', interrupted)
    with pytest.raises(module.CodexWorkflowError, match='not writable'):
        module.cleanup_worker(workflow.manifest, 'worker')
    receipt_path = workflow.manifest.parent / 'worker.retire.json'
    original = receipt_path.read_bytes()
    worker = json.loads(workflow.manifest.read_text())['workers']['worker']
    token_path = workflow.manifest.parent / '.worker.close-token'
    assert token_path.stat().st_mode & 0o077 == 0
    assert token_path.read_text() not in workflow.manifest.read_text()
    assert not Path(worker['worktree']).exists()
    assert json.loads((workflow.ledger / (worker['lease_id'] + '.json')).read_text())['state'] != 'closed'
    if invalid:
        if invalid == 'recreated':
            Path(worker['worktree']).mkdir()
        else:
            tampered = json.loads(original)
            tampered[invalid] = True if invalid == 'physical_after' else 'mismatch'
            receipt_path.write_text(json.dumps(tampered))
        with pytest.raises(module.CodexWorkflowError, match='cannot resume retirement receipt'):
            module.cleanup_worker(workflow.manifest, 'worker')
        assert sum(call == ('retire.py', '--repo') for call in calls) == 1
        assert json.loads((workflow.ledger / (worker['lease_id'] + '.json')).read_text())['state'] != 'closed'
        return
    module.cleanup_worker(workflow.manifest, 'worker')
    assert receipt_path.read_bytes() == original
    assert sum(call == ('retire.py', '--repo') for call in calls) == 1
    assert json.loads((workflow.ledger / (worker['lease_id'] + '.json')).read_text())['state'] == 'closed'
    assert json.loads(workflow.manifest.read_text())['workers']['worker']['cleaned_at']
    assert not token_path.exists()


def test_consumer_add_after_begin_close_is_refused(workflow, monkeypatch):
    import importlib.util
    result = workflow.launch()
    assert result.returncode == 0, result.stderr
    assert workflow.cli('watch', '--manifest', workflow.manifest, '--timeout', '5', '--interval', '0.05').returncode == 0
    assert workflow.cli('harvest', '--manifest', workflow.manifest).returncode == 0
    spec = importlib.util.spec_from_file_location('interleave_workflow', CLI.parent / 'codex_workflows.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    monkeypatch.setenv('GOLEMS_WORKSPACE_LEASES', str(workflow.ledger))
    real_tool = module._workers.lifecycle_tool
    attempted = []

    def interleave(tool, *args, **kwargs):
        result = real_tool(tool, *args, **kwargs)
        if tool == 'lease.py' and args[0] == 'begin-close':
            lease_id = args[args.index('--lease-id') + 1]
            attempt = real_tool('lease.py', 'consumer', 'add', '--lease-id', lease_id,
                                '--who', 'reviewer', check=False)
            attempted.append(attempt)
        return result

    monkeypatch.setattr(module._workers, 'lifecycle_tool', interleave)
    module.cleanup_worker(workflow.manifest, 'worker')
    worker = json.loads(workflow.manifest.read_text())['workers']['worker']
    lease = json.loads((workflow.ledger / (worker['lease_id'] + '.json')).read_text())
    assert len(attempted) == 1 and attempted[0].returncode != 0
    assert 'closing' in attempted[0].stderr
    assert lease['consumers'] == [] and lease['state'] == 'closed'
    assert worker['retirement_disposition'] == 'REMOVED'
    assert not Path(worker['worktree']).exists()


def test_outstanding_consumer_retains_worktree(workflow):
    assert workflow.launch().returncode == 0
    assert workflow.cli('watch', '--manifest', workflow.manifest, '--timeout', '5', '--interval', '0.05').returncode == 0
    assert workflow.cli('harvest', '--manifest', workflow.manifest).returncode == 0
    worker = json.loads(workflow.manifest.read_text())['workers']['worker']
    lease_cli = ROOT / 'scripts/workspace/lease.py'
    add = subprocess.run([os.sys.executable, str(lease_cli), 'consumer', 'add', '--lease-id', worker['lease_id'], '--who', 'reviewer'], env=workflow.env, capture_output=True, text=True)
    assert add.returncode == 0, add.stderr
    result = workflow.cli('cleanup', '--manifest', workflow.manifest)
    worker = json.loads(workflow.manifest.read_text())['workers']['worker']
    assert result.returncode != 0
    assert worker['retirement_disposition'] == 'RETAINED'
    assert 'consumer' in worker['retirement_reason'].lower()
    assert Path(worker['worktree']).exists()
    assert not (workflow.manifest.parent / 'worker.retire.json').exists()


def test_cleanup_refuses_unignored_token_path(workflow):
    assert workflow.launch().returncode == 0
    assert workflow.cli('watch', '--manifest', workflow.manifest, '--timeout', '5', '--interval', '0.05').returncode == 0
    assert workflow.cli('harvest', '--manifest', workflow.manifest).returncode == 0
    (workflow.repo / '.gitignore').write_text('')
    result = workflow.cli('cleanup', '--manifest', workflow.manifest)
    worker = json.loads(workflow.manifest.read_text())['workers']['worker']
    lease = json.loads((workflow.ledger / (worker['lease_id'] + '.json')).read_text())
    assert result.returncode != 0 and 'not verified gitignored' in result.stderr
    assert lease['state'] == 'bound' and Path(worker['worktree']).exists()
    assert not (workflow.manifest.parent / '.worker.close-token').exists()
