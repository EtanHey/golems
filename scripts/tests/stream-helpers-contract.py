#!/usr/bin/env python3
"""Byte goldens recorded ONLY from the pinned, untouched pre-split tree.

Run normally to check the current tree. --record BASE_ROOT additionally verifies
the base files against git objects before writing fixtures. No network/model
commands are real; each subprocess has a fresh HOME and stub command directory.
"""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

BASE = "70b7833f91f3cf2f683214829fc15baf775bc4a7"
ROOT = Path(__file__).resolve().parents[2]
FIXTURES = Path(__file__).parent / "fixtures/stream-helpers-contract"
ENTRY = "scripts/lib/stream-helpers.sh"
BASH = os.environ.get("STREAM_CONTRACT_BASH", "/bin/bash")

# These cases deliberately exercise failure as a simple command AND in an if:
# bash errexit behavior depends on call context, including command substitution.
CASES = {
    "source": '''
set -- 'argument one' two
set -euo pipefail
trap 'echo trap-on-exit' EXIT
source "$ENTRY" > source.stdout 2> source.stderr
printf '%s\\n' "$0" "$@" "$PWD" "$STREAM_HELPERS_DIR"
trap -p EXIT
set -o | grep -E 'errexit|nounset|pipefail'
declare -F
''',
    "boundaries": '''
set -o pipefail
printf '' | parse_silence_timestamps; echo silence:$?
count_chat_lines ''; file_size_bytes missing
compress_video_h264 '' ''; echo compress:$?
compress_video_h264 missing out; echo missing:$?
touch input out
compress_video_h264 input out; echo overwrite:$?
video_duration_seconds missing; echo duration:$?
stalker_stream_start_epoch bad; echo epoch:$?
stalker_stream_duration_seconds missing; echo stream:$?
stalker_orphan_tail_reason missing channel bad; echo orphan:$?
stalker_abs_dir nonexistent; stalker_format_duration invalid
stalker_format_duration 3723
stalker_ytdlp_record_args '' '' ''; echo args:$?
stalker_ytdlp_record_args best 'file name.ts' 'https://fixture.invalid/live'
durations_match N/A 2; echo match:$?
stalker_file_mtime missing
stalker_terminate_process_tree invalid; echo terminate:$?
stalker_watch_file_growth file invalid; echo watch:$?
stalker_terminate_scorer_tree 1; echo scorer:$?
stalker_process_start_identity invalid; echo identity:$?
stalker_latest_stamped_stream_dir missing channel
stalker_score_parallel_limit 0
stalker_circuit_next_state 0 2 failure; stalker_circuit_next_state 1 3 success
stalker_circuit_next_state bad 0 success; echo circuit:$?
stalker_acquire_circuit_lock missing; echo lock:$?
stalker_merge_score_results missing gems.md; echo merge:$?
stalker_gems_complete missing; echo complete:$?
stalker_stage_status_summary missing
stalker_resolve_command absent-fixture-command; echo resolve:$?
STREAM_WHATSAPP_NOTIFY=0 notify_stalker_whatsapp body
notify_stalker_whatsapp body
''',
    "media-scoring": '''
printf 'line1\\nline2\\n' > input
count_chat_lines input; file_size_bytes input
compress_video_h264 input compressed 25 fast; echo compress:$?
video_duration_seconds input
mkdir -p results/segment-002 results/segment-001 circuit
printf '### [00:01] first\\n' > results/segment-001/gem.md
printf '### [00:02] second\\n' > results/segment-002/gem.md
stalker_acquire_circuit_lock circuit; echo lock:$?
stalker_merge_score_results results gems.md
stalker_gems_complete gems.md; echo partial:$?
printf 'Scored: fixture\\n' >> gems.md
stalker_gems_complete gems.md; echo complete:$?
''',
    "notifications-success": '''
STREAM_WHATSAPP_RECIPIENT=fixture notify_stalker_whatsapp $'Message\\nline'; echo whatsapp:$?
''',
    "notifications-refusal": '''
export FIXTURE_FAIL=99
STREAM_WHATSAPP_RECIPIENT=fixture notify_stalker_whatsapp body; echo whatsapp:$?
''',
    "transcription-retry": '''
touch segment.wav model.bin
export FIXTURE_FAIL=2 STALKER_RETRY_SLEEP_BASE=1
transcribe_with_whisper_server segment.wav 3; echo server:$?
transcribe_with_whisper_cli segment.wav model.bin 3; echo cli:$?
''',
    "transcription-fallback": '''
touch segment.wav model.bin
export FIXTURE_CURL_FAIL=99
transcribe_segment_with_fallback segment.wav model.bin segment-001 out; echo fallback:$?
''',
    "transcription-refusal": '''
touch segment.wav model.bin
export FIXTURE_FAIL=99
transcribe_segment_with_fallback segment.wav model.bin segment-001 out; echo fallback:$?
transcribe_with_whisper_cli segment.wav missing 3; echo model:$?
''',
    "errexit-direct": '''
touch segment.wav model.bin
export FIXTURE_FAIL=99
set -e
transcribe_with_whisper_cli segment.wav model.bin 3
echo must-not-reach
''',
    "errexit-conditional": '''
touch segment.wav model.bin
export FIXTURE_FAIL=99
set -e
if transcribe_with_whisper_cli segment.wav model.bin 3; then echo unexpected; else echo refused; fi
echo survived
''',
    "stages": '''
mkdir -p run
printf 'line1\\nline2\\n' > run/chat.log
stalker_stage_done run scoring; echo absent:$?
stalker_mark_scoring_started run invalid
printf 'partial\\n' > run/gems.md
stalker_reconcile_interrupted_scoring_root .
stalker_stage_status_summary run
stalker_require_run_quality run; echo refused:$?
printf '### [00:01] gem\\nScored: fixture\\n' > run/gems.md
stalker_require_run_quality run; echo quality:$?
mark_stalker_stage_done run scoring
stalker_stage_done run scoring; echo done:$?
stalker_stage_status_summary run
''',
}

