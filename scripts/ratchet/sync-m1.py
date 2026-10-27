#!/usr/bin/env python3
"""Explicitly authorized M1 skills sync. Transports are injectable via PATH."""
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import stat
import subprocess
import sys
import tarfile
from datetime import datetime, timezone


def require(ok, message):
    if not ok:
        raise ValueError(message)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None


def installed():
    path = Path.home() / '.golems/release.json'
    return json.loads(path.read_text()) if path.exists() else {}


def inventory(path):
    if path.is_symlink():
        return ['link', os.readlink(path)]
    if path.is_dir():
        return {p.name: inventory(p) for p in sorted(path.iterdir())}
    return ['file', digest(path)]


def remote(mode, head, version, stage):
    home = Path.home()
    if mode == 'status':
        print(json.dumps(installed()))
        return
    work = home / stage
    config = home / '.codex/config.toml'
    if mode == 'prepare':
        roots = [p for p in (home / r for r in ('.claude/skills', '.agents/skills', '.codex/skills',
                 '.cursor/skills', '.gemini/config/skills')) if p.exists()]
        before = installed()
        preserved, keep = {}, []
        for root in roots:
            for entry in root.iterdir():
                if entry.is_symlink() and any(entry.resolve().is_relative_to(home / p)
                        for p in ('.golems/releases', '.golems/current', '.golems/vendor')):
                    continue
                preserved[str(entry)] = inventory(entry)
                if root == home / '.codex/skills' and not entry.is_symlink():
                    keep.append(str(entry))
        backup = home / '.claude' / ('skills.bak-' + work.name + '.tgz')
        backup.parent.mkdir(parents=True, exist_ok=True)
        with tarfile.open(backup, 'x:gz', dereference=False) as archive:
            for root in roots:
                archive.add(root, arcname=str(root.relative_to(home)))
        work.mkdir(parents=True, exist_ok=False)
        state = dict(config=digest(config), preserved=preserved, keep=keep, release=before)
        (work / 'before.json').write_text(json.dumps(state))
        print(json.dumps(dict(backup=str(backup), bytes=backup.stat().st_size, **state)))
        return
    state = json.loads((work / 'before.json').read_text())
    try:
        archive = work / f'golems-{version}.tar.gz'
        verify(work, head, version)
        with tarfile.open(archive) as release:
            (work / 'install.sh').write_bytes(release.extractfile('scripts/release/install.sh').read())
        result = subprocess.run(['sh', str(work / 'install.sh'), '--from-file', str(archive),
                    '--sums', str(work / 'SHA256SUMS'), '--preserve-releases'], capture_output=True, text=True)
        (work / 'install.log').write_text(result.stdout + result.stderr)
        print(result.stdout + result.stderr, end='')
        result.check_returncode()
        for path in state['keep']:
            require('Keeping existing path ' + path in result.stdout.splitlines(),
                    'installer omitted Keeping existing path ' + path)
        script = home / '.golems/current/skills/golem-powers/golem-install/scripts/repoint-skills.mjs'
        args = ['bun', str(script), '--source', str(home / '.golems/current/skills/golem-powers'), '--vendor-skills']
        subprocess.run(args, check=True)
        subprocess.run(args + ['--apply'], check=True)
        require(installed().get('commit') == head, 'M1 release.json does not report target')
    finally:
        after = digest(config)
        print(json.dumps(dict(config_before=state['config'], config_after=after)))
        require(after == state['config'], 'config.toml changed')
        for path, value in state['preserved'].items():
            require(inventory(Path(path)) == value, 'M1-only skill changed: ' + path)


def verify(work, head, version):
    names = [f'golems-{version}.tar.gz', 'MANIFEST.json']
    sums = [line.split() for line in (work / 'SHA256SUMS').read_text().splitlines()]
    for name in names:
        matches = [s[0] for s in sums if len(s) == 2 and s[1] == name]
        require(matches == [digest(work / name)], 'checksum mismatch: ' + name)
    manifest = json.loads((work / 'MANIFEST.json').read_text())
    require(manifest['commit'] == head and manifest['version'] == version, 'release identity mismatch')
    with tarfile.open(work / names[0]) as archive:
        members = archive.getmembers()
        require(all(m.isfile() and re.fullmatch(r'[A-Za-z0-9_.+/@-]+', m.name)
                    and not m.name.startswith('/') and '..' not in m.name.split('/') for m in members), 'unsafe archive')
        expected = {f['path']: f['sha256'] for f in manifest['files']}
        require(len(expected) == len(manifest['files']), 'duplicate manifest path')
        expected['MANIFEST.json'] = digest(work / 'MANIFEST.json')
        require(len(members) == len(expected) and {m.name for m in members} == set(expected), 'archive inventory mismatch')
        for m in members:
            require(hashlib.sha256(archive.extractfile(m).read()).hexdigest() == expected[m.name], 'payload checksum mismatch: ' + m.name)


