#!/usr/bin/env python3
"""Compute weighted Cohen kappa across agada-bench judge outputs."""
import argparse
import itertools
import json
import random
import statistics
import sys
from pathlib import Path


LABELS = [0, 1, 2, 3]


def fail(message, code=1):
    print(f"kappa-matrix.py: ERROR {message}", file=sys.stderr)
    return code


def numeric(label):
    if isinstance(label, int) and label in LABELS:
        return label
    if isinstance(label, str):
        if label.isdigit() and int(label) in LABELS:
            return int(label)
        if label.lower() in {"cant-tell", "can't tell", "cant_tell"}:
            return None
    return None


def load_corpus(path):
    pairs = set()
    with path.open() as f:
        for line in f:
            if line.strip():
                row = json.loads(line)
                pairs.add((row["query_id"], row["chunk_id"]))
    return pairs


def load_judge(path, corpus_pairs):
    rows = {}
    with path.open() as f:
        for line in f:
            if not line.strip():
                continue
            row = json.loads(line)
            key = (row.get("query_id"), row.get("chunk_id"))
            if corpus_pairs is not None and key not in corpus_pairs:
                continue
            rows[key] = numeric(row.get("label"))
    return rows


def weight(i, j, mode):
    if mode == "none":
        return 1.0 if i == j else 0.0
    power = 2 if mode == "quadratic" else 1
    return 1.0 - (abs(i - j) / (len(LABELS) - 1)) ** power


def weighted_kappa(a_vals, b_vals, mode):
    n = len(a_vals)
    if n == 0:
        return None
    obs = 0.0
    row_counts = {label: 0 for label in LABELS}
    col_counts = {label: 0 for label in LABELS}
    for a, b in zip(a_vals, b_vals):
        obs += weight(a, b, mode)
        row_counts[a] += 1
        col_counts[b] += 1
    p_obs = obs / n
    p_exp = 0.0
    for i in LABELS:
        for j in LABELS:
            p_exp += weight(i, j, mode) * row_counts[i] * col_counts[j] / (n * n)
    if abs(1 - p_exp) < 1e-12:
        return 1.0 if abs(p_obs - p_exp) < 1e-12 else 0.0
    return (p_obs - p_exp) / (1 - p_exp)


def percentile(values, pct):
    if not values:
        return None
    ordered = sorted(values)
    idx = (len(ordered) - 1) * pct
    lo = int(idx)
    hi = min(lo + 1, len(ordered) - 1)
    frac = idx - lo
    return ordered[lo] * (1 - frac) + ordered[hi] * frac


def bootstrap_ci(pairs, iters, mode):
    if not pairs:
        return None, None
    rng = random.Random(1337)
    kappas = []
    for _ in range(iters):
        sample = [pairs[rng.randrange(len(pairs))] for _ in pairs]
        a_vals = [a for a, _ in sample]
        b_vals = [b for _, b in sample]
        val = weighted_kappa(a_vals, b_vals, mode)
        if val is not None:
            kappas.append(val)
    return percentile(kappas, 0.025), percentile(kappas, 0.975)


