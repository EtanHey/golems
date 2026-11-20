"""Narrow, fail-closed exemption for verified branch deletion. Never delete here.

One literal command only: aliases, wrappers, config overrides, bulk operations,
implicit destinations and dynamic shell scope retain the normal approval gate.
"""
import json
import fcntl
import importlib.util
from fnmatch import fnmatchcase
import os
import re
import shlex
import subprocess
import time
import stat
from pathlib import Path
from urllib.parse import quote


def _trusted_gh():
    # Reuse the gate's fixed Homebrew candidates and ownership/mode checks.
    # Load by this release tree's path: standalone guardian/default hooks do
    # not necessarily have the confirmation hook directory on sys.path.
    source = Path(__file__).resolve().parents[1] / 'human-confirm-gate/hooks/tokens.py'
    spec = importlib.util.spec_from_file_location('_branch_cleanup_tokens', source)
    tokens = importlib.util.module_from_spec(spec)
    exec(compile(source.read_bytes(), str(source), 'exec'), tokens.__dict__)
    return tokens.trusted_binary(tokens.GH_CANDIDATES)


def _run(argv, cwd):
    if argv[0] == 'git': argv = ['/usr/bin/git', *argv[1:]]
    elif argv[0] == 'gh': argv = [_trusted_gh(), *argv[1:]]
    env = {k: v for k, v in os.environ.items()
           if not k.startswith('GIT_') and k not in ('GH_HOST', 'GH_REPO')}
    env.update(GIT_NO_REPLACE_OBJECTS='1', GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL=os.devnull)
    result = subprocess.run(argv, cwd=cwd, capture_output=True, text=True,
                            timeout=2, check=True, env=env)
    return result.stdout.strip()


def forced_local_delete(args):
    """Only force-delete flags, honoring value options and end-of-options.

    Non-force deletion keeps Git's own merged-work refusal, including compounds.
    """
    delete = force = False
    values = {'--sort', '--format', '--contains', '--no-contains', '--merged',
              '--no-merged', '--points-at', '--set-upstream-to', '-u'}
    i = 0
    while i < len(args):
        arg = args[i]; i += 1
        if arg == '--': break
        if arg in values:
            i += 1; continue
        if arg.startswith('--'):
            option = arg.split('=', 1)[0]
            delete |= len(option) >= 3 and '--delete'.startswith(option)
            force |= len(option) >= 3 and '--force'.startswith(option)
        elif arg.startswith('-'):
            if 'D' in arg[1:]: return True
            delete |= 'd' in arg[1:]
            force |= 'f' in arg[1:]
    return delete and force


def _plan(command, cwd):
    if not isinstance(command, str) or any(c in command for c in '$`\n\r;&|()<>{}\\*?[]~!^#'):
        return None
    words = shlex.split(command)
    if not words: return None
    executable = words.pop(0)
    if executable not in ('git', '/usr/bin/git', 'gh'): return None
    if executable != 'gh' and words[:1] == ['-C'] and len(words) > 2:
        cwd = os.path.realpath(os.path.join(cwd, words[1])); words = words[2:]
    if executable != 'gh' and words[:1] == ['branch'] and len(words) >= 3 and forced_local_delete(words[1:]):
        if words[1] != '-D': return None  # Other force spellings retain confirmation.
        return cwd, 'local', None, words[2:], {}
    if executable != 'gh' and words[:1] == ['push']:
        args = words[1:]
        leases = {}
        for arg in args:
            if arg.startswith('--force-with-lease='):
                lease = re.fullmatch(r'--force-with-lease=(?:refs/heads/)?([^:]+):([0-9a-f]{40}|[0-9a-f]{64})', arg)
                if not lease or lease[1] in leases: return None
                leases[lease[1]] = lease[2]
        args = [a for a in args if not a.startswith('--force-with-lease=')]
        delete = '--delete' in args or '-d' in args
        args = [a for a in args if a not in ('--delete', '-d')]
        if len(args) < 2 or args[0] != 'origin': return None
        refs = args[1:]
        if not delete and not all(r.startswith(':') for r in refs): return None
        refs = [r if delete else r[1:] for r in refs]
        refs = [r.removeprefix('refs/heads/') for r in refs]
        if leases and set(leases) != set(refs): return None
        return cwd, 'remote', None, refs, leases
    if executable == 'gh' and words[:1] == ['api']:
        args = words[1:]
        if args[:2] in (['-X', 'DELETE'], ['--method', 'DELETE']): args = args[2:]
        elif args[-1:] == ['--method=DELETE']: args = args[:-1]
        else: return None
        if len(args) != 1: return None
        match = re.fullmatch(r'repos/(EtanHey/[A-Za-z0-9_.-]+)/git/refs/heads/(.+)', args[0])
        if match: return cwd, 'remote', match[1], [match[2]], {}
    return None


