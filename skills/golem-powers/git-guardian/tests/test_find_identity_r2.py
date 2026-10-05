"""Opus R1 B2/B3: decision-only regressions, including real APFS identity."""
import os
from pathlib import Path
import pwd
import sys

import pytest
from test_repo_parent_rm import guardian, workspace


@pytest.mark.parametrize('command', [
    "find . -path './.git*' -delete", "find . -ipath './.GIT*' -delete",
    "find . -path './skills*' -delete", "find .git -name '*o*' -delete",
    "find .git -path '*objects*' -delete", "find .git -mindepth 1 -mtime +1 -delete",
    "find .git/objects -mindepth 1 -mtime +1 -delete",
    "find ../other -path '*.git*' -delete", "find ../other/.git -name '*o*' -delete",
])
def test_filtered_find_cannot_waive_metadata_or_top_level_deletion(workspace, command):
    home, repo, _, _ = workspace
    (repo / '.git' / 'objects').mkdir()
    (repo / 'skills').mkdir()
    (home / 'Gits' / 'other' / '.git').mkdir(parents=True)
    assert guardian.dangerous_shell_reason(command, cwd=str(repo))


@pytest.mark.parametrize('tool', ['rm', 'find', 'rsync'])
def test_firmlink_parent_by_relative_identity(workspace, tmp_path, monkeypatch, tool):
    home, repo, _, _ = workspace
    volume = tmp_path / 'storage' / 'volume' / 'data'
    volume.mkdir(parents=True)
    original = os.path.samefile
    def identity(left, right):
        left, right = str(left), str(right)
        prefix = str(volume) + os.sep
        if left.startswith(prefix):
            left = str(tmp_path / left[len(prefix):])
        if right.startswith(prefix):
            right = str(tmp_path / right[len(prefix):])
        return original(left, right)
    monkeypatch.setattr(guardian._paths.os.path, 'samefile', identity)
    commands = {'rm': f'rm -rf "{volume}"', 'find': f'find "{volume}" -delete',
                'rsync': f'rsync -a --delete ./source/ "{volume}/"'}
    assert guardian.dangerous_shell_reason(commands[tool], cwd=str(repo))


def test_symlink_child_does_not_make_ordinary_cleanup_an_ancestor(workspace):
    home, repo, deep, _ = workspace
    (deep / 'owner').symlink_to(home, target_is_directory=True)
    assert guardian.dangerous_shell_reason(f'rm -rf "{deep}"', cwd=str(repo)) is None


@pytest.mark.parametrize('tool', ['rm', 'find', 'rsync'])
@pytest.mark.parametrize('alias', ['data', 'case', 'volume', 'symlink'])
def test_real_apfs_data_volume_parent_is_protected(workspace, tmp_path, monkeypatch, tool, alias):
    if sys.platform != 'darwin':
        pytest.skip('real macOS firmlink identity')
    data = Path('/System/Volumes/Data')
    if not os.path.samefile('/Users', data / 'Users'):
        pytest.skip('host has no Users data-volume firmlink')
    home, repo, _, _ = workspace
    monkeypatch.setenv('HOME', pwd.getpwuid(os.getuid()).pw_dir)
    targets = {'data': data, 'case': Path('/system/volumes/data'),
               'volume': Path('/Volumes/Macintosh HD/System/Volumes/Data')}
    link = tmp_path / 'data-volume-link'
    link.symlink_to(data, target_is_directory=True)
    targets['symlink'] = link
    target = targets[alias]
    if not target.exists():
        pytest.skip('optional host alias unavailable')
    assert os.path.samefile(target, data)
    commands = {'rm': f'rm -rf "{target}/"', 'find': f'find -L "{target}" -delete',
                'rsync': f'rsync -a --delete ./source/ "{target}/"'}
    assert guardian.dangerous_shell_reason(commands[tool], cwd=str(repo))
