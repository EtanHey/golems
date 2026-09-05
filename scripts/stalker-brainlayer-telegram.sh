#!/bin/bash
# Stalker Golem BrainLayer + Telegram contract.
#
# Subcommands:
#   ingest-run <stream-dir> [--dry-run]
#   queue-run <stream-dir> <reason>
#   digest <stalker-root> <YYYY-MM-DD> [--dry-run]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/stream-helpers.sh
source "$SCRIPT_DIR/lib/stream-helpers.sh"

AGENT_TAG="${STALKER_AGENT_TAG:-stalker-golem-codex-trackB}"
PROJECT="${STALKER_BRAINLAYER_PROJECT:-golems}"
DEFAULT_IMPORTANCE="${STALKER_BRAINLAYER_IMPORTANCE:-7}"

usage() {
    cat >&2 <<'USAGE'
Usage:
  stalker-brainlayer-telegram.sh ingest-run <stream-dir> [--dry-run]
  stalker-brainlayer-telegram.sh queue-run <stream-dir> <reason>
  stalker-brainlayer-telegram.sh digest <stalker-root> <YYYY-MM-DD> [--dry-run]
USAGE
}

is_dry_run_env() {
    [ "${STALKER_BRAINLAYER_DRY_RUN:-${STALKER_BRAIN_STORE_DRY_RUN:-0}}" = "1" ]
}

build_brain_payloads() {
    local stream_dir="$1"
    python3 - "$stream_dir" "$AGENT_TAG" "$PROJECT" "$DEFAULT_IMPORTANCE" <<'PY'
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
PY
}

