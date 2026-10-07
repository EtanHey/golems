#!/usr/bin/env python3
"""Read-only live skill parity. Fixtures are explicit and never the live row command."""
import argparse
import hashlib
import json
import os
import re
import socket
import uuid
import subprocess
import sys
from pathlib import Path

ROOTS = ('.claude/skills', '.agents/skills', '.codex/skills')
IGNORED = {'.git', 'node_modules', '__pycache__', '.pytest_cache'}


def normalize(value, home):
    return '$HOME' + value[len(home):] if value == home or value.startswith(home + '/') else value


def walk_error(error):
    raise error


def observed_identity():
    result = subprocess.run(['/usr/sbin/ioreg', '-rd1', '-c', 'IOPlatformExpertDevice'],
                            capture_output=True, text=True, timeout=10, check=True)
    values = re.findall(r'"IOPlatformUUID"\s*=\s*"([0-9A-Fa-f-]{36})"', result.stdout)
    if len(values) != 1 or uuid.UUID(values[0]).int == 0:
        raise ValueError('machine identity unavailable')
    hostname = socket.gethostname().strip().lower()
    home = str(Path.home().resolve(strict=True))
    if not hostname or not home.startswith('/'):
        raise ValueError('hostname/HOME identity unavailable')
    return {key: hashlib.sha256(value.encode()).hexdigest() for key, value in
            [('machine', str(uuid.UUID(values[0]))), ('hostname', hostname), ('home', home)]}


def object_keys(value, keys, label):
    if not isinstance(value, dict) or set(value) != set(keys):
        raise ValueError(label + ': malformed object')


def name(value, nested=False):
    if (not isinstance(value, str) or not value or any(ord(c) < 32 for c in value) or
            value.startswith('/') or any(p in ('', '.', '..') for p in value.split('/')) or
            (not nested and '/' in value)):
        raise ValueError('malformed relative name')


def digest(value):
    if not isinstance(value, str) or not re.fullmatch('[0-9a-f]{64}', value):
        raise ValueError('malformed digest')


def identity(value):
    object_keys(value, ('machine', 'hostname', 'home'), 'identity')
    for field in value.values(): digest(field)


def names(value, nested=False, nonempty=False):
    if not isinstance(value, list) or (nonempty and not value):
        raise ValueError('malformed readable/allowlist')
    for item in value: name(item, nested)
    if len(set(value)) != len(value): raise ValueError('duplicate list entry')


def validate(document, required=False):
    object_keys(document, ('schema', 'identities' if required else 'identity', 'roots'), 'manifest')
    if type(document['schema']) is not int or document['schema'] != 2:
        raise ValueError('schema 2 required; historical schema 1 is not fresh identity proof')
    object_keys(document['roots'], ROOTS, 'roots')
    if required:
        pins = document['identities']
        if not isinstance(pins, list) or len(pins) != 2: raise ValueError('two identity pins required')
        for pin in pins: identity(pin)
        if pins[0]['machine'] == pins[1]['machine']: raise ValueError('identity pins must name two machines')
    else: identity(document['identity'])
    for root, record in document['roots'].items():
        if required:
            object_keys(record, ('readable', 'allow_broken', 'allow_empty', 'target_aliases'), root)
            names(record['readable'], nested=True, nonempty=True)
            for field in ('allow_broken', 'allow_empty'): names(record[field])
            if not isinstance(record['target_aliases'], dict): raise ValueError('malformed aliases')
            for entry, targets in record['target_aliases'].items():
                name(entry)
                if (not isinstance(targets, list) or len(targets) != 2 or
                        any(not isinstance(t, str) or not t.startswith('$HOME/') for t in targets)):
                    raise ValueError('malformed target alias')
            continue
        object_keys(record, ('exists', 'entries'), root)
        if type(record['exists']) is not bool or not isinstance(record['entries'], dict):
            raise ValueError(root + ': malformed root')
        for entry, row in record['entries'].items():
            name(entry)
            object_keys(row, ('kind', 'exists', 'normalized_target', 'skill_sha256', 'files', 'internal_skills'), 'entry')
            if row['kind'] not in ('file', 'dir', 'symlink') or type(row['exists']) is not bool:
                raise ValueError('malformed entry kind/existence')
            if not isinstance(row['normalized_target'], str) or not row['normalized_target']:
                raise ValueError('malformed target')
            if row['skill_sha256'] is not None: digest(row['skill_sha256'])
            for field in ('files', 'internal_skills'):
                if not isinstance(row[field], dict): raise ValueError('malformed entry catalog')
            for key, value in row['internal_skills'].items(): name(key, True); digest(value)
            for key, value in row['files'].items():
                name(key, True)
                if not isinstance(value, dict): raise ValueError('malformed supporting entry')
                if value.get('kind') == 'file':
                    object_keys(value, ('kind', 'sha256', 'executable'), 'file'); digest(value['sha256'])
                    if type(value['executable']) is not bool: raise ValueError('malformed executable bit')
                else:
                    object_keys(value, ('kind', 'target'), 'supporting link')
                    if value['kind'] != 'symlink' or not isinstance(value['target'], str) or not value['target']:
                        raise ValueError('malformed supporting link')


