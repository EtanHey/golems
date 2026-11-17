"""Round-two review regressions: real bundles and the hook's actual entry points."""
import contextlib
import io
import json
import os
import shlex
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from test_archived_delete import git
from test_own_fork_lease import BRANCH, GATE, decision, tokens
from test_commands import ROOT
from test_lead_issuer import load

pytest_plugins = ['test_own_fork_lease', 'test_archived_delete']


@pytest.mark.parametrize('kind', ['incremental', 'filtered'])
def test_incomplete_bundle_refuses(cell, archived, monkeypatch, kind):
    home, repo, old, path, command = archived
    if kind == 'incremental':
        git(repo, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com',
            'commit', '--allow-empty', '-qm', 'next')
        sha = git(repo, 'rev-parse', 'HEAD')
        git(repo, 'branch', '-f', BRANCH)
        path = path.with_name(sha + '.bundle')
        git(repo, 'bundle', 'create', str(path), old + '..refs/heads/' + BRANCH)
        command = command.replace(old, sha)
        assert any(line.startswith(b'-') for line in path.read_bytes().split(b'\n\n', 1)[0].splitlines())
    else:
        path.unlink()
        git(repo, 'bundle', 'create', '--version=3', str(path), '--filter=blob:none', 'refs/heads/' + BRANCH)
        assert b'@filter=blob:none' in path.read_bytes().split(b'\n\n', 1)[0]
    path.chmod(0o600)
    # Git accepts both while prerequisites exist locally; the policy must not.
    git(repo, 'bundle', 'verify', str(path))
    assert decision(cell, monkeypatch, command)[0] == 2
    assert not (home / '.golems/branch-archive/deletes.jsonl').exists()


@pytest.mark.parametrize('version', ['v2', 'v3'])
def test_complete_bundle_versions_allow(cell, archived, monkeypatch, version):
    _, repo, _, path, command = archived
    path.unlink()
    git(repo, 'bundle', 'create', '--version=' + version[-1], str(path), 'refs/heads/' + BRANCH)
    path.chmod(0o600)
    assert decision(cell, monkeypatch, command) == (0, '')


@pytest.mark.parametrize('depth', [0, 1, 2, 3])
def test_writable_archive_directory_refuses(cell, archived, monkeypatch, depth):
    _, _, _, path, command = archived
    path.parents[depth].chmod(0o777)
    assert decision(cell, monkeypatch, command)[0] == 2


def test_foreign_owned_archive_directory_refuses(cell, archived, monkeypatch):
    import archived_delete
    _, _, _, path, command = archived
    real = Path.lstat
    def info(p, *args, **kw):
        result = real(p, *args, **kw)
        if p == path.parents[2]:
            fields = list(result)
            fields[4] = os.getuid() + 1
            return os.stat_result(fields)
        return result
    monkeypatch.setattr(archived_delete.os, 'getuid', os.getuid)
    monkeypatch.setattr(Path, 'lstat', info)
    assert decision(cell, monkeypatch, command)[0] == 2


def test_missing_bundle_guidance_creates_directory(cell, archived, monkeypatch):
    _, _, _, path, command = archived
    path.unlink()
    rc, reason = decision(cell, monkeypatch, command)
    assert rc == 2
    assert shlex.join(['mkdir', '-p', str(path.parent)]) in reason


def test_guardian_then_gate_writes_one_named_attempt(cell, archived, monkeypatch):
    home, repo, _, _, command = archived
    guardian = load(ROOT.parent / 'git-guardian/hooks/pre_tool_use.py', 'review_guardian')
    real_run = subprocess.run
    def nested(argv, **kw):
        if any(str(word).endswith('human-confirm-pretooluse.py') for word in argv):
            hook_at = next(i for i, word in enumerate(argv) if str(word).endswith('human-confirm-pretooluse.py'))
            output = io.StringIO()
            with monkeypatch.context() as patch:
                patch.setattr(sys, 'stdin', io.StringIO(kw['input']))
                patch.setattr(sys, 'argv', argv[hook_at:])
                with contextlib.redirect_stdout(output):
                    rc = GATE.main()
            return SimpleNamespace(returncode=rc, stdout=output.getvalue())
        return real_run(argv, **kw)
    monkeypatch.setattr(subprocess, 'run', nested)
    assert guardian.archived_delete_allowed(command, str(repo))
    assert not (home / '.golems/branch-archive/deletes.jsonl').exists()
    assert decision(cell, monkeypatch, command) == (0, '')
    rows = (home / '.golems/branch-archive/deletes.jsonl').read_text().splitlines()
    assert len(rows) == 1
    assert json.loads(rows[0])['event'] == 'allowed_attempt'


