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


_PIN_LINE = re.compile(rb'(?:#[\x20-\x7e]*|[0-9a-f]{64}(?: +[A-Za-z0-9._-]+)?)?')


def parse_pins(raw):
    """Shared pin grammar (tests/pin-vectors.json, install-hooks pinnedFingerprints).

    ASCII, LF lines; each line is empty, a printable `#` comment, or 64
    lowercase hex plus an optional ` label`. Anything else voids the pin."""
    lines = raw.split(b'\n')
    if not all(_PIN_LINE.fullmatch(line) for line in lines):
        raise ValueError('malformed confirmation anchor pin')
    return {line[:64].decode() for line in lines if line[:1] not in (b'', b'#')}


def pinned_fingerprints(pins):
    """Fingerprints committed at the pinned tree's HEAD; working-tree edits never count.

    The repository is named, never discovered from the gate dir: object
    replacement is off and discovery cannot leave the tree root."""
    pins = Path(pins)
    tree = Path(os.path.realpath(pins.parents[3]))
    if any(os.path.lexists(directory / '.git') for directory in pins.parents[:3]):
        raise ValueError('nested repository marker inside the pinned tree')
    env = {'PATH': '/usr/bin:/bin', 'GIT_NO_REPLACE_OBJECTS': '1', 'GIT_CEILING_DIRECTORIES': str(tree.parent)}
    committed = subprocess.run([GIT, '--no-replace-objects', '-C', str(tree), 'cat-file', 'blob',
                                'HEAD:' + pins.relative_to(pins.parents[3]).as_posix()],
                               capture_output=True, timeout=2, env=env)
    if committed.returncode or committed.stdout != pins.read_bytes():
        raise ValueError('anchor pin differs from the pinned commit')
    return parse_pins(committed.stdout)


def describe_anchor(raw):
    """One `principal  type  SHA256:fp  comment` line per key, or raise.

    Exactly one key each for `human` and/or `lead`; no options, so no
    cert-authority and no shared principals."""
    import base64
    rows, seen = [], set()
    for line in raw.decode('ascii').splitlines():
        if not line.strip() or line.lstrip().startswith('#'):
            continue
        fields = line.split()
        if len(fields) < 3 or fields[0] not in ('human', 'lead') or fields[0] in seen \
                or not re.fullmatch(r'(?:ssh-|ecdsa-|sk-)[A-Za-z0-9@.-]+', fields[1]):
            raise ValueError('allowed signers must hold one plain key each for human and lead')
        blob = base64.b64decode(fields[2], validate=True)
        digest = base64.b64encode(hashlib.sha256(blob).digest()).decode().rstrip('=')
        seen.add(fields[0])
        rows.append(f"{fields[0]}  {fields[1]}  SHA256:{digest}  {' '.join(fields[3:])}".rstrip())
    if 'human' not in seen:
        raise ValueError('allowed signers has no human key')
    return rows


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
    describe_anchor(raw)
    return raw


def pin_anchor(home, confirm=None):
    """Owner terminal only: show the keys, lock after confirmation, return the fingerprint.

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
    rows = describe_anchor(raw)
    if confirm is None or not confirm(rows):
        raise ValueError('keys not confirmed by the owner; nothing locked')
    policy.parent.chmod(0o700)
    for path in (policy, policy.parent):
        os.chflags(path, stat.UF_IMMUTABLE)
    if not (locked(policy.parent.lstat(), stat.S_ISDIR, 0o700) and locked(policy.lstat(), stat.S_ISREG, 0o600)):
        raise ValueError('confirmation trust anchor did not lock')
    if private_read(policy) != raw:
        raise ValueError('confirmation trust anchor changed while locking')
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
    except (OSError, ValueError, UnicodeError, subprocess.SubprocessError):
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
