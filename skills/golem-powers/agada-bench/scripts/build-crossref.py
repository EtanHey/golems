#!/usr/bin/env python3
"""Cross-reference agada-bench judge JSONLs into consensus diagnostics."""
import argparse
import json
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path


def fail(message, code=1):
    print(f"build-crossref.py: ERROR {message}", file=sys.stderr)
    return code


def numeric(label):
    if isinstance(label, int):
        return label
    if isinstance(label, str):
        if label.isdigit():
            return int(label)
        if label.lower() in {"cant-tell", "can't tell", "cant_tell"}:
            return None
    return None


def fmt_label(value):
    if value is None:
        return "."
    return str(value)


def load_corpus(path):
    pairs = set()
    with path.open() as f:
        for line in f:
            if line.strip():
                row = json.loads(line)
                pairs.add((row["query_id"], row["chunk_id"]))
    return pairs


def load_judges(judge_dir, judges, corpus_pairs):
    by_pair = defaultdict(dict)
    counts = Counter()
    fm_by_judge = defaultdict(Counter)
    fm_total = Counter()
    confidence_by_judge = defaultdict(list)
    cant_tell_by_judge = Counter()
    off_corpus_by_judge = defaultdict(list)
    for judge in judges:
        path = judge_dir / f"{judge}.jsonl"
        if not path.exists():
            raise FileNotFoundError(path)
        with path.open() as f:
            for line in f:
                if not line.strip():
                    continue
                row = json.loads(line)
                key = (row.get("query_id"), row.get("chunk_id"))
                if key not in corpus_pairs:
                    off_corpus_by_judge[judge].append(key)
                by_pair[key][judge] = row
                counts[judge] += 1
                for fm in row.get("failure_modes_observed") or []:
                    fm_by_judge[judge][fm] += 1
                    fm_total[fm] += 1
                conf = row.get("confidence_0_100")
                if isinstance(conf, (int, float)):
                    confidence_by_judge[judge].append(conf)
                if numeric(row.get("label")) is None and row.get("label") not in (None, ""):
                    cant_tell_by_judge[judge] += 1
    return {
        "by_pair": by_pair,
        "counts": counts,
        "fm_by_judge": fm_by_judge,
        "fm_total": fm_total,
        "confidence_by_judge": confidence_by_judge,
        "cant_tell_by_judge": cant_tell_by_judge,
        "off_corpus_by_judge": off_corpus_by_judge,
    }


def consensus_label(labels):
    nums = sorted(numeric(v) for v in labels.values() if numeric(v) is not None)
    if not nums:
        return "cant-tell"
    mid = len(nums) // 2
    if len(nums) % 2:
        return nums[mid]
    return min(nums[mid - 1], nums[mid])


def classify_pairs(by_pair, judges):
    disagreements = []
    unanimous = []
    near_agree = []
    cant_tell_mixed = []
    for key, rows in sorted(by_pair.items()):
        labels = {j: rows[j].get("label") for j in judges if j in rows}
        vals = [numeric(value) for value in labels.values()]
        nums = [value for value in vals if value is not None]
        has_cant = any(numeric(value) is None and value not in (None, "") for value in labels.values())
        if not nums:
            cant_tell_mixed.append((key, labels))
            continue
        spread = max(nums) - min(nums)
        record = (key, labels, spread, has_cant)
        if spread == 0 and len(nums) == len(judges) and not has_cant:
            unanimous.append(record)
        elif spread >= 2:
            disagreements.append(record)
        else:
            near_agree.append(record)
    return disagreements, unanimous, near_agree, cant_tell_mixed


def write_consensus(path, by_pair, judges, dry_run):
    if dry_run:
        return 0
    rows_written = 0
    with path.open("w") as f:
        for key, by_judge in sorted(by_pair.items()):
            qid, chunk_id = key
            labels = {j: by_judge[j].get("label") for j in judges if j in by_judge}
            nums = [numeric(v) for v in labels.values() if numeric(v) is not None]
            spread = max(nums) - min(nums) if nums else None
            confs = [
                by_judge[j].get("confidence_0_100")
                for j in judges
                if j in by_judge and isinstance(by_judge[j].get("confidence_0_100"), (int, float))
            ]
            fm_union = set()
            judge_details = {}
            for judge in judges:
                if judge not in by_judge:
                    continue
                row = by_judge[judge]
                fms = row.get("failure_modes_observed") or []
                fm_union.update(fms)
                judge_details[judge] = {
                    "label": row.get("label"),
                    "confidence_0_100": row.get("confidence_0_100"),
                    "reasoning_short": row.get("reasoning_short"),
                    "failure_modes_observed": fms,
                }
            f.write(
                json.dumps(
                    {
                        "query_id": qid,
                        "chunk_id": chunk_id,
                        "consensus_label": consensus_label(labels),
                        "labels_by_judge": labels,
                        "judge_details": judge_details,
                        "spread": spread,
                        "avg_confidence": round(sum(confs) / len(confs), 1) if confs else None,
                        "failure_modes_union": sorted(fm_union),
                        "needs_red_team": spread is not None and spread >= 2,
                    },
                    ensure_ascii=False,
                )
                + "\n"
            )
            rows_written += 1
    return rows_written


