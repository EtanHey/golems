import json
from pathlib import Path
import subprocess
import importlib.util
import pytest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts/install-gemini-context.sh"
TEMPLATE = ROOT / "templates/gemini/GEMINI.md"


def fixture(tmp_path):
    home = tmp_path / "home"
    repo = tmp_path / "repo"
    home.mkdir()
    repo.mkdir()
    registry = tmp_path / "registry.json"
    registry.write_text(json.dumps({"projects": {"example": {"path": str(repo)}}}))
    return home, repo, registry


def run(home, registry, *args):
    return subprocess.run(["bash", str(SCRIPT), "--host", "mbp", "--home", str(home),
                           "--registry", str(registry), *args], capture_output=True, text=True)


def test_dry_run_and_apply_are_separate_and_idempotent(tmp_path):
    home, repo, registry = fixture(tmp_path)
    assert run(home, registry).returncode == 0
    assert not (repo / "GEMINI.md").exists()
    assert not (home / ".gemini").exists()
    assert run(home, registry, "--apply").returncode == 0
    assert (repo / "GEMINI.md").read_bytes() == TEMPLATE.read_bytes()
    agent = home / ".gemini/antigravity-cli/agents/gatherer.md"
    assert agent.exists() and agent.stat().st_mode & 0o777 == 0o600
    worker = home / ".gemini/antigravity-cli/agents/brain-worker/agent.md"
    assert worker.read_bytes() == (ROOT / "templates/gemini/agents/brain-worker.md").read_bytes()
    assert worker.stat().st_mode & 0o777 == 0o600
    assert run(home, registry, "--apply").returncode == 0
    assert not list(home.glob(".golems/backups/gemini-md/*/*"))
    assert run(home, registry, "--check").returncode == 0


def test_agents_only_renders_dependency_without_touching_repo_context(tmp_path):
    home, repo, registry = fixture(tmp_path)
    original = b"# Project context\n"
    (repo / "GEMINI.md").write_bytes(original)
    assert run(home, registry, "--apply", "--agents-only").returncode == 0
    assert (repo / "GEMINI.md").read_bytes() == original
    gatherer = home / ".gemini/antigravity-cli/agents/gatherer.md"
    worker_dir = home / ".gemini/antigravity-cli/agents/brain-worker"
    assert f"agents: [{json.dumps(str(worker_dir))}]" in gatherer.read_text()
    assert "inheritMcp: false" in gatherer.read_text().split("---", 2)[1]
    assert (worker_dir / "agent.md").exists()
    assert run(home, registry, "--apply", "--agents-only").returncode == 0
    assert not list(home.glob(".golems/backups/gemini-md/*/*"))


def test_dependency_path_escapes_quotes_and_spaces(tmp_path):
    home, repo, registry = fixture(tmp_path)
    quoted = tmp_path / 'home "quoted" space'
    home.rename(quoted)
    assert run(quoted, registry, "--apply", "--agents-only").returncode == 0
    gatherer = quoted / ".gemini/antigravity-cli/agents/gatherer.md"
    line = next(line for line in gatherer.read_text().splitlines() if line.startswith("agents:"))
    assert json.loads(line.removeprefix("agents: ")) == [
        str(quoted / ".gemini/antigravity-cli/agents/brain-worker")
    ]


def test_worker_directory_symlink_refuses_entire_pair_install(tmp_path):
    home, repo, registry = fixture(tmp_path)
    agents = home / ".gemini/antigravity-cli/agents"
    agents.mkdir(parents=True)
    external = tmp_path / "external-worker"
    external.mkdir()
    (external / "agent.md").write_bytes(b"keep original")
    (agents / "brain-worker").symlink_to(external, target_is_directory=True)
    result = run(home, registry, "--agents-only", "--apply")
    assert result.returncode != 0 and "symlink destination refused" in result.stderr
    assert (external / "agent.md").read_bytes() == b"keep original"
    assert not (agents / "gatherer.md").exists()


def test_stale_claude_copy_is_backed_up_byte_for_byte(tmp_path):
    home, repo, registry = fixture(tmp_path)
    original = "# First Boot\nbrain_recall(mode=\"context\")\n"
    (repo / "CLAUDE.md").write_text(original)
    (repo / "GEMINI.md").write_text(original)
    assert "yes" in run(home, registry).stdout
    assert run(home, registry, "--apply").returncode == 0
    backups = list(home.glob(".golems/backups/gemini-md/*/example-*-GEMINI.md"))
    assert len(backups) == 1 and backups[0].read_text() == original
    assert backups[0].stat().st_mode & 0o777 == 0o600


