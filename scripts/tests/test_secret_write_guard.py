"""SEC1: real Git ignore decisions before any write, with value-free refusals."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

import pytest

ROOT = Path(__file__).resolve().parents[2]
HOOK = ROOT / "skills/golem-powers/secret-write-guard/hooks/secret-write-pretooluse.py"
ADAPTER = ROOT / "scripts/hooks/codex-policy-hook.py"
SENTINEL = "SYNTHETIC_CONTENT_MUST_NOT_BE_LOGGED"


@pytest.fixture
def workspace():
    base = ROOT / "docs.local/sec1-tests"
    base.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=base) as scratch:
        root = Path(scratch)
        repo = root / "repo"
        repo.mkdir()
        subprocess.run(["git", "init", "-q", str(repo)], check=True)
        # The host globally ignores .env; fixtures must control this policy.
        subprocess.run(["git", "-C", str(repo), "config", "core.excludesfile", "/dev/null"], check=True)
        yield root, repo


def run(repo, tool="Write", target=".env", command=None, env=None, codex=False):
    ti = {"command": command} if command is not None else {"file_path": target, "content": SENTINEL}
    payload = {"tool_name": tool, "tool_input": ti, "cwd": str(repo)}
    args = [sys.executable, "-I", "-B", str(ADAPTER if codex else HOOK)]
    if codex:
        args.append("secret-write-guard")
    proc = subprocess.run(args, input=json.dumps(payload), text=True, capture_output=True,
                          env=env, timeout=10)
    assert SENTINEL not in proc.stdout + proc.stderr
    assert not proc.stderr, proc.stderr
    value = json.loads(proc.stdout)
    denied = value.get("hookSpecificOutput", {}).get("permissionDecision") == "deny"
    assert proc.returncode == (0 if codex or not denied else 2)
    return denied, proc.stdout


@pytest.mark.parametrize("name", [".env", ".env.local", "server.pem", "server.key", "credentials.json",
                                      "secret.txt", "id_rsa.pub", "cert.p12"])
def test_unignored_secret_denied(workspace, name):
    _, repo = workspace
    denied, message = run(repo, target=name)
    assert denied
    assert name in message and "gitignored" in message
    assert not (repo / name).exists()


@pytest.mark.parametrize("name", [".env.example", ".env.sample", "notes.md"])
def test_nonsecret_allowed(workspace, name):
    assert not run(workspace[1], target=name)[0]


@pytest.mark.parametrize("tool", [None, "", []])
def test_malformed_tool_denied(workspace, tool):
    assert run(workspace[1], tool=tool)[0]


def test_ignored_allowed_but_tracked_denied(workspace):
    _, repo = workspace
    (repo / ".gitignore").write_text(".env\n")
    assert not run(repo, tool="Edit")[0]
    (repo / ".env").write_text("synthetic")
    subprocess.run(["git", "-C", str(repo), "add", "-f", ".env"], check=True)
    assert run(repo)[0]


def test_outside_and_symlinks(workspace):
    root, repo = workspace
    outside = root / "config"
    outside.mkdir()
    assert not run(repo, target=str(outside / "token"))[0]
    assert not run(repo, target=str(outside / ".env"))[0]
    (repo / ".env").symlink_to(outside / "ordinary")
    assert not run(repo)[0]
    (outside / "ordinary").symlink_to(repo / "hidden")
    assert run(repo)[0]
    (outside / "alias").symlink_to(repo / ".env.local")
    assert run(repo, target=str(outside / "alias"))[0]


@pytest.mark.parametrize("command", ["echo x > secret.txt", "echo x >> .env", "echo x | tee -a .env",
    "cd repo && echo x > .env", "P=.env; echo x > \"$P\"", "bash -c 'echo x > .env'",
    "echo $(echo x > .env)", "echo x >&secret.txt", "echo x | tee -- -secret"])
def test_shell_writes_denied(workspace, command):
    root, repo = workspace
    assert run(root if command.startswith("cd repo") else repo, "Bash", command=command)[0]


def test_shell_ignored_and_data_allowed(workspace):
    _, repo = workspace
    (repo / ".gitignore").write_text(".env\nsecret.txt\n")
    assert not run(repo, "Shell", command="echo x > .env; echo x | tee secret.txt")[0]
    assert not run(repo, "Bash", command="echo 'x > .env'; cat .env")[0]
    assert not run(repo, "Bash", command="cat <<'EOF'\necho x > .env\nEOF")[0]


@pytest.mark.parametrize("broken", ["missing", "check-ignore", "discovery"])
def test_git_failure_denied(workspace, broken):
    root, repo = workspace
    bin_dir = root / "bin"
    bin_dir.mkdir()
    if broken != "missing":
        git = bin_dir / "git"
        real_git = shutil.which("git")
        git.write_text("#!/bin/sh\n" + ("exit 128\n" if broken == "discovery" else
                       f'case "$*" in *check-ignore*) exit 128;; esac\nexec "{real_git}" "$@"\n'))
        git.chmod(0o700)
    env = {**os.environ, "PATH": str(bin_dir)}
    assert run(repo, env=env)[0]


@pytest.mark.parametrize("command", ["echo x > $UNKNOWN/.env", "echo x > $(pwd)/.env"])
def test_unresolved_write_denied_without_content(workspace, command):
    assert run(workspace[1], "Bash", command=command.replace("echo x", "echo " + SENTINEL))[0]


@pytest.mark.parametrize("codex", [False, True])
def test_patch_and_codex_shell(workspace, codex):
    _, repo = workspace
    patch = "*** Begin Patch\n*** Add File: .env\n+" + SENTINEL + "\n*** End Patch"
    assert run(repo, "apply_patch", command=patch, codex=codex)[0]
    (repo / ".gitignore").write_text(".env\n")
    assert not run(repo, "apply_patch", command=patch, codex=codex)[0]
    assert run(repo, "Bash", command="echo x > secret.txt", codex=codex)[0]


def test_manifest_and_canon_contract():
    manifest = json.loads((ROOT / "scripts/hooks/manifest.json").read_text())
    for entries in manifest["hosts"].values():
        guard = next(e for e in entries if e["id"] == "secret-write-guard")
        assert "--fail-closed" in guard["command"]
    for entries in manifest["codex_hosts"].values():
        assert any(e["gate"] == "secret-write-guard" for e in entries)
    canon = (ROOT / "standards/fleet-canon.md").read_text().split("10. **never-privatize**", 1)[1]
    assert "gitignored BEFORE the write, fail closed; never committed" in canon


def test_outside_any_repository_and_resolution_failure(workspace):
    base = Path.home() / ".config/golems-sec1-tests"
    base.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=base) as scratch:
        outside = Path(scratch)
        assert subprocess.run(["git", "-C", str(outside), "rev-parse", "--show-toplevel"],
                              capture_output=True).returncode != 0
        assert not run(outside, target=".env")[0]
        assert not run(outside, target="token")[0]
    _, repo = workspace
    (repo / "loop.key").symlink_to("loop.key")
    (repo / ".gitignore").write_text("loop.key\n")
    assert run(repo, target="loop.key")[0]
    assert run(repo, "Bash", command="echo x > sub/../.env")[0]
    (repo / "sub/child").mkdir(parents=True)
    (repo / "link").symlink_to(repo / "sub/child")
    (repo / ".gitignore").write_text("/.env\n")
    env = {**os.environ, "DEST": str(repo / "link/..")}
    assert run(repo, "Bash", command='cd -P "$DEST" && echo x > .env', env=env)[0]