def write_report(path, run_dir, corpus_pairs, judges, data, classes, dry_run):
    disagreements, unanimous, near_agree, cant_tell_mixed = classes
    if dry_run:
        return
    by_pair = data["by_pair"]
    lines = [
        "# Phase 2 - Disagreement Matrix & FM Frequency Table",
        "",
        f"> Run dir: {run_dir}",
        f"> Generated: {datetime.now(timezone.utc).replace(microsecond=0).isoformat()} via build-crossref.py",
        "",
        "## Top-line",
        "",
        f"- Corpus pairs (authoritative): {len(corpus_pairs)}",
        f"- Total pairs seen across all judges: {len(by_pair)}",
        f"- Pairs graded by all {len(judges)} judges: {sum(1 for rows in by_pair.values() if len(rows) == len(judges))}",
        f"- Unanimous: {sum(1 for rec in unanimous if rec[0] in corpus_pairs)}",
        f"- Near-agreement (spread 0-1): {len(near_agree)}",
        f"- Disagreements >=2 grades apart: {len(disagreements)}",
        f"- All-cant-tell or no-numeric-labels: {len(cant_tell_mixed)}",
        "",
        "## Judge integrity: off-corpus chunk_ids",
        "",
    ]
    if not any(data["off_corpus_by_judge"].get(j) for j in judges):
        lines.append("_All judges used corpus chunk_ids._")
    else:
        lines.extend(["| Judge | Off-corpus pairs | Example |", "|---|---:|---|"])
        for judge in judges:
            off = data["off_corpus_by_judge"].get(judge, [])
            example = f"qid={off[0][0]} chunk_id={off[0][1]}" if off else "-"
            lines.append(f"| {judge}Judge | {len(off)} | {example} |")
    lines.extend(
        [
            "",
            "## Per-judge stats",
            "",
            "| Judge | Rows | Avg confidence | cant-tell uses | Top FM observed |",
            "|---|---:|---:|---:|---|",
        ]
    )
    for judge in judges:
        confs = data["confidence_by_judge"][judge]
        avg = round(sum(confs) / len(confs), 1) if confs else 0
        top = data["fm_by_judge"][judge].most_common(1)
        top_str = f"{top[0][0]}({top[0][1]})" if top else "-"
        lines.append(
            f"| {judge}Judge | {data['counts'][judge]} | {avg} | "
            f"{data['cant_tell_by_judge'][judge]} | {top_str} |"
        )
    lines.extend(
        [
            "",
            "## Failure-mode frequency",
            "",
            "| FM tag | Total | " + " | ".join(judges) + " |",
            "|---|---:|" + "---:|" * len(judges),
        ]
    )
    for fm, total in data["fm_total"].most_common():
        counts = [str(data["fm_by_judge"][judge].get(fm, 0)) for judge in judges]
        lines.append(f"| `{fm}` | {total} | " + " | ".join(counts) + " |")
    lines.extend(["", "## Disagreements >= 2 grades apart", ""])
    if not disagreements:
        lines.append("_(none)_")
    else:
        lines.append(
            "| qid | chunk_id (short) | "
            + " | ".join(judges)
            + " | spread | FM union |"
        )
        lines.append("|---:|---|" + ":---:|" * len(judges) + "---:|---|")
        for key, labels, spread, _has_cant in disagreements:
            qid, chunk_id = key
            short = chunk_id[:18] + "..." if len(chunk_id) > 18 else chunk_id
            cells = [fmt_label(labels.get(judge)) for judge in judges]
            fms = set()
            for row in by_pair[key].values():
                fms.update(row.get("failure_modes_observed") or [])
            lines.append(
                f"| {qid} | `{short}` | "
                + " | ".join(cells)
                + f" | {spread} | {', '.join(sorted(fms)) or '-'} |"
            )
    lines.append("")
    path.write_text("\n".join(lines))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-dir", required=True)
    parser.add_argument("--judges", required=True)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    run_dir = Path(args.run_dir).expanduser()
    judges = [j.strip() for j in args.judges.split(",") if j.strip()]
    if not judges:
        return fail("--judges resolved to empty")
    corpus_path = run_dir / "phase-0b-corpus" / "corpus.jsonl"
    judge_dir = run_dir / "phase-1-judgments"
    out_dir = run_dir / "phase-2-crossref"
    out = out_dir / "disagreement-matrix.md"
    consensus = out_dir / "consensus-draft.jsonl"
    if not corpus_path.exists():
        return fail(f"missing corpus: {corpus_path}")
    if not judge_dir.exists():
        return fail(f"missing judgments dir: {judge_dir}")
    try:
        corpus_pairs = load_corpus(corpus_path)
        data = load_judges(judge_dir, judges, corpus_pairs)
    except (OSError, json.JSONDecodeError, KeyError, FileNotFoundError) as exc:
        return fail(str(exc))
    classes = classify_pairs(data["by_pair"], judges)
    if not args.dry_run:
        out_dir.mkdir(parents=True, exist_ok=True)
    rows = write_consensus(consensus, data["by_pair"], judges, args.dry_run)
    write_report(out, run_dir, corpus_pairs, judges, data, classes, args.dry_run)
    disagreements, unanimous, near_agree, cant_tell_mixed = classes
    print(
        "build-crossref.py: "
        f"pairs={len(data['by_pair'])} consensus_rows={rows if not args.dry_run else len(data['by_pair'])} "
        f"unanimous={len(unanimous)} near_agree={len(near_agree)} "
        f"disagreements={len(disagreements)} no_numeric={len(cant_tell_mixed)} "
        f"output={out}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
