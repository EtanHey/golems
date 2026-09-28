#!/usr/bin/env python3
"""Base-recorded, whole-pipeline process-stream command/file contract."""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
ENTRY = "scripts/stalker/process-stream.sh"
BASE = "fe31e3d554598ec0b2e218f54b66344a1ca5d6f7"
FIXTURES = Path(__file__).parent / "fixtures/process-stream-contract"
RUN_NAME = "examplechannel-2026-06-25-040516"
CASES = ("fresh", "resume", "rescore", "no-scorer", "fallback-success",
         "fallback-failure", "parallel-order", "transcription-failure",
         "chat-json", "deferred", "usage")

STUB = r'''import json, os, pathlib, subprocess, sys, time
name = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
data = pathlib.Path(os.environ["CONTRACT_DATA"])
run = data / "run" / "examplechannel-2026-06-25-040516"
def trace(stdin=None):
    event = {"command": name, "argv": args}
    if stdin is not None: event["stdin"] = stdin
    with (data / "commands.jsonl").open("a") as f: f.write(json.dumps(event) + "\n")
if name == "date":
    fmt = args[-1] if args else ""
    values = {"+%H:%M:%S": "01:02:03", "+%Y-%m-%d": "2026-06-25",
              "+%Y-%m-%dT%H:%M:%SZ": "2026-06-25T01:02:03Z",
              "+%Y%m%dT%H%M%SZ": "20260625T010203Z", "+%s": "1750813323"}
    print(values.get(fmt, "Wed Jun 25 01:02:03 UTC 2026"))
elif name == "ps":
    print("Wed Jun 25 01:00:00 2026")
elif name == "mktemp":
    counter = data / "mktemp-count"
    n = int(counter.read_text()) + 1 if counter.exists() else 1
    counter.write_text(str(n))
    template = next((a for a in args if "XXXXXX" in a), str(data / "scratch" / "tmp.XXXXXX"))
    path = pathlib.Path(template.replace("XXXXXX", f"contract{n:03d}"))
    path.parent.mkdir(parents=True, exist_ok=True)
    if "-d" in args: path.mkdir()
    else: path.touch()
    trace()
    print(path)
elif name == "ffprobe":
    trace()
    print("60.000000")
elif name == "ffmpeg":
    trace()
    if "-af" in args:
        print("[silencedetect @ 0x1] silence_end: 30.0 | silence_duration: 2", file=sys.stderr)
    else:
        output = args[-2] if args[-1] == "-y" else args[-1]
        target = pathlib.Path(output)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("synthetic " + target.suffix + "\n")
elif name == "sox":
    trace()
    t = int(args[args.index("trim") + 1])
    print("RMS     amplitude: " + ("0.900000" if t in (10, 30) else "0.100000"), file=sys.stderr)
elif name == "curl":
    trace()
    if os.environ.get("TRANSCRIBE_FAIL") == "1": sys.exit(7)
    segment = next((a for a in args if a.startswith("file=@")), "")
    print("A dramatic highlight in " + ("first" if "001" in segment else "second") + " segment.")
elif name == "whisper-cli":
    trace()
    if os.environ.get("TRANSCRIBE_FAIL") == "1": sys.exit(7)
    print("Whisper fallback highlight.")
elif name == "agy":
    stdin = sys.stdin.read()
    trace(stdin)
    if os.environ.get("AGY_FAIL") == "1":
        print("synthetic agy failure", file=sys.stderr)
        sys.exit(9)
    if os.environ.get("PARALLEL_ORDER") == "1" and "first segment" in " ".join(args): time.sleep(0.15)
    print('{"score":9,"type":"hype","title":"A clear synthetic highlight","summary":"Synthetic scoring found a highlight."}')
elif name == "timeout":
    trace()
    executable = args[2] if args[0].startswith("--kill-after") else args[1]
    start = args.index(executable)
    sys.exit(subprocess.run(args[start:]).returncode)
elif name == "codex":
    trace(sys.stdin.read())
    if os.environ.get("CODEX_FAIL") == "1":
        print("synthetic codex failure", file=sys.stderr)
        sys.exit(9)
    result = '{"score":8,"type":"take","title":"Codex fallback highlight","summary":"Synthetic fallback found a highlight."}\n'
    pathlib.Path(args[args.index("--output-last-message") + 1]).write_text(result)
elif name == "telegram":
    trace(sys.stdin.read())
elif name == "node":
    trace()
    with (data / "completion-calls").open("a") as f: f.write("called\n")
elif name == "annotate-clip.sh":
    trace()
    pathlib.Path(args[3]).write_text("synthetic annotated clip\n")
else:
    raise SystemExit("unknown stub " + name)
'''


