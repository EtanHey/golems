"""masked-read.py prints structure, never a value. Invented tokens only."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile

import pytest

ROOT = Path(__file__).resolve().parents[4]
READER = ROOT / "skills/golem-powers/secret-read-guard/scripts/masked-read.py"
TOKEN = "FAKE-SYNTH-7f3a9c"


@pytest.fixture
def scratch():
    base = ROOT / "docs.local/secret-read-guard-tests"
    base.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=base) as d:
        yield Path(d)


def read(path):
    proc = subprocess.run([sys.executable, str(READER), str(path)], capture_output=True, text=True, timeout=30)
    assert proc.returncode == 0, proc.stderr
    return proc.stdout


def tag(value):
    return f"<redacted len={len(value)} sha={hashlib.sha256(value.encode()).hexdigest()[:8]}>"


CASES = {
    "settings.json": (json.dumps({"env": {"ANTHROPIC_AUTH_TOKEN": TOKEN, "PORT": 8317},
                                  "permissions": {"allow": ["Bash(ls)"]}}),
                      ["\"ANTHROPIC_AUTH_TOKEN\"", "\"permissions\"", tag(TOKEN)]),
    "hub.env": (f"# key: {TOKEN}\nexport OPENAI_API_KEY='{TOKEN}'\nEMPTY=\n",
                ["OPENAI_API_KEY=", "# <comment redacted>", tag(TOKEN)]),
    "cliproxyapi.conf": (f"port: 8317\napi-keys:\n  - {TOKEN}\nauth:\n  secret: \"{TOKEN}\"  \n",
                         ["port: <redacted", "api-keys:", "- " + tag(TOKEN), "secret: " + tag(TOKEN)]),
    "config.toml": (f"[provider]\nkey = \"{TOKEN}\"\n# {TOKEN}\n",
                    ["[provider]", "key = " + tag(TOKEN)]),
    "auth.json.bak-rotate-1": (json.dumps({"tokens": [TOKEN]}), ["\"tokens\"", tag(TOKEN)]),
    "mystery.bin": (f"{TOKEN}\nsome_key = whatever {TOKEN}\n<<{TOKEN}>>\n",
                    ["key names only", "some_key"]),
}


@pytest.mark.parametrize("name", sorted(CASES))
def test_structure_without_values(scratch, name):
    text, expected = CASES[name]
    path = scratch / name
    path.write_text(text)
    out = read(path)
    assert TOKEN not in out
    for fragment in expected:
        assert fragment in out, (name, fragment, out)


def test_equal_values_share_a_sha_across_files(scratch):
    (scratch / "a.env").write_text(f"K={TOKEN}\n")
    (scratch / "b.json").write_text(json.dumps({"k": TOKEN}))
    a, b = read(scratch / "a.env"), read(scratch / "b.json")
    assert tag(TOKEN) in a and tag(TOKEN) in b


def test_missing_file_reports_without_crashing(scratch):
    proc = subprocess.run([sys.executable, str(READER), str(scratch / "nope.env")], capture_output=True, text=True)
    assert proc.returncode == 1 and "cannot read" in proc.stdout
