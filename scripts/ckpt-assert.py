#!/usr/bin/env python3
"""ckpt-assert.py — RED/GREEN gate for the precompact-checkpoint hook fix (PR-K1).

Asserts that a checkpoint markdown produced by `precompact-checkpoint.py --replay`
against the gen-15 proven-failure transcript satisfies all five acceptance
criteria from PLAN §3a:

  1. >=30 of ~34 user corrections present (current hook captures 0)
  2. Project == orchestrator (from transcript cwd, not full-text grep)
  3. Size < 60 KB (no 535KB attachment dumps)
  4. FIRST-ACTION CONTRACT header present (raw transcript + boot doc + collab channel)
  5. REMEMBER-LIST contains the Pi-MVP-grade item (around line 1882 of the replay JSONL)

Exit 0 = GREEN (all pass). Exit 1 = RED (one or more fail). Usage:

  python3 scripts/ckpt-assert.py /tmp/ckpt-replay.md
"""
import re
import sys
from pathlib import Path

# Distinctive fingerprint of the L1882 "Pi-MVP-grade" turn (open-source phone-agent
# MVP — "I wonder if you can give it an LLM as a judge score as well"). Lower-cased
# substring match so truncation/whitespace-normalization can't break it.
PI_MVP_FINGERPRINT = "give it an llm as a judge"
MIN_CORRECTIONS = 30
MAX_SIZE_BYTES = 60 * 1024


def section_body(text, heading):
    """Return the body lines under a `## <heading>` (or `### ...CONTRACT`) section."""
    pattern = rf"(?ms)^#{{1,6}}\s*{re.escape(heading)}.*?\n(.*?)(?=^#{{1,6}}\s|\Z)"
    m = re.search(pattern, text)
    return m.group(1).strip() if m else ""


def count_correction_bullets(text):
    body = section_body(text, "User Corrections")
    if not body or body.lstrip().startswith("_No"):
        return 0
    return sum(1 for line in body.splitlines() if line.strip().startswith("- "))


def main():
    if len(sys.argv) < 2:
        print("usage: ckpt-assert.py <checkpoint.md>", file=sys.stderr)
        return 2
    path = Path(sys.argv[1])
    if not path.exists():
        print(f"FAIL: checkpoint file not found: {path}", file=sys.stderr)
        return 1
    raw = path.read_bytes()
    text = raw.decode("utf-8", errors="replace")
    size = len(raw)

    checks = []

    # 1. >=30 corrections
    n_corr = count_correction_bullets(text)
    checks.append((f"corrections >= {MIN_CORRECTIONS} (got {n_corr})", n_corr >= MIN_CORRECTIONS))

    # 2. project == orchestrator
    proj_m = re.search(r"(?im)^\*\*Project:\*\*\s*(\S+)", text)
    project = proj_m.group(1) if proj_m else "(none)"
    checks.append((f"project == orchestrator (got {project})", project == "orchestrator"))

    # 3. size < 60KB
    checks.append((f"size < 60KB (got {size} bytes)", size < MAX_SIZE_BYTES))

    # 4. FIRST-ACTION CONTRACT header present — must be an actual markdown heading,
    #    not transcript text that happened to mention the phrase (the base-hook dump
    #    bleeds the literal words in, so a bare substring match false-passes).
    has_contract = bool(
        re.search(r"(?im)^#{1,6}\s*FIRST-ACTION\s+CONTRACT", text)
    )
    checks.append(("FIRST-ACTION CONTRACT heading present", has_contract))

    # 5. REMEMBER-LIST contains the Pi-MVP-grade item
    remember_body = section_body(text, "REMEMBER-LIST")
    has_pi = PI_MVP_FINGERPRINT in remember_body.lower()
    checks.append(("REMEMBER-LIST contains Pi-MVP-grade item (L1882)", has_pi))

    all_pass = all(ok for _, ok in checks)
    verdict = "GREEN" if all_pass else "RED"
    print(f"=== ckpt-assert: {verdict} ({path}) ===")
    for label, ok in checks:
        print(f"  [{'PASS' if ok else 'FAIL'}] {label}")
    return 0 if all_pass else 1


if __name__ == "__main__":
    sys.exit(main())
