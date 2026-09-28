#!/bin/bash
# Sourced only by process-stream.sh; no top-level side effects.
# Globals (R/W): derive_stream_labels reads VIDEO, OUT_DIR; writes STREAMER, DATE.
# write_chat_velocity reads OUT_DIR and its three arguments; writes its output file.
# prepare_stream_inputs reads CHAT_LOG, CHAT_IS_JSON, CHAT_TIMESTAMPS_ARE_RELATIVE, OUT_DIR;
# writes CHAT_LOG, CHAT_TIMESTAMPS_ARE_RELATIVE and chat-converted.txt.

derive_stream_labels() {
    local video_base parent_base fallback_date base_no_ext
    video_base="$(basename "$VIDEO")"
    parent_base="$(basename "$OUT_DIR")"
    fallback_date="$(date +%Y-%m-%d)"

    if [[ "$video_base" =~ ^video\.(mp4|ts)$ ]] \
        && [[ "$parent_base" =~ ^(.+)-([0-9]{4})-([0-9]{2})-([0-9]{2})-[0-9]{6}$ ]]; then
        STREAMER="${BASH_REMATCH[1]}"
        DATE="${BASH_REMATCH[2]}-${BASH_REMATCH[3]}-${BASH_REMATCH[4]}"
        return
    fi

    if [[ "$video_base" =~ ^twitch-(.+)-([0-9]{4})-?([0-9]{2})-?([0-9]{2})\.[^.]+$ ]]; then
        STREAMER="${BASH_REMATCH[1]}"
        DATE="${BASH_REMATCH[2]}-${BASH_REMATCH[3]}-${BASH_REMATCH[4]}"
        return
    fi

    base_no_ext="${video_base%.*}"
    STREAMER=$(printf '%s\n' "$base_no_ext" | sed 's/^twitch-//;s/-[0-9]*$//')
    DATE="$fallback_date"
}

write_chat_velocity() {
    local chat_log="$1"
    local velocity_file="$2"
    local timestamps_are_relative="$3"

    python3 - "$chat_log" "$velocity_file" "$OUT_DIR" "$timestamps_are_relative" <<'PY'
import datetime
import os
import re
import sys
import time
from collections import Counter

chat_log, velocity_file, out_dir, timestamps_mode = sys.argv[1:5]
timestamps_are_relative = timestamps_mode == "true"
try:
    time.tzset()
except AttributeError:
    pass

lines = open(chat_log).readlines()
times = []
stream_start_epoch = None
previous_clock_secs = None
day_offset_secs = 0
base_name = os.path.basename(out_dir)
start_match = re.search(r'(\d{4}-\d{2}-\d{2})-(\d{6})$', base_name)
if start_match and not timestamps_are_relative:
    try:
        start_text = f'{start_match.group(1)} {start_match.group(2)}'
        # stream-watcher.sh names directories with local shell date, while its
        # chat lurker writes UTC HH:MM:SS via toISOString(). Convert the local
        # directory timestamp to UTC before comparing chat clock times.
        stream_start_local = datetime.datetime.strptime(start_text, '%Y-%m-%d %H%M%S').astimezone()
        stream_start_epoch = stream_start_local.timestamp()
        stream_start_utc = stream_start_local.astimezone(datetime.timezone.utc)
    except Exception:
        stream_start_epoch = None

for line in lines:
    m = re.match(r'\[(\d{2}):(\d{2}):(\d{2})\]', line)
    if not m:
        continue
    h, mi, s = int(m.group(1)), int(m.group(2)), int(m.group(3))
    clock_secs = h * 3600 + mi * 60 + s
    stream_secs = None
    if timestamps_are_relative:
        stream_secs = clock_secs
    elif stream_start_epoch is not None:
        if previous_clock_secs is not None and clock_secs < previous_clock_secs:
            day_offset_secs += 24 * 3600
        chat_utc = datetime.datetime.combine(
            stream_start_utc.date(),
            datetime.time(h, mi, s),
            tzinfo=datetime.timezone.utc,
        ).timestamp() + day_offset_secs
        # Live watcher chat timestamps are UTC clock times. If a stream crosses
        # UTC midnight, early next-day chat clocks are numerically before the
        # recording start time and must advance before candidate gating.
        while chat_utc < stream_start_epoch:
            chat_utc += 24 * 3600
        stream_secs = max(0, int(round(chat_utc - stream_start_epoch)))
    previous_clock_secs = clock_secs
    times.append((clock_secs, stream_secs))

if not times:
    print('No parseable timestamps')
    raise SystemExit(0)

# Keep the historical first-chat-relative bucket for display, and add
# stream= seconds when the chat source can be aligned to transcript time.
base = times[0][0]
buckets = Counter()
for clock_secs, stream_secs in times:
    rel_bucket = ((clock_secs - base) // 10) * 10
    stream_bucket = rel_bucket if stream_secs is None else (stream_secs // 10) * 10
    buckets[(rel_bucket, stream_bucket)] += 1

avg = len(times) / max(len(buckets), 1)
with open(velocity_file, 'w') as f:
    f.write(f'# Chat velocity (msgs per 10s) | avg: {avg:.1f}\n')
    for rel_bucket, stream_bucket in sorted(buckets):
        count = buckets[(rel_bucket, stream_bucket)]
        marker = ' <<<' if count > avg * 2 else ''
        mins, secs = divmod(rel_bucket, 60)
        stream_part = ''
        if timestamps_are_relative or stream_start_epoch is not None:
            smins, ssecs = divmod(stream_bucket, 60)
            stream_part = f' stream={stream_bucket} [{smins:02d}:{ssecs:02d}]'
        f.write(f'{rel_bucket} {count} [{mins:02d}:{secs:02d}]{stream_part}{marker}\n')

spikes = [(b, c) for b, c in buckets.items() if c > avg * 2]
print(f'  {len(times)} messages, {len(buckets)} windows, {len(spikes)} velocity spikes')
PY
}

prepare_stream_inputs() {
# --- Convert JSON chat to text format if needed ---
if [ -n "$CHAT_LOG" ] && [ "$CHAT_IS_JSON" = true ] && [ -f "$CHAT_LOG" ]; then
    CHAT_TEXT="$OUT_DIR/chat-converted.txt"
    if [ ! -f "$CHAT_TEXT" ]; then
        log "Converting JSON chat to text format..."
        python3 -c "
import json
with open('$CHAT_LOG') as f:
    messages = json.load(f)
with open('$CHAT_TEXT', 'w') as f:
    for m in messages:
        secs = int(m.get('time_s', 0))
        h, rem = divmod(secs, 3600)
        mins, s = divmod(rem, 60)
        f.write(f'[{h:02d}:{mins:02d}:{s:02d}] {m[\"user\"]}: {m[\"message\"]}\n')
print(f'  Converted {len(messages)} messages')
" 2>/dev/null
    fi
    CHAT_LOG="$CHAT_TEXT"
    CHAT_TIMESTAMPS_ARE_RELATIVE=true
fi

if [ -n "$CHAT_LOG" ]; then
    case "$(basename "$CHAT_LOG")" in
        chat-converted.txt|chat.txt) CHAT_TIMESTAMPS_ARE_RELATIVE=true ;;
    esac
fi

}
