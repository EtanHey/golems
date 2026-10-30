"""Bind-time filesystem and Git identity, shared by lease and retirement."""
import os
from pathlib import Path
import stat
import subprocess


LEGACY = "legacy: no generation recorded at bind"


class Mismatch(ValueError):
    """The resource no longer matches its recorded allocation generation."""


def directory_identity(path):
    info = Path(path).lstat()
    if not stat.S_ISDIR(info.st_mode):
        raise ValueError("generation requires a directory: " + str(path))
    # st_dev may change after a remount; that mismatch fails safe as RETAINED.
    return [info.st_dev, info.st_ino]


def capture(path):
    def git(*args):
        env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
        result = subprocess.run(["git", "-C", str(path), *args], env=env,
                                capture_output=True, text=True)
        if result.returncode:
            raise ValueError("generation Git identity unavailable: " + result.stderr.strip())
        return result.stdout.rstrip("\n")

    root_identity = directory_identity(path)
    git_dir = Path(git("rev-parse", "--absolute-git-dir")).resolve()
    value = dict(root_identity=root_identity, git_dir=str(git_dir),
                 git_dir_identity=directory_identity(git_dir),
                 branch=git("rev-parse", "--symbolic-full-name", "HEAD"))
    if directory_identity(path) != root_identity:
        raise ValueError("resource changed while capturing generation")
    return value


def verify(path, expected):
    try:
        observed = capture(path)
    except (OSError, ValueError) as error:
        raise Mismatch("resource replaced since bind: " + str(error)) from error
    if observed != expected:
        raise Mismatch("resource replaced since bind: filesystem, gitdir or branch differs")
    return observed
