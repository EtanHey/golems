#!/usr/bin/env python3
"""Derive agada-bench gold labels from judge JSONLs and optional red-team votes."""
import argparse
import json
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path


def fail(message, code=1):
    print(f"build-gold.py: ERROR {message}", file=sys.stderr)
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


def load_jsonl(path):
    rows = []
    with path.open() as f:
        for line in f:
            if line.strip():
                rows.append(json.loads(line))
    return rows


def load_corpus(path):
    pairs = set()
    meta = {}
    for row in load_jsonl(path):
        key = (row["query_id"], row["chunk_id"])
        pairs.add(key)
        meta[key] = row
    return pairs, meta


def load_grades(judge_dir, judges, corpus_pairs):
    grades = {judge: {} for judge in judges}
    off = defaultdict(list)
    for judge in judges:
        path = judge_dir / f"{judge}.jsonl"
        if not path.exists():
            continue
        for row in load_jsonl(path):
            key = (row.get("query_id"), row.get("chunk_id"))
            if key in corpus_pairs:
                grades[judge][key] = row
            else:
                off[judge].append(row)
    return grades, off


def detect_hard_pairs(corpus_pairs, grades, judges):
    hard = set()
    for key in corpus_pairs:
        nums = []
        for judge in judges:
            row = grades[judge].get(key)
            if row:
                value = numeric(row.get("label"))
                if value is not None:
                    nums.append(value)
        if nums and max(nums) - min(nums) >= 2:
            hard.add(key)
    return hard


def load_hard_pairs(path):
    data = json.loads(path.read_text())
    pairs = set()
    for item in data:
        if isinstance(item, dict):
            pairs.add((item["query_id"], item["chunk_id"]))
        elif isinstance(item, list) and len(item) == 2:
            pairs.add((item[0], item[1]))
    return pairs


def load_red_team_votes(gold_dir):
    votes = defaultdict(dict)
    files = sorted(gold_dir.glob("red-team-*.jsonl"))
    for path in files:
        judge = path.stem.replace("red-team-", "").replace("-resolutions", "")
        for row in load_jsonl(path):
            key = (row.get("query_id"), row.get("chunk_id"))
            label = row.get("red_team_label", row.get("label"))
            votes[key][judge] = {**row, "resolved_label": numeric(label)}
    return votes, files


def load_consensus_rows(path):
    if not path.exists():
        return {}
    rows = {}
    for row in load_jsonl(path):
        rows[(row.get("query_id"), row.get("chunk_id"))] = row
    return rows


def fm_union(rows):
    out = set()
    for row in rows:
        if not row:
            continue
        for fm in row.get("failure_modes_observed") or []:
            out.add(fm)
    return sorted(out)


def avg_conf(rows):
    confs = [
        row.get("confidence_0_100")
        for row in rows
        if row and isinstance(row.get("confidence_0_100"), (int, float))
    ]
    return round(sum(confs) / len(confs), 1) if confs else None


def label_map_for_pair(key, grades, judges):
    labels = {}
    for judge in judges:
        row = grades.get(judge, {}).get(key)
        if row:
            labels[judge] = numeric(row.get("label"))
    return labels


def confidence_for_label(key, grades, labels, gold_label):
    rows = []
    for judge, label in labels.items():
        if label == gold_label:
            row = grades.get(judge, {}).get(key)
            if row:
                rows.append(row)
    return avg_conf(rows)


