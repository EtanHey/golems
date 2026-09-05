#!/usr/bin/env python3
"""weave-run.py — reproducible orchestrator for a weave over recent sessions.

This is the committed version of the 2026-05-29 harness (`weave_orchestrate.py`).
It exists so a weave is never again untracked WIP: discover → prepare → batches
→ aggregate are all here, parameterized by a time window and a workdir.

Delegation model (the orchestrator wields this; workers do the mining):
  - ONE miner agent = ONE session (not five shards of one session).
  - Parallelism = N different sessions at once (default batch size 5).
  - Centerpiece sessions (the orchestrator's own JSONLs) are mined first/deepest.

Subcommands:
  discover  --hours 24 --workdir DIR [--centerpiece-repo orchestrator]
              scan ~/.claude/projects + ~/.codex/sessions for JSONLs modified in
              the window → workdir/corpus-manifest.json
  prepare   --workdir DIR [--digest-min-mb 0.5]
              per session: (large Claude) run session-miner.py → digest, then
              prepare-mine-context.py → workdir/mine-context/<label>.md
  batches   --workdir DIR [--size 5]
              centerpieces-first batch plan → workdir/batch-manifest.json
  status    --workdir DIR
              which sessions have findings files yet (done vs need)
  aggregate --workdir DIR [--tokens N] [--title T]
              run weave-ledger.py over workdir/findings → ACTION-LEDGER.md + ledger.json

Layout under --workdir:
  corpus-manifest.json  digests/  mine-context/  findings/  ACTION-LEDGER.md  ledger.json
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
SESSION_MINER = HERE.parent.parent / "skill-creator" / "scripts" / "session-miner.py"
PREP = HERE / "prepare-mine-context.py"
LEDGER = HERE / "weave-ledger.py"

CLAUDE_PROJECTS = Path.home() / ".claude" / "projects"
CODEX_SESSIONS = Path.home() / ".codex" / "sessions"


# ---------------------------------------------------------------- discover ---
def claude_label(jsonl: Path) -> str:
    slug = re.sub(r"^-Users-.+?-Gits-", "", jsonl.parent.name)
    slug = re.sub(r"^-Users-[^-]+-", "", slug)
    return f"{slug}/{jsonl.stem[:8]}"


def codex_label(jsonl: Path) -> str:
    return f"codex/{jsonl.stem}"


def _is_noise_session(path) -> bool:
    """Workflow-internal sub-agent journals are NOT real sessions — their
    content is already in the parent session, and mining them double-counts +
    inflates the corpus (2026-06-01: 90 of 127 'sessions' were these). Skip any
    path under a `subagents/` dir (covers `subagents/agent-*` and
    `subagents/workflows/wf_*/agent-*`)."""
    return "subagents" in path.parts


def discover(args) -> int:
    cutoff = time.time() - args.hours * 3600
    exclude_self = getattr(args, "exclude_self", None)
    sessions = []
    for jsonl in CLAUDE_PROJECTS.glob("**/*.jsonl"):
        try:
            st = jsonl.stat()
        except OSError:
            continue
        if st.st_mtime < cutoff or st.st_size == 0:
            continue
        if _is_noise_session(jsonl):
            continue
        if exclude_self and exclude_self in jsonl.stem:
            continue
        slug = jsonl.parent.name
        sessions.append({
            "label": claude_label(jsonl),
            "src": str(jsonl),
            "source": "claude",
            "size": st.st_size,
            "mtime": int(st.st_mtime),
            "centerpiece": args.centerpiece_repo in slug,
        })
    if CODEX_SESSIONS.exists():
        for jsonl in CODEX_SESSIONS.glob("**/*.jsonl"):
            try:
                st = jsonl.stat()
            except OSError:
                continue
            if st.st_mtime < cutoff or st.st_size == 0:
                continue
            sessions.append({
                "label": codex_label(jsonl),
                "src": str(jsonl),
                "source": "codex",
                "size": st.st_size,
                "mtime": int(st.st_mtime),
                "centerpiece": False,
            })
    # de-dup labels, centerpieces first, then by size desc (big sessions = more signal)
    seen, uniq = set(), []
    for s in sorted(sessions, key=lambda s: (not s["centerpiece"], -s["size"])):
        if s["label"] in seen:
            continue
        seen.add(s["label"])
        uniq.append(s)

    wd = Path(args.workdir)
    wd.mkdir(parents=True, exist_ok=True)
    out = wd / "corpus-manifest.json"
    deliberate_exclusions = []
    if exclude_self:
        deliberate_exclusions.append({
            "session_stem": exclude_self,
            "reason": "weave lead self-session excluded for corpus integrity",
        })
    manifest = {"sessions": uniq, "deliberate_exclusions": deliberate_exclusions}
    out.write_text(json.dumps(manifest, indent=2))
    cp = sum(1 for s in uniq if s["centerpiece"])
    total_mb = sum(s["size"] for s in uniq) / 1048576
    print(f"DISCOVERED {len(uniq)} sessions in last {args.hours}h "
          f"({cp} centerpiece, {total_mb:.1f} MB total) -> {out}")
    for s in uniq[: args.show]:
        mark = "★" if s["centerpiece"] else " "
        print(f"  {mark} {s['label']:<40} {s['size']/1024:8.0f} KB  {s['source']}")
    if len(uniq) > args.show:
        print(f"  … +{len(uniq) - args.show} more (see {out})")
    return 0


def load_manifest(wd: Path) -> list[dict]:
    raw = json.loads((wd / "corpus-manifest.json").read_text())
    if isinstance(raw, list):
        return raw
    return raw.get("sessions", [])


def findings_path(wd: Path, label: str) -> Path:
    return wd / "findings" / (label.replace("/", "__") + ".jsonl")


# ----------------------------------------------------------------- prepare ---
def prepare(args) -> int:
    wd = Path(args.workdir)
    sessions = load_manifest(wd)
    digests = wd / "digests"
    ctx = wd / "mine-context"
    digests.mkdir(parents=True, exist_ok=True)
    ctx.mkdir(parents=True, exist_ok=True)
    min_bytes = int(args.digest_min_mb * 1048576)
    for s in sessions:
        # large Claude sessions get a deterministic digest first (parser is cheap)
        if s["source"] == "claude" and s["size"] >= min_bytes and SESSION_MINER.exists():
            dg = digests / (s["label"].replace("/", "__") + ".md")
            if not dg.exists():
                r = subprocess.run(
                    [sys.executable, str(SESSION_MINER), "--src", s["src"],
                     "--out", str(dg), "--label", s["label"].split("/")[0]],
                    capture_output=True, text=True,
                )
                if r.returncode != 0:
                    print(f"  digest FAIL {s['label']}: {r.stderr.strip()[:200]}", file=sys.stderr)
                else:
                    s["digest"] = str(dg)
            else:
                s["digest"] = str(dg)
        # build the compact mine-context (digest + grep excerpts)
        r = subprocess.run(
            [sys.executable, str(PREP), "--ctx-dir", str(ctx)],
            input=json.dumps(s), capture_output=True, text=True,
        )
        if r.returncode != 0:
            print(f"  ctx FAIL {s['label']}: {r.stderr.strip()[:200]}", file=sys.stderr)
            return 1
        print(r.stdout.strip())
    # persist any digest paths we filled in (preserve deliberate_exclusions wrapper)
    manifest_path = wd / "corpus-manifest.json"
    raw = json.loads(manifest_path.read_text())
    if isinstance(raw, list):
        raw = {"sessions": sessions, "deliberate_exclusions": []}
    else:
        raw["sessions"] = sessions
    manifest_path.write_text(json.dumps(raw, indent=2))
    print(f"prepared {len(sessions)} context files -> {ctx}")
    return 0


# ------------------------------------------------------------------ batches ---
def batches(args) -> int:
    wd = Path(args.workdir)
    sessions = load_manifest(wd)
    need = [s for s in sessions if not _has_findings(wd, s["label"])]
    size = args.size
    plan = [need[i:i + size] for i in range(0, len(need), size)]
    out = wd / "batch-manifest.json"
    out.write_text(json.dumps({
        "batch_size": size,
        "total_remaining": len(need),
        "batches": [
            {"batch_id": i + 1,
             "sessions": [{"label": s["label"], "src": s["src"], "source": s["source"],
                           "centerpiece": s["centerpiece"],
                           "ctx": str(wd / "mine-context" / (s["label"].replace("/", "__") + ".md")),
                           "out": str(findings_path(wd, s["label"]))}
                          for s in batch]}
            for i, batch in enumerate(plan)
        ],
    }, indent=2))
    print(f"wrote {out} — {len(need)} sessions in {len(plan)} batches of <= {size} (centerpieces first)")
    return 0


def _has_findings(wd: Path, label: str) -> bool:
    fp = findings_path(wd, label)
    return fp.exists() and fp.stat().st_size > 5


def status(args) -> int:
    wd = Path(args.workdir)
    sessions = load_manifest(wd)
    done, need = [], []
    for s in sessions:
        fp = findings_path(wd, s["label"])
        if fp.exists():
            n = sum(1 for ln in fp.open() if ln.strip())
            done.append((s["label"], n, s["centerpiece"]))
        else:
            need.append((s["label"], s["centerpiece"]))
    print(f"sessions={len(sessions)} done={len(done)} need={len(need)}")
    for lab, n, cp in sorted(done):
        print(f"  OK   {'★' if cp else ' '} {lab} ({n} findings)")
    for lab, cp in sorted(need):
        print(f"  NEED {'★' if cp else ' '} {lab}")
    return 0 if not need else 1


def aggregate(args) -> int:
    wd = Path(args.workdir)
    cmd = [sys.executable, str(LEDGER), "--findings-dir", str(wd / "findings"),
           "--out-dir", str(wd), "--title", args.title]
    if args.tokens:
        cmd += ["--tokens", str(args.tokens)]
    if args.strict:
        cmd += ["--strict"]
    return subprocess.run(cmd).returncode


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    d = sub.add_parser("discover"); d.set_defaults(func=discover)
    d.add_argument("--hours", type=float, default=24)
    d.add_argument("--workdir", required=True)
    d.add_argument("--centerpiece-repo", default="orchestrator")
    d.add_argument("--show", type=int, default=30)
    d.add_argument("--exclude-self", default=None,
                   help="session id (stem) of the weave's own live session, to keep it out of the corpus")

    pr = sub.add_parser("prepare"); pr.set_defaults(func=prepare)
    pr.add_argument("--workdir", required=True)
    pr.add_argument("--digest-min-mb", type=float, default=0.5)

    b = sub.add_parser("batches"); b.set_defaults(func=batches)
    b.add_argument("--workdir", required=True)
    b.add_argument("--size", type=int, default=5)

    s = sub.add_parser("status"); s.set_defaults(func=status)
    s.add_argument("--workdir", required=True)

    a = sub.add_parser("aggregate"); a.set_defaults(func=aggregate)
    a.add_argument("--workdir", required=True)
    a.add_argument("--tokens", type=int, default=0)
    a.add_argument("--title", default="Weave Action-Ledger")
    a.add_argument("--strict", action="store_true")

    args = p.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
