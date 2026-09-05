#!/usr/bin/env python3
"""weave-ledger.py — the weave's action-ledger + conversion-to-change metric.

The weave's defining feature is NOT the fan-out — it is the ledger that makes
token-waste impossible to hide. Every finding a weave produces gets a
*disposition*; this script aggregates per-session findings JSONL into one
ledger and computes the only metric that matters:

    conversion-to-change = (findings that became a real change) / (actionable findings)

A weave with 0% conversion is token-burn dressed up as diligence, and this
script is what surfaces that instead of letting "we produced N nice docs"
masquerade as progress.

Derived from the 2026-05-29 harness `aggregate_ledger.py`, generalized:
  - parameterized --findings-dir / --out-dir (no hardcoded run path)
  - canonical disposition vocabulary + conversion classification
  - enforces "route EVERY finding to a disposition" (flags missing/unreasoned)
  - optional --tokens for cost-per-converted-finding (the worth-it number)

Input: a directory of `*.jsonl` files, one finding object per line:
  {"id","title","detail","evidence","type","track","disposition","importance","recurring"}
  (empty files are valid — a mined session that yielded nothing.)

Usage:
  python3 weave-ledger.py --findings-dir DIR [--out-dir DIR]
                          [--title "Weave Action-Ledger — DATE"]
                          [--tokens N] [--strict]
"""
from __future__ import annotations

import argparse
import collections
import glob
import json
import os
import sys

# Canonical disposition vocabulary. Each maps to a conversion class.
#   converged  = became a real change (counts toward conversion-to-change)
#   open       = dispatched/filed but not yet landed (in flight)
#   dropped    = consciously not pursued — REASON REQUIRED in `detail`/`reason`
#   confirm    = validated good behavior ("what-worked") — not a change, excluded
#                from the conversion denominator (you can't "convert" a confirmation)
DISPOSITION_CLASS = {
    "MERGED-PR": "converged",
    "PR-FILED": "converged",
    "PR-FIX": "converged",
    "SKILL-NEW": "converged",
    "SKILL-EDIT": "converged",
    "DEEP-RESEARCH": "open",
    "FOLLOW-UP": "open",
    "FOLLOW-UP-FILED": "open",
    "REJECTED": "dropped",
    "PARKED": "dropped",
    "DUPLICATE": "dropped",
    "KEEP": "confirm",
}
KNOWN_DISPOSITIONS = sorted(DISPOSITION_CLASS)

# Tracks seed the gen-10 large-plan lanes; "cross-cutting" is the catch-all.
TRACKS = [
    "cmuxLayer", "BrainLayer", "VoiceLayer", "MCL", "MCP-layer",
    "WhatsApp-alert", "skill-creator", "dashboard", "plans", "collab",
    "cross-cutting",
]


def load_findings(find_dir: str):
    rows, malformed, files, empty = [], 0, 0, 0
    for fp in sorted(glob.glob(os.path.join(find_dir, "*.jsonl"))):
        files += 1
        had_content = False
        with open(fp, errors="replace") as fh:
            for ln in fh:
                ln = ln.strip()
                if not ln:
                    continue
                had_content = True
                try:
                    o = json.loads(ln)
                except Exception:
                    malformed += 1
                    continue
                o.setdefault("track", "cross-cutting")
                o.setdefault("disposition", "FOLLOW-UP")
                o.setdefault("importance", 5)
                o.setdefault("type", "unknown")
                o.setdefault("recurring", False)
                o["_src_file"] = os.path.basename(fp)
                rows.append(o)
        if not had_content:
            empty += 1
    return rows, malformed, files, empty


def dedup(rows):
    """Dedup by (track, normalized title first 50 chars); keep highest importance."""
    seen = {}
    for r in rows:
        key = (r.get("track"), (r.get("title", "")[:50]).lower().strip())
        if key not in seen or r.get("importance", 0) > seen[key].get("importance", 0):
            seen[key] = r
    return list(seen.values())


def conversion_class(disp: str) -> str:
    return DISPOSITION_CLASS.get(disp, "open")


def audit_dispositions(findings):
    """Enforce the routing contract: every finding has a known disposition, and
    every DROPPED finding states a reason. Returns a list of violations."""
    violations = []
    for r in findings:
        disp = r.get("disposition")
        if disp not in DISPOSITION_CLASS:
            violations.append(("unknown-disposition", r.get("id", "?"), disp))
        if conversion_class(disp) == "dropped":
            reason = (r.get("reason") or r.get("detail") or "").strip()
            if not reason:
                violations.append(("dropped-without-reason", r.get("id", "?"), disp))
    return violations