def normalized(value, sandbox, root):
    value = value.replace(str(sandbox), "<SANDBOX>").replace(str(root), "<TREE>")
    value = value.replace(str(ROOT), "<TREE>")
    value = re.sub(r"pid=[0-9]+", "pid=<PID>", value)
    value = re.sub(r"\.stage-scoring\.started\.tmp\.[0-9]+", ".stage-scoring.started.tmp.<PID>", value)
    value = re.sub(r"agy failed after [0-9]+s", "agy failed after <ELAPSED>s", value)
    # BSD wc pads redirected counts; GNU wc does not. Keep the count exact.
    value = re.sub(r"(Found|Volume measured:|Total messages:) {2,}(?=[0-9])", r"\1 ", value)
    # du -sh reports allocated blocks, which differ between APFS and ext4.
    value = re.sub(r"(Total disk: )\d+(?:\.\d+)?[KMGTP]?", r"\1<FS_ALLOC>", value)
    # The shell displays only the first 60 transcript characters. A path cut
    # mid-component cannot match the full sandbox prefix above.
    value = re.sub(r"(?<=see )/[^ \n]*?(?=\.\.\.)", "<TRUNCATED_RUN_PATH>", value)
    return value


def first_difference(actual, expected, path="result"):
    """Name the first mismatched field without dumping a full golden to CI logs."""
    if type(actual) is not type(expected):
        return f"{path}: type {type(actual).__name__} != {type(expected).__name__}"
    if isinstance(actual, dict):
        for key in sorted(actual.keys() | expected.keys()):
            if key not in actual or key not in expected:
                return f"{path}.{key}: missing from one side"
            difference = first_difference(actual[key], expected[key], f"{path}.{key}")
            if difference: return difference
    elif isinstance(actual, list):
        if len(actual) != len(expected):
            return f"{path}: length {len(actual)} != {len(expected)}"
        for index, (left, right) in enumerate(zip(actual, expected)):
            difference = first_difference(left, right, f"{path}[{index}]")
            if difference: return difference
    elif isinstance(actual, str) and actual != expected:
        offset = next((index for index, pair in enumerate(zip(actual, expected))
                       if pair[0] != pair[1]), min(len(actual), len(expected)))
        start = max(0, offset - 60)
        return (f"{path}: first differing character {offset}; "
                f"actual={actual[start:offset + 120]!r} "
                f"expected={expected[start:offset + 120]!r}; "
                f"lengths={len(actual)}/{len(expected)}")
    elif actual != expected:
        return f"{path}: actual={actual!r:.300} expected={expected!r:.300}"
    return None


