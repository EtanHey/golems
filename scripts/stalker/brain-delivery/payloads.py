import hashlib
import json
import os
import re
import sys
from pathlib import Path

stream_dir = Path(sys.argv[1])
agent_tag = sys.argv[2]
project = sys.argv[3]
default_importance = int(sys.argv[4])
name = stream_dir.name
date_match = re.search(r"(\d{4}-\d{2}-\d{2})", name)
run_date = date_match.group(1) if date_match else "unknown-date"
channel = name.split("-", 1)[0] if "-" in name else name

def read_text(path, limit=None):
    if not path.exists():
        return ""
    text = path.read_text(errors="replace")
    return text[:limit] if limit else text

def file_bytes(path):
    return path.stat().st_size if path.exists() else 0

def file_sha256(path):
    if not path.exists():
        return ""
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()

def ledger_drive_target():
    ledger = stream_dir / "_DRIVE-LEDGER.md"
    if not ledger.exists():
        return "missing"
    for line in ledger.read_text(errors="replace").splitlines():
        if line.startswith("- Drive Target:"):
            return line.split(":", 1)[1].strip() or "missing"
    return "present-without-drive-target"

def gem_titles():
    gems = stream_dir / "gems.md"
    titles = []
    if gems.exists():
        for line in gems.read_text(errors="replace").splitlines():
            match = re.match(r"^### \[[^\]]+\]\s*(.+)$", line)
            if match:
                titles.append(match.group(1).strip())
    return titles

def base_tags(record):
    return [
        f"agent:{agent_tag}",
        f"project:{project}",
        f"date:{run_date}",
        f"stream:{name}",
        f"channel:{channel}",
        f"record:{record}",
    ]

def payload(record, content, memory_type="journal", importance=None, extra_tags=None):
    tags = base_tags(record)
    if extra_tags:
        tags.extend(extra_tags)
    return {
        "content": content.strip(),
        "memory_type": memory_type,
        "project": project,
        "tags": tags,
        "importance": int(default_importance if importance is None else importance),
    }

video = stream_dir / "video.mp4"
source_ts = stream_dir / "video.ts"
chat = stream_dir / "chat.log"
transcript = stream_dir / "transcript.md"
gems = stream_dir / "gems.md"
ledger = stream_dir / "_DRIVE-LEDGER.md"
failures = stream_dir / "transcription-failures.log"
replay = stream_dir / "orphaned_stores.jsonl"

media_path = video if video.exists() else source_ts
titles = gem_titles()
transcript_text = read_text(transcript, 500)
failure_text = read_text(failures, 1200).strip()
existing_replay_count = 0
if replay.exists():
    existing_replay_count = sum(1 for line in replay.read_text(errors="replace").splitlines() if line.strip())

summary_lines = [
    f"[{run_date}] Stalker Golem run summary",
    f"Agent: {agent_tag}",
    f"Project: {project}",
    f"Importance: {default_importance}",
    f"Stream: {name}",
    f"Channel: {channel}",
    f"Stream dir: {stream_dir}",
    f"Media file: {media_path.name if media_path.exists() else 'missing'}",
    f"Media bytes: {file_bytes(media_path)}",
    f"Media sha256: {file_sha256(media_path) or 'missing'}",
    f"Chat lines: {sum(1 for _ in chat.open(errors='replace')) if chat.exists() else 0}",
    f"Transcript bytes: {file_bytes(transcript)}",
    f"Drive ledger: {'present' if ledger.exists() else 'missing'}",
    f"Drive target: {ledger_drive_target()}",
]
if transcript_text:
    summary_lines.append("Transcript excerpt: " + " ".join(transcript_text.split())[:400])

records = [
    payload(
        "run-summary",
        "\n".join(summary_lines),
        memory_type="journal",
        importance=default_importance,
    )
]

if titles:
    gem_lines = [
        f"[{run_date}] Stalker Golem curated gems",
        f"Agent: {agent_tag}",
        f"Project: {project}",
        f"Importance: {default_importance}",
        f"Stream: {name}",
        f"Gem count: {len(titles)}",
        "Top gems: " + "; ".join(titles[:5]),
    ]
else:
    gem_lines = [
        f"[{run_date}] Stalker Golem curated gems",
        f"Agent: {agent_tag}",
        f"Project: {project}",
        f"Importance: {default_importance}",
        f"Stream: {name}",
        "Gem count: 0",
        "No-gems reason: gems.md missing or contains no curated gem headings",
    ]
records.append(payload("curated-gems", "\n".join(gem_lines), memory_type="journal", importance=default_importance))

if failure_text:
    records.append(payload(
        "failures",
        "\n".join([
            f"[{run_date}] Stalker Golem failures",
            f"Agent: {agent_tag}",
            f"Project: {project}",
            "Importance: 9",
            f"Stream: {name}",
            "Failures:",
            failure_text,
        ]),
        memory_type="issue",
        importance=9,
        extra_tags=["status:open", "severity:high"],
    ))

records.append(payload(
    "replay-state",
    "\n".join([
        f"[{run_date}] Stalker Golem replay/backfill queue state",
        f"Agent: {agent_tag}",
        f"Project: {project}",
        f"Importance: {default_importance}",
        f"Stream: {name}",
        f"Replay file: {replay}",
        f"Existing queued records before ingest: {existing_replay_count}",
        "Queue contract: failed BrainLayer writes append JSONL records with intended_brain_store=true.",
    ]),
    memory_type="note",
    importance=default_importance,
))

for record in records:
    print(json.dumps(record, sort_keys=True))