def test_repo_specific_content_requires_named_force(tmp_path):
    home, repo, registry = fixture(tmp_path)
    original = "# Project design\n" + "project-specific guidance\n" * 446
    (repo / "GEMINI.md").write_text(original)
    result = run(home, registry, "--apply")
    assert result.returncode == 0 and "REVIEW" in result.stdout
    assert (repo / "GEMINI.md").read_text() == original
    assert run(home, registry, "--apply", "--force-repo", "example").returncode == 0
    assert (repo / "GEMINI.md").read_bytes() == TEMPLATE.read_bytes()


def test_global_ritual_is_flagged_without_modifying_anything(tmp_path):
    home, repo, registry = fixture(tmp_path)
    global_file = home / ".gemini/GEMINI.md"
    global_file.parent.mkdir()
    global_file.write_text("# First Boot\nBoot timer: 30 seconds\n")
    assert run(home, registry, "--check").returncode == 1
    assert run(home, registry, "--apply").returncode == 1
    assert global_file.read_text() == "# First Boot\nBoot timer: 30 seconds\n"
    assert not (repo / "GEMINI.md").exists()


def test_repo_ritual_check_is_read_only(tmp_path):
    home, repo, registry = fixture(tmp_path)
    (repo / "GEMINI.md").write_text("brain_recall ( mode = 'context')\n")
    result = run(home, registry, "--check")
    assert result.returncode == 1 and "yes" in result.stdout
    assert not (home / ".gemini").exists()


def test_symlink_destination_is_skipped(tmp_path):
    assert SCRIPT.exists()
    home, repo, registry = fixture(tmp_path)
    target = tmp_path / "external"
    target.write_text("outside")
    (repo / "GEMINI.md").symlink_to(target)
    result = run(home, registry, "--apply", "--force-repo", "example")
    assert result.returncode == 0 and "SKIP-SYMLINK" in result.stdout
    assert target.read_text() == "outside"


def test_lead_persona_installs_separately_from_gatherer(tmp_path):
    home, repo, registry = fixture(tmp_path)
    persona = tmp_path / "lead.md"
    persona.write_text("# Lead First Boot\n")
    assert run(home, registry, "--apply", "--lead-persona", str(persona), "--lead-agent", "example-lead").returncode == 0
    assert (home / ".claude/agents/example-lead.md").read_bytes() == persona.read_bytes()
    assert "First Boot" not in (repo / "GEMINI.md").read_text()


def test_invalid_input_does_not_partially_apply(tmp_path):
    home, repo, registry = fixture(tmp_path)
    registry.write_text(json.dumps({"projects": {"example": {"path": str(repo)}, "bad": {"path": "relative"}}}))
    assert run(home, registry, "--apply").returncode != 0
    assert not (repo / "GEMINI.md").exists() and not (home / ".gemini").exists()


def test_check_and_force_are_scoped_to_registered_repos(tmp_path):
    home, repo, registry = fixture(tmp_path)
    assert run(home, registry, "--apply", "--check").returncode != 0
    assert run(home, registry, "--force-repo", "unknown").returncode != 0
    assert not (repo / "GEMINI.md").exists()


def test_global_clean_context_is_kept_and_custom_agent_is_backed_up(tmp_path):
    home, repo, registry = fixture(tmp_path)
    agent = home / ".gemini/antigravity-cli/agents/gatherer.md"
    agent.parent.mkdir(parents=True)
    agent.write_bytes(b"existing-agent\r\n")
    global_file = home / ".gemini/GEMINI.md"
    global_file.write_bytes(b"# Lean global context\r\n")
    assert run(home, registry, "--apply").returncode == 0
    assert global_file.read_bytes() == b"# Lean global context\r\n"
    assert next(home.glob(".golems/backups/gemini-md/*/gatherer-*.md")).read_bytes() == b"existing-agent\r\n"


def test_long_repo_context_is_reviewed_even_when_equal_to_claude(tmp_path):
    home, repo, registry = fixture(tmp_path)
    original = '# Project-specific documentation\n' + 'Project-specific guidance\n' * 446
    (repo / 'CLAUDE.md').write_text(original)
    (repo / 'GEMINI.md').write_text(original)
    result = run(home, registry, '--apply')
    assert 'REVIEW' in result.stdout
    assert (repo / 'GEMINI.md').read_text() == original


def test_unsafe_backup_is_refused_before_any_write(tmp_path):
    home, repo, registry = fixture(tmp_path)
    newer = tmp_path / 'newer'
    newer.mkdir()
    old = 'generic context\n'
    (repo / 'CLAUDE.md').write_text(old)
    (repo / 'GEMINI.md').write_text(old)
    registry.write_text(json.dumps({'projects': {'a-new': {'path': str(newer)}, 'z-old': {'path': str(repo)}}}))
    external = tmp_path / 'external-backups'
    external.mkdir()
    (home / '.golems').symlink_to(external)
    result = run(home, registry, '--apply')
    assert result.returncode != 0
    assert not (newer / 'GEMINI.md').exists()
    assert (repo / 'GEMINI.md').read_text() == old


