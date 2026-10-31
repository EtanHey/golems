#!/usr/bin/env python3
"""Read-only live skill and enabled-plugin parity. Fixtures are explicit and never the live row command."""
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
IGNORED = {'.pytest_cache'}
# Codex owns .system (CLI-version dependent); Claude app sync owns synced
# (account/machine dependent). Neither namespace is shipped by golems.
APP_MANAGED = {'.codex/skills': {'.system'}, '.claude/skills': {'synced'}}


def app_managed(root, name):
    return name.split('/')[0] in APP_MANAGED.get(root, set())


INSTALLER_MARKERS = {'.golems-source-commit', '.golems-install.json'}
# Claude config dirs (relative to HOME) whose settings.json enabledPlugins must match.
DEFAULT_CLAUDE_CONFIG_DIRS = ('.claude',)


def normalize(value, home):
    return '$HOME' + value[len(home):] if value == home or value.startswith(home + '/') else value


def version(value):
    if (not isinstance(value, str) or not value or value != value.strip() or
            any(ord(c) < 32 for c in value)):
        raise ValueError('malformed installed version')


def commit(value):
    if not isinstance(value, str) or not re.fullmatch(r'[0-9a-f]{40}|[0-9a-f]{64}', value):
        raise ValueError('malformed installed/checkout commit')


def installed_release(home):
    # installed.json belongs to golems-sync; only the release installer owns versions.
    record = Path(home) / '.golems/release.json'
    if not record.exists() and not record.is_symlink(): return None
    try:
        data = json.loads(record.read_text())
        if not isinstance(data, dict): raise ValueError('malformed record')
        value = data.get('version')
        version(value)
        if 'commit' in data: commit(data['commit'])
    except (OSError, ValueError):
        raise ValueError('release.json unreadable or malformed installed version')
    return data


def checkout_head(directory):
    # Provenance is best-effort; content remains the gate if Git is unavailable.
    try:
        result = subprocess.run(['git', '-C', str(directory), 'rev-parse', 'HEAD'],
                                capture_output=True, text=True, timeout=5, check=True)
        value = result.stdout.strip()
        commit(value)
        return value
    except (OSError, ValueError, subprocess.SubprocessError):
        return None


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
    keys = {'schema', 'identities' if required else 'identity', 'roots'}
    if not required and isinstance(document, dict) and 'installed_version' in document:
        keys.add('installed_version')
        version(document['installed_version'])
    if not required and isinstance(document, dict):
        if 'claude_plugins' in document:
            keys.add('claude_plugins')
            validate_plugins(document['claude_plugins'])
        if 'installed_commit' in document:
            keys.add('installed_commit')
            if 'installed_version' not in document: raise ValueError('release commit without version')
            commit(document['installed_commit'])
        if 'checkout_commits' in document:
            keys.add('checkout_commits')
            values = document['checkout_commits']
            if not isinstance(values, list): raise ValueError('malformed checkout commits')
            for value in values: commit(value)
            if len(set(values)) != len(values): raise ValueError('duplicate checkout commit')
    object_keys(document, keys, 'manifest')
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
            # Deprecated: target_aliases is validated for schema compatibility only.
            if not isinstance(record['target_aliases'], dict): raise ValueError('malformed aliases')
            for entry, targets in record['target_aliases'].items():
                name(entry)
                if (not isinstance(targets, list) or len(targets) != 2 or
                        any(not isinstance(t, str) or not t.startswith('$HOME/') for t in targets)):
                    raise ValueError('malformed target alias')
                for target in targets: name(target[len('$HOME/'):], nested=True)
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
                if value.get('kind') != 'file':
                    raise ValueError('supporting file requires content digest; refresh inventory')
                object_keys(value, ('kind', 'sha256', 'executable'), 'file'); digest(value['sha256'])
                if type(value['executable']) is not bool: raise ValueError('malformed executable bit')


def config_dirs(value):
    # Config spelling is ~/<dir>; inventories and diagnostics use the HOME-relative <dir>.
    if (not isinstance(value, list) or not value or
            any(not isinstance(item, str) or not item.startswith('~/') for item in value)):
        raise ValueError('claude_config_dirs must be a nonempty list of ~/ paths')
    dirs = [item[2:].rstrip('/') for item in value]
    for item in dirs: name(item, nested=True)
    if len(set(dirs)) != len(dirs): raise ValueError('duplicate claude_config_dirs entry')
    return tuple(dirs)