def resolve_pair(key, grades, judges, tiebreaker, hard_pairs, red_team_votes):
    present = {judge: grades[judge].get(key) for judge in judges if grades[judge].get(key)}
    labels = {judge: numeric(row.get("label")) for judge, row in present.items()}
    numerics = [value for value in labels.values() if value is not None]
    valid_judges = [judge for judge, value in labels.items() if value is not None]
    missing = [judge for judge in judges if judge not in present]
    rows = list(present.values())
    fms = fm_union(rows)
    confidence = avg_conf(rows)

    if key in hard_pairs:
        votes = red_team_votes.get(key, {})
        counts = Counter(vote["resolved_label"] for vote in votes.values() if vote["resolved_label"] is not None)
        if not counts:
            return None, "pending-rt", valid_judges, missing, confidence, fms, "Spread >=2; red-team/cascade unresolved."
        max_count = max(counts.values())
        winners = [label for label, count in counts.items() if count == max_count]
        if len(winners) == 1:
            return winners[0], "red-team-majority", list(votes), missing, confidence, fms, f"Red-team votes: {dict(counts)}"
        tb = votes.get(tiebreaker)
        if tb and tb["resolved_label"] is not None:
            return tb["resolved_label"], f"red-team-tiebreak-{tiebreaker}Judge", list(votes), missing, confidence, fms, f"Red-team tie: {dict(counts)}"
        return None, "red-team-pending", list(votes), missing, confidence, fms, f"Red-team tie unresolved: {dict(counts)}"

    if not numerics:
        return None, "all-cant-tell-or-empty", valid_judges, missing, confidence, fms, "All judges abstained or no grades available."
    counts = Counter(numerics)
    if len(counts) == 1:
        label = numerics[0]
        return label, f"unanimous-{len(valid_judges)}", valid_judges, missing, confidence, fms, None
    max_count = max(counts.values())
    winners = [label for label, count in counts.items() if count == max_count]
    if len(winners) == 1:
        label = winners[0]
        agreeing = [judge for judge, value in labels.items() if value == label]
        return label, f"majority-{max_count}of{len(valid_judges)}", agreeing, missing, confidence, fms, None
    tb_label = labels.get(tiebreaker)
    if tb_label is not None:
        return tb_label, f"tiebreak-{tiebreaker}Judge", valid_judges, missing, confidence, fms, f"Tie {dict(counts)}; {tiebreaker}Judge breaks."
    return None, "tie-no-claude", valid_judges, missing, confidence, fms, f"Tie {dict(counts)} and tiebreaker missing."


def resolve_split_pair(key, grades, primary_judges, shadow_judge, tiebreaker, consensus_rows, red_team_votes):
    consensus = consensus_rows.get(key, {})
    if consensus.get("primary_labels"):
        primary_labels = {
            judge: numeric(label)
            for judge, label in (consensus.get("primary_labels") or {}).items()
        }
    else:
        primary_labels = label_map_for_pair(key, grades, primary_judges)
    primary_labels = {
        judge: label for judge, label in primary_labels.items() if label is not None
    }

    if shadow_judge:
        if consensus.get("shadow_label") is not None:
            raw_shadow = consensus.get("shadow_label") or {}
            shadow_label = {
                judge: numeric(label)
                for judge, label in raw_shadow.items()
                if numeric(label) is not None
            }
        else:
            row = grades.get(shadow_judge, {}).get(key)
            value = numeric(row.get("label")) if row else None
            shadow_label = {shadow_judge: value} if value is not None else {}
    else:
        shadow_label = None

    primary_nums = [value for value in primary_labels.values() if value is not None]
    method = None
    gold = None
    notes = []
    if not primary_nums:
        method = "all-cant-tell"
        gold = "cant-tell"
    else:
        counts = Counter(primary_nums)
        top_label, top_count = counts.most_common(1)[0]
        spread = max(primary_nums) - min(primary_nums)
        if top_count == len(primary_judges) and len(primary_nums) == len(primary_judges):
            method = "unanimous-3-primary"
            gold = top_label
        elif spread >= 2:
            votes = red_team_votes.get(key, {})
            vote_counts = Counter(
                vote["resolved_label"]
                for vote in votes.values()
                if vote.get("resolved_label") is not None
            )
            if vote_counts:
                max_count = max(vote_counts.values())
                winners = [label for label, count in vote_counts.items() if count == max_count]
                if len(winners) == 1:
                    method = "red-team-majority"
                    gold = winners[0]
                elif votes.get(tiebreaker, {}).get("resolved_label") is not None:
                    method = f"red-team-tiebreak-{tiebreaker}Judge"
                    gold = votes[tiebreaker]["resolved_label"]
                else:
                    method = "pending-red-team"
                    gold = top_label
                    notes.append(f"red-team tie unresolved: {dict(vote_counts)}")
            else:
                method = "pending-red-team"
                gold = top_label
                notes.append("primary spread >= 2; red-team resolution missing - provisional gold = majority label")
        elif top_count == 2:
            method = "majority-2-primary"
            gold = top_label
        else:
            tb_label = primary_labels.get(tiebreaker)
            if tb_label is not None:
                method = f"tiebreak-{tiebreaker}Judge-primary"
                gold = tb_label
                notes.append(f"primary split {dict(counts)}; {tiebreaker}Judge breaks")
            else:
                method = "pending-red-team"
                gold = top_label
                notes.append(f"primary split {dict(counts)} and tiebreaker missing")

    conf = consensus.get("avg_confidence")
    if conf is None:
        conf = confidence_for_label(key, grades, primary_labels, gold)
    fms = consensus.get("failure_modes_union")
    if fms is None:
        involved_rows = [grades.get(judge, {}).get(key) for judge in primary_judges]
        if shadow_judge:
            involved_rows.append(grades.get(shadow_judge, {}).get(key))
        fms = fm_union(involved_rows)
    return {
        "gold_label": gold,
        "method": method,
        "primary_labels": primary_labels,
        "shadow_label": shadow_label,
        "confidence_avg": conf,
        "failure_modes_union": sorted(fms),
        "notes": "; ".join(notes) or None,
    }


