import json
from pathlib import Path
import subprocess

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
    assert run(home, registry, "--apply").returncode == 0
    assert not list(home.glob(".golems/backups/gemini-md/*/*"))
    assert run(home, registry, "--check").returncode == 0


def test_stale_claude_copy_is_backed_up_byte_for_byte(tmp_path):
    home, repo, registry = fixture(tmp_path)
    original = "# First Boot\nbrain_recall(mode=\"context\")\n"
    (repo / "CLAUDE.md").write_text(original)
    (repo / "GEMINI.md").write_text(original)
    assert "yes" in run(home, registry).stdout
    assert run(home, registry, "--apply").returncode == 0
    backups = list(home.glob(".golems/backups/gemini-md/*/example-GEMINI.md"))
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


def test_symlink_destination_is_refused(tmp_path):
    assert SCRIPT.exists()
    home, repo, registry = fixture(tmp_path)
    target = tmp_path / "external"
    target.write_text("outside")
    (repo / "GEMINI.md").symlink_to(target)
    assert run(home, registry, "--apply", "--force-repo", "example").returncode != 0
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
    assert next(home.glob(".golems/backups/gemini-md/*/gatherer.md")).read_bytes() == b"existing-agent\r\n"


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
