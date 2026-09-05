#!/usr/bin/env python3
"""Extract agada-bench corpus rows from a Claude Code session JSONL."""
# Note (v1 limitation): chunk_id is the BL-rendered prefix (e.g., 'rt-0c2e3cb8-'),
# not the full ID. chunk_full_content is BL's truncated summary, not the verbatim
# body. Both limitations need a live BL DB lookup to overcome; adjacent_chunks is
# likewise empty in v1. Deferred to v2 per references/roadmap-v2.md Phase A.
import argparse
import json
import re
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path


RESULT_RE = re.compile(
    r"^\[(\d+)\]\s+(\S+)\s+\(score=([-\d.]+)\s+imp=(\d+|None|null)?\)",
    re.IGNORECASE,
)
BOX_RESULT_RE = re.compile(
    r"^[├└]─\s+\[(\d+)\]\s+([\w-]+)\s+score:\s*([-\d.]+)\s+"
    r"imp:\s*(-?\d+)(?:\s+(\d{4}-\d{2}-\d{2}))?",
    re.IGNORECASE,
)
FIELD_RE = re.compile(r"^\s{2,}([A-Za-z][A-Za-z _-]*):\s*(.*)$")
BOX_PROJECT_RE = re.compile(r"^│\s+([^│]+?)\s+│\s*(.*)$")
BOX_TAGS_RE = re.compile(r"^│\s+tags:\s*(.*)$", re.IGNORECASE)


def fail(message, code=1):
    print(f"extract-corpus.py: ERROR {message}", file=sys.stderr)
    return code


def load_jsonl(path):
    with path.open() as f:
        for lineno, line in enumerate(f, 1):
            if not line.strip():
                continue
            try:
                yield json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(f"{path}:{lineno}: {exc}") from exc


def tool_base(name):
    return (name or "").split("__")[-1]


def text_from_result(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text":
                parts.append(str(item.get("text", "")))
            elif isinstance(item, str):
                parts.append(item)
        return "\n".join(parts)
    return ""


def normalize_tags(value):
    if value is None:
        return []
    if isinstance(value, list):
        return [str(v).strip() for v in value if str(v).strip()]
    raw = str(value).strip()
    if not raw or raw.lower() in {"none", "null", "-"}:
        return []
    if raw.startswith("["):
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list):
                return [str(v).strip() for v in parsed if str(v).strip()]
        except json.JSONDecodeError:
            pass
    return [part.strip() for part in raw.split(",") if part.strip()]


def parse_filter_input(payload):
    filters = {}
    if not isinstance(payload, dict):
        return filters
    for key, value in payload.items():
        if key == "query":
            continue
        filters[key] = value
    return filters


def parse_result_blocks(text):
    rows = []
    current = None
    current_field = None
    for line in text.splitlines():
        clean = line.strip()
        match = RESULT_RE.match(clean)
        box_match = BOX_RESULT_RE.match(clean)
        if box_match:
            if current:
                rows.append(current)
            date = box_match.group(5)
            current = {
                "position": int(box_match.group(1)),
                "chunk_id": box_match.group(2),
                "score": float(box_match.group(3)),
                "importance": int(box_match.group(4)),
                "fields": {
                    "created": f"{date}T00:00:00Z" if date else None,
                },
            }
            current_field = None
            continue
        if match:
            if current:
                rows.append(current)
            imp = match.group(4)
            current = {
                "position": int(match.group(1)),
                "chunk_id": match.group(2),
                "score": float(match.group(3)),
                "importance": int(imp) if imp and imp.isdigit() else None,
                "fields": {},
            }
            current_field = None
            continue
        if not current:
            continue
        tags = BOX_TAGS_RE.match(line)
        if tags:
            current["fields"]["tags"] = tags.group(1).strip()
            current_field = "tags"
            continue
        project = BOX_PROJECT_RE.match(line)
        if project and not line.lstrip().lower().startswith("tags:"):
            current["fields"]["project"] = project.group(1).strip() or None
            content = project.group(2).strip() or None
            current["fields"]["content"] = content
            current["fields"]["summary"] = content
            current_field = "content"
            continue
        field = FIELD_RE.match(line)
        if field:
            key = field.group(1).strip().lower().replace(" ", "_").replace("-", "_")
            current["fields"][key] = field.group(2).strip()
            current_field = key
        elif current_field and line.startswith("    "):
            extra = line.strip()
            if extra:
                current["fields"][current_field] = (
                    current["fields"][current_field] + "\n" + extra
                ).strip()
    if current:
        rows.append(current)
    return rows


def is_zero_result(text, parsed_rows):
    if parsed_rows:
        return False
    lowered = text.lower()
    return (
        "no results found" in lowered
        or "found 0 results" in lowered
        or re.search(r"\b0 results\b", lowered) is not None
    )