def write_outputs(gold_path, adj_path, fm_path, rows, unresolved, method_counts, off_rows, red_team_files, dry_run, schema):
    if dry_run:
        return
    with gold_path.open("w") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    lines = [
        "# Phase 3 Adjudication Log - agada-bench",
        "",
        f"> Generated: {now} via build-gold.py",
        "",
        "## Top-line",
        "",
        f"- Corpus pairs to label: {len(rows)}",
        f"- Gold rows written: {len(rows)}",
        f"- Unresolved: {len(unresolved)}",
        f"- Red-team files discovered: {len(red_team_files)}",
        "",
        "## Resolution method distribution",
        "",
        "| Method | Count |",
        "|---|---:|",
    ]
    for method, count in method_counts.most_common():
        lines.append(f"| `{method}` | {count} |")
    if unresolved:
        lines.extend(["", "## Unresolved pairs", ""])
        for row in unresolved:
            method_key = "resolution_method" if "resolution_method" in row else "method"
            lines.append(
                f"- qid={row['query_id']}, chunk_id=`{row['chunk_id']}` - "
                f"{row[method_key]}: {row.get('notes')}"
            )
    if any(off_rows.values()):
        lines.extend(["", "## Judge integrity - off-corpus rows", ""])
        for judge, off in off_rows.items():
            lines.append(f"- {judge}Judge: {len(off)} off-corpus rows discarded from consensus")
    lines.append("")
    adj_path.write_text("\n".join(lines))

    fm_freq = Counter()
    for row in rows:
        for fm in row.get("failure_modes_union") or []:
            fm_freq[fm] += 1
    fm_lines = [
        "# Phase 3 FM Frequency Table - Final Gold",
        "",
        "| FM tag | Pairs with tag | % of corpus |",
        "|---|---:|---:|",
    ]
    total = len(rows)
    for fm, count in fm_freq.most_common():
        pct = round(100 * count / total, 1) if total else 0
        fm_lines.append(f"| `{fm}` | {count} | {pct}% |")
    if not fm_freq:
        fm_lines.append("| _(none)_ | 0 | 0% |")
    fm_lines.append("")
    fm_path.write_text("\n".join(fm_lines))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-dir", required=True)
    parser.add_argument("--judges", required=True)
    parser.add_argument("--tiebreaker", default="claude")
    parser.add_argument("--hard-pairs")
    parser.add_argument("--schema", choices=["v1", "v1.1-3p", "v1.1-3p-1s"], default="v1.1-3p")
    parser.add_argument("--primary-judges")
    parser.add_argument("--shadow-judge")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    run_dir = Path(args.run_dir).expanduser()
    judges = [j.strip() for j in args.judges.split(",") if j.strip()]
    if not judges:
        return fail("--judges resolved to empty")
    primary_judges = (
        [j.strip() for j in args.primary_judges.split(",") if j.strip()]
        if args.primary_judges
        else judges
    )
    shadow_judge = args.shadow_judge.strip() if args.shadow_judge else None
    if args.schema.startswith("v1.1"):
        if len(primary_judges) != 3:
            return fail(f"{args.schema} requires exactly 3 primary judges", 1)
        missing_primary = [judge for judge in primary_judges if judge not in judges]
        if missing_primary:
            return fail(f"--primary-judges not present in --judges: {','.join(missing_primary)}", 1)
    if args.schema == "v1.1-3p-1s":
        if not shadow_judge:
            return fail("--shadow-judge is required for --schema v1.1-3p-1s", 1)
        if shadow_judge not in judges:
            return fail("--shadow-judge must be present in --judges", 1)
    if args.schema == "v1.1-3p" and shadow_judge:
        return fail("--shadow-judge is only valid with --schema v1.1-3p-1s", 1)
    corpus_path = run_dir / "phase-0b-corpus" / "corpus.jsonl"
    judge_dir = run_dir / "phase-1-judgments"
    gold_dir = run_dir / "phase-3-gold"
    consensus_path = run_dir / "phase-2-crossref" / "consensus-draft.jsonl"
    gold_path = gold_dir / "gold.jsonl"
    adj_path = gold_dir / "adjudication-log.md"
    fm_path = gold_dir / "FM-summary.md"
    if not corpus_path.exists():
        return fail(f"missing corpus: {corpus_path}")
    try:
        corpus_pairs, _meta = load_corpus(corpus_path)
        grades, off_rows = load_grades(judge_dir, judges, corpus_pairs)
        hard_pairs = (
            load_hard_pairs(Path(args.hard_pairs).expanduser())
            if args.hard_pairs
            else detect_hard_pairs(corpus_pairs, grades, judges)
        )
        red_team_votes, red_team_files = load_red_team_votes(gold_dir)
        consensus_rows = load_consensus_rows(consensus_path)
    except (OSError, json.JSONDecodeError, KeyError) as exc:
        return fail(str(exc))
    if not args.dry_run:
        gold_dir.mkdir(parents=True, exist_ok=True)
    rows = []
    unresolved = []
    method_counts = Counter()
    for key in sorted(corpus_pairs):
        qid, chunk_id = key
        if args.schema == "v1":
            label, method, agree, missing, conf, fms, notes = resolve_pair(
                key, grades, judges, args.tiebreaker, hard_pairs, red_team_votes
            )
            row = {
                "query_id": qid,
                "chunk_id": chunk_id,
                "gold_label": label,
                "resolution_method": method,
                "judges_in_agreement": agree,
                "judges_missing": missing,
                "avg_confidence": conf,
                "failure_modes_union": fms,
                "notes": notes,
            }
        else:
            resolved = resolve_split_pair(
                key,
                grades,
                primary_judges,
                shadow_judge if args.schema == "v1.1-3p-1s" else None,
                args.tiebreaker,
                consensus_rows,
                red_team_votes,
            )
            row = {
                "query_id": qid,
                "chunk_id": chunk_id,
                "gold_label": resolved["gold_label"],
                "method": resolved["method"],
                "primary_labels": resolved["primary_labels"],
                "confidence_avg": resolved["confidence_avg"],
                "failure_modes_union": resolved["failure_modes_union"],
                "notes": resolved["notes"],
            }
            if args.schema == "v1.1-3p-1s":
                row["shadow_label"] = resolved["shadow_label"] or {}
        rows.append(row)
        method = row.get("resolution_method") or row.get("method")
        method_counts[method] += 1
        if row["gold_label"] is None:
            unresolved.append(row)
    write_outputs(gold_path, adj_path, fm_path, rows, unresolved, method_counts, off_rows, red_team_files, args.dry_run, args.schema)
    print(
        "build-gold.py: "
        f"rows={len(rows)} unresolved={len(unresolved)} hard_pairs={len(hard_pairs)} "
        f"red_team_files={len(red_team_files)} schema={args.schema} output={gold_path}"
    )
    return 2 if unresolved else 0


if __name__ == "__main__":
    sys.exit(main())
