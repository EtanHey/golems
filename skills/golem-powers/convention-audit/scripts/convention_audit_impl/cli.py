"""CLI argument parsing and exact output/exit contracts."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import subprocess
import sys
from typing import Callable

def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Find concepts with multiple independent implementations that can silently diverge."
    )
    parser.add_argument(
        "--repo", required=True, type=Path, help="Repository to inspect read-only"
    )
    parser.add_argument(
        "--output-dir",
        required=True,
        type=Path,
        help="Directory for report and raw run logs",
    )
    parser.add_argument(
        "--codex-binary",
        default="codex",
        help="Raw Codex CLI binary (never a repoGolem alias)",
    )
    parser.add_argument("--concurrency", type=int, default=3)
    parser.add_argument(
        "--timeout", type=int, default=1800, help="Per-worker timeout in seconds"
    )
    parser.add_argument(
        "--no-effort-fallback",
        action="store_true",
        help="Require max reasoning and never attempt the xhigh fallback",
    )
    return parser

def main(*, parser: Callable, run_audit: Callable, lens_count: int) -> int:
    args = parser().parse_args()
    if args.concurrency < 1 or args.concurrency > lens_count:
        raise SystemExit(f"--concurrency must be between 1 and {lens_count}")
    try:
        report, run_log = run_audit(args)
    except (RuntimeError, subprocess.TimeoutExpired, json.JSONDecodeError) as exc:
        print(f"convention-audit: {exc}", file=sys.stderr)
        return 1
    print(
        json.dumps(
            {"findings": len(report["findings"]), "telemetry": run_log["telemetry"]},
            sort_keys=True,
        )
    )
    return 0
