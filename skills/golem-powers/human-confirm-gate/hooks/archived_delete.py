"""Reversible, unsigned single-ref deletes. Never executes a push."""
import hashlib
import json
import os
import re
import shlex
import stat
import subprocess
import time

import tokens

GUIDANCE = ('To delete a fleet branch: run scripts/fleet/archive-and-delete-branch.sh, '
            'then the command it prints.')


def archive_path(home, target, branch, sha):
    return home / '.golems/branch-archive' / target / branch.replace('/', '__') / (sha + '.bundle')


def archive_directories(root, leaf, *, create=False):
    """Every archive directory is owned and excludes group/other writers."""
    relative = leaf.relative_to(root)
    directories = [root.parent, root]
    for part in relative.parts:
        directories.append(directories[-1] / part)
    for directory in directories:
        if create:
            directory.mkdir(mode=0o700, exist_ok=True)
        info = directory.lstat()
        if (not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid()
                or info.st_mode & 0o022):
            raise ValueError('unsafe archive directory')


def complete_header(stream, branch, sha):
    """One bounded parser, on the already-open bundle fd; no prerequisite/filter."""
    version = stream.readline(4096)
    if version not in (b'# v2 git bundle\n', b'# v3 git bundle\n'):
        raise ValueError('unsupported bundle header')
    capability = False
    heads = []
    for _ in range(4):
        line = stream.readline(4096)
        if line == b'\n':
            if heads != [(sha + ' refs/heads/' + branch + '\n').encode()]:
                raise ValueError('bundle must name exactly the leased branch')
            if version == b'# v3 git bundle\n' and not capability:
                raise ValueError('v3 bundle must explicitly use sha1')
            return
        if not line.endswith(b'\n') or line.startswith(b'-'):
            raise ValueError('incomplete or incremental bundle')
        if line.startswith(b'@'):
            if (version != b'# v3 git bundle\n' or capability or heads
                    or line != b'@object-format=sha1\n'):
                raise ValueError('unsupported bundle capability')
            capability = True
        else:
            heads.append(line)
    raise ValueError('oversized bundle header')


def check_bundle(path, repo, branch, sha, *, archive_root=None):
    # Reject symlinked directories too; a symlinked archive is not a saved copy.
    if any(p.is_symlink() for p in (path, *path.parents)):
        raise ValueError('symlinked archive')
    archive_directories(archive_root or path.parents[3], path.parent)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb', buffering=0) as stream:
        info = os.fstat(fd)
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid()
                or stat.S_IMODE(info.st_mode) not in (0o600, 0o644)):
            raise ValueError('unsafe bundle')
        complete_header(stream, branch, sha)
        # Git and the hash read the same opened file, not a swapped pathname.
        opened = '/dev/fd/' + str(fd)
        for args in (['bundle', 'list-heads', opened], ['bundle', 'verify', opened]):
            stream.seek(0)
            result = subprocess.run([tokens.GIT, '-C', repo, *args], capture_output=True,
                                    text=True, timeout=2, pass_fds=(fd,))
            if result.returncode or (args[1] == 'list-heads' and
                                    result.stdout.strip() != f'{sha} refs/heads/{branch}'):
                raise ValueError('bundle does not preserve exactly the leased ref')
        stream.seek(0)
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def record(home, target, branch, sha, path, digest):
    receipt = home / '.golems/branch-archive/deletes.jsonl'
    fd = os.open(receipt, os.O_WRONLY | os.O_APPEND | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
    with os.fdopen(fd, 'a') as stream:
        info = os.fstat(fd)
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid()
                or stat.S_IMODE(info.st_mode) not in (0o600, 0o644)):
            raise ValueError('unsafe receipt')
        row = dict(event='allowed_attempt', time=time.time(), repo=target, branch=branch, sha=sha,
                   bundle=str(path), bundle_sha256=digest)
        stream.write(json.dumps(row, separators=(',', ':')) + '\n')
        stream.flush()
        os.fsync(fd)


def scope(payload, ops, home, *, write_receipt=True):
    from commands import shell
    if len(ops) != 1 or ops[0]['class'] != 'delete' or ops[0].get('local'):
        return False, ''
    try:
        op = ops[0]
        words = shlex.split(payload['tool_input']['command'])
        prefix = words[:3] + ['push'] if words[:2] == ['git', '-C'] else ['git', 'push']
        tail = words[len(prefix):]
        if words[:len(prefix)] != prefix or len(tail) != 3:
            return False, ''
        lease = re.fullmatch(r'--force-with-lease=refs/heads/(.+):([0-9a-f]{40})', tail[0])
        if not lease:
            return False, ''
        branch, sha = lease.groups()
        repo, remote = op['repo'], op['remote']
        if (tail[1] != remote or tail[2] != ':refs/heads/' + branch
                or op['refs'] != [tail[2]]):
            return False, ''
        subprocess.run([tokens.GIT, 'check-ref-format', 'refs/heads/' + branch],
                       check=True, capture_output=True, timeout=1)
        target = tokens.own_lease_remote(repo, remote)
        if branch.casefold() in ('main', 'master', 'develop', 'trunk', 'gh-pages') or branch.casefold().startswith('release'):
            return False, f'Blocked: shared branch of {target}; deleting it needs Etan.'
        try:
            default, data, prs = tokens.own_lease_metadata(target, branch, include_prs=True)
            if (not isinstance(default, str) or not default or data['name'] != branch
                    or type(data['protected']) is not bool or not isinstance(prs, list) or len(prs) >= 100):
                raise ValueError('ambiguous metadata')
            linked = False
            for pr in prs:
                head, base = pr['head']['ref'], pr['base']['ref']
                if not isinstance(head, str) or not head or not isinstance(base, str) or not base:
                    raise ValueError('ambiguous PR metadata')
                linked |= branch in (head, base)
        except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError, shell.PolicyEvaluationDeadlineExceeded):
            return False, f"Blocked: couldn't confirm branch safety and open PRs in {target}. Retry the push."
        if branch.casefold() == default.casefold() or data['protected'] or linked:
            return False, f'Blocked: default/protected branch or open PR uses {branch} in {target}; deleting it needs Etan.'
        path = archive_path(home, target, branch, sha)
        try:
            digest = check_bundle(path, repo, branch, sha)
        except (OSError, ValueError, subprocess.SubprocessError):
            create = shlex.join(['mkdir', '-p', str(path.parent)]) + ' && ' + shlex.join(['git', '-C', repo, 'bundle', 'create', str(path), 'refs/heads/' + branch])
            return False, (f'Blocked: missing or invalid bundle {path}. {GUIDANCE} '
                           f'Bundle creation command (local ref must equal {sha}): {create}')
        try:
            if write_receipt:
                record(home, target, branch, sha, path, digest)
        except (OSError, ValueError):
            return False, 'Blocked: could not save the branch deletion receipt. Retry after fixing the archive permissions.'
        return True, ''
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError):
        return False, ''