@pytest.mark.parametrize("ritual", ["# First Boot\n", "Boot timer: 30 seconds\n", "Timer for boot: 30 seconds\n"])
def test_independent_ritual_branches(tmp_path, ritual):
    home, repo, registry = fixture(tmp_path)
    (repo / "GEMINI.md").write_text(ritual)
    assert run(home, registry, "--check").returncode == 1


@pytest.mark.parametrize("clean", ["brain_recall", "brain_recall(query='context')", "Retry timers are configured in bootstrap.ts", "watchdog reboot timer", "On first boot the device initializes", "first boot of the device"])
def test_ritual_mentions_and_device_boot_are_clean(tmp_path, clean):
    home, repo, registry = fixture(tmp_path)
    (repo / "GEMINI.md").write_text(clean)
    result = run(home, registry, "--check")
    assert result.returncode == 0 and "example\tREVIEW\t1\t1\tno" in result.stdout


def test_short_genuine_context_and_force_are_scoped(tmp_path):
    home, repo, registry = fixture(tmp_path)
    other = tmp_path / "other"
    other.mkdir()
    registry.write_text(json.dumps({"projects": {"example": {"path": str(repo)}, "other": {"path": str(other)}}}))
    for path in (repo, other):
        (path / "GEMINI.md").write_text("# Real repository instructions\n")
        (path / "CLAUDE.md").write_text("# Different shared instructions\n")
    assert run(home, registry, "--apply").returncode == 0
    assert (repo / "GEMINI.md").read_text() == "# Real repository instructions\n"
    assert run(home, registry, "--apply", "--force-repo", "example").returncode == 0
    assert (repo / "GEMINI.md").read_bytes() == TEMPLATE.read_bytes()
    assert (other / "GEMINI.md").read_text() == "# Real repository instructions\n"


@pytest.mark.parametrize("lines,action", [(200, "REPLACE"), (201, "REVIEW")])
def test_matching_context_threshold(tmp_path, lines, action):
    home, repo, registry = fixture(tmp_path)
    original = b"Repo guidance\n" * lines
    for name in ("CLAUDE.md", "GEMINI.md"):
        (repo / name).write_bytes(original)
    result = run(home, registry, "--apply")
    assert result.returncode == 0 and action in result.stdout
    assert (repo / "GEMINI.md").read_bytes() == (TEMPLATE.read_bytes() if lines == 200 else original)


@pytest.mark.parametrize("same_path", [True, False])
def test_case_insensitive_aliases_keep_one_original_backup_per_destination(tmp_path, same_path):
    home, repo, registry = fixture(tmp_path)
    other = repo if same_path else tmp_path / "other"
    other.mkdir(exist_ok=True)
    registry.write_text(json.dumps({"projects": {"Example": {"path": str(repo)}, "example": {"path": str(other)}}}))
    for path in {repo, other}:
        (path / "GEMINI.md").write_bytes(b"Original\r\n")
        (path / "CLAUDE.md").write_bytes(b"Original\r\n")
    result = run(home, registry, "--apply")
    assert result.returncode == 0
    backups = list(home.glob(".golems/backups/gemini-md/*/*"))
    assert len(backups) == (1 if same_path else 2)
    assert len({p.name.casefold() for p in backups}) == len(backups)
    assert all(p.read_bytes() == b"Original\r\n" for p in backups)


@pytest.mark.parametrize("mode", [(), ("--check",), ("--apply",)])
@pytest.mark.parametrize("parent", [False, True])
def test_symlinks_are_rows_and_other_repos_continue(tmp_path, mode, parent):
    home, repo, registry = fixture(tmp_path)
    other = tmp_path / "other"
    other.mkdir()
    external = tmp_path / "external"
    external.mkdir()
    (external / "GEMINI.md").write_bytes(b"untouched")
    if parent:
        linked = tmp_path / "linked"
        linked.symlink_to(external, target_is_directory=True)
        repo = linked
    else:
        (repo / "GEMINI.md").symlink_to(external / "GEMINI.md")
    registry.write_text(json.dumps({"projects": {"example": {"path": str(repo)}, "other": {"path": str(other)}}}))
    result = run(home, registry, *mode)
    assert result.returncode == 0
    assert "example\tSKIP-SYMLINK" in result.stdout and "other\tCREATE" in result.stdout
    assert (external / "GEMINI.md").read_bytes() == b"untouched"
    assert (other / "GEMINI.md").exists() == (mode == ("--apply",))


