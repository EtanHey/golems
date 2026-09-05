#!/usr/bin/env python3
"""
agada-bench primary driver — score live BrainLayer recall against the standing gold corpus.

Two subcommands:

  prepare  — load gold.jsonl + phase-0b-corpus/corpus.jsonl from N domains,
             reconstruct verbatim brain_search args per qid (Wave-0 #2),
             emit unified queries.jsonl that the operator's Claude/Codex session uses
             to drive live brain_search calls.

  score    — read bench-results.jsonl (filled in by the operator's session after live
             brain_search), compute recall@K / MRR / precision@5 / placebo rate /
             regression diff vs --baseline; emit a markdown audit doc using
             ≤2KB chunked-write segments + append-mode (Wave-0 #1) for robustness on
             long output.

Wave-0 known patterns baked in:
  #1 CHUNKED-WRITE: any output > 2KB is split + appended segment-by-segment.
  #2 QUERY RECONSTRUCTION: prepare reads phase-0b-corpus/corpus.jsonl per domain
     (gold.jsonl alone does NOT carry verbatim brain_search args).
  #3 RUN 4 LOW-POWER: Run 4 has only 1 L2+L3 pair; flagged + excluded from
     cross-domain aggregates by default. Pass --include-low-power to override.

v1 limitation: this script does NOT call brain_search itself (Python can't reach the
MCP). It plans the bench and scores the results. The live brain_search calls happen
in a Claude/Codex session reading workflows/run-bench.md.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path


CHUNK_SIZE_BYTES = 2048  # Wave-0 #1: write at most 2KB per append
LOW_POWER_THRESHOLD = 5  # L2+L3 < this → flag as LOW-POWER


def fail(message: str, code: int = 1) -> int:
    print(f"run-bench.py: ERROR {message}", file=sys.stderr)
    return code


def load_jsonl(path: Path) -> list[dict]:
    rows = []
    with path.open() as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def append_chunked(out_path: Path, text: str) -> None:
    """Wave-0 #1: append the text to out_path in ≤CHUNK_SIZE_BYTES segments."""
    data = text.encode("utf-8")
    with out_path.open("ab") as f:
        for i in range(0, len(data), CHUNK_SIZE_BYTES):
            f.write(data[i : i + CHUNK_SIZE_BYTES])
            f.flush()


def reconstruct_queries(corpus_rows: list[dict]) -> dict[int, dict]:
    """Wave-0 #2: index unique queries by qid from a domain's corpus.jsonl."""
    index: dict[int, dict] = {}
    for row in corpus_rows:
        qid = row.get("query_id")
        if qid is None:
            continue
        if qid in index:
            continue
        index[qid] = {
            "query_id": qid,
            "query_text": row.get("query_text"),
            "query_filters": row.get("query_filters") or {},
            "query_intent_hint": row.get("query_intent_hint"),
        }
    return index


def gold_label_density(gold_rows: list[dict]) -> dict:
    labels = Counter(r.get("gold_label") for r in gold_rows)
    return {
        "rows": len(gold_rows),
        "label_distribution": dict(labels),
        "l2_l3_count": labels.get(2, 0) + labels.get(3, 0),
    }


