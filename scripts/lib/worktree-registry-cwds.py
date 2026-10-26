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
        output = subprocess.check_output(["/bin/ps", "-axo", "pid=,lstart="], text=True, timeout=30,
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
                starts[pid] = datetime.datetime.strptime(fields[1].strip(), "%a %b %d %H:%M:%S %Y").timestamp()
            except (ValueError, IndexError, OverflowError, OSError):
                starts[pid] = None  # Present PID, unknown start: retain this row.
        if not starts:
            raise ValueError("empty ps snapshot")
        return starts
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        raise ValueError(f"registry process snapshot unavailable: {exc}") from exc


def census(path):
    valid = skipped = 0
    with open(path, encoding="utf-8") as source:
        lines = list(source)
        starts = process_starts()
        for number, line in enumerate(lines, 1):
            if not line.strip():
                continue
            try:
                row = json.loads(line, object_pairs_hook=unique)
                if not isinstance(row, dict):
                    raise ValueError("expected object")
                fields = [row[key] for key in ("cwd", "worktree_path", "launch_cwd") if key in row]
                paths = [p for p in fields if isinstance(p, str) and p.startswith("/")
                         and not any(ord(c) < 32 or ord(c) == 127 for c in p)]
                pid = row.get("pid")
                if type(pid) is not int or not 0 < pid <= 2147483647:
                    if paths:
                        valid += 1  # Uncertain PID: protect every recoverable path.
                        for cwd in paths:
                            print(cwd)
                    raise ValueError("invalid pid")
                if not paths or len(paths) != len(fields):
                    raise ValueError("invalid cwd fields")
            except (ValueError, TypeError) as exc:
                skipped += 1
                print(f"registry line {number}: {exc}; malformed row", file=sys.stderr)
                continue
            valid += 1
            if pid not in starts:
                continue
            started = starts[pid]
            # cmux ts is Unix milliseconds. Allow 120 seconds of wall-clock skew.
            ts = row.get("ts")
            if (started is not None and type(ts) in (int, float) and ts > 0
                    and (type(ts) is int or math.isfinite(ts)) and started * 1000 >= ts + 120_000):
                continue
            for cwd in paths:
                print(cwd)
    if skipped:
        print(f"encountered {skipped} malformed registry rows", file=sys.stderr)
        if not valid:
            raise ValueError("registry contains no valid rows")


if __name__ == "__main__":
    try:
        census(sys.argv[1])
    except (OSError, ValueError) as exc:
        print(f"registry census failed: {exc}", file=sys.stderr)
        sys.exit(1)
