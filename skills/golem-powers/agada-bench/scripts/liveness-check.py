#!/usr/bin/env python3
"""Validate judge JSONL liveness and corpus alignment."""
import argparse
import json
import sys
from pathlib import Path


def fail(message, code=1):
    print(f"liveness-check.py: ERROR {message}", file=sys.stderr)
    return code


def load_pairs(path):
    pairs = set()
    with path.open() as f:
        for line in f:
            if not line.strip():
                continue
            row = json.loads(line)
            pairs.add((row["query_id"], row["chunk_id"]))
    return pairs


def read_judge(path, corpus_pairs):
    rows = 0
    in_corpus = set()
    off_corpus = []
    with path.open() as f:
        for line in f:
            if not line.strip():
                continue
            row = json.loads(line)
            rows += 1
            key = (row.get("query_id"), row.get("chunk_id"))
            if key in corpus_pairs:
                in_corpus.add(key)
            else:
                off_corpus.append(key)
    return rows, in_corpus, off_corpus


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--phase1-dir", required=True)
    parser.add_argument("--corpus", required=True)
    parser.add_argument("--expected-judges", required=True)
    parser.add_argument("--tolerance", type=float, default=0.05)
    parser.add_argument("--strict", action="store_true")
    parser.add_argument("--out")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    phase1 = Path(args.phase1_dir).expanduser()
    corpus = Path(args.corpus).expanduser()
    out = Path(args.out).expanduser() if args.out else phase1 / "liveness-report.md"
    judges = [j.strip() for j in args.expected_judges.split(",") if j.strip()]
    if not judges:
        return fail("--expected-judges resolved to empty")
    if not corpus.exists():
        return fail(f"corpus not found: {corpus}")
    try:
        corpus_pairs = load_pairs(corpus)
    except (OSError, json.JSONDecodeError, KeyError) as exc:
        return fail(f"cannot read corpus: {exc}")
    threshold = (1 - args.tolerance) * len(corpus_pairs)
    off_limit = args.tolerance * len(corpus_pairs)
    results = []
    strict_exit = 0

    for judge in judges:
        path = phase1 / f"{judge}.jsonl"
        if not path.exists():
            result = {
                "judge": judge,
                "rows": 0,
                "in_corpus": 0,
                "off": 0,
                "alignment": 0.0,
                "status": "DEAD",
                "note": "missing file",
            }
            strict_exit = max(strict_exit, 2)
            results.append(result)
            continue
        try:
            rows, in_corpus, off_corpus = read_judge(path, corpus_pairs)
        except (OSError, json.JSONDecodeError) as exc:
            result = {
                "judge": judge,
                "rows": 0,
                "in_corpus": 0,
                "off": 0,
                "alignment": 0.0,
                "status": "DEAD",
                "note": f"unreadable JSONL: {exc}",
            }
            strict_exit = max(strict_exit, 2)
            results.append(result)
            continue
        aligned = len(in_corpus)
        off = len(off_corpus)
        alignment = aligned / len(corpus_pairs) if corpus_pairs else 0.0
        off_rate = off / rows if rows else 0.0
        if off > off_limit or off_rate > args.tolerance:
            status = "INTEGRITY-FAIL"
            strict_exit = max(strict_exit, 3)
            note = f"off-corpus {off} exceeds tolerance"
        elif aligned < threshold:
            status = "DEAD"
            strict_exit = max(strict_exit, 2)
            note = f"under quota {aligned}/{int(threshold)}"
        else:
            status = "ALIVE"
            note = ""
        results.append(
            {
                "judge": judge,
                "rows": rows,
                "in_corpus": aligned,
                "off": off,
                "alignment": alignment,
                "status": status,
                "note": note,
            }
        )

    lines = [
        f"# Liveness Report - {phase1}/",
        "",
        f"Corpus: {len(corpus_pairs)} (query_id, chunk_id) pairs from {corpus}",
        f"Expected judges: {', '.join(judges)}",
        f"Tolerance: {args.tolerance:.0%}",
        f"Mode: {'strict' if args.strict else 'warn-only'}",
        "",
        "## Per-judge",
        "",
        "| Judge | Rows written | Rows in corpus | Off-corpus | % of corpus | Status |",
        "|---|---:|---:|---:|---:|---|",
    ]
    for result in results:
        status = result["status"]
        detail = status if not result["note"] else f"{status} ({result['note']})"
        lines.append(
            f"| {result['judge']}Judge | {result['rows']} | {result['in_corpus']} | "
            f"{result['off']} | {result['alignment'] * 100:.1f}% | {detail} |"
        )
    failing = [r for r in results if r["status"] != "ALIVE"]
    lines.extend(["", "## Verdict", ""])
    if failing:
        lines.append(
            "FAIL - " + ", ".join(f"{r['judge']}Judge={r['status']}" for r in failing)
        )
        lines.extend(
            [
                "",
                "## Action required",
                "",
                "Re-run affected judges against the same corpus, then re-run liveness-check.",
            ]
        )
    else:
        lines.append("PASS - all expected judges are alive within tolerance.")
    lines.append("")

    if args.dry_run:
        print(
            f"liveness-check.py: dry_run=true judges={len(judges)} "
            f"failures={len(failing)} output={out}"
        )
        return 0
    try:
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text("\n".join(lines))
    except OSError as exc:
        return fail(str(exc))
    if failing and not args.strict:
        print(
            "liveness-check.py: WARN fail conditions present but --strict not set",
            file=sys.stderr,
        )
    exit_code = strict_exit if args.strict else 0
    print(
        f"liveness-check.py: judges={len(judges)} failures={len(failing)} "
        f"strict={str(args.strict).lower()} output={out}"
    )
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
