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


def managed_link(entry, home):
    if not entry.is_symlink():
        return None
    target = entry.resolve()
    if any(target.is_relative_to(home / p) for p in ('.golems/releases', '.golems/current', '.golems/vendor')):
        return 'release'
    checkout = str(target).rsplit('/skills/', 1)[0] if '/skills/' in str(target) else ''
    return 'checkout' if checkout.endswith('/golems') or re.fullmatch(r'.*/golems/\.worktrees/[^/]+', checkout) else None


def remote(mode, head, version, stage):
    home = Path.home()
    if mode == 'receipt':
        source = home / '.golems/current'
        writer = source / 'scripts/skills-sync-receipt.mjs'
        try:
            require(installed().get('commit') == head, 'receipt release identity mismatch')
            require(writer.is_file(), 'receipt writer missing')
            result = subprocess.run(['node', str(writer), 'emit', 'release-channel', 'm1', str(source),
                                     str(home / '.golems')], capture_output=True, text=True)
            print(result.stdout + result.stderr, end='')
            result.check_returncode()
            verdicts = re.findall(r'^skills-sync receipt: (LIVE|INSTALLED_NOT_ACTIVE|MISMATCH|FAILED)$', result.stdout, re.M)
            require(len(verdicts) == 1, 'receipt verdict unavailable')
            print('m1-receipt: ' + verdicts[0])
        except (OSError, ValueError, subprocess.SubprocessError) as error:
            print('m1-receipt: unavailable')
            print('M1 receipt unavailable: ' + str(error), file=sys.stderr)
        return
    if mode == 'status':
        attempts = list((home / '.golems/m1-sync').glob(head + '-*'))
        for attempt in attempts:
            marker = attempt / 'success.json'
            try:
                completion = json.loads(marker.read_text()) if marker.is_file() and not marker.is_symlink() else None
            except (ValueError, OSError):
                completion = None
            require(isinstance(completion, dict) and completion.get('head') == head,
                    'M1 sync needs attention: incomplete stage ' + str(attempt))
        record = installed()
        require(record.get('commit') != head or attempts, 'M1 sync needs attention: no success marker for ' + head)
        print(json.dumps(dict(record, sync_verified=bool(attempts))))
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
                kind = managed_link(entry, home)
                if kind == 'release':
                    continue
                preserved[str(entry)] = ['checkout-link', os.readlink(entry)] if kind == 'checkout' else inventory(entry)
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
            entry = Path(path)
            if isinstance(value, list) and value[0] == 'checkout-link':
                expected = home / '.golems/current/skills/golem-powers' / entry.name
                unchanged = entry.is_symlink() and (os.readlink(entry) == value[1] or entry.resolve() == expected.resolve())
            else:
                unchanged = inventory(entry) == value
            require(unchanged, 'M1-only skill changed: ' + path)
    marker = work / 'success.json.pending'
    marker.write_text(json.dumps(dict(head=head)))
    marker.replace(work / 'success.json')


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
    # Only called after sync() passed the standing authorization and verified apply.
    command = shlex.join(['python3', '-B', '-', '--remote', 'receipt', head, '', ''])
    try:
        result = subprocess.run(['ssh', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'UpdateHostKeys=no', 'm1', command], input=Path(__file__).read_bytes(),
                                capture_output=True, timeout=180)
        text = (result.stdout + result.stderr).decode(errors='replace')
        if result.returncode or not re.search(r'^m1-receipt: ', text, re.M): text += '\nm1-receipt: unavailable\n'
    except (OSError, subprocess.SubprocessError) as error:
        text = 'm1-receipt: unavailable\n' + str(error) + '\n'
    (work / 'm1-receipt.log').write_text(text)
    print(text, end='')


def authorized():
    try:
        path = Path.home() / '.golems/ratchet/m1-sync-authorized.json'
        parent = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            require(not os.fstat(parent).st_mode & 0o022, 'authorization directory is writable by others')
            with os.fdopen(os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)) as stream:
                metadata = os.fstat(stream.fileno())
                require(stat.S_ISREG(metadata.st_mode) and metadata.st_uid == os.getuid()
                        and not metadata.st_mode & 0o077, 'owner-only regular file required')
                grant = json.load(stream)
        finally:
            os.close(parent)
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
    release = subprocess.run(['gh', 'api', 'repos/EtanHey/golems/releases/tags/' + tag,
                              '--jq', '.draft'], capture_output=True)
    if (release.returncode and b'HTTP 404' in release.stderr) or (not release.returncode and release.stdout.strip() == b'true'):
        print(f'release for {head} not published yet; re-run when it is', file=sys.stderr)
        return 2
    if release.returncode:
        print(release.stderr.decode(errors='replace').strip(), file=sys.stderr)
        return 1
    require(release.stdout.strip() == b'false', 'invalid release metadata')
    subprocess.run(['gh', 'release', 'download', tag, '--repo', 'EtanHey/golems', '--dir', str(work),
                    '--pattern', f'golems-{version}.tar.gz', '--pattern', 'SHA256SUMS', '--pattern', 'MANIFEST.json'], check=True)
    verify(work, head, version)  # No SSH, even a read, before verification.
    source = Path(__file__).read_bytes()
    stage = '.golems/m1-sync/' + head + '-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%f')

    def ssh(mode, capture=False):
        command = shlex.join(['python3', '-B', '-', '--remote', mode, head, version, stage])
        return subprocess.run(['ssh', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'UpdateHostKeys=no', 'm1', command], input=source,
                              stdout=subprocess.PIPE if capture else None, check=True)
    before = ssh('status', capture=True).stdout
    (work / 'release-before.json').write_bytes(before)
    record = json.loads(before)
    if record.get('commit') == head and record.get('sync_verified') is True:
        print('M1 already at ' + head + '; no copy or backup')
        after_m1_sync(head, work)
        return 0
    ssh('prepare')
    subprocess.run(['scp', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'UpdateHostKeys=no', *[str(work / n) for n in
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
