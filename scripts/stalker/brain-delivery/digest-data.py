"""Read stalker runs and aggregate digest facts without formatting the message."""
from dataclasses import dataclass
import re
from pathlib import Path


@dataclass
class DigestData:
    digest_date: str
    dirs: list
    processed: list
    dropped: list
    failed_drops: list
    failure_details: list
    ledger_dirs: list
    missing_ledgers: list
    drive_targets: list
    gems_files_seen: int
    cleanup_skipped: list
    all_gems: list
    saw_any_gem_heading: bool
    total_chat: int
    total_duration: float


COMPLETION_MARKERS = [
    ".stage-process.done",
    ".stage-archive.done",
    ".stage-brainlayer.done",
    ".stage-notified.done",
    ".brainlayer-status",
    "_DRIVE-LEDGER.md",
]

def has_completion_signal(run_dir):
    return any((run_dir / marker).exists() for marker in COMPLETION_MARKERS)

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

def collect_digest(root, digest_date):
    root = Path(root)
    dirs = sorted([p for p in root.iterdir() if p.is_dir() and digest_date in p.name]) if root.exists() else []
    processed = [p for p in dirs if not (p / ".orphan-tail").exists() and has_completion_signal(p)]
    dropped = [p for p in dirs if p not in processed]
    failed_drops = [p for p in dropped if not (p / ".orphan-tail").exists()]
    failure_details = []
    if dirs and not processed:
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
            failure_details.append(block)

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
    return DigestData(
        digest_date, dirs, processed, dropped, failed_drops, failure_details,
        ledger_dirs, missing_ledgers, drive_targets, gems_files_seen,
        cleanup_skipped, all_gems, saw_any_gem_heading, total_chat, total_duration,
    )