store_payloads() {
    local payloads_file="$1"
    local state_file="$2"
    if [ -n "${STALKER_BRAIN_STORE_CMD:-}" ]; then
        # STALKER_BRAIN_STORE_CMD is a single executable path. Use a wrapper script
        # when test fakes or local tools need additional arguments.
        local payload record_key
        while IFS= read -r payload; do
            [ -n "$payload" ] || continue
            if printf '%s\n' "$payload" | "$STALKER_BRAIN_STORE_CMD" >/dev/null; then
                record_key="$(payload_record_key "$payload")"
                append_store_state "$state_file" "$record_key" "stored"
            fi
        done < "$payloads_file"
        return
    fi

    local brainlayer_src="${STALKER_BRAINLAYER_SRC:-$HOME/Gits/brainlayer/src}"
    PYTHONPATH="$brainlayer_src${PYTHONPATH:+:$PYTHONPATH}" python3 - "$payloads_file" "$state_file" <<'PY'
import json
import os
import sys
from datetime import datetime, timezone

payloads = [json.loads(line) for line in open(sys.argv[1]) if line.strip()]
state_file = sys.argv[2]

def record_key(payload):
    for tag in payload.get("tags") or []:
        if tag.startswith("record:"):
            return tag.split(":", 1)[1]
    return "unknown"

def append_stored(payload):
    record = {
        "record": record_key(payload),
        "status": "stored",
        "updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    os.makedirs(os.path.dirname(state_file), exist_ok=True)
    with open(state_file, "a") as handle:
        handle.write(json.dumps(record, sort_keys=True) + "\n")
        handle.flush()
        os.fsync(handle.fileno())

try:
    from brainlayer.paths import get_db_path
    from brainlayer.store import store_memory
    from brainlayer.vector_store import VectorStore
    store = VectorStore(get_db_path())
except Exception as exc:
    print(f"BrainLayer batch startup failed: {exc}", file=sys.stderr)
    raise SystemExit(1)

for payload in payloads:
    try:
        store_memory(
            store=store,
            embed_fn=None,
            content=payload["content"],
            memory_type=payload.get("memory_type", "note"),
            project=payload.get("project"),
            tags=payload.get("tags") or [],
            importance=payload.get("importance"),
        )
        append_stored(payload)
    except Exception as exc:
        print(f"BrainLayer store failed: {exc}", file=sys.stderr)
PY
}

queue_payload() {
    local replay_file="$1"
    local reason="$2"
    local payload="$3"
    mkdir -p "$(dirname "$replay_file")"
    PAYLOAD_JSON="$payload" python3 - "$replay_file" "$reason" <<'PY'
import json
import os
import sys
from datetime import datetime, timezone

replay_file = sys.argv[1]
reason = sys.argv[2]
payload = json.loads(os.environ["PAYLOAD_JSON"])
record = {
    "queued_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "intended_brain_store": True,
    "reason": reason,
    "payload": payload,
}
with open(replay_file, "a") as handle:
    handle.write(json.dumps(record, sort_keys=True) + "\n")
PY
}

payload_record_key() {
    local payload="$1"
    PAYLOAD_JSON="$payload" python3 - <<'PY'
import json
import os

payload = json.loads(os.environ["PAYLOAD_JSON"])
record = "unknown"
for tag in payload.get("tags") or []:
    if tag.startswith("record:"):
        record = tag.split(":", 1)[1]
        break
print(record)
PY
}

store_state_has() {
    local state_file="$1"
    local record_key="$2"
    local status="$3"
    [ -f "$state_file" ] || return 1
    python3 - "$state_file" "$record_key" "$status" <<'PY'
import json
import sys

state_file, record_key, status = sys.argv[1:4]
found = False
with open(state_file, errors="replace") as handle:
    for line in handle:
        line = line.strip()
        if not line:
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError:
            continue
        if record.get("record") == record_key and record.get("status") == status:
            found = True
            break
sys.exit(0 if found else 1)
PY
}

append_store_state() {
    local state_file="$1"
    local record_key="$2"
    local status="$3"
    mkdir -p "$(dirname "$state_file")"
    python3 - "$state_file" "$record_key" "$status" <<'PY'
import json
import sys
from datetime import datetime, timezone

state_file, record_key, status = sys.argv[1:4]
record = {
    "record": record_key,
    "status": status,
    "updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
}
with open(state_file, "a") as handle:
    handle.write(json.dumps(record, sort_keys=True) + "\n")
PY
}

write_brainlayer_status() {
    local stream_dir="$1"
    local status="$2"
    local stored_count="$3"
    local queued_count="$4"
    local total_count="$5"
    local replay_file="$6"
    {
        printf 'status=%s\n' "$status"
        printf 'stored_count=%s\n' "$stored_count"
        printf 'queued_count=%s\n' "$queued_count"
        printf 'total_count=%s\n' "$total_count"
        printf 'replay_file=%s\n' "$replay_file"
        printf 'updated_at=%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    } > "$stream_dir/.brainlayer-status"
}

ingest_run() {
    local stream_dir="$1"
    local dry_run="$2"
    [ -d "$stream_dir" ] || { echo "ingest-run: stream directory not found: $stream_dir" >&2; return 2; }

    local payloads_file pending_file replay_file state_file total_count stored_count queued_count payload status record_key batch_status
    payloads_file="$(mktemp)"
    pending_file="$(mktemp)"
    replay_file="$stream_dir/orphaned_stores.jsonl"
    state_file="$stream_dir/.brainlayer-store-state.jsonl"
    build_brain_payloads "$stream_dir" > "$payloads_file"
    total_count=$(wc -l < "$payloads_file" | tr -d ' ')
    stored_count=0
    queued_count=0

    if [ "$dry_run" = "1" ]; then
        cat "$payloads_file"
        rm -f "$payloads_file" "$pending_file"
        return 0
    fi

    while IFS= read -r payload; do
        [ -n "$payload" ] || continue
        record_key="$(payload_record_key "$payload")"
        if store_state_has "$state_file" "$record_key" "stored"; then
            stored_count=$((stored_count + 1))
            continue
        fi
        printf '%s\n' "$payload" >> "$pending_file"
    done < "$payloads_file"

    batch_status=0
    if [ -s "$pending_file" ]; then
        store_payloads "$pending_file" "$state_file" || batch_status=$?
    fi

    while IFS= read -r payload; do
        [ -n "$payload" ] || continue
        record_key="$(payload_record_key "$payload")"
        if store_state_has "$state_file" "$record_key" "stored"; then
            stored_count=$((stored_count + 1))
        else
            if ! store_state_has "$state_file" "$record_key" "queued"; then
                queue_payload "$replay_file" "brain_store_failed" "$payload"
                append_store_state "$state_file" "$record_key" "queued"
            fi
            queued_count=$((queued_count + 1))
        fi
    done < "$pending_file"

    rm -f "$payloads_file" "$pending_file"

    if [ "$batch_status" -ne 0 ]; then
        printf 'BrainLayer batch process exited with status %s; unfinished payloads were queued\n' "$batch_status" >&2
    fi

    if [ "$queued_count" -gt 0 ] || [ "$((stored_count + queued_count))" -ne "$total_count" ]; then
        status="queued"
    else
        status="stored"
    fi
    write_brainlayer_status "$stream_dir" "$status" "$stored_count" "$queued_count" "$total_count" "$replay_file"
    if [ "$queued_count" -eq 0 ] && [ "$((stored_count + queued_count))" -eq "$total_count" ]; then
        mark_stalker_stage_done "$stream_dir" "brainlayer"
    fi
}

queue_unfinished_run() {
    local stream_dir="$1"
    local reason="$2"
    [ -d "$stream_dir" ] || { echo "queue-run: stream directory not found: $stream_dir" >&2; return 2; }

    local payloads_file replay_file state_file total_count stored_count queued_count payload record_key status
    payloads_file="$(mktemp)"
    replay_file="$stream_dir/orphaned_stores.jsonl"
    state_file="$stream_dir/.brainlayer-store-state.jsonl"
    build_brain_payloads "$stream_dir" > "$payloads_file"
    total_count=$(wc -l < "$payloads_file" | tr -d ' ')
    stored_count=0
    queued_count=0

    while IFS= read -r payload; do
        [ -n "$payload" ] || continue
        record_key="$(payload_record_key "$payload")"
        if store_state_has "$state_file" "$record_key" "stored"; then
            stored_count=$((stored_count + 1))
            continue
        fi
        if ! store_state_has "$state_file" "$record_key" "queued"; then
            queue_payload "$replay_file" "$reason" "$payload"
            append_store_state "$state_file" "$record_key" "queued"
        fi
        queued_count=$((queued_count + 1))
    done < "$payloads_file"

    rm -f "$payloads_file"
    if [ "$queued_count" -eq 0 ] && [ "$((stored_count + queued_count))" -eq "$total_count" ]; then
        status="stored"
        mark_stalker_stage_done "$stream_dir" "brainlayer"
    else
        status="queued"
    fi
    write_brainlayer_status "$stream_dir" "$status" "$stored_count" "$queued_count" "$total_count" "$replay_file"
}

build_digest_body() {
    local stalker_root="$1"
    local digest_date="$2"
python3 - "$stalker_root" "$digest_date" <<'PY'
from datetime import datetime
import json
import re
import sys
from pathlib import Path

root = Path(sys.argv[1])
digest_date = sys.argv[2]

dirs = sorted([p for p in root.iterdir() if p.is_dir() and digest_date in p.name]) if root.exists() else []

COMPLETION_MARKERS = [
    ".stage-process.done",
    ".stage-archive.done",
    ".stage-brainlayer.done",
    ".stage-notified.done",
    ".brainlayer-status",
    "_DRIVE-LEDGER.md",
]

# packages/claude/src/lib/notify-server.ts rejects request bodies above 4096
# bytes and slices accepted notification bodies at 2000 JavaScript UTF-16 code
# units. Keep every digest below both limits, with room for the JSON envelope.
FAILED_DIGEST_BODY_JSON_LIMIT_BYTES = 1200
NOTIFICATION_BODY_UTF16_LIMIT = 2000
NOTIFICATION_BODY_JSON_LIMIT_BYTES = 3600

def notification_body_json_bytes(value):
    return len(json.dumps(value).encode("utf-8"))

def notification_body_utf16_units(value):
    return len(value.encode("utf-16-le")) // 2

def fits_notification_body(value):
    return (
        notification_body_utf16_units(value) <= NOTIFICATION_BODY_UTF16_LIMIT
        and notification_body_json_bytes(value) <= NOTIFICATION_BODY_JSON_LIMIT_BYTES
    )

def render_bounded_failure(full_lines, mandatory_lines, detail_blocks, total_dropped):
    full_message = "\n".join(full_lines)
    if notification_body_json_bytes(full_message) <= FAILED_DIGEST_BODY_JSON_LIMIT_BYTES:
        return full_message

    bounded_lines = list(mandatory_lines)
    shown = 0
    for block in detail_blocks:
        next_shown = shown + 1
        marker = (
            f"… details truncated: {next_shown} of {total_dropped} dropped runs shown; "
            f"{total_dropped} total."
        )
        candidate = "\n".join(bounded_lines + block + [marker])
        if notification_body_json_bytes(candidate) > FAILED_DIGEST_BODY_JSON_LIMIT_BYTES:
            break
        bounded_lines.extend(block)
        shown = next_shown

    if shown < total_dropped:
        marker = (
            f"… details truncated: {shown} of {total_dropped} dropped runs shown; "
            f"{total_dropped} total."
        )
    else:
        marker = "… digest truncated to fit notification limit."
    bounded_message = "\n".join(bounded_lines + [marker])
    if notification_body_json_bytes(bounded_message) > FAILED_DIGEST_BODY_JSON_LIMIT_BYTES:
        raise RuntimeError("mandatory failed-digest headline exceeds notification budget")
    return bounded_message

def render_bounded_digest(full_lines, summary_lines, dropped_names, warning_lines, moment_blocks, drive_lines):
    full_message = "\n".join(full_lines)
    if fits_notification_body(full_message):
        return full_message

    bounded_lines = list(summary_lines)
    shown_drops = 0
    if dropped_names:
        bounded_lines.extend(["", "DROPPED (not counted above):"])
        for name in dropped_names:
            next_shown = shown_drops + 1
            marker = (
                f"… digest truncated: {next_shown} of {len(dropped_names)} dropped runs shown; "
                "notification limit reached."
            )
            candidate = "\n".join(bounded_lines + [f"- {name}", marker])
            if not fits_notification_body(candidate):
                break
            bounded_lines.append(f"- {name}")
            shown_drops = next_shown

        if shown_drops < len(dropped_names):
            marker = (
                f"… digest truncated: {shown_drops} of {len(dropped_names)} dropped runs shown; "
                "notification limit reached."
            )
            bounded_message = "\n".join(bounded_lines + [marker])
            if not fits_notification_body(bounded_message):
                raise RuntimeError("mandatory digest verdict exceeds notification budget")
            return bounded_message

    marker = "… digest truncated to fit notification limit."
    optional_blocks = []
    if warning_lines:
        optional_blocks.append(["", "Warnings: " + "; ".join(warning_lines)])
    optional_blocks.append(["", "Top moments:"])
    optional_blocks.extend(moment_blocks)
    if drive_lines:
        optional_blocks.append([""] + drive_lines)

    for block in optional_blocks:
        candidate = "\n".join(bounded_lines + block + [marker])
        if not fits_notification_body(candidate):
            continue
        bounded_lines.extend(block)

    bounded_message = "\n".join(bounded_lines + [marker])
    if not fits_notification_body(bounded_message):
        raise RuntimeError("mandatory digest verdict exceeds notification budget")
    return bounded_message

def has_completion_signal(run_dir):
    return any((run_dir / marker).exists() for marker in COMPLETION_MARKERS)

processed = [p for p in dirs if not (p / ".orphan-tail").exists() and has_completion_signal(p)]
dropped = [p for p in dirs if p not in processed]
failed_drops = [p for p in dropped if not (p / ".orphan-tail").exists()]

if not dirs:
    print(f"no runs recorded for {digest_date}")
    raise SystemExit(75)

if not processed:
    noun = "directory" if len(dirs) == 1 else "directories"
    mandatory_lines = [
        "🚨 Digest failure: no confident summary was produced.",
        f"Found {len(dirs)} matching run {noun}, but none were eligible for processing",
        "Dropped runs:",
    ]
    detail_blocks = []
    for run_dir in dirs:
        if (run_dir / ".orphan-tail").exists():
            reason = ".orphan-tail present"
        else:
            missing = [marker for marker in COMPLETION_MARKERS if not (run_dir / marker).exists()]
            reason = "missing completion markers: " + ", ".join(missing)
        block = [f"- {run_dir.name}: {reason}"]

        gems_file = run_dir / "gems.md"
        if gems_file.exists():
            heading_count = sum(
                1 for line in gems_file.read_text(errors="replace").splitlines()
                if re.match(r"^### \[", line)
            )
            heading_noun = "heading" if heading_count == 1 else "headings"
            block.append(f"  gems.md exists on disk ({heading_count} curated {heading_noun})")

        chat_file = run_dir / "chat.log"
        if chat_file.exists():
            line_count = len(chat_file.read_text(errors="replace").splitlines())
            line_noun = "line" if line_count == 1 else "lines"
            block.append(f"  chat.log exists on disk ({line_count} {line_noun})")
        detail_blocks.append(block)
    full_lines = mandatory_lines + [line for block in detail_blocks for line in block]
    print(render_bounded_failure(full_lines, mandatory_lines, detail_blocks, len(dirs)))
    raise SystemExit(75)

def capitalize_label(value):
    value = value.replace("_", " ").replace("-", " ").strip()
    return value[:1].upper() + value[1:] if value else "Unknown"

def streamer_from_run(run_dir):
    match = re.match(r"^(.+?)-\d{4}-\d{2}-\d{2}(?:-|$)", run_dir.name)
    if match:
        return match.group(1)
    return run_dir.name.rsplit(".", 1)[0] or "unknown"

def display_date(value):
    try:
        return datetime.strptime(value, "%Y-%m-%d").strftime("%b %-d")
    except ValueError:
        return value

def format_duration(seconds):
    if seconds <= 0:
        return "duration unknown"
    minutes = int(round(seconds / 60))
    hours, mins = divmod(minutes, 60)
    if hours and mins:
        return f"{hours}h{mins:02d}m"
    if hours:
        return f"{hours}h"
    return f"{mins}m"

def chat_count(run_dir):
    chat = run_dir / "chat.log"
    if not chat.exists():
        return 0
    return len(chat.read_text(errors="replace").splitlines())

def parse_ledger(run_dir):
    ledger = run_dir / "_DRIVE-LEDGER.md"
    target = ""
    durations = []
    if not ledger.exists():
        return target, durations
    for line in ledger.read_text(errors="replace").splitlines():
        if line.startswith("- Drive Target:"):
            target = line.split(":", 1)[1].strip()
            continue
        if not line.startswith("|"):
            continue
        parts = [part.strip() for part in line.strip().strip("|").split("|")]
        if len(parts) < 4:
            continue
        path, duration = parts[0], parts[3]
        if path in {"video.mp4", "video.ts", "video-compressed.mp4"} and re.fullmatch(r"\d+(?:\.\d+)?", duration):
            durations.append(float(duration))
    return target, durations

def short_drive_tail(target, fallback_channel):
    parts = [part for part in Path(target).parts if part not in {"/", ""}] if target else []
    if "stalker-golem" in parts:
        index = parts.index("stalker-golem")
        tail = parts[index:index + 3]
        if len(tail) >= 3:
            tail[2] = digest_date
            return "/".join(tail)
    return f"stalker-golem/{fallback_channel}/{digest_date}"

def parse_gems(run_dir):
    gems_file = run_dir / "gems.md"
    if not gems_file.exists():
        return [], False

    gems = []
    current = None
    saw_heading = False
    heading_re = re.compile(r"^### \[(?P<timestamp>[0-9:]+)\]\s*(?:Segment\s+\d+\s*)?(?:\((?P<duration>[^)]+)\)\s*)?(?P<title>.+?)\s*$")
    score_re = re.compile(r"^\*\*Score:\*\*\s*(?P<score>\d+(?:\.\d+)?)/10\s*\|\s*\*\*Type:\*\*\s*(?P<type>.+?)\s*$")
    gist_re = re.compile(r"^\*\*Gist:\*\*\s*(?P<gist>.+?)\s*$")

    for line in gems_file.read_text(errors="replace").splitlines():
        heading = heading_re.match(line)
        if heading:
            saw_heading = True
            if current and current.get("score") is not None:
                gems.append(current)
            current = {
                "timestamp": heading.group("timestamp"),
                "duration": heading.group("duration") or "",
                "title": heading.group("title").strip(),
                "score": None,
                "type": "",
                "gist": "",
                "run": run_dir.name,
            }
            continue
        if current:
            score = score_re.match(line)
            if score:
                current["score"] = float(score.group("score"))
                current["type"] = score.group("type").strip()
                continue
            gist = gist_re.match(line)
            if gist:
                current["gist"] = gist.group("gist").strip()

    if current and current.get("score") is not None:
        gems.append(current)
    return gems, saw_heading

ledger_dirs = []
missing_ledgers = []
drive_targets = []
gems_files_seen = 0
cleanup_skipped = []
all_gems = []
saw_any_gem_heading = False
total_chat = 0
total_duration = 0

for run_dir in processed:
    target, durations = parse_ledger(run_dir)
    if target or (run_dir / "_DRIVE-LEDGER.md").exists():
        ledger_dirs.append(run_dir)
        if target:
            drive_targets.append(target)
        if durations:
            total_duration += max(durations)
    else:
        missing_ledgers.append(run_dir.name)

    parsed_gems, saw_heading = parse_gems(run_dir)
    if (run_dir / "gems.md").exists():
        gems_files_seen += 1
    saw_any_gem_heading = saw_any_gem_heading or saw_heading
    all_gems.extend(parsed_gems)
    total_chat += chat_count(run_dir)

    if (run_dir / ".archive-cleanup-skipped").exists():
        cleanup_skipped.append(run_dir.name)

main_run = processed[0] if processed else None
streamer_key = streamer_from_run(main_run) if main_run else "unknown"
streamer = capitalize_label(streamer_key)
backup_status = "☁️ backed up" if processed and len(ledger_dirs) == len(processed) else "⚠️ not backed up"

lines = [
    f"🎬 {streamer} — {display_date(digest_date)} · {format_duration(total_duration)}",
    f"💎 {len(all_gems)} gems · {total_chat} chat · {backup_status}",
    "",
    "Top moments:",
]
moment_blocks = []

if all_gems:
    def sort_key(gem):
        timestamp_seconds = 0
        for part in gem["timestamp"].split(":"):
            timestamp_seconds = timestamp_seconds * 60 + int(part)
        return (-gem["score"], timestamp_seconds)

    for gem in sorted(all_gems, key=sort_key)[:8]:
        score_value = int(gem["score"]) if gem["score"].is_integer() else gem["score"]
        emoji = "🔥" if gem["score"] >= 8 else "💎" if gem["score"] >= 7 else "•"
        details = f" ({gem['type']})" if gem["type"] else ""
        block = [f"{emoji} {score_value}/10 · {gem['timestamp']} · {gem['title']}{details}"]
        if gem.get("gist"):
            block.append(gem["gist"])
        moment_blocks.append(block)
        lines.extend(block)
else:
    if gems_files_seen == 0:
        reason = "no gems.md found for processed runs"
    elif not saw_any_gem_heading:
        reason = "gems.md files contain no curated headings"
    else:
        reason = "gems.md files contain no scored highlights"
    moment_blocks.append([f"No highlights found — {reason}"])
    lines.extend(moment_blocks[-1])

drive_lines = []
if drive_targets:
    drive_lines.append(f"📁 Brain Drive › {short_drive_tail(drive_targets[0], streamer_key)}")
elif main_run:
    drive_lines.append(f"📁 Brain Drive › {short_drive_tail('', streamer_key)}")
if drive_lines:
    lines.extend([""] + drive_lines)

warnings = []
if missing_ledgers:
    warnings.append("Missing Drive ledger: " + ", ".join(missing_ledgers))
if cleanup_skipped:
    warnings.append("WARNING: cleanup skipped - originals retained; Drive re-verify failed: " + ", ".join(cleanup_skipped))
if dropped:
    warnings.append("DROPPED (not counted above): " + ", ".join(run_dir.name for run_dir in dropped))

if warnings:
    lines.extend(["", "Warnings: " + "; ".join(warnings)])

if failed_drops:
    mandatory_lines = [
        lines[0],
        lines[1],
        "",
        "DROPPED (not counted above):",
    ]
    detail_blocks = [[f"- {run_dir.name}"] for run_dir in dropped]
    print(render_bounded_failure(lines, mandatory_lines, detail_blocks, len(dropped)))
else:
    summary_lines = lines[:2]
    non_drop_warnings = [warning for warning in warnings if not warning.startswith("DROPPED (not counted above):")]
    print(render_bounded_digest(
        lines,
        summary_lines,
        [run_dir.name for run_dir in dropped],
        non_drop_warnings,
        moment_blocks,
        drive_lines,
    ))
if failed_drops:
    raise SystemExit(75)
PY
}

send_digest() {
    local stalker_root="$1"
    local digest_date="$2"
    local dry_run="$3"
    [ -d "$stalker_root" ] || { echo "digest: stalker root not found: $stalker_root" >&2; return 2; }

    local title body digest_status telegram_status
    stalker_reconcile_interrupted_scoring_root "$stalker_root"
    title="Stalker Morning Digest - ${digest_date}"
    if body="$(build_digest_body "$stalker_root" "$digest_date")"; then
        digest_status=0
    else
        digest_status=$?
        if [ "$body" != "no runs recorded for ${digest_date}" ]; then
            title="Stalker Morning Digest FAILED - ${digest_date}"
        fi
    fi

    if [ "$dry_run" = "1" ]; then
        printf '%s\n%s\n' "$title" "$body"
        return "$digest_status"
    fi

    telegram_status=0
    if notify_stalker_telegram "$title" "$body" "default" "stalker-golem"; then
        telegram_status=0
    else
        telegram_status=$?
    fi
    if [ "$telegram_status" -ne 0 ]; then
        return "$telegram_status"
    fi
    return "$digest_status"
}

main() {
    [ "$#" -ge 1 ] || { usage; exit 2; }
    local command="$1"
    shift

    case "$command" in
        ingest-run)
            [ "$#" -ge 1 ] || { usage; exit 2; }
            local stream_dir="$1"
            shift
            local dry_run=0
            is_dry_run_env && dry_run=1
            while [ "$#" -gt 0 ]; do
                case "$1" in
                    --dry-run) dry_run=1 ;;
                    *) echo "Unknown ingest-run option: $1" >&2; usage; exit 2 ;;
                esac
                shift
            done
            ingest_run "$stream_dir" "$dry_run"
            ;;
        queue-run)
            [ "$#" -eq 2 ] || { usage; exit 2; }
            queue_unfinished_run "$1" "$2"
            ;;
        digest)
            [ "$#" -ge 2 ] || { usage; exit 2; }
            local stalker_root="$1"
            local digest_date="$2"
            shift 2
            local dry_run=0
            if is_dry_run_env || [ "${STALKER_TELEGRAM_DRY_RUN:-0}" = "1" ]; then
                dry_run=1
            fi
            while [ "$#" -gt 0 ]; do
                case "$1" in
                    --dry-run) dry_run=1 ;;
                    *) echo "Unknown digest option: $1" >&2; usage; exit 2 ;;
                esac
                shift
            done
            send_digest "$stalker_root" "$digest_date" "$dry_run"
            ;;
        *)
            echo "Unknown command: $command" >&2
            usage
            exit 2
            ;;
    esac
}

main "$@"