def cmd_prepare(args: argparse.Namespace) -> int:
    if not args.gold_paths:
        return fail("--gold no paths provided")
    out_path = Path(args.output).expanduser()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    # Truncate before append-chunked writes.
    out_path.write_text("")

    metadata = {
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "domains": [],
        "total_queries": 0,
        "total_gold_pairs": 0,
        "total_l2_l3": 0,
        "low_power_domains": [],
    }

    bundles: list[dict] = []
    for spec in args.gold_paths:
        if ":" in spec:
            domain, gold_str = spec.split(":", 1)
        else:
            return fail(f"--gold expects <domain>:<gold_path>, got {spec!r}")
        gold_path = Path(gold_str).expanduser()
        if not gold_path.exists():
            return fail(f"gold path missing: {gold_path}")
        corpus_path = gold_path.parent.parent / "phase-0b-corpus" / "corpus.jsonl"
        if not corpus_path.exists():
            return fail(
                f"corpus path missing (need for QUERY RECONSTRUCTION per W0 #2): {corpus_path}"
            )

        gold_rows = load_jsonl(gold_path)
        corpus_rows = load_jsonl(corpus_path)
        queries = reconstruct_queries(corpus_rows)
        density = gold_label_density(gold_rows)
        low_power = density["l2_l3_count"] < LOW_POWER_THRESHOLD

        if low_power:
            metadata["low_power_domains"].append(domain)
        metadata["total_queries"] += len(queries)
        metadata["total_gold_pairs"] += len(gold_rows)
        metadata["total_l2_l3"] += density["l2_l3_count"]
        metadata["domains"].append(
            {
                "domain": domain,
                "gold_path": str(gold_path),
                "corpus_path": str(corpus_path),
                "queries": len(queries),
                "gold_rows": density["rows"],
                "l2_l3_count": density["l2_l3_count"],
                "label_distribution": density["label_distribution"],
                "low_power": low_power,
            }
        )

        # Build (qid, chunk_id) → gold_label index for the writer below.
        gold_index = {
            (r["query_id"], r["chunk_id"]): r.get("gold_label") for r in gold_rows
        }
        bundles.append(
            {
                "domain": domain,
                "queries": queries,
                "gold_index": gold_index,
                "low_power": low_power,
            }
        )

    # Emit one row per (domain, query) bench task.
    payload_lines: list[str] = []
    payload_lines.append(json.dumps({"_meta": metadata}, ensure_ascii=False))
    for bundle in bundles:
        for qid in sorted(bundle["queries"]):
            q = bundle["queries"][qid]
            expected = [
                {"chunk_id": cid, "gold_label": lbl}
                for (q_id, cid), lbl in bundle["gold_index"].items()
                if q_id == qid
            ]
            payload_lines.append(
                json.dumps(
                    {
                        "domain": bundle["domain"],
                        "query_id": qid,
                        "query_text": q["query_text"],
                        "query_filters": q["query_filters"],
                        "query_intent_hint": q["query_intent_hint"],
                        "expected_gold": expected,
                        "low_power_domain": bundle["low_power"],
                    },
                    ensure_ascii=False,
                )
            )
    append_chunked(out_path, "\n".join(payload_lines) + "\n")

    if args.print_meta:
        print(json.dumps(metadata, ensure_ascii=False, indent=2))
    print(
        "run-bench.py prepare: "
        f"domains={len(bundles)} queries={metadata['total_queries']} "
        f"gold_pairs={metadata['total_gold_pairs']} l2_l3={metadata['total_l2_l3']} "
        f"low_power={metadata['low_power_domains']} output={out_path}"
    )
    return 0


def numeric_label(value) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.isdigit():
        return int(value)
    return None


def classify_provenance(hit: dict) -> str:
    """Return one of: true_hit, echo_fm11, downstream, uncertain, metadata_gap."""
    explicit = hit.get("provenance")
    if explicit in ("true_hit", "echo_fm11", "downstream", "uncertain", "metadata_gap"):
        return explicit
    # Fallback heuristic: missing both timestamps → metadata_gap.
    if not hit.get("chunk_created_iso") and not hit.get("source_session_id"):
        return "metadata_gap"
    return "uncertain"


def compute_recall(results_for_query: list[dict], gold_expected: list[dict], k_values: list[int]) -> dict:
    expected_relevant = {
        row["chunk_id"]
        for row in gold_expected
        if (numeric_label(row.get("gold_label")) or 0) >= 2
    }
    sorted_hits = sorted(
        results_for_query, key=lambda h: h.get("position", math.inf)
    )

    out: dict = {}
    for k in k_values:
        top = sorted_hits[:k]
        true_relevant = {
            h.get("chunk_id")
            for h in top
            if classify_provenance(h) == "true_hit"
            and h.get("chunk_id") in expected_relevant
        }
        inflated_relevant = {
            h.get("chunk_id") for h in top if h.get("chunk_id") in expected_relevant
        }
        out[f"recall@{k}_true"] = (
            len(true_relevant) / max(len(expected_relevant), 1)
        )
        out[f"recall@{k}_inflated"] = (
            len(inflated_relevant) / max(len(expected_relevant), 1)
        )

    first_true_rank = None
    for h in sorted_hits:
        if (
            classify_provenance(h) == "true_hit"
            and h.get("chunk_id") in expected_relevant
        ):
            first_true_rank = h.get("position")
            break
    out["mrr_true"] = (1.0 / first_true_rank) if first_true_rank else 0.0

    top5 = sorted_hits[:5]
    precision_numerator = sum(
        1
        for h in top5
        if classify_provenance(h) == "true_hit"
        and h.get("chunk_id") in expected_relevant
    )
    out["precision@5"] = precision_numerator / max(len(top5), 1)

    provenance_counts = Counter(classify_provenance(h) for h in sorted_hits)
    total = sum(provenance_counts.values()) or 1
    out["placebo_rate"] = (
        provenance_counts.get("echo_fm11", 0) + provenance_counts.get("downstream", 0)
    ) / total
    out["provenance_counts"] = dict(provenance_counts)
    out["expected_relevant_count"] = len(expected_relevant)
    return out


