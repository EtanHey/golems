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
        git('add', 'README', cwd=source)
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
    assert receipt['disposition'] == worker['retirement_disposition'] == lease['disposition'] == disposition
    assert lease['state'] == 'closed'
    assert path.exists() is dirty
    if dirty:
        assert worker['retirement_reason'] == receipt['reason']
