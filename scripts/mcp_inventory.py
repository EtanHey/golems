#!/usr/bin/env python3
"""
MCP process inventory — US-001.

Lists running MCP processes with pid/ppid/cmdline/rss-MB/elapsed.
Classifies orphan (ppid=1) vs attached (ppid != 1).
Emits human-readable table + JSON.

SAFETY: this script is READ-ONLY. Never kills anything.

Usage:
    python3 mcp_inventory.py [--json] [--out PATH]

Per DoD US-001: must produce verbatim ps output; no fabricated process names.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass, asdict
from typing import Optional


MCP_NEEDLES = (
    "mcp-server",
    "mcp_server",
    "mcp-mcp",
    "/mcp/",
    "-mcp",
    "mcplayer",
    "brainlayer-mcp",
    "voicelayer-mcp",
    "whatsapp-mcp",
    "exa-mcp",
    "supabase-mcp",
    "cmux-mcp",
    "github-summarizer",
    "context7",
    "stitch-mcp",
    "linear-mcp",
    "notion-mcp",
    "sophtron",
    "figma-mcp",
    "browser-tools",
    "israeli-bank-mcp",
)


@dataclass
class Proc:
    pid: int
    ppid: int
    etime: str
    etime_sec: int
    rss_kb: int
    rss_mb: float
    command: str
    classification: str  # "orphan" | "attached" | "self-or-orchestrator"


def parse_etime(etime: str) -> int:
    """Parse ps etime format ([[dd-]hh:]mm:ss) to seconds."""
    s = etime.strip()
    days = 0
    if "-" in s:
        day_part, s = s.split("-", 1)
        days = int(day_part)
    parts = s.split(":")
    parts = [int(p) for p in parts]
    if len(parts) == 3:
        h, m, sec = parts
    elif len(parts) == 2:
        h, m, sec = 0, parts[0], parts[1]
    else:
        h, m, sec = 0, 0, parts[0]
    return days * 86400 + h * 3600 + m * 60 + sec


def is_mcp_cmd(cmd: str) -> bool:
    lc = cmd.lower()
    if "grep" in lc and "mcp" in lc:
        return False
    if "mcp_inventory" in lc or "mcp_reaper" in lc:
        return False  # don't list our own scripts
    return any(n in lc for n in MCP_NEEDLES)


def run_ps() -> str:
    """Return raw output of ps -axo pid,ppid,etime,rss,command (no truncation)."""
    out = subprocess.check_output(
        ["ps", "-axo", "pid,ppid,etime,rss,command"], text=True
    )
    return out


def parse_ps(raw: str) -> list[Proc]:
    procs: list[Proc] = []
    lines = raw.splitlines()
    header = lines[0] if lines else ""
    # ps fields: PID PPID ELAPSED RSS COMMAND
    # We parse by splitting first 4 columns, rest is the command (may contain spaces).
    for line in lines[1:]:
        m = re.match(r"\s*(\d+)\s+(\d+)\s+(\S+)\s+(\d+)\s+(.*)$", line)
        if not m:
            continue
        pid_s, ppid_s, etime, rss_s, command = m.groups()
        if not is_mcp_cmd(command):
            continue
        pid = int(pid_s)
        ppid = int(ppid_s)
        rss_kb = int(rss_s)
        try:
            etime_sec = parse_etime(etime)
        except Exception:
            etime_sec = 0
        # classification:
        # - ppid == 1 → orphan
        # - ppid == os.getpid() or ppid is shell ancestor → ours, exclude
        # - else → attached
        if pid == os.getpid() or ppid == os.getpid():
            classification = "self-or-orchestrator"
        elif ppid == 1:
            classification = "orphan"
        else:
            classification = "attached"
        procs.append(
            Proc(
                pid=pid,
                ppid=ppid,
                etime=etime,
                etime_sec=etime_sec,
                rss_kb=rss_kb,
                rss_mb=round(rss_kb / 1024.0, 1),
                command=command,
                classification=classification,
            )
        )
    return procs


def summarize(procs: list[Proc]) -> dict:
    total = len(procs)
    rss_mb = sum(p.rss_mb for p in procs)
    orphans = [p for p in procs if p.classification == "orphan"]
    attached = [p for p in procs if p.classification == "attached"]
    by_name: dict[str, int] = {}
    for p in procs:
        # bucket by the first matching needle
        bucket = "other"
        lc = p.command.lower()
        for n in MCP_NEEDLES:
            if n in lc:
                bucket = n
                break
        by_name[bucket] = by_name.get(bucket, 0) + 1
    oldest_orphan = max(orphans, key=lambda p: p.etime_sec, default=None)
    return {
        "total": total,
        "rss_mb_total": round(rss_mb, 1),
        "rss_gb_total": round(rss_mb / 1024.0, 2),
        "orphan_count": len(orphans),
        "attached_count": len(attached),
        "by_server": dict(sorted(by_name.items(), key=lambda x: -x[1])),
        "oldest_orphan_pid": oldest_orphan.pid if oldest_orphan else None,
        "oldest_orphan_etime": oldest_orphan.etime if oldest_orphan else None,
    }


def render_table(procs: list[Proc]) -> str:
    lines = []
    lines.append(
        f"{'PID':>7} {'PPID':>6} {'ELAPSED':>11} {'RSS_MB':>8} {'CLASS':<10} COMMAND"
    )
    lines.append("-" * 100)
    for p in sorted(procs, key=lambda x: (x.classification != "orphan", -x.etime_sec)):
        cmd = p.command if len(p.command) <= 120 else p.command[:117] + "..."
        lines.append(
            f"{p.pid:>7} {p.ppid:>6} {p.etime:>11} {p.rss_mb:>8.1f} {p.classification:<10} {cmd}"
        )
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true", help="emit JSON instead of table")
    ap.add_argument("--out", help="write to file (table + summary + JSON if --json)")
    args = ap.parse_args()

    raw = run_ps()
    procs = parse_ps(raw)
    summary = summarize(procs)

    if args.json:
        out = json.dumps({"summary": summary, "procs": [asdict(p) for p in procs]}, indent=2)
    else:
        table = render_table(procs)
        out = f"# MCP Process Inventory\n\n## Summary\n{json.dumps(summary, indent=2)}\n\n## Processes\n```\n{table}\n```\n"

    if args.out:
        with open(args.out, "w") as f:
            f.write(out)
        print(f"wrote {args.out} ({len(procs)} procs)", file=sys.stderr)
    else:
        print(out)

    return 0


if __name__ == "__main__":
    sys.exit(main())
