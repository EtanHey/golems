#!/usr/bin/env python3
"""
MCP process reaper — US-003.

SAFETY-CRITICAL:
  - DRY-RUN is the default. Live kills require explicit --confirm.
  - Predicate `is_working_agent` (US-002) gates EVERY kill candidate.
  - Elapsed > 30 minutes is REQUIRED in addition to predicate returning False.
  - SIGTERM with 5-second grace period, then SIGKILL only if still alive.
  - Every action logged to ~/.golems/mcp-reaper.log with timestamp + reason.
  - FAIL-SAFE ABORT: if candidate count exceeds MAX_CANDIDATES_BEFORE_ABORT,
    the whole run aborts WITHOUT killing anything. This protects against a
    bad predicate update that suddenly flags many processes as eligible.

PREDICATE SEMANTICS (honest):
  `is_working_agent` is a WHITELIST predicate, NOT a "conservative-bias-to-spare"
  predicate. It returns True (spare) ONLY for:
    1. self / launchd
    2. ps lookup race (pid disappeared) — a genuine ambiguity case
    3. SAFELIST substring match in cmdline
    4. Any ancestor's cmdline matches an AI_CLI_PATTERN
  Anything else returns False (eligible-to-kill). The safety story is:
    - SAFELIST + AI_CLI_PATTERNS must enumerate every "this is alive" signal.
    - The recency gate (>30 min) is a separate independent layer.
    - The fail-safe abort caps damage from a bad rule update.
    - Dry-run default + JSONL audit trail catches regressions before kills.
See the private coordination archive's phase-2 predicate findings for the full rule list.

Usage:
    python3 mcp_reaper.py                # DRY-RUN: list what WOULD be killed; takes no action
    python3 mcp_reaper.py --dry-run      # explicit DRY-RUN: same inert behavior
    python3 mcp_reaper.py --confirm      # LIVE: actually send SIGTERM/SIGKILL
    python3 mcp_reaper.py --min-elapsed-sec 1800 --confirm   # tune the recency gate
    python3 mcp_reaper.py --max-candidates 5     # fail-safe abort threshold (default 5)

This script is INERT in dry-run mode — calling it cannot harm anything.
"""
from __future__ import annotations

import argparse
import datetime
import json
import os
import pathlib
import re
import signal
import subprocess
import sys
import time
from dataclasses import dataclass, asdict
from typing import Optional


LOG_PATH = pathlib.Path.home() / ".golems" / "mcp-reaper.log"
MIN_ELAPSED_SEC_DEFAULT = 30 * 60  # 30 minutes — US-003 mandate
SIGTERM_GRACE_SEC = 5  # US-003 mandate
# FAIL-SAFE: if more than this many candidates appear in a single run, abort.
# A spike likely indicates a predicate regression (SAFELIST entry deleted,
# AI_CLI_PATTERN typo, etc.). Better to abort and alert than mass-kill.
MAX_CANDIDATES_BEFORE_ABORT_DEFAULT = 5

# Reuse the MCP keyword set from the inventory script. Kept inline so the
# reaper is self-contained (no import path dependency).
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

# SAFELIST per US-002 Rule 2 — never reap these even if classification suggests orphan.
# Substrings, case-insensitive, matched against full cmdline.
SAFELIST = (
    "whatsapp-bridge",
    "whatsapp-bridge-business",
    "brainlayer watch",
    # broadened from "mcplayer/src/index.ts" after dry-run found PID 2609 (notify-server.ts)
    # also part of mcplayer subsystem — caught by prefix.
    "mcplayer/src/",
    "voicebar",
    "brain-bar",
    "brainbar",
    # FN-1 mitigation — whatsapp-mcp-server is daemon-style; spare until 30-day dry-run reveals otherwise
    "whatsapp-mcp-server",
)

