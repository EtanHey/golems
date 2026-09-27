#!/usr/bin/env python3
"""Golden the public bridge with fake stores/transports and a fixed clock."""
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

BASE = "e180e9ee12cd4ed3ee3bb2c1353cb21bd9ebbf93"
ROOT = Path(__file__).resolve().parents[2]
ENTRY = "scripts/stalker/stalker-brainlayer-telegram.sh"
FIXTURES = Path(__file__).parent / "fixtures/brain-delivery-contract"
DATE = "2026-06-18"
RUN = f"example-{DATE}-120000"

STUB = '''import json, os, pathlib, subprocess, sys
name = pathlib.Path(sys.argv[0]).name
data = pathlib.Path(os.environ["DATA"])
args = sys.argv[1:]
if name == "date":
    print("20260619T010203Z" if args[-1] == "+%Y%m%dT%H%M%SZ" else "2026-06-19T01:02:03Z")
    sys.exit(0)
if name == "mktemp":
    folder = data / "tmp"
    folder.mkdir(exist_ok=True)
    counter = folder / "counter"
    n = int(counter.read_text()) + 1 if counter.exists() else 1
    counter.write_text(str(n))
    target = folder / ("file-%03d" % n)
    target.touch()
    print(target)
    sys.exit(0)
record = {"command": name, "argv": args}
source = None
if name == "python3" and args[0] == "-":
    source = sys.stdin.buffer.read()
    record["stdin"] = "python source; EOF after source"
elif name in ("brain-store", "telegram"):
    record["stdin"] = sys.stdin.read()
with (data / "commands.jsonl").open("a") as f: f.write(json.dumps(record) + "\\n")
if name == "python3":
    sys.exit(subprocess.run([os.environ["REAL_PYTHON"], *args], input=source).returncode)
if name == "brain-store":
    counter = data / "store-count"
    count = int(counter.read_text()) + 1 if counter.exists() else 1
    counter.write_text(str(count))
    if os.environ.get("STORE_MODE") == "fail" or (os.environ.get("STORE_MODE") == "partial" and count > 1):
        print("fixture store failure", file=sys.stderr)
        sys.exit(9)
if name == "telegram" and os.environ.get("TELEGRAM_FAIL") == "1":
    print("fixture telegram failure", file=sys.stderr)
    sys.exit(9)
'''

CLOCK = '''import datetime
class FixedDateTime(datetime.datetime):
    @classmethod
    def now(cls, tz=None):
        return cls(2026, 6, 19, 1, 2, 3, tzinfo=tz)
datetime.datetime = FixedDateTime
'''

BATCH_STORE = '''import json, os
from pathlib import Path
def store_memory(**kwargs):
    kwargs.pop("store")
    data = Path(os.environ["DATA"])
    with (data / "batch-calls.jsonl").open("a") as f:
        f.write(json.dumps(kwargs) + "\\n")
    if os.environ.get("STORE_MODE") == "partial" and "record:run-summary" not in kwargs["tags"]:
        raise RuntimeError("fixture batch failure")
'''


def prepared_run(data, name=RUN):
    run = data / "runs" / name
    run.mkdir(parents=True, exist_ok=True)
    files = {
        "video.mp4": "fixture video\n", "chat.log": "one\ntwo\n",
        "transcript.md": "# Transcript\nA deterministic fixture.\n",
        "gems.md": "### [00:01] First\n**Score:** 7/10 | **Type:** take\n**Gist:** First idea.\n\n### [00:02] Second\n**Score:** 8/10 | **Type:** rant\n**Gist:** Second idea.\n",
        "_DRIVE-LEDGER.md": "- Drive Target: /fixture/Brain Drive/stalker-golem/example/run\n| video.mp4 | 14 | fixture | 120 |\n",
        "transcription-failures.log": "2026-06-18T00:00:00Z fixture failure\n",
        ".stage-process.done": "done\n", ".stage-archive.done": "done\n",
    }
    for name, value in files.items():
        (run / name).write_text(value)
    return run


