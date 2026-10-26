#!/usr/bin/env python3
"""Non-signalling registry census; uncertain liveness protects each row's paths."""
import datetime
import json
import math
import os
import subprocess
import sys


def unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate field")
        result[key] = value
    return result


def process_starts():
    """One all-user snapshot includes foreign PIDs without permission to signal."""
    try:
        output = subprocess.check_output(["ps", "-axo", "pid=,lstart="], text=True,
                                         env=dict(os.environ, LC_ALL="C"))
        starts = {}
        for line in output.splitlines():
            if not line.strip():
                continue
            fields = line.split(None, 1)
            pid = int(fields[0])
            if not 0 < pid <= 2147483647:
                raise ValueError("invalid ps pid")
            try:
                starts[pid] = datetime.datetime.strptime(fields[1], "%a %b %d %H:%M:%S %Y").timestamp()
            except (ValueError, IndexError, OverflowError, OSError):
                starts[pid] = None  # Present PID, unknown start: retain this row.
        if not starts:
            raise ValueError("empty ps snapshot")
        return starts
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        print(f"registry process snapshot unavailable; retaining registered paths: {exc}", file=sys.stderr)
        return None  # Unknown census protects registered paths, not unrelated trees.


def census(path):
    valid = skipped = 0
    with open(path, encoding="utf-8") as source:
        starts = process_starts()
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
            except (ValueError, TypeError) as exc:
                skipped += 1
                print(f"registry line {number}: {exc}; skipping malformed row", file=sys.stderr)
                continue
            valid += 1
            if starts is not None:
                if pid not in starts:
                    continue
                started = starts[pid]
                # cmux ts is Unix milliseconds. Missing/invalid ts cannot prove reuse.
                ts = row.get("ts")
                if (started is not None and type(ts) in (int, float) and ts > 0
                        and (type(ts) is int or math.isfinite(ts)) and started * 1000 > ts):
                    continue
            for cwd in paths:
                print(cwd)
    if skipped:
        print(f"skipped {skipped} malformed registry rows", file=sys.stderr)
        if not valid:
            raise ValueError("registry contains no valid rows")


if __name__ == "__main__":
    try:
        census(sys.argv[1])
    except (OSError, ValueError) as exc:
        print(f"registry census failed: {exc}", file=sys.stderr)
        sys.exit(1)