def inventory():
    home = str(Path.home())
    roots = {}
    for root in ROOTS:
        directory = Path(home) / root
        entries = {}
        if directory.is_dir():
            for entry in sorted(directory.iterdir()):
                if entry.name == '.DS_Store': continue
                row = dict(kind='symlink' if entry.is_symlink() else 'dir' if entry.is_dir() else 'file',
                           exists=entry.exists(), normalized_target=normalize(str(entry.resolve()), home),
                           skill_sha256=None, files={}, internal_skills={})
                if entry.is_dir():
                    files = {}
                    for base, dirs, names in os.walk(entry.resolve(), followlinks=False, onerror=walk_error):
                        dirs[:] = sorted(d for d in dirs if d not in IGNORED)
                        for name in sorted(dirs + names):
                            if name == '.DS_Store' or name.endswith('.pyc'): continue
                            item = Path(base) / name
                            relative = str(item.relative_to(entry.resolve()))
                            if item.is_symlink():
                                if not item.exists(): raise ValueError('broken supporting link')
                                files[relative] = dict(kind='symlink', target=normalize(os.readlink(item), home))
                            elif item.is_file():
                                files[relative] = dict(kind='file', sha256=hashlib.sha256(item.read_bytes()).hexdigest(),
                                                       executable=bool(item.stat().st_mode & 0o111))
                    if 'SKILL.md' in files:
                        row['skill_sha256'] = hashlib.sha256((entry / 'SKILL.md').read_bytes()).hexdigest()
                        row['files'] = files
                    else:
                        nested = {str(Path(k).parent): v['sha256'] for k, v in files.items()
                                  if Path(k).name == 'SKILL.md' and v['kind'] == 'file'}
                        row['internal_skills'] = nested
                        row['files'] = {k: v for k, v in files.items()
                                        if any(k.startswith(n + '/') for n in nested)}
                entries[entry.name] = row
        roots[root] = dict(exists=directory.is_dir(), entries=entries)
    return dict(schema=2, identity=observed_identity(), roots=roots)


def supporting(entry):
    files = entry.get('files', {})
    if entry.get('skill_sha256'): return files
    return {k: v for k, v in files.items()
            if any(k.startswith(n + '/') for n in entry.get('internal_skills', {}))}


