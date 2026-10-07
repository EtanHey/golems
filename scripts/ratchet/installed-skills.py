#!/usr/bin/env python3
"""Read-only live skill parity. Fixtures are explicit and never the live row command."""
import argparse
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

ROOTS = ('.claude/skills', '.agents/skills', '.codex/skills')
IGNORED = {'.git', 'node_modules', '__pycache__', '.pytest_cache'}


def normalize(value, home):
    return '$HOME' + value[len(home):] if value == home or value.startswith(home + '/') else value


def walk_error(error):
    raise error


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
    return dict(schema=1, roots=roots)


def supporting(entry):
    files = entry.get('files', {})
    if entry.get('skill_sha256'): return files
    return {k: v for k, v in files.items()
            if any(k.startswith(n + '/') for n in entry.get('internal_skills', {}))}


def compare(left, right, requirements):
    for document in [left, right, requirements]:
        if document.get('schema') != 1 or not isinstance(document.get('roots'), dict):
            raise ValueError('invalid manifest schema')
    if set(requirements['roots']) != set(ROOTS): raise ValueError('requirements need all three roots')
    errors, invalid = [], []
    parity, valid = True, True
    for root in ROOTS:
        required = requirements['roots'][root]
        if not isinstance(required.get('readable'), list) or not required['readable']:
            raise ValueError('empty required readable catalog')
        hosts = [document['roots'].get(root) for document in [left, right]]
        if any(not host or host.get('exists') is not True for host in hosts):
            errors.append(root + ': missing root'); parity = valid = False
            continue
        catalogs = [{n: e for n, e in host['entries'].items() if n != '.DS_Store'} for host in hosts]
        if set(catalogs[0]) != set(catalogs[1]):
            errors.append(root + ': name mismatch'); parity = False
        for number, catalog in enumerate(catalogs):
            readable = set()
            for name, entry in catalog.items():
                if entry.get('skill_sha256'): readable.add(name)
                readable.update(name + '/' + n for n in entry.get('internal_skills', {}))
                target = entry.get('normalized_target', '')
                if not target.startswith('$HOME/'):
                    errors.append(root + ': foreign target'); valid = False
                if entry.get('exists') is not True:
                    invalid.append(root + '/' + name + ': host ' + str(number) + ' broken')
                    if name not in required.get('allow_broken', []):
                        errors.append(root + ': broken entry'); valid = False
                elif not entry.get('skill_sha256') and not entry.get('internal_skills'):
                    invalid.append(root + '/' + name + ': host ' + str(number) + ' empty/non-skill')
                    if name not in required.get('allow_empty', []):
                        errors.append(root + ': unreadable entry'); valid = False
            if set(required['readable']) - readable:
                errors.append(root + ': required readable skill missing'); valid = False
        for name in set(catalogs[0]) & set(catalogs[1]):
            a, b = (catalog[name] for catalog in catalogs)
            fields = ['kind', 'exists', 'skill_sha256']
            if (any(a.get(k) != b.get(k) for k in fields) or
                    a.get('internal_skills', {}) != b.get('internal_skills', {}) or supporting(a) != supporting(b)):
                errors.append(root + ': content/shape mismatch'); parity = False
            targets = [a['normalized_target'], b['normalized_target']]
            if targets[0] != targets[1] and required.get('target_aliases', {}).get(name) != targets:
                errors.append(root + ': target mismatch'); parity = False
    return dict(name_content_parity=parity, required_readable_valid=valid,
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
        print(json.dumps(dict(measurement=measurement, **result), sort_keys=True))
        return 1 if result['errors'] else 0
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError):
        print('installed skill parity: FAIL (host, roots, manifest, or readable content unavailable)', file=sys.stderr)
        return 1


if __name__ == '__main__': sys.exit(main())
