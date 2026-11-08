#!/usr/bin/env python3
"""Deterministic weave frontier: init, next, ingest, questions, status --workdir DIR.

Single orchestrator owns the run. Workers write only their round item's `out`.
No agents or network calls are made here. Empty findings files are valid receipts.
"""
import argparse
import fcntl
import hashlib
import json
import re
import sys
import uuid
from pathlib import Path

KINDS = {"mine", "redteam", "regather", "verify", "widen"}


def norm(text):
    return " ".join(text.casefold().split())


def key_for(kind, target, claim):
    return hashlib.sha256(json.dumps([kind, target, norm(claim)]).encode()).hexdigest()


def text(value):
    if not isinstance(value, str) or not value.strip():
        raise ValueError("expected nonempty text")
    return value.strip()


def array(row, field):
    if not isinstance(row, dict) or not isinstance(row.get(field, []), list):
        raise ValueError(f"{field} requires a list on a finding object")
    return row.get(field, [])


def enqueue(state, kind, target, why, parent):
    if kind not in KINDS:
        raise ValueError(f"unknown kind: {kind}")
    target, why = text(target), text(why)
    key = key_for(kind, target, why)
    if key not in state["scheduled"]:
        state["scheduled"][key] = dict(key=key, kind=kind, target=target,
                                       parent_key=parent, round=None, why=why)
        state["pending"].append(key)
        state["yields"][parent] = state["yields"].get(parent, 0) + 1
    return key


def init(args):
    plan = json.loads((args.workdir / "batch-manifest.json").read_text())
    sessions = [s for b in plan["batches"] for s in b["sessions"]]
    state = dict(status="RUNNING", run_id=uuid.uuid4().hex, rounds=[], scheduled={}, pending=[], yields={},
                 dry_streak=0, questions={}, bank_growth=0, unverified={}, mined=[],
                 sessions={}, max_items=args.max_items_per_round, max_rounds=args.max_rounds)
    for session in sorted(sessions, key=lambda s: not s.get("centerpiece", False)):
        label = text(session["label"])
        state["sessions"][label] = session
        enqueue(state, "mine", label, "Initial batch plan", "root")
    if not state["pending"]:
        raise ValueError("empty batch plan: coverage defect")
    return state


def next_round(state, args):
    if state["rounds"] and not state["rounds"][-1]["ingested"]:
        raise ValueError("ingest the current round before next")
    if any(not q["processed"] for q in state["questions"].values()):
        raise ValueError("run questions --bank before next")
    # Retry unresolved verification, retaining its stable identity, never a dry leaf.
    for key in state["unverified"]:
        if key not in state["pending"]:
            state["pending"].append(key)
    if state["max_rounds"] and len(state["rounds"]) >= state["max_rounds"] and state["pending"]:
        state["status"] = "BACKSTOP_HIT"
        return
    number = len(state["rounds"]) + 1
    pending = sorted(state["pending"], key=lambda k: -state["yields"].get(
        state["scheduled"][k]["parent_key"], 0))
    count = state["max_items"] or len(pending)
    selected, state["pending"] = pending[:count], pending[count:]
    items = []
    for key in selected:
        item = state["scheduled"][key]
        if item["round"] is None:
            item["round"] = number
        out = args.workdir / "loop" / f"round-{number}" / f"{key}.jsonl"
        out.parent.mkdir(parents=True, exist_ok=True)
        items.append(dict(item, round=number, out=str(out)))
    state["rounds"].append(dict(number=number, items=items,
                                carried=list(state["pending"]), ingested=False))