def after_m1_sync(head, work):
    # RC-I5 owns the future skills-sync install receipt at this hook point.
    print('after_m1_sync: target ' + head + '; RC-I5 receipt hook reserved')


def authorized():
    try:
        path = Path.home() / '.golems/ratchet/m1-sync-authorized.json'
        metadata = path.lstat()
        require(stat.S_ISREG(metadata.st_mode) and metadata.st_uid == os.getuid()
                and not metadata.st_mode & 0o077, 'owner-only regular file required')
        grant = json.loads(path.read_text())
        require(type(grant) is dict and type(grant.get('schema')) is int
                and grant['schema'] == 1 and grant.get('item') == 32
                and grant.get('scope') == 'm1-skills-install'
                and isinstance(grant.get('words'), str) and grant['words'].strip(), 'invalid grant')
        require(isinstance(grant.get('date'), str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}', grant['date']), 'invalid date')
        datetime.strptime(grant['date'], '%Y-%m-%d')
        return True
    except (ValueError, OSError):
        return False


def check_authorization():
    if not authorized():
        print('M1 sync not authorized (Etan #32)', file=sys.stderr)
        sys.exit(1)


def sync(head, version, work):
    check_authorization()
    work.mkdir(parents=True, exist_ok=False)
    tag = 'v' + version
    try:
        release = subprocess.run(['gh', 'release', 'view', tag, '--repo', 'EtanHey/golems',
                                  '--json', 'isDraft', '--jq', '.isDraft'], capture_output=True, check=True)
    except subprocess.CalledProcessError:
        print(f'release for {head} not published yet; re-run when it is', file=sys.stderr)
        return 2
    require(release.stdout.strip() == b'false', 'release is not published (draft)')
    subprocess.run(['gh', 'release', 'download', tag, '--repo', 'EtanHey/golems', '--dir', str(work),
                    '--pattern', f'golems-{version}.tar.gz', '--pattern', 'SHA256SUMS', '--pattern', 'MANIFEST.json'], check=True)
    verify(work, head, version)  # No SSH, even a read, before verification.
    source = Path(__file__).read_bytes()
    stage = '.golems/m1-sync/' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%f')

    def ssh(mode, capture=False):
        command = shlex.join(['python3', '-B', '-', '--remote', mode, head, version, stage])
        return subprocess.run(['ssh', '-o', 'BatchMode=yes', 'm1', command], input=source,
                              stdout=subprocess.PIPE if capture else None, check=True)
    before = ssh('status', capture=True).stdout
    (work / 'release-before.json').write_bytes(before)
    if json.loads(before).get('commit') == head:
        print('M1 already at ' + head + '; no copy or backup')
        return 0
    ssh('prepare')
    subprocess.run(['scp', '-o', 'BatchMode=yes', *[str(work / n) for n in
                   (f'golems-{version}.tar.gz', 'SHA256SUMS', 'MANIFEST.json')], 'm1:' + stage + '/'], check=True)
    ssh('apply')
    after_m1_sync(head, work)
    return 0


if __name__ == '__main__':
    try:
        os.umask(0o077)
        if sys.argv[1] == '--remote':
            remote(*sys.argv[2:])
        elif sys.argv[1] == '--check-authorization':
            check_authorization()
        else:
            head, version, directory = sys.argv[1:]
            require(re.fullmatch(r'[0-9a-f]{40}', head) and re.fullmatch(r'\d{4}\.\d{2}\.\d{2}-' + head[:7], version), 'invalid target')
            sys.exit(sync(head, version, Path(directory)))
    except (ValueError, OSError, KeyError, subprocess.CalledProcessError, tarfile.TarError) as error:
        print('sync-m1: ' + str(error), file=sys.stderr)
        sys.exit(1)
