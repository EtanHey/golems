#!/usr/bin/env python3
"""A malformed registry is missing evidence, never an empty census."""
import errno
import json
import os
import sys


def unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate field")
        result[key] = value
    return result


def census(path):
    with open(path, encoding="utf-8") as source:
        for number, line in enumerate(source, 1):
            if not line.strip():
                continue
            try:
                row = json.loads(line, object_pairs_hook=unique)
                if not isinstance(row, dict):
                    raise ValueError("expected object")
                pid = row.get("pid")
                if type(pid) is not int or not 0 < pid <= 2147483647:
                    raise ValueError("invalid pid")
                paths = [row[key] for key in ("cwd", "worktree_path", "launch_cwd") if key in row]
                if not paths or any(not isinstance(p, str) or not p.startswith("/")
                                    or any(ord(c) < 32 or ord(c) == 127 for c in p) for p in paths):
                    raise ValueError("invalid cwd fields")
                try:
                    os.kill(pid, 0)
                except OSError as exc:
                    if exc.errno == errno.ESRCH:
                        continue
                    raise ValueError("cannot establish pid liveness") from exc
                for cwd in paths:
                    print(cwd)
            except (ValueError, TypeError) as exc:
                raise ValueError(f"registry line {number}: {exc}") from exc


if __name__ == "__main__":
    try:
        census(sys.argv[1])
    except (OSError, ValueError) as exc:
        print(f"registry census failed: {exc}", file=sys.stderr)
        sys.exit(1)