def installer():
    spec = importlib.util.spec_from_file_location("installer", ROOT / "scripts/install-gemini-context.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_readonly_later_directory_prevents_all_writes(tmp_path):
    home, repo, registry = fixture(tmp_path)
    other = tmp_path / "other"
    other.mkdir()
    registry.write_text(json.dumps({"projects": {"a": {"path": str(repo)}, "z": {"path": str(other)}}}))
    other.chmod(0o555)
    try:
        result = run(home, registry, "--apply")
        assert result.returncode != 0 and "repo\taction" in result.stdout
        assert not (repo / "GEMINI.md").exists() and not (home / ".gemini").exists()
    finally:
        other.chmod(0o755)


def test_mid_commit_failure_restores_old_bytes_and_removes_created_files(tmp_path, monkeypatch, capsys):
    module = installer()
    first, created, last = (tmp_path / n for n in ("first", "created", "last"))
    first.write_bytes(b"original\r\n")
    last.write_bytes(b"last original")
    plans = [(first, b"new", "first", first.read_bytes()), (created, b"new", "created", None), (last, b"new", "last", last.read_bytes())]
    replace = module.os.replace
    def fail_last(source, dest):
        if Path(dest) == last:
            raise OSError("injected rename failure")
        return replace(source, dest)
    monkeypatch.setattr(module.os, "replace", fail_last)
    with pytest.raises(OSError, match="injected rename failure"):
        module.apply(plans, tmp_path / "backups")
    assert first.read_bytes() == b"original\r\n" and last.read_bytes() == b"last original"
    assert not created.exists() and not list(tmp_path.glob(".gemini-context-*"))
    assert "ROLLED-BACK" in capsys.readouterr().out
    assert (tmp_path / "backups/first").read_bytes() == b"original\r\n"


def test_backup_collision_and_verification_abort_before_replace(tmp_path, monkeypatch):
    module = installer()
    dest = tmp_path / "GEMINI.md"
    dest.write_bytes(b"original")
    backup = tmp_path / "backups"
    backup.mkdir()
    existing = backup / "saved"
    existing.write_bytes(b"earlier original")
    with pytest.raises(FileExistsError):
        module.apply([(dest, b"new", "saved", b"original")], backup)
    assert existing.read_bytes() == b"earlier original" and dest.read_bytes() == b"original"
    existing.unlink()
    read_bytes = Path.read_bytes
    def corrupt_backup(path):
        return b"corrupt" if path == existing else read_bytes(path)
    monkeypatch.setattr(Path, "read_bytes", corrupt_backup)
    with pytest.raises(ValueError, match="backup verification"):
        module.apply([(dest, b"new", "saved", b"original")], backup)
    assert dest.read_bytes() == b"original"


@pytest.mark.parametrize("readonly", ["file", "backup"])
def test_readonly_replacement_or_backup_root_is_prevalidated(tmp_path, readonly):
    home, repo, registry = fixture(tmp_path)
    original = b"stale\r\n"
    (repo / "GEMINI.md").write_bytes(original)
    (repo / "CLAUDE.md").write_bytes(original)
    locked = repo / "GEMINI.md" if readonly == "file" else home / ".golems/backups/gemini-md"
    if readonly == "backup":
        locked.mkdir(parents=True)
    locked.chmod(0o444 if readonly == "file" else 0o555)
    try:
        result = run(home, registry, "--apply")
        assert result.returncode != 0 and "repo\taction" in result.stdout
        assert (repo / "GEMINI.md").read_bytes() == original and not (home / ".gemini").exists()
    finally:
        locked.chmod(0o644 if readonly == "file" else 0o755)


def test_force_on_second_alias_applies_once(tmp_path):
    home, repo, registry = fixture(tmp_path)
    registry.write_text(json.dumps({"projects": {"a": {"path": str(repo)}, "z": {"path": str(repo)}}}))
    (repo / "GEMINI.md").write_bytes(b"genuine short content")
    result = run(home, registry, "--apply", "--force-repo", "z")
    assert result.returncode == 0 and "SKIP-DUPLICATE" in result.stdout
    assert (repo / "GEMINI.md").read_bytes() == TEMPLATE.read_bytes()
    backups = list(home.glob(".golems/backups/gemini-md/*/*"))
    assert len(backups) == 1 and backups[0].read_bytes() == b"genuine short content"


def test_staging_failure_commits_nothing(tmp_path, monkeypatch):
    module = installer()
    first, last = tmp_path / "first", tmp_path / "last"
    first.write_bytes(b"original")
    original_stage = module.stage
    def fail_last(path, data):
        if path == last:
            raise OSError("injected staging failure")
        return original_stage(path, data)
    monkeypatch.setattr(module, "stage", fail_last)
    with pytest.raises(OSError, match="staging failure"):
        module.apply([(first, b"new", "first", b"original"), (last, b"new", "last", None)], tmp_path / "backups")
    assert first.read_bytes() == b"original" and not last.exists()
    assert not list(tmp_path.glob(".gemini-context-*"))
