"""Own-branch leases: real parser/config/routes and hook output; GitHub reads stubbed."""
import contextlib
import io
import json
import os
import shlex
import subprocess
from unittest.mock import Mock
from urllib.parse import quote

import pytest

from test_commands import ROOT
from test_lead_issuer import load
import tokens

SHA = '90a038f736e9134c7c93bc938a8e8a1eda0f15d4'
BRANCH = 'preview/pinned-maria-current-20261103'
GATE = load(ROOT / 'hooks/human-confirm-pretooluse.py', 'own_lease_gate')


def lease(branch=BRANCH, remote='fork', source='HEAD'):
    ref = 'refs/heads/' + branch
    return f'git push --force-with-lease={ref}:{SHA} {remote} {source}:{ref}'


@pytest.fixture
def cell(tmp_path, monkeypatch):
    monkeypatch.setenv('HOME', str(tmp_path))
    monkeypatch.setenv('GIT_CONFIG_NOSYSTEM', '1')
    monkeypatch.setenv('GIT_CONFIG_GLOBAL', os.devnull)
    repo = tmp_path / 'repo'
    subprocess.run([tokens.GIT, 'init', '-q', '-b', 'local-topic', str(repo)], check=True)
    for remote, owner in [('fork', 'EtanHey'), ('origin', 'pingdotgg'), ('backup', 'elsewhere')]:
        subprocess.run([tokens.GIT, '-C', str(repo), 'remote', 'add', remote,
                        f'https://github.com/{owner}/t3code.git'], check=True)
    monkeypatch.setattr(tokens, 'authorize', lambda *args: False)
    monkeypatch.setattr(tokens, 'own_lease_metadata',
                        lambda target, branch: ('main', dict(name=branch, protected=False)), raising=False)
    return tmp_path, repo


def config(cell, key, value):
    subprocess.run([tokens.GIT, '-C', str(cell[1]), 'config', '--add', key, value], check=True)


def decision(cell, monkeypatch, command):
    payload = dict(tool_name='Bash', cwd=str(cell[1]), session_id='own-lease-session',
                   tool_input=dict(command=command))
    monkeypatch.setattr('sys.stdin', io.StringIO(json.dumps(payload)))
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        rc = GATE.main()
    assert err.getvalue() == ''
    result = json.loads(out.getvalue())
    return rc, result.get('hookSpecificOutput', {}).get('permissionDecisionReason', '')


@pytest.mark.parametrize('url', ['https://github.com/EtanHey/t3code.git',
                               'git@github.com:eTaNhEy/t3code.git',
                               'ssh://git@github.com/EtanHey/t3code.git'])
@pytest.mark.parametrize('use_c', [False, True])
def test_own_lease_allowed_with_several_remotes(cell, monkeypatch, url, use_c):
    subprocess.run([tokens.GIT, '-C', str(cell[1]), 'remote', 'set-url', 'fork', url], check=True)
    command = lease()
    if use_c:
        command = command.replace('git push', f'git -C {shlex.quote(str(cell[1]))} push')
    assert decision(cell, monkeypatch, command) == (0, '')


@pytest.mark.parametrize('command', [
    'git push --force fork HEAD:topic', 'git push -f fork HEAD:topic',
    'git push fork +HEAD:topic', 'git push --force-with-lease fork HEAD:topic',
    lease(remote='origin'), lease() + ' --delete', 'git push --mirror fork',
    lease() + f' --force-with-lease=refs/heads/{BRANCH}:{SHA}',
    lease().replace('HEAD:refs/heads/' + BRANCH, 'HEAD:refs/heads/elsewhere'),
    lease() + ' --force-if-includes', lease() + ' --prune',
    lease(source='+HEAD'), lease().replace(SHA, SHA[:12]),
    'echo ok; ' + lease(), 'env ' + lease(), lease() + '; ' + lease(),
    lease().replace('git push', 'git -c push.followTags=true push'),
    lease().replace('git push', 'git -c remote.fork.mirror=true push'),
    'git push fork :topic', 'git filter-branch HEAD', 'gh repo edit EtanHey/t3code --enable-wiki',
])
def test_other_commands_stay_denied(cell, monkeypatch, command):
    assert decision(cell, monkeypatch, command)[0] == 2


@pytest.mark.parametrize('branch', ['main', 'MASTER', 'Main', 'develop', 'trunk',
                                   'gh-pages', 'release/x', 'ReLeAsE-candidate'])
def test_shared_names_deny_with_plain_reason(cell, monkeypatch, branch):
    metadata = Mock(side_effect=subprocess.TimeoutExpired(['gh'], 2))
    monkeypatch.setattr(tokens, 'own_lease_metadata', metadata)
    rc, reason = decision(cell, monkeypatch, lease(branch))
    metadata.assert_not_called()
    assert rc == 2 and 'EtanHey/t3code' in reason and 'branch' in reason
    assert 'shared branch' in reason
    assert '\n' not in reason


@pytest.mark.parametrize('default,protected,detail', [(BRANCH, False, 'default branch'),
                                                     (BRANCH.upper(), False, 'default branch'),
                                                     ('main', True, 'protected branch')])
def test_github_shared_branches_deny(cell, monkeypatch, default, protected, detail):
    monkeypatch.setattr(tokens, 'own_lease_metadata',
                        lambda target, branch: (default, dict(name=branch, protected=protected)), raising=False)
    rc, reason = decision(cell, monkeypatch, lease())
    assert rc == 2 and detail in reason and 'EtanHey/t3code' in reason


