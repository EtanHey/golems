#!/usr/bin/env python3
"""Route unresolved agada-bench gold rows through W3.3 pending-RT decisions."""
import argparse
import json
import os
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path


PENDING_METHODS = {
    "pending-rt",
    "red-team-pending",
    "red-team-pending-claude-tiebreak",
    "tie-no-claude",
    "all-cant-tell-or-empty",
}


def fail(message, code=1):
    print(f"route-pending-rt.py: ERROR {message}", file=sys.stderr)
    return code


def numeric(label):
    if isinstance(label, int):
        return label
    if isinstance(label, str) and label.isdigit():
        return int(label)
    return None


def load_jsonl(path):
    rows = []
    with path.open() as f:
        for line in f:
            if line.strip():
                rows.append(json.loads(line))
    return rows


def is_pending(row):
    # v1 schema uses "resolution_method"; v1.1-3p / v1.1-3p-1s use "method"
    method = str(row.get("resolution_method") or row.get("method") or "")
    return method in PENDING_METHODS or "pending" in method


def consensus_index(path):
    data = {}
    for row in load_jsonl(path):
        data[(row.get("query_id"), row.get("chunk_id"))] = row
    return data


def judge_details(consensus_row):
    details = consensus_row.get("judge_details")
    if isinstance(details, dict) and details:
        return details
    labels = consensus_row.get("labels_by_judge") or {}
    return {judge: {"label": label} for judge, label in labels.items()}


def route_for(row, consensus_row, cascade):
    if cascade == "etan-adjudicate":
        return "etan-adjudicate", "forced by --cascade etan-adjudicate"
    if cascade == "discard-fm14":
        return "discard-fm14", "forced by --cascade discard-fm14"

    details = judge_details(consensus_row or {})
    labels = {judge: numeric(info.get("label")) for judge, info in details.items()}
    labels = {judge: label for judge, label in labels.items() if label is not None}
    distinct = sorted(set(labels.values()))
    spread = max(distinct) - min(distinct) if distinct else 0
    counts = Counter(labels.values())
    majority_label = None
    outlier_judge = None
    if counts:
        top_label, top_count = counts.most_common(1)[0]
        if top_count == 2 and len(labels) == 3 and len(distinct) == 2:
            majority_label = top_label
            outliers = [judge for judge, label in labels.items() if label != majority_label]
            outlier_judge = outliers[0] if len(outliers) == 1 else None
    fm_union = set(row.get("failure_modes_union") or consensus_row.get("failure_modes_union") or [])
    for info in details.values():
        fm_union.update(info.get("failure_modes_observed") or [])
    majority_conf = []
    if majority_label is not None:
        for judge, info in details.items():
            if numeric(info.get("label")) == majority_label:
                conf = info.get("confidence_0_100")
                if isinstance(conf, (int, float)):
                    majority_conf.append(conf)
    avg_conf = consensus_row.get("avg_confidence") if consensus_row else None
    high_conf = (
        all(conf >= 80 for conf in majority_conf)
        if majority_conf
        else isinstance(avg_conf, (int, float)) and avg_conf >= 80
    )
    if len(distinct) == 2 and outlier_judge and "FM6" in fm_union and high_conf:
        return "cascade-opus", f"single outlier {outlier_judge} with FM6 and high-confidence majority"
    if len(distinct) == 3 and spread == 3:
        return "discard-fm14", "three distinct labels with spread=3"
    if len(distinct) == 3 and spread == 2:
        return "etan-adjudicate", "genuine three-way disagreement"
    return "etan-adjudicate", "default conservative escalation"


def write_jsonl_atomic(path, rows):
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    os.replace(tmp, path)