def enabled_plugins(home, directory):
    # Every configured dir owes a readable settings.json; absence is a named failure, not "none enabled".
    settings = Path(home) / directory / 'settings.json'
    try:
        text = settings.read_text()
    except FileNotFoundError:
        return dict(error='settings.json missing')
    except (OSError, UnicodeDecodeError):
        return dict(error='settings.json unreadable')
    try:
        data = json.loads(text)
    except ValueError:
        return dict(error='settings.json not JSON')
    if not isinstance(data, dict): return dict(error='settings.json not a JSON object')
    plugins = data.get('enabledPlugins', {})
    if not isinstance(plugins, dict) or any(type(v) is not bool for v in plugins.values()):
        return dict(error='enabledPlugins malformed')
    return dict(enabled=sorted(key for key, value in plugins.items() if value))


def plugin_key(value):
    if not isinstance(value, str) or not value or any(ord(c) < 32 for c in value):
        raise ValueError('malformed plugin key')


def validate_plugins(value):
    if not isinstance(value, dict) or not value: raise ValueError('malformed claude_plugins')
    for directory, record in value.items():
        name(directory, nested=True)
        if isinstance(record, dict) and set(record) == {'error'}:
            if not isinstance(record['error'], str) or not record['error'] or any(ord(c) < 32 for c in record['error']):
                raise ValueError('malformed claude_plugins error')
            continue
        object_keys(record, ('enabled',), 'claude_plugins')
        if not isinstance(record['enabled'], list): raise ValueError('malformed claude_plugins enabled')
        for key in record['enabled']: plugin_key(key)
        if len(set(record['enabled'])) != len(record['enabled']): raise ValueError('duplicate enabled plugin')


def compare_plugins(left, right, dirs):
    errors = []
    hosts = [('local', left.get('claude_plugins')), ('remote', right.get('claude_plugins'))]
    for role, plugins in hosts:
        if plugins is None:
            errors.append('plugin-inventory missing: ' + role + ' reported no claude_plugins')
        elif set(plugins) != set(dirs):
            errors.append('plugin-config-dirs mismatch: ' + role + ' reported [' + ','.join(sorted(plugins)) +
                          '] expected [' + ','.join(dirs) + ']')
    if errors: return errors
    for directory in dirs:
        for role, plugins in hosts:
            if 'error' in plugins[directory]:
                errors.append('plugin-settings-invalid ' + directory + ': ' + role + ' ' + plugins[directory]['error'])
    if errors: return errors
    enabled = [{key: [d for d in dirs if key in plugins[d]['enabled']]
                for key in {k for d in dirs for k in plugins[d]['enabled']}} for _, plugins in hosts]
    for key in sorted(set(enabled[0]) | set(enabled[1])):
        a, b = enabled[0].get(key, []), enabled[1].get(key, [])
        if a != b:
            errors.append('plugin-enabled-mismatch ' + key + ': local=[' + ','.join(a) + '] remote=[' + ','.join(b) + ']')
    return errors


def release_policy():
    # Stdin execution on the remote host has no sibling files. The local caller
    # prepends the builder's policy, so neither host relies on the remote checkout.
    policy = globals().get('RELEASE_SHIPPING_POLICY')
    if policy is None:
        policy = json.loads((Path(__file__).resolve().parents[1] /
                             'release/shipped-paths.json').read_text())
    object_keys(policy, ('schema', 'roots', 'support', 'excluded_parts', 'excluded_files'), 'release shipping policy')
    if type(policy['schema']) is not int or policy['schema'] != 1:
        raise ValueError('release shipping policy schema must be 1')
    for field in ('roots', 'support', 'excluded_parts'):
        if not isinstance(policy[field], list) or not policy[field] or any(
                not isinstance(value, str) or not value for value in policy[field]):
            raise ValueError('malformed release shipping policy ' + field)
    if not isinstance(policy['excluded_files'], str):
        raise ValueError('malformed release shipping policy excluded_files')
    try:
        re.compile(policy['excluded_files'])
    except re.error:
        raise ValueError('malformed release shipping policy excluded_files')
    return policy