class ReceiptError(OSError):
    """Persistence failure, distinct from missing merge evidence."""


def receipt_row(target, branch, sha, path=None, digest=None, **extra):
    return dict(event='allowed_attempt', time=time.time(), repo=target, branch=branch, sha=sha,
                bundle=str(path) if path is not None else None, bundle_sha256=digest, **extra)


def record(home, target, branch, sha, path=None, digest=None, **extra):
    """Durably record one attempt through the same transaction as bulk deletes."""
    record_rows(home, [receipt_row(target, branch, sha, path, digest, **extra)])


def record_rows(home, rows):
    """Append all rows under one lock; restore the old length on write failure."""
    try:
        _record_rows(home, rows)
    except (OSError, ValueError) as exc:
        raise ReceiptError('could not save branch deletion receipt') from exc


def _record_rows(home, rows):
    root = home / '.golems/branch-archive'
    for directory in (root.parent, root):
        directory.mkdir(mode=0o700, exist_ok=True)
        info = directory.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o022:
            raise ValueError('unsafe receipt directory')
    data = ''.join(json.dumps(row, separators=(',', ':')) + '\n' for row in rows).encode()
    fd = os.open(root / 'deletes.jsonl', os.O_RDWR | os.O_APPEND | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
    with os.fdopen(fd, 'r+b', buffering=0):
        info = os.fstat(fd)
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid()
                or stat.S_IMODE(info.st_mode) not in (0o600, 0o644)):
            raise ValueError('unsafe receipt')
        # Nonblocking admission keeps the hook inside its time budget. All
        # writers (archived, merged and reconstructed) use this same lock.
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        start = os.fstat(fd).st_size
        try:
            pending = memoryview(data)
            while pending:
                written = os.write(fd, pending)
                if written <= 0: raise OSError('short receipt write')
                pending = pending[written:]
            os.fsync(fd)
        except BaseException:
            os.ftruncate(fd, start)
            # Preserve the original failure even if syncing rollback fails.
            try: os.fsync(fd)
            except OSError: pass
            raise


def proof_at_head(run, cwd, repo, branch, sha, default, default_sha, prs):
    """Shared exact-head PR or refreshed-default ancestry proof."""
    if not isinstance(prs, list) or len(prs) >= 100:
        raise ValueError('incomplete PR metadata')
    for p in prs:
        if (p.get('merged_at') and p.get('base', {}).get('ref') == default
                and p['head']['sha'] == sha and p['head']['ref'] == branch
                and p['head']['repo']['full_name'] == repo):
            number = p['number']
            if type(number) is not int or number < 1: raise ValueError('invalid PR number')
            return f'pr#{number}@{sha}'
    if not run(['git', 'rev-list', default_sha + '..' + sha], cwd):
        return 'ancestor'
    return ''


def merged_proof(cwd, repo, remote, branch, sha, default):
    """Read fresh default and PR evidence, including already-deleted branches."""
    _run(['git', 'check-ref-format', 'refs/heads/' + default], cwd)
    _run(['git', 'fetch', '--no-tags', '--no-recurse-submodules', '--', remote,
          '+refs/heads/' + default + ':refs/remotes/' + remote + '/' + default], cwd)
    default_sha = _run(['git', 'rev-parse', '--verify',
                        'refs/remotes/' + remote + '/' + default + '^{commit}'], cwd)
    prs = json.loads(_run(['gh', 'api', '--hostname', 'github.com', 'repos/' + repo
                          + '/pulls?state=closed&head=EtanHey:' + quote(branch, safe='') + '&per_page=100'], cwd))
    return proof_at_head(_run, cwd, repo, branch, sha, default, default_sha, prs)