# AI-CLI ancestor patterns per US-002 Rule 4 — if any ancestor cmdline matches,
# the descendant is "attached" to a live agent and MUST be spared.
AI_CLI_PATTERNS = (
    "Claude.app/Contents",
    ".local/share/claude/versions/",
    "claude daemon",
    "claude --",
    "@anthropic-ai/claude-code",
    "codex --",
    "openai/codex",
    "cursor --",
    "Cursor.app/Contents",
    "kiro --",
    "gemini --",
    "Gemini.app",
    "Code.app/Contents",
    "iTerm.app/Contents",
    "Terminal.app/Contents",
    "cmux",
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


def parse_etime(etime: str) -> int:
    s = etime.strip()
    days = 0
    if "-" in s:
        day_part, s = s.split("-", 1)
        days = int(day_part)
    parts = [int(p) for p in s.split(":")]
    if len(parts) == 3:
        h, m, sec = parts
    elif len(parts) == 2:
        h, m, sec = 0, parts[0], parts[1]
    else:
        h, m, sec = 0, 0, parts[0]
    return days * 86400 + h * 3600 + m * 60 + sec


def ps_all() -> list[Proc]:
    out = subprocess.check_output(
        ["ps", "-axo", "pid,ppid,etime,rss,command"], text=True
    )
    procs: list[Proc] = []
    for line in out.splitlines()[1:]:
        m = re.match(r"\s*(\d+)\s+(\d+)\s+(\S+)\s+(\d+)\s+(.*)$", line)
        if not m:
            continue
        pid_s, ppid_s, etime, rss_s, command = m.groups()
        try:
            etime_sec = parse_etime(etime)
        except Exception:
            etime_sec = 0
        procs.append(
            Proc(
                pid=int(pid_s),
                ppid=int(ppid_s),
                etime=etime,
                etime_sec=etime_sec,
                rss_kb=int(rss_s),
                rss_mb=round(int(rss_s) / 1024.0, 1),
                command=command,
            )
        )
    return procs


def is_mcp_cmd(cmd: str) -> bool:
    lc = cmd.lower()
    if "grep" in lc and "mcp" in lc:
        return False
    if "mcp_inventory" in lc or "mcp_reaper" in lc:
        return False
    return any(n in lc for n in MCP_NEEDLES)


def ancestor_chain(pid: int, by_pid: dict[int, Proc]) -> list[Proc]:
    chain: list[Proc] = []
    cur = pid
    seen: set[int] = set()
    for _ in range(50):  # cycle guard
        if cur in seen:
            return chain
        seen.add(cur)
        p = by_pid.get(cur)
        if not p:
            return chain
        chain.append(p)
        if p.ppid in (0, 1):
            return chain
        cur = p.ppid
    return chain


def in_safelist(cmd: str) -> bool:
    lc = cmd.lower()
    return any(s.lower() in lc for s in SAFELIST)


def matches_ai_cli(cmd: str) -> bool:
    return any(p in cmd or p.lower() in cmd.lower() for p in AI_CLI_PATTERNS)


def is_working_agent(pid: int, by_pid: dict[int, Proc]) -> tuple[bool, str]:
    """US-002 whitelist predicate. Returns (is_working_agent, reason).

    True (SPARE) ONLY for explicit positive matches:
      1. self / parent / launchd      (Rule 1)
      2. ps-lookup race                (Rule 2 — genuine ambiguity case)
      3. SAFELIST cmdline substring   (Rule 3)
      4. Ancestor matches AI_CLI_PATTERN (Rule 4)
    Otherwise returns False (eligible-to-kill). This is honest whitelist
    semantics — NOT a conservative-default-True predicate. The safety story
    is the COMBINATION of: (a) whitelist coverage, (b) >30-min recency gate,
    (c) fail-safe abort threshold in main(), (d) dry-run default, (e) JSONL
    audit log.
    """
    # Rule 1: self / launchd
    if pid == os.getpid() or pid == os.getppid():
        return True, "self/parent — never kill ourselves"
    if pid == 1:
        return True, "launchd — never touch"

    # Rule 2: ps-lookup race (genuine ambiguity — bias to True)
    p = by_pid.get(pid)
    if not p:
        return True, "pid not in current ps snapshot (race) — ambiguity-spare"

    # Rule 3: SAFELIST cmdline match
    if in_safelist(p.command):
        return True, f"safelist match: {p.command[:80]}"

    # Rule 4: ancestor chain walk for AI-CLI patterns
    chain = ancestor_chain(pid, by_pid)
    for a in chain[1:]:  # skip self; check ancestors
        if matches_ai_cli(a.command):
            return True, f"ancestor pid={a.pid} matches AI-CLI: {a.command[:80]}"

    # No whitelist rule matched. By honest whitelist semantics, this is
    # eligible-to-kill (subject to recency gate + fail-safe abort in caller).
    return False, "no whitelist rule matched (eligible-to-kill candidate)"


def log_event(record: dict) -> None:
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    record["timestamp"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    with LOG_PATH.open("a") as f:
        f.write(json.dumps(record) + "\n")


def reap(pid: int, dry_run: bool) -> str:
    """Send SIGTERM, wait 5s, then SIGKILL if alive. Returns outcome string."""
    if dry_run:
        return "DRY_RUN"
    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        return "ALREADY_GONE"
    except PermissionError:
        return "PERMISSION_DENIED"
    # 5 second grace
    deadline = time.time() + SIGTERM_GRACE_SEC
    while time.time() < deadline:
        try:
            os.kill(pid, 0)  # liveness probe
        except ProcessLookupError:
            return "TERM_OK"
        time.sleep(0.5)
    # Still alive — escalate
    try:
        os.kill(pid, signal.SIGKILL)
        return "KILL_FORCED"
    except ProcessLookupError:
        return "TERM_OK_LATE"
    except PermissionError:
        return "PERMISSION_DENIED_ON_KILL"


def main() -> int:
    ap = argparse.ArgumentParser()
    mode_group = ap.add_mutually_exclusive_group()
    mode_group.add_argument(
        "--confirm",
        action="store_true",
        help="Actually kill. Default is DRY-RUN (no action).",
    )
    mode_group.add_argument(
        "--dry-run",
        action="store_true",
        help="Explicitly dry-run. Same as default: list candidates, take no action.",
    )
    ap.add_argument(
        "--min-elapsed-sec",
        type=int,
        default=MIN_ELAPSED_SEC_DEFAULT,
        help=f"Required elapsed seconds before kill (default {MIN_ELAPSED_SEC_DEFAULT}s = 30min)",
    )
    ap.add_argument(
        "--show-spared",
        action="store_true",
        help="Print the spared list for transparency",
    )
    ap.add_argument(
        "--max-candidates",
        type=int,
        default=MAX_CANDIDATES_BEFORE_ABORT_DEFAULT,
        help=(
            f"Fail-safe abort: if candidate count exceeds this, "
            f"the run aborts without killing anything (default {MAX_CANDIDATES_BEFORE_ABORT_DEFAULT}). "
            f"A spike likely indicates a predicate regression."
        ),
    )
    args = ap.parse_args()

    dry_run = not args.confirm

    all_procs = ps_all()
    by_pid = {p.pid: p for p in all_procs}
    mcps = [p for p in all_procs if is_mcp_cmd(p.command)]

    candidates: list[tuple[Proc, str]] = []
    spared: list[tuple[Proc, str]] = []

    for p in mcps:
        is_wa, reason = is_working_agent(p.pid, by_pid)
        if is_wa:
            spared.append((p, reason))
            continue
        if p.etime_sec < args.min_elapsed_sec:
            spared.append((p, f"elapsed {p.etime_sec}s < min {args.min_elapsed_sec}s"))
            continue
        candidates.append((p, reason))

    mode = "DRY-RUN" if dry_run else "LIVE"
    print(f"=== mcp_reaper {mode} ===")
    print(f"total MCP procs: {len(mcps)} | candidates: {len(candidates)} | spared: {len(spared)}")
    print()
    print("--- candidates ---")
    if not candidates:
        print("(none)")
    for p, reason in candidates:
        print(
            f"pid={p.pid:>6} ppid={p.ppid:>6} elapsed={p.etime:>11} rss={p.rss_mb:>6.1f}MB "
            f"reason={reason}"
        )
        print(f"        cmd: {p.command[:140]}")

    if args.show_spared:
        print()
        print("--- spared ---")
        for p, reason in spared:
            print(
                f"pid={p.pid:>6} ppid={p.ppid:>6} elapsed={p.etime:>11} reason={reason}"
            )

    # FAIL-SAFE ABORT: too many candidates likely means a predicate regression.
    # Abort the run, log the spike, take no action.
    if len(candidates) > args.max_candidates:
        abort_record = {
            "mode": mode,
            "event": "FAIL_SAFE_ABORT",
            "candidate_count": len(candidates),
            "threshold": args.max_candidates,
            "candidate_pids": [p.pid for p, _ in candidates],
            "reason": (
                f"candidate count {len(candidates)} > threshold {args.max_candidates}; "
                f"suspect predicate regression. No kills performed."
            ),
        }
        log_event(abort_record)
        print()
        print(
            f"!!! FAIL_SAFE_ABORT — {len(candidates)} candidates exceeds threshold {args.max_candidates}. "
            f"No action taken. Review ~/.golems/mcp-reaper.log + tune SAFELIST / AI_CLI_PATTERNS "
            f"before re-running. Override with --max-candidates N if intentional."
        )
        return 2

    # Action loop
    print()
    print("--- actions ---")
    for p, reason in candidates:
        outcome = reap(p.pid, dry_run=dry_run)
        record = {
            "mode": mode,
            "pid": p.pid,
            "ppid": p.ppid,
            "elapsed_sec": p.etime_sec,
            "rss_mb": p.rss_mb,
            "command": p.command,
            "kill_reason": reason,
            "outcome": outcome,
        }
        log_event(record)
        print(f"pid={p.pid:>6} outcome={outcome}")

    print()
    print(f"log: {LOG_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