STUB = '''import json, os, pathlib, sys
name = pathlib.Path(sys.argv[0]).name
root = pathlib.Path(os.environ["DATA"])
args = sys.argv[1:]
if name == "date":
    print("20260102T030405Z" if args[-1] == "+%Y%m%dT%H%M%SZ" else "2026-01-02T03:04:05Z")
    sys.exit(0)
record = {"command": name, "argv": args}
with (root / "commands.jsonl").open("a") as f: f.write(json.dumps(record) + "\\n")
if name == "sleep": sys.exit(0)
counter = root / (name + ".count")
count = int(counter.read_text()) + 1 if counter.exists() else 1
counter.write_text(str(count))
fail = int(os.environ.get("FIXTURE_CURL_FAIL" if name == "curl" else "FIXTURE_FAIL", os.environ.get("FIXTURE_FAIL", "0")))
if count <= fail:
    print(name + " fixture failure", file=sys.stderr)
    sys.exit(7)
if name == "ffmpeg":
    pathlib.Path(args[-1]).write_bytes(b"fixture compressed media\\n")
    print("ffmpeg fixture output")
elif name == "ffprobe": print("123.456")
elif name in ("curl", "whisper-cli"): print('{"text":"fixture transcript"}')
'''


def capture(root, case):
    # Runtime sandboxes are ephemeral; no receipts or fixtures live in /tmp.
    with tempfile.TemporaryDirectory(prefix="stream-contract-") as directory:
        sandbox = Path(directory).resolve()
        data, bin_dir = sandbox / "data", sandbox / "bin"
        data.mkdir()
        bin_dir.mkdir()
        for command in ("date", "curl", "whisper-cli", "sleep", "ffmpeg", "ffprobe"):
            path = bin_dir / command
            path.write_text(f"#!{sys.executable}\n" + STUB)
            path.chmod(0o755)
        env = {"PATH": str(bin_dir) + os.pathsep + os.environ["PATH"],
               "HOME": str(sandbox / "home"), "LC_ALL": "C", "TZ": "UTC",
               "ENTRY": str(root / ENTRY), "DATA": str(data), "BIN": str(bin_dir),
               "STALKER_WHATSAPP_QUEUE_DIR": str(data / "whatsapp-queue"),
               "STALKER_WHATSAPP_ENDPOINTS": "http://fixture.invalid/one http://fixture.invalid/two",
               "STALKER_RETRY_SLEEP_BASE": "0"}
        code = CASES[case] if case == "source" else 'source "$ENTRY"\n' + CASES[case]
        result = subprocess.run([BASH, "-c", code, "fixture-caller"], cwd=data,
                                env=env, capture_output=True, timeout=20)

        def normalize(value):
            # ONLY sandbox/source roots and validated queue pid/random components
            # vary. Contents remain raw bytes: never parse/re-serialize JSON.
            value = value.replace(str(sandbox).encode(), b"<SANDBOX>")
            value = value.replace(str(root / "scripts/lib").encode(), b"<LIB>")
            return re.sub(rb"20260102T030405Z-[0-9]+-[0-9]+-stalker-", b"20260102T030405Z-<PID>-<RANDOM>-stalker-", value).decode()

        files = {normalize(str(p.relative_to(data)).encode()): normalize(p.read_bytes())
                 for p in sorted(data.rglob("*")) if p.is_file()}
        return {"stdout": normalize(result.stdout), "stderr": normalize(result.stderr),
                "exit": result.returncode, "files": files}


def main():
    record = len(sys.argv) > 1 and sys.argv[1] == "--record"
    root = Path(sys.argv[2]).resolve() if record else Path(os.environ.get("STREAM_CONTRACT_ROOT", ROOT)).resolve()
    if record:
        for relative in (ENTRY, "scripts/lib/portable-stat.sh"):
            original = subprocess.check_output(["git", "show", f"{BASE}:{relative}"], cwd=ROOT)
            assert (root / relative).read_bytes() == original, "recording requires untouched base"
        FIXTURES.mkdir(parents=True, exist_ok=True)
    for case in CASES:
        actual = capture(root, case)
        fixture = FIXTURES / f"{case}.json"
        if record:
            fixture.write_text(json.dumps(actual, indent=2) + "\n")
        else:
            expected = json.loads(fixture.read_text())
            assert actual == expected, f"{case}: golden mismatch\nEXPECTED {expected!r}\nACTUAL {actual!r}"
        print(f"{case}: {'recorded from base' if record else 'PASS'}")
    if not record:
        with tempfile.TemporaryDirectory(prefix="stream-copy-") as directory:
            copied = Path(directory).resolve()
            shutil.copytree(root / "scripts/lib", copied / "scripts/lib")
            for case in CASES:
                assert capture(copied, case) == json.loads((FIXTURES / f"{case}.json").read_text()), f"copied tree: {case}"
            print("copied library tree: all cases PASS")


if __name__ == "__main__":
    main()
