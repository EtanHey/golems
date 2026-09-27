"""Format stalker digest facts and preserve the shell-facing Python stdin contract."""
from datetime import datetime
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import sys


def _load_data_module():
    # The shell executes this file on stdin, so __file__ is <stdin>. Resolve
    # against the entry's real location; never search sys.path by module name.
    module_path = Path(os.environ.get(
        "STALKER_DIGEST_DATA_PATH",
        Path(__file__).resolve().with_name("digest-data.py"),
    )).resolve()
    name = "_stalker_digest_data_" + hashlib.sha256(os.fsencode(module_path)).hexdigest()
    module = sys.modules.get(name)
    if module is None:
        spec = importlib.util.spec_from_file_location(name, module_path)
        module = importlib.util.module_from_spec(spec)
        sys.modules[name] = module
        previous_bytecode_setting = sys.dont_write_bytecode
        sys.dont_write_bytecode = True
        try:
            spec.loader.exec_module(module)
        except BaseException:
            del sys.modules[name]
            raise
        finally:
            sys.dont_write_bytecode = previous_bytecode_setting
    return module


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

def short_drive_tail(target, fallback_channel, digest_date):
    parts = [part for part in Path(target).parts if part not in {"/", ""}] if target else []
    if "stalker-golem" in parts:
        index = parts.index("stalker-golem")
        tail = parts[index:index + 3]
        if len(tail) >= 3:
            tail[2] = digest_date
            return "/".join(tail)
    return f"stalker-golem/{fallback_channel}/{digest_date}"

def render_digest(data):
    digest_date = data.digest_date
    dirs = data.dirs
    processed = data.processed
    dropped = data.dropped
    failed_drops = data.failed_drops
    ledger_dirs = data.ledger_dirs
    missing_ledgers = data.missing_ledgers
    drive_targets = data.drive_targets
    gems_files_seen = data.gems_files_seen
    cleanup_skipped = data.cleanup_skipped
    all_gems = data.all_gems
    saw_any_gem_heading = data.saw_any_gem_heading
    total_chat = data.total_chat
    total_duration = data.total_duration

    if not dirs:
        return f"no runs recorded for {digest_date}", 75
    if not processed:
        noun = "directory" if len(dirs) == 1 else "directories"
        mandatory_lines = [
            "🚨 Digest failure: no confident summary was produced.",
            f"Found {len(dirs)} matching run {noun}, but none were eligible for processing",
            "Dropped runs:",
        ]
        detail_blocks = data.failure_details
        full_lines = mandatory_lines + [line for block in detail_blocks for line in block]
        return render_bounded_failure(full_lines, mandatory_lines, detail_blocks, len(dirs)), 75

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
        drive_lines.append(f"📁 Brain Drive › {short_drive_tail(drive_targets[0], streamer_key, digest_date)}")
    elif main_run:
        drive_lines.append(f"📁 Brain Drive › {short_drive_tail('', streamer_key, digest_date)}")
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
        message = render_bounded_failure(lines, mandatory_lines, detail_blocks, len(dropped))
    else:
        summary_lines = lines[:2]
        non_drop_warnings = [warning for warning in warnings if not warning.startswith("DROPPED (not counted above):")]
        message = render_bounded_digest(
            lines,
            summary_lines,
            [run_dir.name for run_dir in dropped],
            non_drop_warnings,
            moment_blocks,
            drive_lines,
        )
    return message, 75 if failed_drops else 0

def main(argv):
    data = _load_data_module().collect_digest(argv[1], argv[2])
    message, status = render_digest(data)
    print(message)
    return status


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