def shipped_skill_path(path, policy, directory=False):
    path = 'skills/golem-powers/' + path
    return ((path in policy['support'] or any(path.startswith(root) for root in policy['roots'])) and
            not any(part in policy['excluded_parts'] for part in path.split('/')) and
            (directory or not re.search(policy['excluded_files'], path)))


def remote_inventory_script(dirs=DEFAULT_CLAUDE_CONFIG_DIRS):
    # Config dirs travel inside the script, like the policy: nothing reaches the remote shell.
    return ('RELEASE_SHIPPING_POLICY = ' + repr(release_policy()) + '\n' +
            'INVENTORY_CLAUDE_CONFIG_DIRS = ' + repr(tuple(dirs)) + '\n' + Path(__file__).read_text())


def content_files(directory, ancestors=frozenset(), prefix='', policy=None, skill_prefix=''):
    if policy is None: policy = release_policy()
    resolved = directory.resolve(strict=True)
    if resolved in ancestors: raise ValueError('supporting directory symlink cycle')
    files = {}
    for item in sorted(directory.iterdir()):
        regular_file = item.is_file() and not item.is_symlink()
        if regular_file and ((not prefix and item.name in INSTALLER_MARKERS) or
                             item.name == '.DS_Store' or item.name.endswith('.pyc')):
            continue
        relative = prefix + item.name
        if not shipped_skill_path(skill_prefix + relative, policy, directory=item.is_dir()):
            continue
        if item.is_symlink() and not item.exists(): raise ValueError('broken supporting link')
        if item.is_dir():
            if item.name not in IGNORED:
                files.update(content_files(item, ancestors | {resolved}, relative + '/', policy, skill_prefix))
        elif item.is_file():
            files[relative] = dict(kind='file', sha256=hashlib.sha256(item.read_bytes()).hexdigest(),
                                   executable=bool(item.stat().st_mode & 0o111))
        elif item.is_symlink():
            raise ValueError('unsupported supporting link')
    return files


def inventory(dirs=DEFAULT_CLAUDE_CONFIG_DIRS):
    policy = release_policy()
    home = str(Path.home())
    roots = {}
    skill_directories = set()
    for root in ROOTS:
        directory = Path(home) / root
        entries = {}
        if directory.is_dir():
            for entry in sorted(directory.iterdir()):
                if app_managed(root, entry.name): continue
                if entry.name == '.DS_Store' and entry.is_file() and not entry.is_symlink(): continue
                row = dict(kind='symlink' if entry.is_symlink() else 'dir' if entry.is_dir() else 'file',
                           exists=entry.exists(), normalized_target=normalize(str(entry.resolve()), home),
                           skill_sha256=None, files={}, internal_skills={})
                if entry.is_dir():
                    files = content_files(entry, policy=policy, skill_prefix=entry.name + '/')
                    if 'SKILL.md' in files:
                        row['skill_sha256'] = files['SKILL.md']['sha256']
                        row['files'] = files
                    else:
                        nested = {str(Path(k).parent): v['sha256'] for k, v in files.items()
                                  if Path(k).name == 'SKILL.md' and v['kind'] == 'file'}
                        row['internal_skills'] = nested
                        row['files'] = {k: v for k, v in files.items()
                                        if any(k.startswith(n + '/') for n in nested)}
                if row['skill_sha256'] or row['internal_skills']:
                    skill_directories.add(entry.resolve())
                entries[entry.name] = row
        roots[root] = dict(exists=directory.is_dir(), entries=entries)
    document = dict(schema=2, identity=observed_identity(), roots=roots,
                    claude_plugins={directory: enabled_plugins(home, directory) for directory in dirs})
    release = installed_release(home)
    if release is not None:
        document['installed_version'] = release['version']
        if 'commit' in release: document['installed_commit'] = release['commit']
    else:
        heads = sorted({head for directory in sorted(skill_directories)
                        if (head := checkout_head(directory)) is not None})
        if heads: document['checkout_commits'] = heads
    return document