def build(find_dir, out_dir, title, tokens, strict):
    rows, malformed, files, empty = load_findings(find_dir)
    findings = dedup(rows)

    by_track = collections.Counter(r["track"] for r in findings)
    by_type = collections.Counter(r["type"] for r in findings)
    by_disp = collections.Counter(r["disposition"] for r in findings)
    by_class = collections.Counter(conversion_class(r["disposition"]) for r in findings)
    recurring = [r for r in findings if r.get("recurring")]
    high = sorted(
        [r for r in findings if r.get("importance", 0) >= 8],
        key=lambda r: -r.get("importance", 0),
    )

    converged = by_class.get("converged", 0)
    open_ = by_class.get("open", 0)
    dropped = by_class.get("dropped", 0)
    confirm = by_class.get("confirm", 0)
    total = len(findings)
    actionable = converged + open_ + dropped  # confirmations excluded from this denominator
    # TWO denominators, both reported:
    #   strict  = converged / total deduped findings  (the spec §4 anti-waste metric —
    #             includes KEEP confirmations in the denominator; the harshest, headline number)
    #   actionable = converged / actionable           (refined — you can't "convert" a
    #             validated what-worked confirmation, so KEEP is excluded here)
    conversion_strict = (converged / total) if total else 0.0
    conversion_rate = (converged / actionable) if actionable else 0.0
    cost_per_converted = (tokens / converged) if (tokens and converged) else None

    violations = audit_dispositions(findings)

    metrics = {
        "raw": len(rows),
        "deduped": len(findings),
        "malformed": malformed,
        "files": files,
        "empty_sessions": empty,
        "by_track": dict(by_track),
        "by_type": dict(by_type),
        "by_disposition": dict(by_disp),
        "by_conversion_class": dict(by_class),
        "recurring_count": len(recurring),
        "high_importance_count": len(high),
        "converged": converged,
        "open": open_,
        "dropped": dropped,
        "confirmations": confirm,
        "actionable": actionable,
        "conversion_to_change": round(conversion_strict, 4),            # spec §4: ÷ total (headline)
        "conversion_to_change_strict": round(conversion_strict, 4),     # converged ÷ total deduped
        "conversion_to_change_actionable": round(conversion_rate, 4),   # converged ÷ actionable (excl KEEP)
        "tokens": tokens,
        "tokens_per_converted_finding": (
            round(cost_per_converted) if cost_per_converted else None
        ),
        "disposition_violations": len(violations),
    }

    os.makedirs(out_dir, exist_ok=True)
    json.dump(
        {"findings": findings, "metrics": metrics, "violations": violations},
        open(os.path.join(out_dir, "ledger.json"), "w"),
        indent=2,
    )

    pct = f"{conversion_rate * 100:.0f}%"
    pct_strict = f"{conversion_strict * 100:.0f}%"
    L = []
    L.append(f"# {title}\n")
    L.append(
        f"> {len(findings)} deduped findings ({len(rows)} raw, {malformed} malformed "
        f"lines skipped) from {files} session findings-files ({empty} empty).\n"
    )
    L.append("## Conversion-to-change (the only metric that matters)\n")
    L.append(
        f"- **Conversion-to-change (spec §4, ÷ total): {pct_strict}** — {converged} of "
        f"{total} findings became a real change (MERGED-PR / PR-FILED / PR-FIX / SKILL-NEW / SKILL-EDIT). "
        "A weave with 0% conversion is token-waste, full stop.\n"
    )
    L.append(
        f"- **Conversion-to-change (refined, ÷ actionable): {pct}** — {converged} of "
        f"{actionable} *actionable* findings (excludes {confirm} KEEP confirmations, which "
        "can't be 'converted').\n"
    )
    L.append(
        f"- **In flight (open):** {open_} (DEEP-RESEARCH / FOLLOW-UP) · "
        f"**Dropped (with reason):** {dropped} (REJECTED / PARKED / DUPLICATE) · "
        f"**Confirmations (what-worked, excluded):** {confirm} (KEEP)\n"
    )
    if cost_per_converted:
        L.append(
            f"- **Token cost per acted-on finding:** ~{round(cost_per_converted):,} "
            f"tokens ({tokens:,} weave tokens ÷ {converged} converged). "
            "This is the number that says whether the weave was worth it.\n"
        )
    if violations:
        L.append(
            f"- **⚠️ {len(violations)} disposition violations** — findings with an "
            "unknown disposition or DROPPED without a reason. See ledger.json `violations`. "
            "Every finding MUST route to a tracked disposition; a drop MUST state why.\n"
        )
    L.append("\n## Metrics\n")
    L.append("- **By track:** " + " · ".join(f"{k}:{v}" for k, v in by_track.most_common()) + "\n")
    L.append("- **By type:** " + " · ".join(f"{k}:{v}" for k, v in by_type.most_common()) + "\n")
    L.append("- **By disposition:** " + " · ".join(f"{k}:{v}" for k, v in by_disp.most_common()) + "\n")
    L.append(f"- **Recurring:** {len(recurring)} · **High-importance (>=8):** {len(high)}\n")

    L.append("\n## High-importance findings (>=8)\n")
    for r in high:
        L.append(
            f"- **[{r['track']}/{r['disposition']}] {r.get('title', '')}** "
            f"(imp {r.get('importance')}{', RECURRING' if r.get('recurring') else ''})  \n"
            f"  {r.get('detail', '')}  \n"
            f"  _evidence:_ {r.get('evidence', '')}  \n"
            f"  _src:_ {r['_src_file']}\n"
        )

    L.append("\n## All findings by track\n")
    for t in TRACKS:
        tr = [r for r in findings if r["track"] == t]
        if not tr:
            continue
        L.append(f"\n### {t} ({len(tr)})\n")
        for r in sorted(tr, key=lambda r: -r.get("importance", 0)):
            L.append(
                f"- [{r['disposition']}|imp{r.get('importance')}|{r.get('type')}] "
                f"**{r.get('title', '')}** — {r.get('detail', '')[:240]}  \n"
                f"  _ev:_ {r.get('evidence', '')[:200]}\n"
            )
    # any tracks not in the canonical list
    extra = sorted(set(by_track) - set(TRACKS))
    for t in extra:
        tr = [r for r in findings if r["track"] == t]
        L.append(f"\n### {t} ({len(tr)}) [non-canonical track]\n")
        for r in sorted(tr, key=lambda r: -r.get("importance", 0)):
            L.append(
                f"- [{r['disposition']}|imp{r.get('importance')}|{r.get('type')}] "
                f"**{r.get('title', '')}** — {r.get('detail', '')[:240]}\n"
            )

    open(os.path.join(out_dir, "ACTION-LEDGER.md"), "w").write("\n".join(L))

    print(f"LEDGER: {len(findings)} deduped / {len(rows)} raw ({malformed} malformed) from {files} files ({empty} empty)")
    print(f"CONVERSION-TO-CHANGE: strict(÷total)={pct_strict}  refined(÷actionable)={pct}  "
          f"(converged={converged} open={open_} dropped={dropped} confirm={confirm} total={total} actionable={actionable})")
    if cost_per_converted:
        print(f"TOKENS-PER-CONVERTED: ~{round(cost_per_converted):,}")
    print(f"by_track: {dict(by_track)}")
    print(f"by_disposition: {dict(by_disp)}")
    if violations:
        print(f"⚠️  {len(violations)} disposition violations (see ledger.json)")
        for kind, fid, disp in violations[:10]:
            print(f"   - {kind}: {fid} (disposition={disp})")
    print(f"-> {os.path.join(out_dir, 'ACTION-LEDGER.md')} + ledger.json")

    if strict and violations:
        return 2
    return 0


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--findings-dir", required=True, help="dir of per-session findings *.jsonl")
    p.add_argument("--out-dir", default=None, help="where to write ledger.json + ACTION-LEDGER.md (default: --findings-dir's parent)")
    p.add_argument("--title", default="Weave Action-Ledger", help="ledger H1 title")
    p.add_argument("--tokens", type=int, default=0, help="total weave output tokens, for cost-per-converted")
    p.add_argument("--strict", action="store_true", help="exit 2 if any disposition violations (use in CI / smoke)")
    args = p.parse_args()
    find_dir = args.findings_dir
    if not os.path.isdir(find_dir):
        print(f"ERROR: findings-dir not found: {find_dir}", file=sys.stderr)
        return 1
    out_dir = args.out_dir or os.path.dirname(os.path.abspath(find_dir.rstrip("/")))
    return build(find_dir, out_dir, args.title, args.tokens, args.strict)


if __name__ == "__main__":
    raise SystemExit(main())