def scenario(name, data, env):
    runs = data / "runs"
    runs.mkdir()
    run = prepared_run(data)
    ingest = ["ingest-run", str(run)]
    digest = ["digest", str(runs), DATE]
    steps = []
    if name == "usage":
        steps = [([], {}), (["unknown"], {}), (["ingest-run"], {}),
                 (ingest + ["--unknown"], {}), (digest + ["--unknown"], {}),
                 (["queue-run", "missing", "reason"], {}), (["digest", "missing", DATE], {})]
    elif name == "dry-run":
        steps = [(ingest + ["--dry-run"], {}), (ingest, {"STALKER_BRAINLAYER_DRY_RUN": "1"}),
                 (ingest, {"STALKER_BRAIN_STORE_DRY_RUN": "1"}),
                 (digest, {"STALKER_BRAINLAYER_DRY_RUN": "1"}),
                 (digest, {"STALKER_BRAIN_STORE_DRY_RUN": "1"}),
                 (digest, {"STALKER_TELEGRAM_DRY_RUN": "1"})]
    elif name == "store-success":
        steps = [(ingest, {}), (ingest, {})]
    elif name == "partial-retry":
        (run / ".brainlayer-store-state.jsonl").write_text("malformed\n\n")
        steps = [(ingest, {"STORE_MODE": "partial"}), (ingest, {"STORE_MODE": "fail"}),
                 (ingest, {}), (ingest, {})]
    elif name == "queue-idempotent":
        steps = [(["queue-run", str(run), 'fixture reason "quoted"'], {}),
                 (["queue-run", str(run), "second reason"], {}), (ingest, {})]
    elif name.startswith("batch-"):
        env.pop("STALKER_BRAIN_STORE_CMD")
        if name == "batch-startup-failure":
            (Path(env["STALKER_BRAINLAYER_SRC"]) / "brainlayer/paths.py").write_text('raise ImportError("fixture startup failure")\n')
        steps = [(ingest, {"STORE_MODE": "partial"} if name == "batch-partial" else {}), (ingest, {})]
    elif name == "payload-exception":
        steps = [(ingest, {"STALKER_BRAINLAYER_IMPORTANCE": "invalid"})]
    elif name == "empty-run":
        empty = runs / "empty"
        empty.mkdir()
        steps = [(["ingest-run", str(empty), "--dry-run"], {}), (["queue-run", str(empty), "empty"], {})]
    elif name.startswith("digest-"):
        if name == "digest-empty":
            runs = data / "empty-root"
            runs.mkdir()
            digest = ["digest", str(runs), DATE]
        elif name == "digest-mixed":
            (runs / f"example-{DATE}-130000").mkdir()
            tail = runs / f"example-{DATE}-140000"
            tail.mkdir()
            (tail / ".orphan-tail").write_text("tail\n")
            (run / ".archive-cleanup-skipped").write_text("skipped\n")
        elif name == "digest-no-scored-gems":
            (run / "gems.md").write_text("### [00:01] Unscored\n")
        elif name == "digest-exception":
            (run / "gems.md").unlink()
            (run / "gems.md").mkdir()
        elif name == "digest-unprocessed-exception":
            (run / ".stage-process.done").unlink()
            (run / ".stage-archive.done").unlink()
            (run / "_DRIVE-LEDGER.md").unlink()
            (run / "gems.md").unlink()
            (run / "gems.md").mkdir()
        elif name == "digest-refusal":
            env["TELEGRAM_FAIL"] = "1"
        steps = [(digest + ["--dry-run"], {}), (digest, {})]
    return steps


CASES = ("usage", "dry-run", "store-success", "partial-retry", "queue-idempotent",
         "batch-success", "batch-partial", "batch-startup-failure", "payload-exception",
         "empty-run", "digest-empty", "digest-mixed", "digest-no-scored-gems", "digest-refusal", "digest-exception",
         "digest-unprocessed-exception")