def supporting(entry):
    # The scanner excludes regular root markers before flattening symlinks to content.
    # Filtering names here would hide marker-named links, directories or nested files.
    files = entry.get('files', {})
    if entry.get('skill_sha256'): return files
    return {k: v for k, v in files.items()
            if any(k.startswith(n + '/') for n in entry.get('internal_skills', {}))}


def compare(left, right, requirements, dirs=DEFAULT_CLAUDE_CONFIG_DIRS):
    validate(left); validate(right); validate(requirements, required=True)
    errors, invalid = [], []
    parity, valid = True, True
    versions = {role: document.get('installed_version', '<checkout>')
                for role, document in [('local', left), ('remote', right)]}
    notes = []
    if ('installed_version' in left and 'installed_version' in right and
            left['installed_version'] != right['installed_version']):
        errors.append('installed version mismatch: local=' + left.get('installed_version', '<unrecorded>') +
                      ' remote=' + right.get('installed_version', '<unrecorded>') + ' (release.json)')
        parity = False
    elif ('installed_version' in left) != ('installed_version' in right):
        owner_role, owner, release = ('remote', right, left) if 'installed_version' in left else ('local', left, right)
        for head in owner.get('checkout_commits', []):
            if release.get('installed_commit') and release['installed_commit'] != head:
                notes.append(owner_role + ' checkout HEAD ' + head +
                             ' differs from release.json commit ' + release['installed_commit'] +
                             '; informational, content parity decides')
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
        catalogs = [{n: e for n, e in host['entries'].items()
                     if not app_managed(root, n) and not (n == '.DS_Store' and e['kind'] == 'file' and e['exists'])}
                    for host in hosts]
        for number in (0, 1):
            for missing in sorted(set(catalogs[1-number]) - set(catalogs[number])):
                errors.append(root + '/' + missing + ': host ' + str(number) + ' name missing'); parity = False
        for number, catalog in enumerate(catalogs):
            readable = set()
            for name, entry in catalog.items():
                if entry.get('skill_sha256'): readable.add(name)
                readable.update(name + '/' + n for n in entry.get('internal_skills', {}))
                if entry.get('exists') is not True:
                    invalid.append(root + '/' + name + ': host ' + str(number) + ' broken')
                    if name not in required.get('allow_broken', []):
                        errors.append(root + '/' + name + ': host ' + str(number) + ' broken entry'); valid = False
                elif not entry.get('skill_sha256') and not entry.get('internal_skills'):
                    invalid.append(root + '/' + name + ': host ' + str(number) + ' empty/non-skill')
                    if name not in required.get('allow_empty', []):
                        errors.append(root + '/' + name + ': host ' + str(number) + ' unreadable entry'); valid = False
            for missing in sorted({n for n in required['readable'] if not app_managed(root, n)} - readable):
                errors.append(root + '/' + missing + ': host ' + str(number) + ' required readable skill missing'); valid = False
        for name in sorted(set(catalogs[0]) & set(catalogs[1])):
            a, b = (catalog[name] for catalog in catalogs)
            if (a['skill_sha256'] != b['skill_sha256'] or
                    a.get('internal_skills', {}) != b.get('internal_skills', {}) or supporting(a) != supporting(b)):
                errors.append(root + '/' + name + ': local/remote content/shape mismatch'); parity = False
    plugin_errors = compare_plugins(left, right, dirs)
    errors += plugin_errors
    return dict(installed_version=versions, notes=notes, host_identity_valid=identities_valid, name_content_parity=parity, required_readable_valid=valid,
                plugin_enabled_parity=not plugin_errors, disclosed_invalid=invalid, errors=errors)