def strength(kappa):
    if kappa is None:
        return "insufficient"
    if kappa <= 0.20:
        return "Slight"
    if kappa <= 0.40:
        return "Fair"
    if kappa <= 0.60:
        return "Moderate"
    if kappa <= 0.80:
        return "Substantial"
    return "Almost perfect"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--from-phase1", required=True)
    parser.add_argument("--judges", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--bootstrap-iters", type=int, default=1000)
    parser.add_argument("--weights", choices=["linear", "quadratic", "none"], default="linear")
    parser.add_argument("--corpus")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    phase1 = Path(args.from_phase1).expanduser()
    out = Path(args.out).expanduser()
    judges = [j.strip() for j in args.judges.split(",") if j.strip()]
    if len(judges) < 2:
        return fail("at least two judges required", 2)
    corpus_pairs = None
    if args.corpus:
        try:
            corpus_pairs = load_corpus(Path(args.corpus).expanduser())
        except (OSError, json.JSONDecodeError, KeyError) as exc:
            return fail(f"cannot read corpus: {exc}")

    data = {}
    for judge in judges:
        path = phase1 / f"{judge}.jsonl"
        if not path.exists():
            return fail(f"missing judge file: {path}", 1)
        try:
            data[judge] = load_judge(path, corpus_pairs)
        except (OSError, json.JSONDecodeError) as exc:
            return fail(f"cannot read {path}: {exc}", 1)
        if not data[judge]:
            return fail(f"{judge} has zero aligned rows", 2)

    pair_results = []
    for a, b in itertools.combinations(judges, 2):
        common = sorted(set(data[a]) & set(data[b]))
        values = [
            (data[a][key], data[b][key])
            for key in common
            if data[a][key] is not None and data[b][key] is not None
        ]
        if not values:
            return fail(f"insufficient numeric overlap for {a} x {b}", 2)
        a_vals = [x for x, _ in values]
        b_vals = [y for _, y in values]
        kappa = weighted_kappa(a_vals, b_vals, args.weights)
        lo, hi = bootstrap_ci(values, args.bootstrap_iters, args.weights)
        pair_results.append(
            {"a": a, "b": b, "n": len(values), "kappa": kappa, "lo": lo, "hi": hi}
        )

    by_judge = {judge: [] for judge in judges}
    for result in pair_results:
        by_judge[result["a"]].append(result["kappa"])
        by_judge[result["b"]].append(result["kappa"])
    mean_by_judge = {
        judge: statistics.mean(vals) if vals else 0.0 for judge, vals in by_judge.items()
    }
    highest = max(pair_results, key=lambda r: r["kappa"])
    drop = (
        highest["a"]
        if mean_by_judge[highest["a"]] >= mean_by_judge[highest["b"]]
        else highest["b"]
    )

    lines = [
        f"# Cohen kappa Matrix - {phase1}/",
        "",
        f"Bootstrap iters: {args.bootstrap_iters}, 95% CI shown in brackets.",
        f"Mode: weighted ({args.weights}) Cohen kappa.",
        "",
        "## Pairwise kappa",
        "",
        "| Pair | n | kappa | 95% CI | Strength |",
        "|---|---:|---:|---|---|",
    ]
    for r in pair_results:
        marker = " REDUNDANT" if r["kappa"] > 0.80 else ""
        lines.append(
            f"| {r['a']} x {r['b']} | {r['n']} | {r['kappa']:.3f} | "
            f"[{r['lo']:.3f}, {r['hi']:.3f}] | {strength(r['kappa'])}{marker} |"
        )
    lines.extend(
        [
            "",
            "## Per-judge mean kappa",
            "",
            "| Judge | Mean kappa | Independence rank |",
            "|---|---:|---:|",
        ]
    )
    ranked = sorted(mean_by_judge.items(), key=lambda x: x[1])
    ranks = {judge: idx + 1 for idx, (judge, _) in enumerate(ranked)}
    for judge, mean in sorted(mean_by_judge.items(), key=lambda x: x[1]):
        lines.append(f"| {judge}Judge | {mean:.3f} | #{ranks[judge]} |")
    lines.extend(
        [
            "",
            "## Drop-judge recommendation",
            "",
            f"Drop **{drop}Judge** if this redundancy pattern is sustained. "
            f"Highest pair: {highest['a']} x {highest['b']} = {highest['kappa']:.3f}.",
            "",
        ]
    )

    if args.dry_run:
        print(
            f"kappa-matrix.py: dry_run=true pairs={len(pair_results)} "
            f"drop={drop} output={out}"
        )
        return 0
    try:
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text("\n".join(lines))
    except OSError as exc:
        return fail(str(exc), 1)
    print(
        f"kappa-matrix.py: pairs={len(pair_results)} drop={drop} "
        f"mean_kappa={statistics.mean([r['kappa'] for r in pair_results]):.3f} output={out}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