def capture(root, case):
    with tempfile.TemporaryDirectory(prefix="brain-delivery-") as directory:
        sandbox = Path(directory).resolve()
        data, bin_dir, site = sandbox / "data", sandbox / "bin", sandbox / "site"
        for folder in (data, bin_dir, site):
            folder.mkdir()
        (site / "sitecustomize.py").write_text(CLOCK)
        backend = sandbox / "backend/brainlayer"
        backend.mkdir(parents=True)
        (backend / "__init__.py").write_text("")
        (backend / "paths.py").write_text('def get_db_path(): return "fixture-db"\n')
        (backend / "store.py").write_text(BATCH_STORE)
        (backend / "vector_store.py").write_text('import os\nfrom pathlib import Path\nclass VectorStore:\n    def __init__(self, path):\n        with (Path(os.environ["DATA"]) / "opens").open("a") as f: f.write(str(path) + "\\n")\n')
        for command in ("date", "mktemp", "python3", "brain-store", "telegram"):
            path = bin_dir / command
            path.write_text(f"#!{sys.executable}\n" + STUB)
            path.chmod(0o755)
        env = {"PATH": str(bin_dir) + os.pathsep + os.environ["PATH"], "HOME": str(sandbox / "home"),
               "LC_ALL": "C", "TZ": "UTC", "DATA": str(data), "REAL_PYTHON": sys.executable,
               "PYTHONPATH": str(site), "PYTHONDONTWRITEBYTECODE": "1",
               "STALKER_BRAIN_STORE_CMD": str(bin_dir / "brain-store"),
               "STALKER_BRAINLAYER_SRC": str(backend.parent),
               "STALKER_TELEGRAM_CMD": str(bin_dir / "telegram"),
               "STALKER_TELEGRAM_QUEUE_DIR": str(data / "telegram-queue")}

        def normalize(value):
            value = value.replace(str(sandbox).encode(), b"<SANDBOX>")
            value = value.replace(str(root).encode(), b"<TREE>")
            value = value.replace(sys.base_prefix.encode(), b"<PYTHON>")
            return re.sub(rb"20260619T010203Z-[0-9]+-[0-9]+-stalker-", b"20260619T010203Z-<PID>-<RANDOM>-stalker-", value).decode()

        results = []
        for args, overrides in scenario(case, data, env):
            proc = subprocess.run(["/bin/bash", str(root / ENTRY), *args], input=b"caller stdin sentinel\n",
                                  cwd=data, env={**env, **overrides}, capture_output=True, timeout=30)
            paths = sorted(p for p in data.rglob("*") if p.is_file())
            files = {normalize(str(p.relative_to(data)).encode()): normalize(p.read_bytes()) for p in paths}
            assert len(files) == len(paths), "normalization must not collapse artifacts"
            results.append({"stdout": normalize(proc.stdout), "stderr": normalize(proc.stderr),
                            "exit": proc.returncode, "files": files})
        return results


def main():
    record = len(sys.argv) == 3 and sys.argv[1] == "--record"
    root = Path(sys.argv[2] if record else os.environ.get("BRAIN_CONTRACT_ROOT", ROOT)).resolve()
    if record:
        assert (root / ENTRY).read_bytes() == subprocess.check_output(["git", "show", f"{BASE}:{ENTRY}"], cwd=ROOT)
        FIXTURES.mkdir(parents=True, exist_ok=True)
    for case in (os.environ.get("BRAIN_CONTRACT_CASE"),) if os.environ.get("BRAIN_CONTRACT_CASE") else CASES:
        version = f"py{sys.version_info.major}{sys.version_info.minor}"
        versioned = case in {"digest-exception", "digest-unprocessed-exception"}
        suffix = f"-{version}" if versioned else ""
        path = FIXTURES / f"{case}{suffix}.json"
        if versioned and not record and not path.exists():
            print(f"{case}: SKIP (no untouched-base traceback for {version})")
            continue
        actual = capture(root, case)
        if record:
            path.write_text(json.dumps(actual, indent=2) + "\n")
        else:
            expected = json.loads(path.read_text())
            assert actual == expected, f"{case}: golden mismatch\nEXPECTED {expected!r}\nACTUAL {actual!r}"
        print(f"{case}: {'recorded from base' if record else 'PASS'}", flush=True)


if __name__ == "__main__":
    main()
