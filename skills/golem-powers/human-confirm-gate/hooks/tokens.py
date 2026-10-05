"""One-use signed capabilities; the anchor is owner-locked and fingerprint-pinned in the hook tree."""
import hashlib
import json
import os
import re
import stat
import subprocess
import time
from pathlib import Path

GIT = '/usr/bin/git'
SSH = '/usr/bin/ssh-keygen'
GH = '/opt/homebrew/bin/gh'


ANCHOR = Path('.config/golems/human-confirm-anchor/allowed_signers')
# The fingerprint pin rides the reviewed, pinned hook tree (hooks-live), never
# the policy dir: clearing flags and rewriting that dir cannot also re-pin.
PINS = Path(__file__).resolve().parents[1] / 'anchor.pins'


def pinned_fingerprints(pins):
    """Owner-pinned SHA-256 values; any malformed line voids the whole pin."""
    lines = [line.split('#', 1)[0].strip() for line in Path(pins).read_text('ascii').splitlines()]
    lines = [line for line in lines if line]
    if not all(re.fullmatch(r'[0-9a-f]{64}(?:\s+\S+)?', line) for line in lines):
        raise ValueError('malformed confirmation anchor pin')
    return {line.split()[0] for line in lines}


def locked(info, kind, mode):
    return (kind(info.st_mode) and stat.S_IMODE(info.st_mode) == mode and info.st_uid == os.getuid()
            and getattr(info, 'st_flags', 0) & stat.UF_IMMUTABLE)