def capture(root, case):
    with tempfile.TemporaryDirectory(prefix=".process-stream-contract-", dir=ROOT / "scripts/tests") as tmp:
        sandbox = Path(tmp).resolve()
        data, bin_dir, home = sandbox / "data", sandbox / "bin", sandbox / "home"
        tree = sandbox / "tree"
        shutil.copytree(root / "scripts/stalker", tree / "scripts/stalker")
        shutil.copytree(root / "scripts/lib", tree / "scripts/lib")
        annotate = tree / "scripts/stalker/annotate-clip.sh"
        annotate.write_text(f"#!{sys.executable}\n" + STUB)
        annotate.chmod(0o755)
        run = data / "run" / RUN_NAME
        for path in (data, bin_dir, home, run): path.mkdir(parents=True, exist_ok=True)
        video = run / "video.mp4"
        video.write_text("synthetic video\n")
        chat = run / "chat.log"
        chat.write_text("[00:00:10] a: wow !clip\n[00:00:30] b: hype\n")
        if case == "chat-json":
            chat = run / "chat.json"
            chat.write_text('[{"time_s":10,"user":"a","message":"wow !clip"},{"time_s":30,"user":"b","message":"hype"}]\n')
        commands = ["date", "ps", "mktemp", "ffprobe", "ffmpeg", "sox", "curl", "whisper-cli", "timeout", "telegram", "node"]
        if case != "no-scorer": commands += ["agy", "codex"]
        for name in commands:
            stub = bin_dir / name
            stub.write_text(f"#!{sys.executable}\n" + STUB)
            stub.chmod(0o755)
        (bin_dir / "python3").symlink_to(sys.executable)
        for name in ("wc", "du"):
            override = os.environ.get(f"PROCESS_STREAM_CONTRACT_{name.upper()}")
            if override: (bin_dir / name).symlink_to(Path(override).resolve())
        env = {"PATH": f"{bin_dir}:/usr/bin:/bin", "HOME": str(home),
               "CONTRACT_DATA": str(data), "LC_ALL": "C", "TZ": "UTC",
               "STALKER_TELEGRAM_CMD": str(bin_dir / "telegram"),
               "STALKER_TELEGRAM_QUEUE_DIR": str(data / "queue"),
               "STALKER_TRANSCRIBE_ATTEMPTS": "1", "STALKER_RETRY_SLEEP_BASE": "0",
               "STALKER_SCORE_PARALLEL": "2" if case == "parallel-order" else "1",
               "STALKER_HEARTBEAT_NOTIFY": "0", "STALKER_HEARTBEAT_SECS": "9999",
               "WHISPER_MODEL": str(data / "model.bin"),
               "AGY_FAIL": "1" if case.startswith("fallback-") else "0",
               "CODEX_FAIL": "1" if case == "fallback-failure" else "0",
               "PARALLEL_ORDER": "1" if case == "parallel-order" else "0",
               "TRANSCRIBE_FAIL": "1" if case == "transcription-failure" else "0"}
        (data / "model.bin").write_text("model\n")
        args = [str(video.relative_to(data)), str(chat.relative_to(data))]
        if case == "chat-json": args += ["--chat-json", "--json-output"]
        if case in ("fresh", "fallback-success", "parallel-order"): args += ["--json-output"]
        if case in ("deferred", "resume", "rescore"): env["STALKER_DEFER_DELIVERY"] = "1"
        if case == "usage": args = []
        steps = [args]
        if case == "resume": steps += [args]
        if case == "rescore": steps += [args + ["--rescore"]]
        results = []
        for index, arguments in enumerate(steps):
            if case == "resume" and index == 1: env["STALKER_DEFER_DELIVERY"] = "0"
            proc = subprocess.run(["/bin/bash", str(tree / ENTRY), *arguments], cwd=data,
                                  env=env, input="caller stdin sentinel\n", text=True,
                                  capture_output=True, timeout=40)
            files = {normalized(str(p.relative_to(run)), sandbox, root):
                     normalized(p.read_text(errors="replace"), sandbox, root)
                     for p in sorted(run.rglob("*")) if p.is_file()}
            trace_path = data / "commands.jsonl"
            trace = [json.loads(line) for line in trace_path.read_text().splitlines()] if trace_path.exists() else []
            if case == "parallel-order":
                trace = sorted(trace, key=lambda item: json.dumps(item, sort_keys=True))
            trace = json.loads(normalized(json.dumps(trace, sort_keys=True), sandbox, root))
            results.append({"exit": proc.returncode, "stdout": normalized(proc.stdout, sandbox, root),
                            "stderr": normalized(proc.stderr, sandbox, root),
                            "files": files, "commands": trace,
                            "completion_calls": (data / "completion-calls").read_text().count("called\n")
                            if (data / "completion-calls").exists() else 0})
        return results


def main():
    record = len(sys.argv) == 3 and sys.argv[1] == "--record"
    root = Path(sys.argv[2] if record else os.environ.get("PROCESS_STREAM_CONTRACT_ROOT", ROOT)).resolve()
    if record:
        assert (root / ENTRY).read_bytes() == subprocess.check_output(["git", "show", f"{BASE}:{ENTRY}"], cwd=ROOT)
        FIXTURES.mkdir(parents=True, exist_ok=True)
    cases = (os.environ["PROCESS_STREAM_CONTRACT_CASE"],) if os.environ.get("PROCESS_STREAM_CONTRACT_CASE") else CASES
    for case in cases:
        actual = capture(root, case)
        path = FIXTURES / f"{case}.json"
        if record:
            path.write_text(json.dumps(actual, indent=2, ensure_ascii=False) + "\n")
        else:
            expected = json.loads(path.read_text())
            assert actual == expected, (f"{case} differs from untouched-base golden {path}: "
                                        f"{first_difference(actual, expected)}")
        print(f"PASS {case}: {len(actual)} step(s)")


if __name__ == "__main__": main()