@pytest.mark.parametrize('key,value', [
    ('remote.fork.pushurl', 'https://github.com/other/t3code.git'),
    ('remote.fork.pushurl', 'https://github.com/EtanHey/elsewhere.git'),
    ('remote.fork.url', 'https://github.com/EtanHey/elsewhere.git'),
    ('url.https://github.com/other/.insteadOf', 'https://github.com/EtanHey/'),
    ('url.https://github.com/other/.pushInsteadOf', 'https://github.com/EtanHey/'),
    ('remote.fork.mirror', 'true'), ('push.followTags', 'true'),
    ('push.useForceIfIncludes', 'true'), ('remote.fork.receivepack', 'custom-receive-pack'),
    ('push.recurseSubmodules', 'on-demand'), ('remote.fork.vcs', 'ext'),
    ('submodule.recurse', 'true'),
])
def test_redirected_or_nonplain_push_config_denies(cell, monkeypatch, key, value):
    config(cell, key, value)
    assert decision(cell, monkeypatch, lease())[0] == 2


@pytest.mark.parametrize('error', [ValueError('metadata failed'),
                                  subprocess.TimeoutExpired(['gh'], 2), OSError('missing gh')])
def test_metadata_errors_deny(cell, monkeypatch, error):
    def fail(*args):
        raise error
    monkeypatch.setattr(tokens, 'own_lease_metadata', fail, raising=False)
    assert decision(cell, monkeypatch, lease())[0] == 2


@pytest.mark.parametrize('metadata', [('', dict(name=BRANCH, protected=False)),
                                     ('main', dict(name='other', protected=False)),
                                     ('main', dict(name=BRANCH)),
                                     ('main', dict(name=BRANCH, protected='false'))])
def test_ambiguous_metadata_denies(cell, monkeypatch, metadata):
    monkeypatch.setattr(tokens, 'own_lease_metadata', lambda *args: metadata, raising=False)
    assert decision(cell, monkeypatch, lease())[0] == 2


def test_metadata_reader_is_bounded_and_targets_encoded_branch(cell, monkeypatch):
    monkeypatch.delattr(tokens, 'own_lease_metadata')  # restore the real implementation below
    # Load a fresh module so the fixture's stub cannot conceal the reader contract.
    real = load(ROOT / 'hooks/tokens.py', 'own_lease_tokens')
    replies = iter([dict(full_name='EtanHey/t3code', default_branch='main'), dict(name=BRANCH, protected=False)])
    calls = []
    monkeypatch.setattr(real, 'trusted_binary', lambda _: '/trusted/gh')
    def run(argv, **kwargs):
        calls.append((argv, kwargs))
        return subprocess.CompletedProcess(argv, 0, json.dumps(next(replies)), '')
    monkeypatch.setattr(real.subprocess, 'run', run)
    assert real.own_lease_metadata('EtanHey/t3code', BRANCH) == ('main', dict(name=BRANCH, protected=False))
    assert [args[0][-1] for args in calls] == [
        'repos/EtanHey/t3code', 'repos/EtanHey/t3code/branches/' + quote(BRANCH, safe='')]
    assert all(kwargs['timeout'] == 2 and kwargs['check'] for _, kwargs in calls)
    assert all(argv[1:4] == ['api', '--hostname', 'github.com'] for argv, _ in calls)


@pytest.mark.parametrize('full_name', ['other/t3code', 'EtanHey/other', None])
def test_metadata_redirects_deny(cell, monkeypatch, full_name):
    real = load(ROOT / 'hooks/tokens.py', 'own_lease_redirect_tokens')
    monkeypatch.setattr(real, 'trusted_binary', lambda _: '/trusted/gh')
    calls = []
    def read(argv):
        calls.append(argv)
        return json.dumps(dict(full_name=full_name, default_branch='main'))
    monkeypatch.setattr(real, 'read_command', read)
    with pytest.raises(ValueError):
        real.own_lease_metadata('EtanHey/t3code', BRANCH)
    assert len(calls) == 1


def test_git_c_uses_target_repo_not_hook_cwd(cell, monkeypatch):
    other = cell[0] / 'other'
    subprocess.run([tokens.GIT, 'init', '-q', str(other)], check=True)
    command = lease().replace('git push', f'git -C {shlex.quote(str(cell[1]))} push')
    assert decision((cell[0], other), monkeypatch, command) == (0, '')


@pytest.mark.parametrize('url', ['https://gıthub.com/EtanHey/t3code.git',
                               'https://gİthub.com/EtanHey/t3code.git',
                               'httpſ://github.com/EtanHey/t3code.git',
                               'https://github.com/EtanHey/t3code-K.git',
                               'https://github.com/EtanHey/t3code-İ.git',
                               'https://github.com/EtanHey/t3code-ı.git'])
def test_unicode_url_lookalikes_deny(cell, monkeypatch, url):
    subprocess.run([tokens.GIT, '-C', str(cell[1]), 'remote', 'set-url', 'fork', url], check=True)
    assert decision(cell, monkeypatch, lease())[0] == 2


@pytest.mark.parametrize('key', ['remote.fork.url', 'remote.fork.pushurl'])
@pytest.mark.parametrize('extra', ['', '   ', '\t'])
@pytest.mark.parametrize('extra_first', [False, True])
def test_blank_extra_url_entries_deny(cell, monkeypatch, key, extra, extra_first):
    subprocess.run([tokens.GIT, '-C', str(cell[1]), 'config', '--unset-all', key], check=False)
    url = 'https://github.com/EtanHey/t3code.git'
    for value in ([extra, url] if extra_first else [url, extra]):
        config(cell, key, value)
    assert decision(cell, monkeypatch, lease())[0] == 2


@pytest.mark.parametrize('flags', ['--atomic -v', '--verbose'])
def test_documented_optional_flags_stay_allowed(cell, monkeypatch, flags):
    assert decision(cell, monkeypatch, lease().replace('git push', 'git push ' + flags)) == (0, '')