def ingest(state, number):
    current = state["rounds"][-1]
    if current["number"] != number or current["ingested"]:
        raise ValueError("ingest requires the current, not-yet-ingested round")
    before = len(state["scheduled"])
    # Read every receipt before mutating; missing/malformed output never means DRY.
    rows = [(item, json.loads(line)) for item in current["items"]
            for line in Path(item["out"]).read_text().splitlines() if line.strip()]
    for item in current["items"]:
        if item["kind"] == "mine" and item["target"] not in state["mined"]:
            state["mined"].append(item["target"])
    for item, finding in rows:
        parent, target = item["key"], finding.get("target", item["target"])
        for followup in array(finding, "followups"):
            enqueue(state, followup["kind"], followup["target"], followup["why"], parent)
        if "verified" in finding:
            if type(finding["verified"]) is not bool:
                raise ValueError("verified must be true or false")
            claim = text(finding.get("claim", item["why"] if item["kind"] == "verify"
                                     else finding.get("title")))
            key = key_for("verify", text(target), claim)
            if finding["verified"]:
                state["unverified"].pop(key, None)
            else:
                key = enqueue(state, "verify", target, claim, parent)
                state["unverified"][key] = claim
        for question in array(finding, "new_questions"):
            question = " ".join(text(question).split())
            qkey = norm(question)
            if qkey not in state["questions"]:
                state["questions"][qkey] = dict(text=question, round=number,
                    finding=text(finding["id"]), session=item["target"], parent_key=parent,
                    processed=False)
    current.update(ingested=True, new_keys=len(state["scheduled"]) - before,
                   unverified=len(state["unverified"]))
    dry = current["new_keys"] == 0 and not state["unverified"]
    # A question awaiting the bank and carried work both prevent premature synthesis.
    if any(not q["processed"] for q in state["questions"].values()) or state["pending"]:
        dry = False
    current["dry"] = dry
    state["dry_streak"] = state["dry_streak"] + 1 if dry else 0
    if state["dry_streak"] >= 2:
        state["status"] = "DRY_STOP"


def questions(state, bank):
    with bank.open("a+", encoding="utf-8") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        handle.seek(0)
        existing = handle.read()
        known = {norm(re.sub(r"^(?:[-*] |[A-Z]\d+[.)] )", "", line).split(" <!--")[0])
                 for line in existing.splitlines() if line.strip()}
        additions = []
        for qkey, q in state["questions"].items():
            if q["processed"]:
                continue
            # The provenance marker also recovers an append before a state-save crash.
            marker = f"weave-question:{state['run_id']}:" + key_for("regather", "bank", qkey)
            if qkey not in known or marker in existing:
                if marker not in existing:
                    additions.append(f"- {q['text']} <!-- {marker}; round={q['round']}; "
                                     f"finding={q['finding']}; session={q['session']} -->\n")
                state["bank_growth"] += 1
                for label in state["mined"]:
                    enqueue(state, "regather", label, q["text"], q["parent_key"])
            q["processed"] = True
        if additions:
            if "## H. Added during the run" not in existing:
                handle.write("\n## H. Added during the run\n")
            handle.writelines(additions)
            handle.flush()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["init", "next", "ingest", "status", "questions"])
    parser.add_argument("--workdir", type=Path, required=True)
    parser.add_argument("--round", type=int)
    parser.add_argument("--bank", type=Path)
    parser.add_argument("--max-items-per-round", type=int, default=0)
    parser.add_argument("--max-rounds", type=int, default=0)
    args = parser.parse_args()
    args.workdir = args.workdir.resolve()
    loop = args.workdir / "loop"
    loop.mkdir(parents=True, exist_ok=True)
    path = loop / "state.json"
    try:
        with (loop / ".lock").open("w") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            if args.command == "init":
                if path.exists() or min(args.max_items_per_round, args.max_rounds) < 0:
                    raise ValueError("already initialized or negative backstop")
                state = init(args)
            else:
                state = json.loads(path.read_text())
                if args.command != "status" and state["status"] != "RUNNING":
                    raise ValueError(f"loop is {state['status']}")
                if args.command == "next":
                    next_round(state, args)
                elif args.command == "ingest":
                    ingest(state, args.round)
                elif args.command == "questions":
                    if not args.bank:
                        raise ValueError("questions requires --bank")
                    questions(state, args.bank)
            if args.command != "status":
                temporary = path.with_suffix(".new")
                temporary.write_text(json.dumps(state, indent=2) + "\n")
                temporary.replace(path)
            print(json.dumps(state, indent=2))
            if state["status"] == "DRY_STOP":
                print("SYNTHESIZE")
            if state["status"] == "BACKSTOP_HIT":
                print("BACKSTOP_HIT: pending items:", file=sys.stderr)
                for key in state["pending"]:
                    print(json.dumps(state["scheduled"][key]), file=sys.stderr)
                return 3
    except (OSError, ValueError, KeyError, TypeError, IndexError, AttributeError) as error:
        print(f"weave-loop: {error}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
