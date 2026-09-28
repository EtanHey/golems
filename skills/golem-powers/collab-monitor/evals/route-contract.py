#!/usr/bin/env python3
"""Untouched-base routing and copied-skill lifecycle goldens."""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import time
import sys

SKILL = Path(__file__).resolve().parents[1]
REPO = SKILL.parents[2]
ENTRY = SKILL / "scripts/collab-monitor.sh"
BASE = "d383ddb5d2164941e8e493bcaae3330839a62fbd"
GOLDEN = Path(__file__).parent / "fixtures/route-contract.json"
FIXTURES = Path(__file__).parent / "fixtures"
TEMP_PARENT = REPO / "docs.local/split-collab-monitor/fixture-tmp"
CASES = (
    ("ten-posts-three-fires.md", "@leadX"),
    ("orchestrator-fourteen-posts.md", "@leadX"),
    ("arrowed-authors.md", "@leadX"),
    ("routing-code-examples.md", "@skillcreator"),
    ("self-authored-post.md", "@skillcreator"),
    ("routing-unclosed-fence.md", "@skillcreator"),
    ("routing-backtick-inline-span.md", "@skillcreator"),
    ("routing-list-nested-fence.md", "@skillcreator"),
    ("foreign-signature-with-cc.md", "@review-638"),
    ("default-author-filter.md", "@skillcreator"),
    ("routing-summary-mention.md", "@skillcreator"),
    ("routing-list-reply.md", "@skillcreator"),
)


def normalize(value, sandbox):
    value = value.replace(str(sandbox), "<SANDBOX>")
    return re.sub(r"pid=[0-9]+", "pid=<PID>", value)


def invoke(entry, cwd, state, *args):
    env = os.environ.copy()
    env.update(MONITOR_STATE_DIR=str(state), POLL_SECONDS="0.1", LC_ALL="C")
    proc = subprocess.run(["/bin/bash", str(entry), *args], cwd=cwd, env=env,
                          capture_output=True, text=True, timeout=30)
    return {"exit": proc.returncode, "stdout": proc.stdout, "stderr": proc.stderr}


def state_files(state, sandbox):
    files = {}
    for path in sorted(state.rglob("*")):
        if path.is_file():
            name = str(path.relative_to(state))
            name = re.sub(r"(?<=sizes/)[0-9a-f]{64}(?=\.size$)", "<BOARD_HASH>", name)
            files[name] = normalize(path.read_text(), sandbox)
    return files


def route_case(fixture, listener):
    with tempfile.TemporaryDirectory(prefix="route-", dir=TEMP_PARENT) as temp:
        sandbox = Path(temp)
        state, board, cwd = sandbox / "state", sandbox / "board.md", sandbox / "elsewhere"
        cwd.mkdir()
        board.write_text("")
        seed = invoke(ENTRY, cwd, state, "run", "--once", listener, str(board))
        assert seed["exit"] == 0, (fixture, seed)
        board.write_bytes((FIXTURES / fixture).read_bytes())
        result = invoke(ENTRY, cwd, state, "run", "--once", listener, str(board))
        return {"fixture": fixture, "listener": listener,
                "seed": {key: normalize(value, sandbox) if isinstance(value, str) else value
                         for key, value in seed.items()},
                "scan": {key: normalize(value, sandbox) if isinstance(value, str) else value
                         for key, value in result.items()},
                "state": state_files(state, sandbox)}


def copied_tree_case():
    with tempfile.TemporaryDirectory(prefix="copied-", dir=TEMP_PARENT) as temp:
        sandbox = Path(temp)
        copied = sandbox / "installed/collab-monitor"
        shutil.copytree(SKILL / "scripts", copied / "scripts")
        entry = copied / "scripts/collab-monitor.sh"
        state, board, cwd = sandbox / "state", sandbox / "board.md", sandbox / "elsewhere"
        cwd.mkdir()
        board.write_text("")
        start = invoke(entry, cwd, state, "start", "@skillcreator", str(board))
        assert start["exit"] == 0, start
        try:
            board.write_bytes((FIXTURES / "addressed-event.md").read_bytes())
            log = state / "skillcreator/monitor.log"
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                if log.exists() and "NEW-FOR-@skillcreator" in log.read_text():
                    break
                time.sleep(0.05)
            else:
                raise AssertionError("copied-tree detached monitor did not route fixture")
            status = invoke(entry, cwd, state, "status", "@skillcreator")
            assert status["exit"] == 0, status
            emitted = normalize(log.read_text(), sandbox)
        finally:
            stop = invoke(entry, cwd, state, "stop", "@skillcreator")
            assert stop["exit"] == 0, stop
        return {"start": {k: normalize(v, sandbox) if isinstance(v, str) else v for k, v in start.items()},
                "status": {k: normalize(v, sandbox) if isinstance(v, str) else v for k, v in status.items()},
                "stop": {k: normalize(v, sandbox) if isinstance(v, str) else v for k, v in stop.items()},
                "log": emitted, "state": state_files(state, sandbox)}


def main():
    record = len(sys.argv) == 2 and sys.argv[1] == "--record"
    assert len(sys.argv) == 1 or record, "usage: route-contract.py [--record]"
    if record:
        original = subprocess.check_output(
            ["git", "show", f"{BASE}:skills/golem-powers/collab-monitor/scripts/collab-monitor.sh"],
            cwd=REPO)
        assert ENTRY.read_bytes() == original, "goldens must be recorded from untouched base"
    TEMP_PARENT.mkdir(parents=True, exist_ok=True)
    actual = {"routes": [route_case(*case) for case in CASES], "copied_tree": copied_tree_case()}
    if record:
        GOLDEN.write_text(json.dumps(actual, indent=2, ensure_ascii=False) + "\n")
    else:
        expected = json.loads(GOLDEN.read_text())
        assert actual == expected, "routing, state, or copied-tree lifecycle differs from untouched base"
    print(f"PASS routing goldens: {len(CASES)} fixtures + copied-tree detached lifecycle")


if __name__ == "__main__":
    main()