def write_queues(gold_path, routed, dry_run):
    gold_dir = gold_path.parent
    etan_rows = [item for item in routed if item["route"] == "etan-adjudicate"]
    cascade_rows = [item for item in routed if item["route"] == "cascade-opus"]
    if dry_run:
        return
    if etan_rows:
        lines = [
            f"# Etan Adjudication Queue - {gold_dir}",
            "",
            f"Generated: {datetime.now(timezone.utc).replace(microsecond=0).isoformat()}",
            "",
        ]
        for idx, item in enumerate(etan_rows, 1):
            row = item["gold_row"]
            lines.extend(
                [
                    f"## Row {idx}: (qid={row['query_id']}, chunk_id={row['chunk_id']})",
                    "",
                    f"**Routing rationale**: {item['rationale']}",
                    "",
                    "**Your verdict**: __",
                    "",
                    "---",
                    "",
                ]
            )
        (gold_dir / "ETAN_QUEUE.md").write_text("\n".join(lines))
    if cascade_rows:
        lines = [
            f"# Cascade Queue - {gold_dir}",
            "",
            "These rows need Opus cascade adjudication. v1 only queues them; it does not call Opus.",
            "",
            "| qid | chunk_id | suggested_label | rationale |",
            "|---:|---|---:|---|",
        ]
        for item in cascade_rows:
            row = item["gold_row"]
            suggestion = item.get("suggested_label")
            lines.append(
                f"| {row['query_id']} | `{row['chunk_id']}` | {suggestion} | {item['rationale']} |"
            )
        (gold_dir / "cascade-queue.md").write_text("\n".join(lines) + "\n")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--gold", required=True)
    parser.add_argument("--consensus", required=True)
    parser.add_argument("--cascade", choices=["opus-4-7", "etan-adjudicate", "discard-fm14"], default="opus-4-7")
    parser.add_argument("--out", required=True)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    gold_path = Path(args.gold).expanduser()
    consensus_path = Path(args.consensus).expanduser()
    out = Path(args.out).expanduser()
    if not gold_path.exists():
        return fail(f"gold not found: {gold_path}")
    if not consensus_path.exists():
        return fail(f"consensus not found: {consensus_path}")
    try:
        gold_rows = load_jsonl(gold_path)
        consensus = consensus_index(consensus_path)
    except (OSError, json.JSONDecodeError) as exc:
        return fail(str(exc))

    routed = []
    keep_rows = []
    discard_rows = []
    for row in gold_rows:
        if not is_pending(row):
            keep_rows.append(row)
            continue
        key = (row.get("query_id"), row.get("chunk_id"))
        con = consensus.get(key, {})
        route, rationale = route_for(row, con, args.cascade)
        labels = sorted(
            {
                numeric(info.get("label"))
                for info in judge_details(con).values()
                if numeric(info.get("label")) is not None
            }
        )
        suggestion = con.get("consensus_label")
        routed_item = {
            "gold_row": row,
            "consensus_row": con,
            "route": route,
            "rationale": rationale,
            "distinct_labels": labels,
            "suggested_label": suggestion,
        }
        routed.append(routed_item)
        if route == "discard-fm14":
            discard_rows.append(row)
        else:
            if route == "cascade-opus":
                row = {
                    **row,
                    "notes": f"PENDING_CASCADE: suggested_label={suggestion}; {rationale}",
                }
            keep_rows.append(row)

    counts = Counter(item["route"] for item in routed)
    lines = [
        f"# Pending-RT Routing - {gold_path.parent}",
        "",
        f"Total pending: {len(routed)}",
        "Routes:",
        f"- cascade-opus: {counts.get('cascade-opus', 0)}",
        f"- discard-fm14: {counts.get('discard-fm14', 0)}",
        f"- etan-adjudicate: {counts.get('etan-adjudicate', 0)}",
        "",
        "## Per-row",
        "",
        "| qid | chunk_id | distinct_labels | route | rationale |",
        "|---:|---|---|---|---|",
    ]
    for item in routed:
        row = item["gold_row"]
        labels = ",".join(str(label) for label in item["distinct_labels"]) or "-"
        lines.append(
            f"| {row['query_id']} | `{row['chunk_id']}` | {labels} | "
            f"{item['route']} | {item['rationale']} |"
        )
    if discard_rows:
        lines.extend(["", "## Discarded - FM14", ""])
        for row in discard_rows:
            lines.append(f"- qid={row['query_id']} chunk_id=`{row['chunk_id']}`")
    lines.append("")

    if not args.dry_run:
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text("\n".join(lines))
        write_queues(gold_path, routed, args.dry_run)
        if discard_rows:
            write_jsonl_atomic(gold_path, keep_rows)
    print(
        "route-pending-rt.py: "
        f"pending={len(routed)} cascade={counts.get('cascade-opus', 0)} "
        f"etan={counts.get('etan-adjudicate', 0)} discard={counts.get('discard-fm14', 0)} "
        f"output={out}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
