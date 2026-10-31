"""Local-only skill snapshot; imports the installed-skills ratchet's hash policy."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys

spec = importlib.util.spec_from_file_location('installed_skills', Path(__file__).with_name('installed-skills.py'))
skills = importlib.util.module_from_spec(spec)
spec.loader.exec_module(skills)
spec = importlib.util.spec_from_file_location('sync_m1', Path(__file__).with_name('sync-m1.py'))
sync = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync)


def commit(directory):
    try:
        value = subprocess.check_output(['git', '-C', str(directory), 'rev-parse', 'HEAD'],
                                        text=True, stderr=subprocess.DEVNULL, timeout=10).strip()
        skills.commit(value)
        return value
    except (OSError, ValueError, subprocess.SubprocessError):
        return None


def snapshot(mode, source, home, prefix):
    roots = [Path(home) / r for r in skills.ROOTS]
    gemini = Path(home) / '.gemini/config/skills'
    if gemini.exists(): roots.append(gemini)
    if mode == 'release-channel': roots.append(Path(prefix) / 'bin')
    records, identities, excluded = [], [], []
    for root in roots:
        records.append(dict(path=str(root), tree_sha256=skills.tree_sha256(root)))
        if root == Path(prefix) / 'bin': continue
        targets = []
        for entry in sorted(root.iterdir()):
            owner = sync.managed_link(entry, Path(home))
            vendor = mode == 'checkout' and owner == 'release'
            if entry.name not in skills.RECEIPT_IGNORED and owner and not vendor:
                targets.append(entry.resolve(strict=True))
            else:
                excluded.append(dict(path=str(entry), kind='vendor' if vendor else 'symlink' if entry.is_symlink() else
                                     'directory' if entry.is_dir() else 'file', count=1))
                if vendor: excluded[-1]['resolved_target'] = str(entry.resolve(strict=True))
        if mode == 'checkout':
            commits = {commit(p if p.is_dir() else p.parent) for p in targets}
            identities.append(dict(path=str(root), commits=sorted(c for c in commits if c),
                                   unresolved=None in commits))
    owned = {c for row in identities for c in row['commits']}
    checkout_commit = next(iter(owned)) if len(owned) == 1 else commit(source)
    return dict(roots=records, root_commits=identities, excluded=excluded, commit=checkout_commit if mode == 'checkout' else
                json.loads((Path(prefix) / 'release.json').read_text())['commit'])


if __name__ == '__main__':
    try:
        print(json.dumps(snapshot(*sys.argv[1:]), sort_keys=True))
    except (OSError, ValueError) as error:
        print('skills receipt snapshot: ' + str(error), file=sys.stderr)
        sys.exit(1)