def anchor_bytes(home):
    """Checked anchor bytes, or raise: every token check denies on any doubt."""
    directory = os.open(home / ANCHOR.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        fd = os.open(ANCHOR.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
        with os.fdopen(fd, 'rb') as stream:
            info = os.fstat(stream.fileno())
            if not (locked(os.fstat(directory), stat.S_ISDIR, 0o700) and locked(info, stat.S_ISREG, 0o600)
                    and info.st_nlink == 1 and info.st_size <= 4096):
                raise ValueError('confirmation trust anchor is not owner-locked')
            raw = stream.read(4097)
    finally:
        os.close(directory)
    if hashlib.sha256(raw).hexdigest() not in pinned_fingerprints(PINS):
        raise ValueError('confirmation trust anchor does not match the pinned fingerprint')
    return raw


def pin_anchor(home):
    """Owner terminal only: lock the reviewed anchor, return its fingerprint.

    The fingerprint lands in anchor.pins through a reviewed PR; never repin
    automatically on a mismatch."""
    if not callable(getattr(os, 'chflags', None)):
        raise ValueError('confirmation anchor provisioning requires macOS immutable flags')
    policy = home / ANCHOR
    if policy.parent.is_symlink() or not policy.parent.is_dir():
        raise ValueError('unsafe confirmation trust anchor directory')
    raw = private_read(policy)
    if len(raw) > 4096 or policy.lstat().st_nlink != 1:
        raise ValueError('unsafe confirmation trust anchor')
    policy.parent.chmod(0o700)
    for path in (policy, policy.parent):
        os.chflags(path, stat.UF_IMMUTABLE)
    if not (locked(policy.parent.lstat(), stat.S_ISDIR, 0o700) and locked(policy.lstat(), stat.S_ISREG, 0o600)):
        raise ValueError('confirmation trust anchor did not lock')
    return hashlib.sha256(raw).hexdigest()


def verify_signature(raw, anchor, kind, signature):
    # SSH receives an immutable byte snapshot, never reopens the mutable path.
    read_fd, write_fd = os.pipe()
    try:
        os.write(write_fd, anchor)  # <=4096 bytes, bounded below pipe capacity
        os.close(write_fd); write_fd = None
        return subprocess.run([SSH, '-Y', 'verify', '-f', '/dev/fd/' + str(read_fd), '-I', kind,
                               '-n', 'golems-confirm', '-s', str(signature)], input=raw,
                              capture_output=True, timeout=2, pass_fds=(read_fd,)).returncode == 0
    finally:
        os.close(read_fd)
        if write_fd is not None: os.close(write_fd)


def private_read(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o600 or info.st_uid != os.getuid() or info.st_size > 65536:
            raise ValueError('unsafe confirmation file')
        return stream.read(65537)


def read_command(argv):
    return subprocess.run(argv, capture_output=True, text=True, check=True, timeout=2).stdout.strip()


def lead_metadata(op):
    repo = op['repo']; branch = op['ref'].removeprefix('refs/heads/')
    if op['source'] not in ('HEAD', branch, op['ref']):
        raise ValueError('lead lease must use the current branch')
    if read_command([GIT, '-C', repo, 'symbolic-ref', '--short', 'HEAD']) != branch:
        raise ValueError('not the worker current branch')
    url = read_command([GIT, '-C', repo, 'remote', 'get-url', '--push', '--all', op['remote']])
    match = re.fullmatch(r'(?:git@github\.com:|https://github\.com/)([^/\s]+/[^/\s]+?)(?:\.git)?', url)
    if not match:
        raise ValueError('lead scope needs one GitHub remote')
    target = match[1]
    metadata = json.loads(read_command([GH, 'repo', 'view', target, '--json', 'defaultBranchRef']))
    pr = json.loads(read_command([GH, 'pr', 'view', branch, '--repo', target, '--json',
                                 'state,mergedAt,headRefName,isCrossRepository,headRefOid']))
    return metadata['defaultBranchRef']['name'], pr


def authorize(payload, ops, home, metadata_fn=lead_metadata):
    root = home / '.config/golems/human-confirm'
    try:
        anchor = anchor_bytes(home)
    except (OSError, ValueError, UnicodeError):
        return False  # static hook denial; never trust any token after tampering
    digest = hashlib.sha256((payload['cwd'] + '\0' + payload['tool_input']['command']).encode()).hexdigest()
    for path in sorted(root.glob('*.json')):
        try:
            raw = private_read(path); token = json.loads(raw)
            now = time.time(); kind = token['kind']; nonce = token['nonce']
            if kind not in ('human', 'lead') or token['version'] != 1 or not re.fullmatch('[0-9a-f]{32}', nonce) or path.name != nonce + '.json':
                continue
            if not (token['issued_at'] <= now < token['expires_at'] <= token['issued_at'] + 300):
                continue
            if token['command_sha256'] != digest or token['operations'] != ops or token['session_id'] != payload['session_id']:
                continue
            # Signature authenticates the creator; creator fields/agent chat do not.
            if not verify_signature(raw, anchor, kind, str(path) + '.sig'):
                continue
            if kind == 'lead':
                if len(ops) != 1 or ops[0]['class'] != 'lease':
                    continue
                # Nested shells/cd/aliases can obscure cwd; lead authority is narrower.
                import shlex
                words = shlex.split(payload['tool_input']['command'])
                prefix = ['git', 'push']
                if words[:1] == ['git'] and words[1:2] == ['-C']:
                    prefix = words[:3] + ['push']
                expected = [f"--force-with-lease={ops[0]['ref']}:{ops[0]['sha']}", ops[0]['remote'],
                            ops[0]['source'] + ':' + ops[0]['ref']]
                if words != prefix + expected:
                    continue
                default, pr = metadata_fn(ops[0])
                branch = ops[0]['ref'].removeprefix('refs/heads/')
                if branch == default or pr['state'] != 'OPEN' or pr['mergedAt'] is not None or pr['isCrossRepository'] or pr['headRefName'] != branch or pr['headRefOid'] != ops[0]['sha']:
                    continue
                collab = Path(token['collab'])
                collab_root = (home / 'Gits/orchestrator/collab').resolve()
                if collab_root not in collab.resolve().parents:
                    continue
                line = 'GOLEMS_CONFIRM ' + json.dumps(token, sort_keys=True, separators=(',', ':'))
                if line not in collab.read_text().splitlines():
                    continue
            # O_EXCL makes concurrent attempts mutually exclusive. A restored token
            # remains spent; retain nonce tombstones permanently, delete capability.
            if time.time() >= token['expires_at']:
                continue
            spent = root / (nonce + '.spent')
            fd = os.open(spent, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
            os.fsync(fd); os.close(fd)
            directory = os.open(root, os.O_RDONLY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
            path.unlink(); Path(str(path) + '.sig').unlink()
            return True
        except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError):
            continue
    return False