def allowed(command, cwd, *, home=None, write_receipt=True, raise_on_receipt_error=False):
    """True only with fresh, owned, unprotected, exact-commit evidence.

    Receipt failures return False, including a missing remote branch/protection
    response. No cached approvals. The final head check follows all GitHub reads;
    a PreToolUse check cannot lock a subsequent Git command against other actors.
    """
    deadline = time.monotonic() + 4
    def run(argv, cwd):
        if time.monotonic() > deadline: raise ValueError('verification deadline')
        result = _run(argv, cwd)
        if time.monotonic() > deadline: raise ValueError('verification deadline')
        return result
    try:
        plan = _plan(command, cwd)
        if not plan: return False
        cwd, kind, requested_repo, branches, leases = plan
        if not branches or len(branches) > 10: return False
        for branch in branches:
            if branch.startswith(('-', 'refs/')) or not re.fullmatch(r'[A-Za-z0-9_./-]+', branch): return False
            run(['git', 'check-ref-format', 'refs/heads/' + branch], cwd)
            if kind == 'local' and run(['git', 'for-each-ref', '--format=%(refname)',
                    'refs/heads/' + branch], cwd).splitlines() != ['refs/heads/' + branch]: return False
        # Reject inherited repository/config/transport redirects, including gh's
        # alternate host/repo variables. get-url resolves Git insteadOf rules.
        if any(k.startswith('GIT_') and k not in ('GIT_PAGER', 'GIT_TERMINAL_PROMPT', 'GIT_EDITOR', 'GIT_SEQUENCE_EDITOR') or k in ('GH_HOST', 'GH_REPO') for k in os.environ): return False
        urls = [run(['git', 'remote', 'get-url', *flags, 'origin'], cwd)
                for flags in ([], ['--push', '--all'])]
        if urls[0] != urls[1]: return False
        match = re.fullmatch(r'(?:https://github.com/|git@github.com:)(EtanHey/[A-Za-z0-9_.-]+?)(?:\.git)?', urls[0])
        if not match: return False
        repo = match[1]
        config = run(['git', 'config', '--null', '--list'], cwd)
        for entry in config.split('\0'):
            key, _, value = entry.partition('\n')
            if key.lower() in ('remote.origin.receivepack', 'remote.origin.uploadpack', 'remote.origin.vcs',
                               'core.sshcommand', 'push.pushoption'): return False
            if key.lower() in ('remote.origin.mirror', 'push.followtags') and value.lower() not in ('false', 'no', 'off', '0'): return False
        if requested_repo and requested_repo != repo: return False
        def api(path):
            return json.loads(run(['gh', 'api', '--hostname', 'github.com', path], cwd))
        query = 'query($name:String!){repository(owner:"EtanHey",name:$name){nameWithOwner defaultBranchRef{name} branchProtectionRules(first:100){nodes{pattern} pageInfo{hasNextPage}}}}'
        metadata = json.loads(run(['gh', 'api', '--hostname', 'github.com', 'graphql',
                                   '-f', 'query=' + query, '-f', 'name=' + repo.split('/')[1]], cwd))['data']['repository']
        if metadata['nameWithOwner'] != repo: return False
        default = metadata['defaultBranchRef']['name']
        protection = metadata['branchProtectionRules']
        if protection['pageInfo']['hasNextPage']: return False
        patterns = [rule['pattern'] for rule in protection['nodes']]
        if any('\\' in p or fnmatchcase(b.casefold(), p.casefold()) for p in patterns for b in branches): return False
        run(['git', 'check-ref-format', 'refs/heads/' + default], cwd)
        if any(b.casefold() == default.casefold() for b in branches): return False
        # Explicit destination overrides stale or customized remote fetch mappings.
        run(['git', 'fetch', '--no-tags', 'origin',
              '+refs/heads/' + default + ':refs/remotes/origin/' + default], cwd)
        default_sha = run(['git', 'rev-parse', '--verify', 'refs/remotes/origin/' + default + '^{commit}'], cwd)
        heads = []
        for branch in branches:
            encoded = quote(branch, safe='')
            if api('repos/' + repo + '/rules/branches/' + encoded) != []: return False
            def head():
                if kind == 'local':
                    return run(['git', 'rev-parse', '--verify', 'refs/heads/' + branch + '^{commit}'], cwd)
                lines = run(['git', 'ls-remote', '--exit-code', '--heads', 'origin', 'refs/heads/' + branch], cwd).splitlines()
                if len(lines) != 1: raise ValueError('ambiguous remote head')
                sha, ref = lines[0].split()
                if ref != 'refs/heads/' + branch: raise ValueError('wrong remote head')
                return sha
            sha = head()
            if not re.fullmatch(r'[0-9a-f]{40}|[0-9a-f]{64}', sha): return False
            if leases and leases.get(branch) != sha: return False
            prs = api('repos/' + repo + '/pulls?state=closed&head=EtanHey:' + quote(branch, safe='') + '&per_page=100')
            if not isinstance(prs, list): return False
            proof = proof_at_head(run, cwd, repo, branch, sha, default, default_sha, prs)
            if not proof: return False
            heads.append((branch, sha, proof))
        # Revalidate every source after the last await-equivalent metadata call.
        for branch, sha, proof in heads:
            if kind == 'local': current = run(['git', 'rev-parse', '--verify', 'refs/heads/' + branch + '^{commit}'], cwd)
            else:
                current = run(['git', 'ls-remote', '--exit-code', '--heads', 'origin', 'refs/heads/' + branch], cwd).split()[0]
            if current != sha: return False
        if write_receipt:
            record_rows(home or Path.home(), [receipt_row(repo, branch, sha, rule='merged-on-main', proof=proof)
                                             for branch, sha, proof in heads])
        return True
    except ReceiptError:
        if raise_on_receipt_error: raise
        return False
    except (ValueError, TypeError, KeyError, IndexError, AttributeError, OSError, subprocess.SubprocessError):
        return False
