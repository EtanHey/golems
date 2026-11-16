"""Archived deletes use real Git bundles, parser, hook, and receipts; REST is injected."""
import hashlib
import json
import shlex
import subprocess

import pytest
from test_own_fork_lease import decision, config, BRANCH
pytest_plugins = ["test_own_fork_lease"]
from test_own_fork_lease import tokens


def git(repo, *args):
    return subprocess.check_output([tokens.GIT, '-C', str(repo), *args], text=True).strip()


@pytest.fixture
def archived(cell, monkeypatch):
    home, repo = cell
    git(repo, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com',
        'commit', '--allow-empty', '-qm', 'fixture')
    sha = git(repo, 'rev-parse', 'HEAD')
    git(repo, 'branch', BRANCH)
    path = home / '.golems/branch-archive/EtanHey/t3code' / BRANCH.replace('/', '__') / (sha + '.bundle')
    path.parent.mkdir(parents=True)
    git(repo, 'bundle', 'create', str(path), 'refs/heads/' + BRANCH)
    path.chmod(0o600)
    monkeypatch.setattr(tokens, 'own_lease_metadata',
                        lambda *a, **kw: ('main', dict(name=BRANCH, protected=False), []))
    command = f'git push --force-with-lease=refs/heads/{BRANCH}:{sha} fork :refs/heads/{BRANCH}'
    return home, repo, sha, path, command


@pytest.mark.parametrize('use_c', [False, True])
def test_valid_archive_allows_and_records(cell, archived, monkeypatch, use_c):
    home, repo, sha, path, command = archived
    if use_c:
        command = command.replace('git push', f'git -C {shlex.quote(str(repo))} push')
    result = decision(cell, monkeypatch, command)
    assert result == (0, ''), result
    receipt, = (home / '.golems/branch-archive/deletes.jsonl').read_text().splitlines()
    row = json.loads(receipt)
    assert row['repo'] == 'EtanHey/t3code' and row['branch'] == BRANCH and row['sha'] == sha
    assert row['bundle'] == str(path) and row['bundle_sha256'] == hashlib.sha256(path.read_bytes()).hexdigest()
    assert row['time']
    assert git(repo, 'bundle', 'list-heads', str(path)) == f'{sha} refs/heads/{BRANCH}'


@pytest.mark.parametrize('problem', ['missing', 'wrong-ref', 'wrong-sha', 'symlink', 'mode', 'receipt',
                                      'default', 'protected', 'head-pr', 'base-pr', 'timeout', 'ambiguous'])
def test_archive_refusals(cell, archived, monkeypatch, problem):
    home, repo, sha, path, command = archived
    if problem == 'missing': path.unlink()
    if problem in ('wrong-ref', 'wrong-sha'):
        path.unlink()
        if problem == 'wrong-sha':
            git(repo, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com',
                'commit', '--allow-empty', '-qm', 'new')
            git(repo, 'branch', '-f', BRANCH)
        git(repo, 'bundle', 'create', str(path), 'refs/heads/' + (BRANCH if problem == 'wrong-sha' else 'local-topic'))
    if problem == 'symlink':
        saved = path.with_suffix('.saved'); path.rename(saved); path.symlink_to(saved)
    if problem == 'mode': path.chmod(0o666)
    if problem == 'receipt': (home / '.golems/branch-archive/deletes.jsonl').mkdir()
    if problem in ('default', 'protected', 'head-pr', 'base-pr', 'ambiguous'):
        monkeypatch.setattr(tokens, 'own_lease_metadata', lambda *a, **kw:
            (BRANCH if problem == 'default' else 'main',
             dict(name=BRANCH, protected=problem == 'protected'),
             None if problem == 'ambiguous' else [dict(head=dict(ref=BRANCH), base=dict(ref='main'))]
             if problem == 'head-pr' else [dict(head=dict(ref='other'), base=dict(ref=BRANCH))]
             if problem == 'base-pr' else []))
    if problem == 'timeout':
        def fail(*a, **kw): raise subprocess.TimeoutExpired('gh', 4)
        monkeypatch.setattr(tokens, 'own_lease_metadata', fail)
    rc, reason = decision(cell, monkeypatch, command)
    assert rc == 2
    if problem == 'missing':
        assert str(path) in reason and 'git -C' in reason and 'bundle create' in reason
    if problem == 'timeout': assert 'Retry' in reason


@pytest.mark.parametrize('change', ['two-refs', 'delete', 'chain', 'sha', 'env', 'verbose'])
def test_other_shapes_refuse(cell, archived, monkeypatch, change):
    _, _, sha, _, command = archived
    command = {'two-refs': command + ' :refs/heads/other',
               'delete': f'git push --delete fork {BRANCH}', 'chain': command + '; echo done',
               'sha': command.replace(sha, 'a' * 40), 'env': 'env ' + command,
               'verbose': command + ' --verbose'}[change]
    assert decision(cell, monkeypatch, command)[0] == 2


@pytest.mark.parametrize('branch', ['main', 'master', 'develop', 'trunk', 'gh-pages', 'release/topic'])
def test_shared_names_refuse(cell, archived, monkeypatch, branch):
    assert decision(cell, monkeypatch, archived[-1].replace(BRANCH, branch))[0] == 2


