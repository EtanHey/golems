#!/usr/bin/env python3
"""Prepare agada-bench judge spawn briefs and a cmux dispatch checklist."""
import argparse
import json
import re
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ADAPTERS = ROOT / "adapters"


def fail(message, code=1):
    print(f"dispatch-judges.py: ERROR {message}", file=sys.stderr)
    return code


def count_jsonl(path):
    count = 0
    with path.open() as f:
        for line in f:
            if not line.strip():
                continue
            json.loads(line)
            count += 1
    return count


def parse_capabilities():
    path = ADAPTERS / "capabilities.yaml"
    data = {}
    current = None
    if not path.exists():
        return data
    for raw in path.read_text().splitlines():
        line = raw.rstrip()
        match = re.match(r"^\s{2}([a-z][\w-]*):\s*$", line)
        if match and line.startswith("  ") and not line.startswith("    "):
            current = match.group(1)
            data[current] = {}
            continue
        if current and line.startswith("    "):
            kv = re.match(r"^\s+([a-zA-Z0-9_-]+):\s*(.+?)\s*(?:#.*)?$", line)
            if kv:
                data[current][kv.group(1)] = kv.group(2).strip().strip('"')
    return data


def extract_template(adapter_text):
    marker = re.search(r"Brief contents?:\s*\n\n```markdown\n(.*?)\n```", adapter_text, re.S)
    if marker:
        return marker.group(1)
    marker = re.search(r"The brief itself contains:\s*\n\n```markdown\n(.*?)\n```", adapter_text, re.S)
    if marker:
        return marker.group(1)
    return adapter_text


def resolve_template(template, values):
    out = template
    for key, value in values.items():
        out = out.replace("{" + key + "}", value)
        out = out.replace("<" + key + ">", value)
    return out


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--corpus", required=True)
    parser.add_argument("--rubric", required=True)
    parser.add_argument("--judges", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--judge-timeout", type=int)
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--workspace", default="current")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    corpus = Path(args.corpus).expanduser()
    rubric = Path(args.rubric).expanduser()
    out_dir = Path(args.output_dir).expanduser()
    if not corpus.exists():
        return fail(f"corpus not found: {corpus}")
    if not rubric.exists():
        return fail(f"rubric not found: {rubric}")
    judges = [j.strip() for j in args.judges.split(",") if j.strip()]
    if not judges:
        return fail("--judges resolved to empty")
    try:
        corpus_rows = count_jsonl(corpus)
    except (OSError, json.JSONDecodeError) as exc:
        return fail(f"cannot read corpus: {exc}")

    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    brief_dir = out_dir / "spawn-briefs"
    capabilities = parse_capabilities()
    written = []
    skipped = []
    tolerance = 0.05

    if not args.dry_run:
        brief_dir.mkdir(parents=True, exist_ok=True)
        out_dir.mkdir(parents=True, exist_ok=True)

    for judge in judges:
        adapter_path = ADAPTERS / f"{judge}.md"
        if not adapter_path.exists():
            return fail(f"adapter not found: {adapter_path}")
        output_path = out_dir / f"{judge}.jsonl"
        if args.resume and output_path.exists():
            try:
                existing = count_jsonl(output_path)
            except Exception:
                existing = 0
            if existing >= int((1 - tolerance) * corpus_rows):
                skipped.append((judge, output_path, existing))
                continue
            if not args.dry_run:
                dead = output_path.with_suffix(
                    output_path.suffix + ".dead-" + run_id
                )
                shutil.move(str(output_path), str(dead))
        adapter_text = adapter_path.read_text()
        template = extract_template(adapter_text)
        judge_name = f"{judge}Judge"
        brief_path = brief_dir / f"{judge_name}-{run_id}.md"
        timeout = args.judge_timeout or capabilities.get(judge, {}).get(
            "judge_timeout_min", "30"
        )
        launcher = capabilities.get(judge, {}).get("launcher", f"{judge_name} -s")
        values = {
            "corpus_path": str(corpus.resolve()),
            "rubric_path": str(rubric.resolve()),
            "output_path": str(output_path.resolve()),
            "output_dir": str(out_dir.resolve()),
            "run_id": run_id,
            "expected": str(corpus_rows),
        }
        body = resolve_template(template, values)
        header = (
            f"<!-- launcher: {launcher}; timeout_min: {timeout}; "
            f"workspace: {args.workspace} -->\n\n"
        )
        if not args.dry_run:
            brief_path.write_text(header + body)
        written.append((judge, judge_name, brief_path, output_path, launcher, timeout))

    plan_path = out_dir / "dispatch-plan.sh"
    plan_lines = [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        "# Operator checklist: spawn panes via cmux MCP/new_split, then send:",
    ]
    for judge, judge_name, brief_path, _out, launcher, _timeout in written:
        plan_lines.extend(
            [
                f"# {judge_name}: launcher {launcher}",
                f"# send: Read {brief_path} and execute.",
            ]
        )
    if not args.dry_run:
        plan_path.write_text("\n".join(plan_lines) + "\n")

    print("dispatch-judges.py: dispatched")
    for judge, judge_name, brief_path, output_path, launcher, timeout in written:
        print(f"- {judge_name} brief written: {brief_path}")
        print(f"  launcher: {launcher}; timeout_min={timeout}; output={output_path}")
    for judge, output_path, existing in skipped:
        print(f"- {judge}Judge skipped by --resume: {existing} rows in {output_path}")
    print(f"spawn the panes via cmux MCP using the brief paths above.")
    print(
        f"poll each {out_dir}/<judge>.jsonl for completion "
        f"(row count >= {int((1 - tolerance) * corpus_rows)} of {corpus_rows})."
    )
    print(
        f"dispatch-judges.py: briefs={len(written)} skipped={len(skipped)} "
        f"dry_run={str(args.dry_run).lower()} output={brief_dir}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