def aggregate(per_query: list[dict], k_values: list[int]) -> dict:
    if not per_query:
        return {"queries": 0}
    out: dict = {"queries": len(per_query)}
    for k in k_values:
        for variant in ("true", "inflated"):
            key = f"recall@{k}_{variant}"
            vals = [q["scores"][key] for q in per_query if key in q["scores"]]
            out[key] = sum(vals) / len(vals) if vals else 0.0
    mrrs = [q["scores"]["mrr_true"] for q in per_query if "mrr_true" in q["scores"]]
    out["mrr_true"] = sum(mrrs) / len(mrrs) if mrrs else 0.0
    precs = [q["scores"]["precision@5"] for q in per_query if "precision@5" in q["scores"]]
    out["precision@5"] = sum(precs) / len(precs) if precs else 0.0
    placebos = [q["scores"]["placebo_rate"] for q in per_query if "placebo_rate" in q["scores"]]
    out["placebo_rate"] = sum(placebos) / len(placebos) if placebos else 0.0
    return out


def cmd_score(args: argparse.Namespace) -> int:
    queries_path = Path(args.queries).expanduser()
    results_path = Path(args.results).expanduser()
    out_path = Path(args.output).expanduser()
    if not queries_path.exists():
        return fail(f"--queries missing: {queries_path}")
    if not results_path.exists():
        return fail(f"--results missing: {results_path}")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text("")  # truncate before chunked appends

    queries_rows = load_jsonl(queries_path)
    meta = next((r["_meta"] for r in queries_rows if "_meta" in r), {})
    queries = [r for r in queries_rows if "_meta" not in r]
    results = load_jsonl(results_path)

    by_query: dict[tuple, dict] = {(r["domain"], r["query_id"]): r for r in queries}
    hits_by_query: dict[tuple, list[dict]] = defaultdict(list)
    for h in results:
        key = (h.get("domain"), h.get("query_id"))
        hits_by_query[key].append(h)

    k_values = [int(k) for k in args.k.split(",") if k.strip()]
    per_query: list[dict] = []
    for key, q in by_query.items():
        scores = compute_recall(hits_by_query.get(key, []), q.get("expected_gold", []), k_values)
        per_query.append(
            {"domain": q["domain"], "query_id": q["query_id"], "low_power": q.get("low_power_domain"), "scores": scores}
        )

    by_domain: dict[str, list[dict]] = defaultdict(list)
    for row in per_query:
        by_domain[row["domain"]].append(row)
    domain_agg = {d: aggregate(rows, k_values) for d, rows in by_domain.items()}
    overall = aggregate(
        [r for r in per_query if args.include_low_power or not r["low_power"]],
        k_values,
    )

    baseline_diff = None
    if args.baseline:
        baseline_path = Path(args.baseline).expanduser()
        if baseline_path.exists():
            baseline = json.loads(baseline_path.read_text())
            baseline_diff = {
                k: overall.get(k, 0) - baseline.get("overall", {}).get(k, 0)
                for k in overall
                if isinstance(overall.get(k), (int, float))
            }
        else:
            print(f"WARN: --baseline path missing: {baseline_path}", file=sys.stderr)

    # Markdown report — chunked-append per Wave-0 #1.
    sections: list[str] = []
    sections.append(f"# BrainLayer Quality Bench — {meta.get('generated_at', 'unknown')}\n\n")
    sections.append(
        f"Source meta: queries={meta.get('total_queries')} gold_pairs={meta.get('total_gold_pairs')} "
        f"l2_l3={meta.get('total_l2_l3')} low_power_domains={meta.get('low_power_domains', [])}\n\n"
    )
    sections.append("## Overall (excluding LOW-POWER unless --include-low-power)\n\n")
    sections.append(
        "| Metric | Value |\n|---|---:|\n"
        + "".join(
            f"| {k} | {v:.4f} |\n" if isinstance(v, float) else f"| {k} | {v} |\n"
            for k, v in overall.items()
        )
        + "\n"
    )
    if baseline_diff:
        sections.append("## Regression diff vs baseline\n\n")
        sections.append(
            "| Metric | Δ |\n|---|---:|\n"
            + "".join(f"| {k} | {v:+.4f} |\n" for k, v in baseline_diff.items())
            + "\n"
        )
    sections.append("## Per-domain breakdown\n\n")
    for d, agg in domain_agg.items():
        low = " (LOW-POWER)" if d in (meta.get("low_power_domains") or []) else ""
        sections.append(f"### Domain: {d}{low}\n\n")
        sections.append(
            "| Metric | Value |\n|---|---:|\n"
            + "".join(
                f"| {k} | {v:.4f} |\n" if isinstance(v, float) else f"| {k} | {v} |\n"
                for k, v in agg.items()
            )
            + "\n"
        )
    sections.append("## Per-query detail\n\n")
    sections.append(
        "| Domain | qid | recall@5_true | recall@5_inflated | MRR_true | precision@5 | placebo |\n"
        + "|---|---:|---:|---:|---:|---:|---:|\n"
    )
    for row in sorted(per_query, key=lambda r: (r["domain"], r["query_id"])):
        s = row["scores"]
        sections.append(
            f"| {row['domain']} | {row['query_id']} | "
            f"{s.get('recall@5_true', 0):.3f} | {s.get('recall@5_inflated', 0):.3f} | "
            f"{s.get('mrr_true', 0):.3f} | {s.get('precision@5', 0):.3f} | "
            f"{s.get('placebo_rate', 0):.3f} |\n"
        )
    sections.append("\n")
    for chunk in sections:
        append_chunked(out_path, chunk)

    summary_json = {
        "overall": overall,
        "by_domain": domain_agg,
        "baseline_diff": baseline_diff,
        "meta": meta,
        "k_values": k_values,
        "include_low_power": bool(args.include_low_power),
    }
    if args.json_out:
        json_path = Path(args.json_out).expanduser()
        json_path.parent.mkdir(parents=True, exist_ok=True)
        json_path.write_text(json.dumps(summary_json, ensure_ascii=False, indent=2))
    print(
        "run-bench.py score: "
        f"queries={len(queries)} hits={len(results)} "
        f"overall_recall@5_true={overall.get('recall@5_true', 0):.3f} "
        f"placebo_rate={overall.get('placebo_rate', 0):.3f} "
        f"output={out_path}"
    )
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_prep = sub.add_parser("prepare", help="Plan the bench from N domains' gold + corpus")
    p_prep.add_argument(
        "--gold",
        dest="gold_paths",
        action="append",
        required=True,
        help="domain:path/to/gold.jsonl — repeat for each domain",
    )
    p_prep.add_argument("--output", default="bench-queries.jsonl")
    p_prep.add_argument("--print-meta", action="store_true")
    p_prep.set_defaults(func=cmd_prepare)

    p_score = sub.add_parser("score", help="Score live brain_search results vs gold")
    p_score.add_argument("--queries", required=True, help="bench-queries.jsonl from prepare")
    p_score.add_argument("--results", required=True, help="bench-results.jsonl filled in by operator")
    p_score.add_argument("--output", required=True, help="markdown audit doc")
    p_score.add_argument("--json-out", help="optional: write summary JSON")
    p_score.add_argument("--baseline", help="prior summary JSON for regression diff")
    p_score.add_argument("--k", default="1,3,5,10,20,50", help="comma-separated K values")
    p_score.add_argument(
        "--include-low-power",
        action="store_true",
        help="Include LOW-POWER domains (e.g. Run 4 with L2+L3=1) in overall aggregates",
    )
    p_score.set_defaults(func=cmd_score)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