def compare(left, right, requirements):
    validate(left); validate(right); validate(requirements, required=True)
    errors, invalid = [], []
    parity, valid = True, True
    identities_valid = True
    if left['identity']['machine'] == right['identity']['machine']:
        errors.append('hosts: local/remote identify the same machine'); identities_valid = False
    for role, actual, expected in zip(('local', 'remote'), (left['identity'], right['identity']), requirements['identities']):
        if actual != expected:
            errors.append(role + ': unexpected machine/hostname/HOME identity'); identities_valid = False
    for root in ROOTS:
        required = requirements['roots'][root]
        if not isinstance(required.get('readable'), list) or not required['readable']:
            raise ValueError('empty required readable catalog')
        hosts = [document['roots'].get(root) for document in [left, right]]
        if any(not host or host.get('exists') is not True for host in hosts):
            errors.append(root + ': missing root'); parity = valid = False
            continue
        catalogs = [{n: e for n, e in host['entries'].items() if n != '.DS_Store'} for host in hosts]
        for number in (0, 1):
            for missing in sorted(set(catalogs[1-number]) - set(catalogs[number])):
                errors.append(root + '/' + missing + ': host ' + str(number) + ' name missing'); parity = False
        for number, catalog in enumerate(catalogs):
            readable = set()
            for name, entry in catalog.items():
                if entry.get('skill_sha256'): readable.add(name)
                readable.update(name + '/' + n for n in entry.get('internal_skills', {}))
                target = entry.get('normalized_target', '')
                if not target.startswith('$HOME/'):
                    errors.append(root + '/' + name + ': host ' + str(number) + ' foreign target'); valid = False
                if entry.get('exists') is not True:
                    invalid.append(root + '/' + name + ': host ' + str(number) + ' broken')
                    if name not in required.get('allow_broken', []):
                        errors.append(root + '/' + name + ': host ' + str(number) + ' broken entry'); valid = False
                elif not entry.get('skill_sha256') and not entry.get('internal_skills'):
                    invalid.append(root + '/' + name + ': host ' + str(number) + ' empty/non-skill')
                    if name not in required.get('allow_empty', []):
                        errors.append(root + '/' + name + ': host ' + str(number) + ' unreadable entry'); valid = False
            for missing in sorted(set(required['readable']) - readable):
                errors.append(root + '/' + missing + ': host ' + str(number) + ' required readable skill missing'); valid = False
        for name in set(catalogs[0]) & set(catalogs[1]):
            a, b = (catalog[name] for catalog in catalogs)
            fields = ['kind', 'exists', 'skill_sha256']
            if (any(a.get(k) != b.get(k) for k in fields) or
                    a.get('internal_skills', {}) != b.get('internal_skills', {}) or supporting(a) != supporting(b)):
                errors.append(root + '/' + name + ': local/remote content/shape mismatch'); parity = False
            targets = [a['normalized_target'], b['normalized_target']]
            if targets[0] != targets[1] and required.get('target_aliases', {}).get(name) != targets:
                errors.append(root + '/' + name + ': local/remote target mismatch'); parity = False
    return dict(host_identity_valid=identities_valid, name_content_parity=parity, required_readable_valid=valid,
                disclosed_invalid=invalid, errors=errors)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--inventory', action='store_true')
    parser.add_argument('--host', default=os.environ.get('RATCHET_SKILL_HOST'))
    parser.add_argument('--identity', default=os.environ.get('RATCHET_SKILL_IDENTITY'))
    parser.add_argument('--requirements', default=os.environ.get('RATCHET_SKILL_REQUIREMENTS'))
    parser.add_argument('--left'); parser.add_argument('--right')
    args = parser.parse_args()
    try:
        if args.inventory:
            print(json.dumps(inventory(), sort_keys=True)); return 0
        if not args.requirements: raise ValueError('required readable manifest unavailable')
        required = json.loads(Path(args.requirements).read_text())
        if args.left or args.right:
            if not (args.left and args.right): raise ValueError('both fixture manifests required')
            left, right = (json.loads(Path(p).read_text()) for p in [args.left, args.right])
            measurement = 'fixture'
        else:
            if not args.host or args.host.startswith('-'): raise ValueError('SSH host unavailable')
            command = ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10']
            if args.identity: command += ['-o', 'IdentitiesOnly=yes', '-o', 'IdentityAgent=none', '-i', args.identity]
            command += [args.host, 'python3 - --inventory']
            remote = subprocess.run(command, input=Path(__file__).read_text(), text=True,
                                    capture_output=True, timeout=60, check=True)
            left, right, measurement = inventory(), json.loads(remote.stdout), 'live'
        result = compare(left, right, required)
        for message in result['errors'] + result['disclosed_invalid']: print(message, file=sys.stderr)
        print(json.dumps({k: v for k, v in dict(measurement=measurement, **result, error_count=len(result['errors']), disclosed_invalid_count=len(result['disclosed_invalid'])).items() if k not in ('errors', 'disclosed_invalid')}, sort_keys=True))
        return 1 if result['errors'] else 0
    except (OSError, ValueError, KeyError, TypeError, AttributeError, subprocess.SubprocessError) as error:
        print('installed skill parity: FAIL (' + (str(error) if isinstance(error, ValueError) else type(error).__name__) + ')', file=sys.stderr)
        return 1


if __name__ == '__main__': sys.exit(main())
