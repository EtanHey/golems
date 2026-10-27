"""Local-only skill snapshot; imports the installed-skills ratchet's hash policy."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys

spec = importlib.util.spec_from_file_location('installed_skills', Path(__file__).with_name('installed-skills.py'))
skills = importlib.util.module_from_spec(spec)
spec.loader.exec_module(skills)


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
    records, identities = [], []
    for root in roots:
        records.append(dict(path=str(root), tree_sha256=skills.tree_sha256(root)))
        if mode == 'checkout':
            targets = [p.resolve(strict=True) for p in root.iterdir() if p.name not in skills.IGNORED
                       and p.name not in skills.INSTALLER_MARKERS and p.name != '.DS_Store']
            commits = {commit(p if p.is_dir() else p.parent) for p in targets}
            identities.append(dict(path=str(root), commits=sorted(c for c in commits if c),
                                   unresolved=not targets or None in commits))
    return dict(roots=records, root_commits=identities, commit=commit(source) if mode == 'checkout' else
                json.loads((Path(prefix) / 'release.json').read_text())['commit'])


if __name__ == '__main__':
    print(json.dumps(snapshot(*sys.argv[1:]), sort_keys=True))
