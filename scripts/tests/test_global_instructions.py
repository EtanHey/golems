"""Global instruction source and isolated installer contracts."""
import hashlib
import importlib.util
import os
from pathlib import Path
import subprocess
import sys

import pytest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts/install-global-instructions.py"
BODY = b"# Shared instructions\n\nSynthetic worker canary.\n"
LEAD = b"# Lead instructions\n\nSynthetic lead canary.\n"


def test_explicit_lead_launch_convention():
    for name in ("large-plan", "agent-routing"):
        skill = (ROOT / f"skills/golem-powers/{name}/SKILL.md").read_text()
        assert "Read and follow <repo>/LEAD.md and the global LEAD.md" in skill
        assert "~/.codex/LEAD.md" in skill
    routing = (ROOT / "skills/golem-powers/agent-routing/SKILL.md").read_text()
    assert "delegates' briefs never name it" in routing


def run(home, *args):
    source = home.parent / "source"
    source.mkdir(exist_ok=True)
    for name, data in (("AGENTS.md", BODY), ("LEAD.md", LEAD)):
        if not (source / name).exists():
            (source / name).write_bytes(data)
    return subprocess.run([sys.executable, str(SCRIPT), "--source-dir", str(source),
                           "--home", str(home), *args],
                          env={**os.environ, "HOME": str(home.parent / "bystander")},
                          capture_output=True, text=True)


def tree(root):
    return {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in root.rglob("*") if p.is_file()}


def test_dry_run_apply_idempotence_backups_and_drift(tmp_path):
    home = tmp_path / "target"
    home.mkdir()
    other = tmp_path / "bystander"
    other.mkdir()
    (other / "sentinel").write_text("untouched")
    for rel in (".codex/AGENTS.md", ".claude/CLAUDE.md", ".codex/LEAD.md"):
        p = home / rel
        p.parent.mkdir(exist_ok=True)
        p.write_text("old " + rel)
    run(home, "--dry-run")  # Prepare the synthetic source before the snapshot.
    before = tree(tmp_path)
    assert run(home).returncode == 0  # The default mode must also be read-only.
    assert tree(tmp_path) == before
    assert run(home, "--check").returncode == 1
    assert tree(tmp_path) == before
    result = run(home, "--apply")
    assert result.returncode == 0, result.stderr
    assert (home / ".codex/AGENTS.md").read_bytes() == BODY
    assert (home / ".codex/LEAD.md").read_bytes() == LEAD
    assert (home / ".claude/CLAUDE.md").read_text() == "@~/.codex/AGENTS.md\n"
    saved = [p.read_text() for p in (home / ".golems/backups").rglob("*.md")]
    assert sorted(saved) == sorted("old " + rel for rel in (".codex/AGENTS.md", ".claude/CLAUDE.md", ".codex/LEAD.md"))
    installed = tree(tmp_path)
    assert run(home, "--apply").returncode == 0
    assert tree(tmp_path) == installed
    assert run(home, "--check").returncode == 0
    assert tree(other) == {"sentinel": before["bystander/sentinel"]}
    assert tree(home.parent / "source") == {name: before["source/" + name] for name in ("AGENTS.md", "LEAD.md")}
    for rel in (".codex/AGENTS.md", ".claude/CLAUDE.md", ".codex/LEAD.md"):
        p = home / rel
        expected = p.read_bytes()
        p.write_bytes(b"drift")
        drifted = tree(tmp_path)
        assert run(home, "--check").returncode == 1
        assert tree(tmp_path) == drifted
        p.write_bytes(expected)


@pytest.mark.parametrize("rel", [".codex", ".claude", ".golems", ".codex/AGENTS.md"])
def test_refuse_symlink_escape_before_any_writes(tmp_path, rel):
    home = tmp_path / "target"
    home.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    dest = home / rel
    dest.parent.mkdir(exist_ok=True)
    dest.symlink_to(outside if ".md" not in rel else outside / "missing")
    run(home, "--dry-run")
    before = tree(tmp_path)
    result = run(home, "--apply")
    assert result.returncode == 2
    assert "symlink" in result.stderr
    assert tree(tmp_path) == before


def test_required_external_source_and_environment_option(tmp_path):
    home = tmp_path / "target"
    env = {k: v for k, v in os.environ.items() if k != "GOLEMS_GLOBAL_SOURCE_DIR"}
    command = [sys.executable, str(SCRIPT), "--home", str(home)]
    result = subprocess.run(command, env=env, capture_output=True, text=True)
    assert result.returncode == 2
    assert "--source-dir or GOLEMS_GLOBAL_SOURCE_DIR is required" in result.stderr
    assert not home.exists()
    source = tmp_path / "external source"
    source.mkdir()
    (source / "AGENTS.md").write_bytes(BODY)
    result = subprocess.run([*command, "--apply"], env={**env, "GOLEMS_GLOBAL_SOURCE_DIR": str(source)},
                            capture_output=True, text=True)
    assert result.returncode == 2  # Missing lead source must fail before any writes.
    assert not home.exists()
    (source / "LEAD.md").write_bytes(LEAD)
    result = subprocess.run([*command, "--apply"], env={**env, "GOLEMS_GLOBAL_SOURCE_DIR": str(source)},
                            capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    assert (home / ".codex/AGENTS.md").read_bytes() == BODY


def test_partial_replace_failure_restores_original_bytes(tmp_path, monkeypatch):
    spec = importlib.util.spec_from_file_location("global_installer", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    files = [tmp_path / ".codex/AGENTS.md", tmp_path / ".claude/CLAUDE.md"]
    for path in files:
        path.parent.mkdir()
        path.write_bytes(b"old bytes")
    real_replace = module.os.replace
    failed = False

    def replace(source, dest):
        nonlocal failed
        if dest == files[1] and not failed:
            failed = True
            raise OSError("synthetic write failure")
        return real_replace(source, dest)

    monkeypatch.setattr(module.os, "replace", replace)
    with pytest.raises(OSError, match="synthetic write failure"):
        module.install([(path, b"new bytes", b"old bytes") for path in files], tmp_path / "backup")
    assert all(path.read_bytes() == b"old bytes" for path in files)
    assert len(list((tmp_path / "backup").rglob("*.md"))) == 2
    assert not list(tmp_path.rglob(".global-instructions-*"))