def test_helper_uses_fixed_interpreter_and_private_directories(cell, archived):
    home, repo, _, path, _ = archived
    path.unlink()
    # Remove only empty fixture archive dirs so the helper must create each one.
    for directory in [path.parent, *path.parents[1:5]]:
        directory.rmdir()
    script = (ROOT.parents[2] / 'scripts/fleet/archive-and-delete-branch.sh').read_text()
    script = script.replace('target = tokens.own_lease_remote(repo, remote)', "target = 'EtanHey/t3code'")
    script = script.replace('root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)',
                            'root=' + shlex.quote(str(ROOT.parents[2])))
    script = script.replace('default, _ = tokens.own_lease_metadata(target, branch)', "raise ValueError('fixture unmerged')")
    helper = home / 'review-helper.sh'
    helper.write_text(script)
    fake = home / 'bin'
    fake.mkdir()
    (fake / 'python3').write_text('#!/bin/sh\necho PATH_INTERPRETER >&2\nexit 73\n')
    (fake / 'python3').chmod(0o700)
    old = os.umask(0)
    try:
        result = subprocess.run(['/bin/bash', str(helper), str(repo), str(repo), BRANCH],
            capture_output=True, text=True, env=dict(os.environ, PATH=str(fake) + os.pathsep + os.environ['PATH']))
    finally:
        os.umask(old)
    assert result.returncode == 0, result.stderr
    assert 'PATH_INTERPRETER' not in result.stderr
    for directory in path.parents[:4]:
        assert directory.stat().st_mode & 0o777 == 0o700


def test_readme_size_and_pruning_are_explicit():
    readme = (ROOT / 'README.md').read_text().lower()
    assert '125 mb' in readme and 'pruning' in readme and 'later' in readme


def test_guardian_slow_nested_gate_fits_deadline(cell, archived, monkeypatch):
    import time
    guardian = load(ROOT.parent / 'git-guardian/hooks/pre_tool_use.py', 'review_slow_guardian')
    home, repo, _, _, command = archived
    # Use a real subprocess wait crossing the old 3 s guardian budget. Only
    # the nested network answer is replaced; full gate behavior is tested above.
    fake = home / 'slow-confirm.py'
    fake.write_text('import time\ntime.sleep(3.2)\nprint("{}")\n')
    real_run = subprocess.run
    def delayed(argv, **kw):
        if any(str(word).endswith('human-confirm-pretooluse.py') for word in argv):
            return real_run([sys.executable, str(fake)], capture_output=True, text=True, timeout=kw['timeout'])
        return real_run(argv, **kw)
    monkeypatch.delenv('CLAUDE_WORKER', raising=False)
    monkeypatch.setattr(subprocess, 'run', delayed)
    monkeypatch.setattr(sys, 'stdin', io.StringIO(json.dumps(dict(tool_name='Bash', cwd=str(repo), tool_input=dict(command=command)))))
    output = io.StringIO()
    started = time.monotonic()
    with contextlib.redirect_stdout(output), pytest.raises(SystemExit) as stopped:
        guardian.main()
    assert stopped.value.code == 0, output.getvalue()
    assert json.loads(output.getvalue()) == {}
    assert 3 <= time.monotonic() - started < 8


@pytest.mark.parametrize('case', ['parent-pr', 'parent-failure', 'parent-timeout', 'missing-parent', 'ambiguous-fork', 'safe-fork'])
def test_fork_parent_pr_admission_and_shared_deadline(cell, archived, monkeypatch, case):
    import time
    home, _, _, _, command = archived
    receipts = home / 'fork-requests'
    receipts.mkdir()
    fake = home / 'gh-fork'
    fake.write_text(f'''#!{sys.executable}
import json, pathlib, sys, time
endpoint = sys.argv[-1]
kind = 'parent' if 'repos/upstream/project/' in endpoint else 'branch' if '/branches/' in endpoint else 'prs' if '/pulls?' in endpoint else 'repo'
root = pathlib.Path({str(receipts)!r})
(root / (kind + '-start.json')).write_text(json.dumps(dict(at=time.monotonic(), endpoint=endpoint)))
time.sleep(0.05 if kind == 'repo' else 4.2 if kind == 'parent' and {case!r} == 'parent-timeout' else 0.4)
if kind == 'parent' and {case!r} == 'parent-failure': sys.exit(1)
data = dict(full_name='EtanHey/t3code', default_branch='main', fork='yes' if {case!r} == 'ambiguous-fork' else True, parent=None if {case!r} == 'missing-parent' else dict(full_name='upstream/project')) if kind == 'repo' else dict(name={BRANCH!r}, protected=False) if kind == 'branch' else [dict(head=dict(ref={BRANCH!r}), base=dict(ref='main'))] if kind == 'parent' and {case!r} == 'parent-pr' else []
(root / (kind + '-end')).write_text(str(time.monotonic()))
print(json.dumps(data))
''')
    fake.chmod(0o700)
    real = load(ROOT / 'hooks/tokens.py', 'review_fork_tokens')
    monkeypatch.setattr(real, 'trusted_binary', lambda _: str(fake))
    monkeypatch.setattr(tokens, 'own_lease_metadata', real.own_lease_metadata)
    start = time.monotonic()
    rc, reason = decision(cell, monkeypatch, command)
    assert time.monotonic() - start < 6.5
    if case == 'safe-fork':
        assert rc == 0, reason
        parent = json.loads((receipts / 'parent-start.json').read_text())
        assert 'head=EtanHey%3Apreview%2Fpinned-maria-current-20261103' in parent['endpoint']
        assert parent['at'] < min(float((receipts / (k + '-end')).read_text()) for k in ('branch', 'prs'))
    else:
        assert rc == 2, reason
        if case != 'parent-pr': assert 'Retry' in reason
    if case == 'parent-timeout':
        assert not (receipts / 'parent-end').exists()
