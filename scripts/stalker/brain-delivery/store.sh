#!/bin/bash
# Sourced by the public stalker-brainlayer-telegram.sh entry.

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
