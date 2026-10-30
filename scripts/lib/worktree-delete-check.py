#!/usr/bin/env python3
"""Read-only preflight: refuse trees Git could partially delete."""
import os
import stat
import sys


def scan(root):
    protected = []
    immutable = (stat.UF_IMMUTABLE | stat.SF_IMMUTABLE) if sys.platform == 'darwin' else 0

    def check(path):
        info = os.lstat(path)
        if ((stat.S_ISDIR(info.st_mode) and not info.st_mode & stat.S_IWUSR)
                or getattr(info, 'st_flags', 0) & immutable):
            protected.append(path)

    def failed(error):
        raise error

    check(root)
    for directory, directories, files in os.walk(root, followlinks=False, onerror=failed):
        for name in sorted(directories + files):
            check(os.path.join(directory, name))
        directories.sort()
    if protected:
        print(f'read-only or immutable content: {protected[0]} (+{len(protected) - 1} more)')
        return 1
    return 0


if __name__ == '__main__':
    try:
        sys.exit(scan(sys.argv[1]))
    except OSError as error:
        print(f'cannot scan deletion permissions: {error}')
        sys.exit(1)