def load_config(path):
    config = Path(path)
    try:
        metadata = config.lstat()
    except OSError:
        raise ValueError('RATCHET_SKILL_CONFIG missing; create owner-only installed-skills.json')
    if not config.is_file() or config.is_symlink() or metadata.st_uid != os.getuid() or metadata.st_mode & 0o077:
        raise ValueError('RATCHET_SKILL_CONFIG must be an owner-only regular file')
    try:
        values = json.loads(config.read_text())
    except (OSError, ValueError):
        raise ValueError('RATCHET_SKILL_CONFIG unreadable or malformed JSON')
    keys = ('schema', 'host', 'identity', 'requirements')
    object_keys(values, keys + (('claude_config_dirs',) if isinstance(values, dict) and 'claude_config_dirs' in values else ()),
                'RATCHET_SKILL_CONFIG')
    if type(values['schema']) is not int or values['schema'] != 1:
        raise ValueError('RATCHET_SKILL_CONFIG schema must be 1')
    if not isinstance(values['host'], str) or not re.fullmatch('[A-Za-z0-9][A-Za-z0-9._@:-]*', values['host']):
        raise ValueError('RATCHET_SKILL_CONFIG host unavailable or malformed')
    for field in ('identity', 'requirements'):
        value = values[field]
        if not isinstance(value, str) or not Path(value).is_absolute() or not Path(value).is_file():
            raise ValueError('RATCHET_SKILL_CONFIG ' + field + ' must name an existing absolute file')
    try:
        values['claude_config_dirs'] = config_dirs(values.get('claude_config_dirs', ['~/' + d for d in DEFAULT_CLAUDE_CONFIG_DIRS]))
    except ValueError as error:
        raise ValueError('RATCHET_SKILL_CONFIG ' + str(error))
    return values


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--inventory', action='store_true')
    parser.add_argument('--config', default=os.environ.get('RATCHET_SKILL_CONFIG', str(Path.home() / '.golems/ratchet/installed-skills.json')))
    parser.add_argument('--check-config', action='store_true')
    parser.add_argument('--requirements')
    parser.add_argument('--left'); parser.add_argument('--right')
    args = parser.parse_args()
    try:
        if args.inventory:
            dirs = globals().get('INVENTORY_CLAUDE_CONFIG_DIRS', DEFAULT_CLAUDE_CONFIG_DIRS)
            print(json.dumps(inventory(dirs), sort_keys=True)); return 0
        dirs = DEFAULT_CLAUDE_CONFIG_DIRS
        if not (args.left or args.right):
            config = load_config(args.config)
            args.host, args.identity, args.requirements, dirs = (
                config[k] for k in ('host', 'identity', 'requirements', 'claude_config_dirs'))
        if not args.requirements: raise ValueError('required readable manifest unavailable')
        try:
            required = json.loads(Path(args.requirements).read_text())
        except (OSError, ValueError):
            raise ValueError('RATCHET_SKILL_CONFIG requirements unreadable or malformed')
        validate(required, required=True)
        if args.check_config:
            if args.left or args.right: raise ValueError('configuration preflight cannot use fixtures')
            print('installed skill parity configuration READY'); return 0
        if args.left or args.right:
            if not (args.left and args.right): raise ValueError('both fixture manifests required')
            left, right = (json.loads(Path(p).read_text()) for p in [args.left, args.right])
            measurement = 'fixture'
        else:
            if not args.host or args.host.startswith('-'): raise ValueError('SSH host unavailable')
            command = ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10']
            if args.identity: command += ['-o', 'IdentitiesOnly=yes', '-o', 'IdentityAgent=none', '-i', args.identity]
            command += [args.host, 'python3 - --inventory']
            remote = subprocess.run(command, input=remote_inventory_script(dirs), text=True,
                                    capture_output=True, timeout=60, check=True)
            left, right, measurement = inventory(dirs), json.loads(remote.stdout), 'live'
        result = compare(left, right, required, dirs)
        for message in result['errors'] + result['disclosed_invalid']: print(message, file=sys.stderr)
        print(json.dumps({k: v for k, v in dict(measurement=measurement, **result, error_count=len(result['errors']), disclosed_invalid_count=len(result['disclosed_invalid'])).items() if k not in ('errors', 'disclosed_invalid')}, sort_keys=True))
        return 1 if result['errors'] else 0
    except (OSError, ValueError, KeyError, TypeError, AttributeError, subprocess.SubprocessError) as error:
        print('installed skill parity: FAIL (' + (str(error) if isinstance(error, ValueError) else type(error).__name__) + ')', file=sys.stderr)
        return 1


if __name__ == '__main__': sys.exit(main())
