"""
Pytest fixtures for `is_working_agent` predicate (US-002).

Covers 7 canonical assertions from the predicate spec:
  T1. self (own pid)        → True
  T2. launchd (pid=1)        → True
  T3. ps-race (pid not in snapshot) → True
  T4. SAFELIST cmdline match (brainlayer watch) → True
  T5. SAFELIST cmdline match (whatsapp-bridge)  → True
  T6. AI_CLI ancestor (claude --) → True
  T7. orphan with no whitelist match → False (eligible-to-kill)
  T8. Claude daemon/version-path ancestor → True

Run with:
    pytest ~/Gits/golems/scripts/tests/test_mcp_predicate.py -v
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

# Make the parent dir importable
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from mcp_reaper import Proc, is_working_agent  # noqa: E402


def make_proc(
    pid: int,
    ppid: int,
    command: str,
    etime: str = "01:23:45",
    etime_sec: int = 5025,
    rss_kb: int = 1024,
) -> Proc:
    return Proc(
        pid=pid,
        ppid=ppid,
        etime=etime,
        etime_sec=etime_sec,
        rss_kb=rss_kb,
        rss_mb=round(rss_kb / 1024.0, 1),
        command=command,
    )


def test_T1_self_returns_true_spare():
    """T1 — own pid must always be spared."""
    me = os.getpid()
    by_pid = {me: make_proc(me, 1, "python3 test_mcp_predicate.py")}
    is_wa, reason = is_working_agent(me, by_pid)
    assert is_wa is True, f"self pid should be spared, got reason={reason}"
    assert "self" in reason.lower() or "parent" in reason.lower()


def test_T2_launchd_returns_true_spare():
    """T2 — launchd pid=1 must never be touched."""
    by_pid = {1: make_proc(1, 0, "/sbin/launchd")}
    is_wa, reason = is_working_agent(1, by_pid)
    assert is_wa is True
    assert "launchd" in reason.lower()


def test_T3_ps_race_returns_true_spare():
    """T3 — pid not in current snapshot (race) must be spared."""
    by_pid: dict[int, Proc] = {}  # empty snapshot
    is_wa, reason = is_working_agent(99999, by_pid)
    assert is_wa is True
    assert "race" in reason.lower() or "ambiguity" in reason.lower()


def test_T4_safelist_brainlayer_watch_spared():
    """T4 — SAFELIST substring match (brainlayer watch) must spare."""
    by_pid = {
        5664: make_proc(
            5664,
            1,
            "/Library/Frameworks/Python.framework/Versions/3.13/bin/brainlayer watch --poll 1.0",
        )
    }
    is_wa, reason = is_working_agent(5664, by_pid)
    assert is_wa is True
    assert "safelist" in reason.lower()


def test_T5_safelist_whatsapp_bridge_spared():
    """T5 — SAFELIST substring match (whatsapp-bridge) must spare."""
    by_pid = {
        2538: make_proc(
            2538,
            1,
            "/Users/example/Gits/whatsapp-mcp/whatsapp-bridge-business/whatsapp-bridge",
        )
    }
    is_wa, reason = is_working_agent(2538, by_pid)
    assert is_wa is True
    assert "safelist" in reason.lower()


def test_T6_ai_cli_ancestor_spared():
    """T6 — descendant of a `claude --` process must be spared by ancestor walk."""
    # 1000 = claude session; 2000 = bun MCP child of claude
    claude_proc = make_proc(1000, 1, "claude --dangerously-skip-permissions --model opus")
    mcp_child = make_proc(2000, 1000, "bun run /some/path/some-mcp-server.ts")
    by_pid = {1000: claude_proc, 2000: mcp_child}
    is_wa, reason = is_working_agent(2000, by_pid)
    assert is_wa is True, f"child of claude should be spared, got reason={reason}"
    assert "ai-cli" in reason.lower() or "ancestor" in reason.lower()


def test_T7_orphan_no_whitelist_match_eligible():
    """T7 — orphan MCP with no whitelist match must be flagged eligible-to-kill."""
    # 3000 = orphan that doesn't match SAFELIST and has no AI-CLI ancestor
    orphan = make_proc(3000, 1, "bun run /tmp/some-random-mcp-server.ts")
    by_pid = {3000: orphan}
    is_wa, reason = is_working_agent(3000, by_pid)
    assert is_wa is False, f"orphan with no whitelist match should be eligible, got reason={reason}"
    assert "no whitelist rule matched" in reason.lower() or "eligible" in reason.lower()


def test_T7b_orphan_chain_to_orphan_still_eligible():
    """T7b — process whose parent is itself an orphan (chain ends ppid=1 with no AI-CLI) eligible."""
    # 4001 ppid=1 (orphan parent), 4002 ppid=4001 — chain walk hits launchd, no AI-CLI
    parent = make_proc(4001, 1, "uv run --directory /tmp/random/path main.py")
    child = make_proc(4002, 4001, "/tmp/random/path/.venv/bin/python3 main.py")
    by_pid = {4001: parent, 4002: child}
    is_wa, reason = is_working_agent(4002, by_pid)
    assert is_wa is False, f"chain ending in orphan should be eligible, got reason={reason}"


def test_T8_claude_daemon_version_path_ancestor_spared():
    """T8 — MCP child under Claude daemon/version-path ancestry must be spared."""
    daemon = make_proc(
        5000,
        1,
        '/Users/example/.local/bin/claude daemon run --origin transient --spawned-by {"label":"claude"}',
    )
    pty_host = make_proc(
        5001,
        5000,
        "/Users/example/.local/share/claude/versions/2.1.143 --bg-pty-host /tmp/cc-daemon/pty.sock",
    )
    claude_spare = make_proc(
        5002,
        5001,
        "/Users/example/.local/share/claude/versions/2.1.143 --bg-spare /tmp/cc-daemon/spare.sock",
    )
    mcp_child = make_proc(
        5003,
        5002,
        "/opt/homebrew/bin/python3 /Users/example/.local/bin/notebooklm-mcp",
    )
    by_pid = {
        daemon.pid: daemon,
        pty_host.pid: pty_host,
        claude_spare.pid: claude_spare,
        mcp_child.pid: mcp_child,
    }
    is_wa, reason = is_working_agent(mcp_child.pid, by_pid)
    assert is_wa is True, f"Claude daemon descendant should be spared, got reason={reason}"
    assert "ai-cli" in reason.lower() or "ancestor" in reason.lower()


if __name__ == "__main__":
    import pytest

    sys.exit(pytest.main([__file__, "-v"]))