@pytest.mark.parametrize('key,value', [('remote.fork.mirror', 'true'), ('push.followTags', 'true'),
    ('remote.fork.pushurl', 'https://github.com/other/t3code.git')])
def test_remote_validation_reused(cell, archived, monkeypatch, key, value):
    config(cell, key, value)
    assert decision(cell, monkeypatch, archived[-1])[0] == 2


def test_helper_preserves_remote_branch_without_moving_local(cell, archived, monkeypatch):
    from test_commands import ROOT
    home, repo, sha, path, _ = archived
    # Exercise the helper without GitHub/network; remote validation stays covered
    # above. A local transport supplies real fetched objects in this fixture.
    source = ROOT.parents[2] / 'scripts/fleet/archive-and-delete-branch.sh'
    script = source.read_text().replace('target = tokens.own_lease_remote(repo, remote)', "target = 'EtanHey/t3code'")
    helper = home / 'helper.sh'
    script = script.replace('root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)',
                            'root=' + shlex.quote(str(ROOT.parents[2])))
    helper.write_text(script)
    before = git(repo, 'rev-parse', 'refs/heads/' + BRANCH)
    path.unlink()
    result = subprocess.run(['bash', str(helper), str(repo), str(repo), BRANCH],
                            capture_output=True, text=True, check=True)
    assert result.stdout.strip() == shlex.join(['git', '-C', str(repo), 'push',
        f'--force-with-lease=refs/heads/{BRANCH}:{sha}', str(repo), ':refs/heads/' + BRANCH])
    assert git(repo, 'rev-parse', 'refs/heads/' + BRANCH) == before
    assert git(repo, 'bundle', 'list-heads', str(path)) == f'{sha} refs/heads/{BRANCH}'
    assert not (home / '.golems/branch-archive/deletes.jsonl').exists()


def test_guardian_only_allows_after_full_gate_success(monkeypatch):
    from test_commands import ROOT
    from test_lead_issuer import load
    from types import SimpleNamespace
    guardian = load(ROOT.parent / 'git-guardian/hooks/pre_tool_use.py', 'archive_guardian')
    calls = []
    def checked(argv, **kwargs):
        calls.append((argv, json.loads(kwargs['input'])))
        return SimpleNamespace(returncode=0, stdout='{}')
    monkeypatch.setattr(subprocess, 'run', checked)
    command = f'git push --force-with-lease=refs/heads/{BRANCH}:{"a" * 40} fork :refs/heads/{BRANCH}'
    assert guardian.archived_delete_allowed(command, '/repo')
    assert calls[0][1]['tool_input']['command'] == command
    assert any(str(arg).endswith('human-confirm-pretooluse.py') for arg in calls[0][0])
    assert calls[0][0][-1] == '--archive-check-only'
    calls.clear()
    assert not guardian.archived_delete_allowed(command + '; echo done', '/repo')
    assert not guardian.archived_delete_allowed('git push --delete fork topic', '/repo')
    assert calls == []
    monkeypatch.setattr(subprocess, 'run', lambda *a, **kw: SimpleNamespace(returncode=2, stdout='{}'))
    assert not guardian.archived_delete_allowed(command, '/repo')


@pytest.mark.parametrize('delay,fail', [(0.2, False), (5, False), (0, True)])
def test_three_rest_reads_share_deadline(cell, archived, monkeypatch, delay, fail):
    import sys
    import time
    from test_commands import ROOT
    from test_lead_issuer import load
    home, _, _, _, command = archived
    fake = home / 'gh-archive'
    receipts = home / 'requests'
    receipts.mkdir()
    fake.write_text(f'''#!{sys.executable}
import json, pathlib, sys, time
kind = 'prs' if '/pulls?' in sys.argv[-1] else 'branch' if '/branches/' in sys.argv[-1] else 'repo'
root = pathlib.Path({str(receipts)!r})
(root / (kind + '-start')).write_text(str(time.monotonic()))
time.sleep({delay!r})
if {fail!r}: sys.exit(1)
data = [] if kind == 'prs' else dict(name={BRANCH!r}, protected=False) if kind == 'branch' else dict(full_name='EtanHey/t3code', default_branch='main', fork=False, parent=None)
(root / (kind + '-end')).write_text(str(time.monotonic()))
print(json.dumps(data))
''')
    fake.chmod(0o700)
    real = load(ROOT / 'hooks/tokens.py', 'archived_rest_tokens')
    monkeypatch.setattr(real, 'trusted_binary', lambda _: str(fake))
    monkeypatch.setattr(tokens, 'own_lease_metadata', real.own_lease_metadata)
    started = time.monotonic()
    rc, reason = decision(cell, monkeypatch, command)
    assert time.monotonic() - started < 7
    if delay == 0.2:
        assert rc == 0, reason
        starts = [float((receipts / (k + '-start')).read_text()) for k in ('repo', 'branch', 'prs')]
        ends = [float((receipts / (k + '-end')).read_text()) for k in ('repo', 'branch', 'prs')]
        assert max(starts) < min(ends)
    else:
        assert rc == 2 and 'Retry' in reason
