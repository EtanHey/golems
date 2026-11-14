"""Untrusted T3 approval receipts. Authority still requires native presence and SSH signing."""
import fcntl
import json
import math
import os
import re
import shlex
import stat
import subprocess
import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from commands import operations


def private(info, directory=False):
    if (not (stat.S_ISDIR if directory else stat.S_ISREG)(info.st_mode)
            or stat.S_IMODE(info.st_mode) != (0o700 if directory else 0o600) or info.st_uid != os.getuid()):
        raise ValueError('approval storage must be private, owned, regular and without symlinks')


@contextmanager
def storage(home):
    # Traverse using directory descriptors: even an intermediate symlink refuses.
    fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY)
    try:
        root = Path(home).absolute() / '.config/golems/approvals'
        for part in root.parts[1:]:
            try: os.mkdir(part, 0o700, dir_fd=fd)
            except FileExistsError: pass
            next_fd = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd); fd = next_fd
        private(os.fstat(fd), True)
        yield fd
    finally:
        os.close(fd)


def validate(value):
    for key in ('question', 'answer', 't3_request_id', 't3_thread_id', 'asked_by', 'command', 'repo_remote', 'ref'):
        if not isinstance(value.get(key), str) or not value[key] or key not in ('question', 'answer') and any(ord(c) < 32 for c in value[key]):
            raise ValueError('record field invalid: ' + key)
    # Explicit selection metadata, never infer assent from prose. This is a receipt,
    # not authentication of T3: even a forged receipt must pass the native prompt.
    if (value.get('answer_kind') != 'option' or value['answer'] != value.get('affirmative_option')
            or value['answer'] not in ('Approve', 'Yes', 'Approve deletion')):
        raise ValueError('answer must be an affirmative option')
    if value['command'] not in value['question'] and not (value['repo_remote'] in value['question'] and value['ref'] in value['question']):
        raise ValueError('question scope must contain exact command or repo URL and full ref')
    if (not re.fullmatch(r'refs/heads/[^\s:]+', value['ref']) or not isinstance(value.get('expected_remote_sha'), str)
            or not re.fullmatch('[0-9a-f]{40}', value['expected_remote_sha'])):
        raise ValueError('record needs full branch ref and 40-hex expected_remote_sha')
    if subprocess.run(['/usr/bin/git', 'check-ref-format', value['ref']], capture_output=True, timeout=5).returncode:
        raise ValueError('record branch ref invalid')
    created, expires = value.get('created_at'), value.get('expires_at')
    if any(type(n) not in (int, float) or not math.isfinite(n) for n in (created, expires)) or not 0 < expires - created <= 72 * 3600:
        raise ValueError('record expiry must be within 72 hours')
    if not created <= time.time() < expires:
        raise ValueError('record expired or future dated')
    return value


def record(value, *, home=None):
    value = dict(value); hours = value.pop('ttl_hours', 24)
    if type(hours) not in (int, float) or not 0 < hours <= 72:
        raise ValueError('record TTL must be 0..72 hours')
    now = time.time(); value.update(created_at=now, expires_at=now + hours * 3600)
    validate(value)
    home = Path(home or Path.home()); name = uuid.uuid4().hex + '.json'
    with storage(home) as directory:
        fd = os.open(name, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600, dir_fd=directory)
        with os.fdopen(fd, 'w') as stream:
            json.dump(value, stream, ensure_ascii=False); stream.flush(); os.fsync(stream.fileno())
        os.fsync(directory)
    return home / '.config/golems/approvals' / name


def read(directory, identity):
    if not re.fullmatch('[0-9a-f]{32}', identity): raise ValueError('record id invalid')
    try:
        fd = os.open(identity + '.json', os.O_RDONLY | os.O_NOFOLLOW, dir_fd=directory)
    except FileNotFoundError as exc: raise ValueError('record missing') from exc
    with os.fdopen(fd) as stream:
        private(os.fstat(stream.fileno()))
        try: value = json.load(stream)
        except (ValueError, UnicodeError) as exc: raise ValueError('record parse failed') from exc
    if not isinstance(value, dict): raise ValueError('record parse needs object')
    return validate(value)


def git(repo, *args):
    return subprocess.run(['/usr/bin/git', '-C', repo, *args], check=True, capture_output=True, text=True, timeout=15).stdout.rstrip('\n')


def remote_tip(repo, remote, ref):
    rows = git(repo, 'ls-remote', '--refs', '--', remote, ref).splitlines()
    if len(rows) != 1 or rows[0].split('\t')[1:] != [ref]:
        raise ValueError('remote tip mismatch: expected exactly one full ref')
    return rows[0].split('\t')[0]


def scope(value, repo, command):
    if command != value['command']: raise ValueError('command mismatch: byte-equal command required')
    ops = operations(command, repo)
    if len(ops) != 1 or ops[0]['class'] != 'delete': raise ValueError('operation class: delete only')
    # No wrappers, compound statements, redirects, other refs, config overrides or alternate executables.
    if shlex.split(command) != ['git', 'push', '--delete', 'origin', value['ref']]:
        raise ValueError('command grammar: one literal git push --delete origin full-ref required')
    op = ops[0]
    if op.get('repo') != repo or op.get('remote') != 'origin' or op.get('refs') != [value['ref']]:
        raise ValueError('command scope mismatch')
    for flags in ([], ['--push']):
        if git(repo, 'remote', 'get-url', *flags, '--all', 'origin') != value['repo_remote']:
            raise ValueError('origin mismatch: exact single fetch and push URL required')
    if remote_tip(repo, value['repo_remote'], value['ref']) != value['expected_remote_sha']:
        raise ValueError('remote tip mismatch')
    return ops


@contextmanager
def carry(home, identity, repo, command, presence):
    with storage(home) as directory:
        fd = os.open('consumed.jsonl', os.O_RDWR | os.O_APPEND | os.O_CREAT | os.O_NOFOLLOW, 0o600, dir_fd=directory)
        with os.fdopen(fd, 'r+') as ledger:
            private(os.fstat(ledger.fileno())); fcntl.flock(ledger, fcntl.LOCK_EX)
            try: spent = [json.loads(line)['id'] for line in ledger]
            except (ValueError, KeyError, TypeError) as exc: raise ValueError('consumed ledger malformed') from exc
            if identity in spent: raise ValueError('approval already consumed')
            value = read(directory, identity); scope(value, repo, command)
            if not presence(value): raise ValueError('human presence cancelled or timed out')
            # Re-read and revalidate after the human interaction; never consume a changed receipt.
            fresh = read(directory, identity)
            if fresh != value: raise ValueError('record changed during presence')
            ops = scope(fresh, repo, command)
            line = json.dumps(dict(id=identity, consumed_at=time.time())) + '\n'
            if os.write(ledger.fileno(), line.encode()) != len(line.encode()): raise OSError('short consumed ledger write')
            os.fsync(ledger.fileno()); os.fsync(directory)
            yield (ops, value['expires_at'])  # consumed durably BEFORE the token is written; failures stay spent