def extract_calls(session_path, allowed_tools, limit):
    calls = {}
    ordered = []
    results = {}
    counts = Counter()
    for obj in load_jsonl(session_path):
        message = obj.get("message") or {}
        content = message.get("content") or []
        if not isinstance(content, list):
            continue
        for item in content:
            if not isinstance(item, dict):
                continue
            if item.get("type") == "tool_use":
                base = tool_base(item.get("name"))
                counts[base] += 1
                if base in allowed_tools:
                    record = {
                        "id": item.get("id"),
                        "tool": base,
                        "input": item.get("input") or {},
                    }
                    calls[item.get("id")] = record
                    if limit is None or len(ordered) < limit:
                        ordered.append(record)
            elif item.get("type") == "tool_result":
                results[item.get("tool_use_id")] = text_from_result(item.get("content"))
    return ordered, results, counts


def write_jsonl(path, rows):
    with path.open("w") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")


def build_summary(path, session, calls, corpus_rows, zero_rows, counts):
    project_dist = Counter(r.get("chunk_project") or "(none)" for r in corpus_rows)
    tag_dist = Counter()
    imp_dist = Counter()
    for row in corpus_rows:
        imp_dist[row.get("chunk_importance")] += 1
        for tag in row.get("chunk_tags") or []:
            tag_dist[tag] += 1
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    lines = [
        f"# Corpus Summary - extracted from {session} on {now}",
        "",
        f"- Source session: {session}",
        f"- Total brain_search calls: {counts.get('brain_search', 0)}",
        f"- Total brain_recall calls: {counts.get('brain_recall', 0)}",
        f"- Total brain_digest calls: {counts.get('brain_digest', 0)}",
        f"- Corpus-producing calls considered: {len(calls)}",
        f"- Unique (qid, chunk_id) pairs: {len(corpus_rows)}",
        f"- Queries with zero results: {len(zero_rows)} (see zero-result-queries.jsonl)",
        f"- Project distribution: {dict(project_dist)}",
        f"- Tag distribution: {dict(tag_dist)}",
        f"- Importance histogram: {dict(imp_dist)}",
        "",
        "## V1 Limitations",
        "",
        "- `chunk_id` is the BL-rendered prefix, not the full chunk id.",
        "- `chunk_full_content` is BL's one-line truncated rendering, not the full body.",
        "- `adjacent_chunks` is always empty because v1 does not perform a live BL DB lookup.",
        "",
    ]
    path.write_text("\n".join(lines))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--session", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--limit", type=int)
    parser.add_argument("--tools", default="brain_search,brain_recall,brain_digest")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    session = Path(args.session).expanduser()
    out_dir = Path(args.output).expanduser()
    if not session.exists():
        return fail(f"session not found: {session}")
    allowed = {part.strip() for part in args.tools.split(",") if part.strip()}
    if not allowed:
        return fail("--tools resolved to an empty set")

    try:
        calls, results, counts = extract_calls(session, allowed, args.limit)
    except (OSError, ValueError) as exc:
        return fail(str(exc))

    corpus_rows = []
    zero_rows = []
    for query_id, call in enumerate(calls, 1):
        payload = call.get("input") or {}
        query = payload.get("query") or payload.get("q") or ""
        text = results.get(call.get("id"), "")
        parsed = parse_result_blocks(text)
        if is_zero_result(text, parsed):
            zero_rows.append(
                {
                    "query_id": query_id,
                    "query_text": query,
                    "query_filters": parse_filter_input(payload),
                    "query_intent_hint": None,
                    "num_returned": 0,
                    "tool": call.get("tool"),
                }
            )
            continue
        for item in parsed:
            fields = item["fields"]
            content = fields.get("content")
            summary = fields.get("summary")
            row = {
                "query_id": query_id,
                "query_text": query,
                "query_filters": parse_filter_input(payload),
                "query_intent_hint": None,
                "chunk_id": item["chunk_id"],
                "chunk_full_content": content,
                "chunk_summary_auto": summary,
                "chunk_tags": normalize_tags(fields.get("tags")),
                "chunk_importance": item["importance"],
                "chunk_source_uri": fields.get("source_uri") or fields.get("source"),
                "chunk_project": fields.get("project"),
                "chunk_created_iso": fields.get("created") or fields.get("created_at"),
                "adjacent_chunks": [],
                "audit_returned_position": item["position"],
                "audit_score": item["score"],
            }
            if content and content.rstrip().endswith("..."):
                row["chunk_content_truncated"] = True
            if content and content.rstrip().endswith("…"):
                row["chunk_content_truncated"] = True
            corpus_rows.append(row)

    corpus_path = out_dir / "corpus.jsonl"
    summary_path = out_dir / "corpus-summary.md"
    zero_path = out_dir / "zero-result-queries.jsonl"
    if args.dry_run:
        print(
            "extract-corpus.py: dry_run=true "
            f"calls={len(calls)} rows={len(corpus_rows)} zero={len(zero_rows)} "
            f"output={corpus_path}"
        )
        return 0
    try:
        out_dir.mkdir(parents=True, exist_ok=True)
        write_jsonl(corpus_path, corpus_rows)
        write_jsonl(zero_path, zero_rows)
        build_summary(summary_path, session, calls, corpus_rows, zero_rows, counts)
    except OSError as exc:
        return fail(str(exc))
    print(
        "extract-corpus.py: "
        f"calls={len(calls)} rows={len(corpus_rows)} zero={len(zero_rows)} "
        f"output={corpus_path}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
