#!/usr/bin/env python3
"""Pinned pyflakes UndefinedName count (F821), or wc-compatible file line count."""
import argparse
from pathlib import Path
import subprocess
import sys


def undefined_names():
    from pyflakes.api import checkPath
    from pyflakes.messages import UndefinedName

    class Reporter:
        count = 0
        errors = 0

        def flake(self, message):
            if isinstance(message, UndefinedName):
                self.count += 1

        def unexpectedError(self, filename, message):
            self.errors += 1
            print(f"{filename}: {message}", file=sys.stderr)

        def syntaxError(self, filename, message, *args):
            self.unexpectedError(filename, message)

    reporter = Reporter()
    paths = subprocess.check_output(['git', 'ls-files', '-z', '--', '*.py']).decode().split('\0')
    excluded = {'vendor', 'vendored', 'third_party', 'node_modules', '.worktrees', 'docs.local'}
    for name in filter(None, paths):
        if not excluded.intersection(Path(name).parts):
            checkPath(name, reporter=reporter)
    if reporter.errors:
        raise RuntimeError('Python files could not be checked')
    return reporter.count


def main():
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--undefined-names', action='store_true')
    mode.add_argument('--lines')
    args = parser.parse_args()
    print(undefined_names() if args.undefined_names else Path(args.lines).read_bytes().count(b'\n'))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'ratchet measure-code: {error}', file=sys.stderr)
        sys.exit(1)
