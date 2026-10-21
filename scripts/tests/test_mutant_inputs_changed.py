"""The semantic-mutant CI step runs on PRs only when its inputs change (Etan 2026-10-22)."""
from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
DETECTOR = ROOT / "scripts" / "ci" / "mutant-inputs-changed.sh"
WORKFLOW = ROOT / ".github" / "workflows" / "golem-powers-skill-tests.yml"


def git(repo: Path, *args: str) -> str:
    return subprocess.run(["git", "-C", str(repo), *args], check=True, text=True,
                          capture_output=True).stdout.strip()


def repo_with_change(tmp_path: Path, changed: str, *, rename_from: str | None = None) -> tuple[Path, str]:
    repo = tmp_path / "repo"
    repo.mkdir()
    git(repo, "init", "-q", "-b", "master")
    git(repo, "config", "user.email", "t@example.invalid")
    git(repo, "config", "user.name", "t")
    seed = repo / (rename_from or "README.md")
    seed.parent.mkdir(parents=True, exist_ok=True)
    seed.write_text("base\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", "base")
    base = git(repo, "rev-parse", "HEAD")
    target = repo / changed
    target.parent.mkdir(parents=True, exist_ok=True)
    if rename_from:
        git(repo, "mv", rename_from, changed)
    else:
        target.write_text("change\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", "change")
    return repo, base


def detect(repo: Path, base: str) -> subprocess.CompletedProcess:
    return subprocess.run(["bash", str(DETECTOR), base], cwd=repo, text=True, capture_output=True)


@pytest.mark.parametrize("path", [
    "scripts/ci/pristine-harness.py",
    "scripts/tests/fixtures/pristine-harness/semantic-mutants.json",
    "scripts/tests/fixtures/codex-sessions/a b.jsonl",
    "skills/golem-powers/_shared/shell_parse.py",
    "skills/golem-powers/_shared/shell_parse_impl/substitutions.py",
    "skills/golem-powers/_shared/harness_paths.py",
    "skills/golem-powers/git-guardian/git_safety_impl/payloads.py",
    "skills/golem-powers/git-guardian/hooks/pre_tool_use.py",
    "skills/golem-powers/tmp-block/hooks/tmp_block_impl/rules.py",
    "scripts/repogolem/golem-dispatch.zsh",
    ".github/workflows/golem-powers-skill-tests.yml",
])
def test_relevant_paths_select_mutants(tmp_path, path):
    repo, base = repo_with_change(tmp_path, path)
    result = detect(repo, base)
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "relevant=true"


@pytest.mark.parametrize("path", [
    "skills/golem-powers/weave/references/topology.md",
    "skills/golem-powers/git-guardian/SKILL.md",
    "packages/shared/package.json",
])
def test_unrelated_paths_skip_mutants(tmp_path, path):
    repo, base = repo_with_change(tmp_path, path)
    result = detect(repo, base)
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "relevant=false"


def test_rename_out_of_a_relevant_path_selects_mutants(tmp_path):
    repo, base = repo_with_change(tmp_path, "attic/old_safety.py",
                                  rename_from="skills/golem-powers/git-guardian/git_safety.py")
    assert detect(repo, base).stdout.strip() == "relevant=true"


def test_unknown_base_fails_instead_of_skipping(tmp_path):
    repo, _ = repo_with_change(tmp_path, "README2.md")
    result = detect(repo, "0" * 40)
    assert result.returncode != 0
    assert "relevant=false" not in result.stdout


def test_workflow_gates_only_the_mutant_step():
    workflow = WORKFLOW.read_text()
    assert "name: Python skill test suites" in workflow
    assert "schedule:" in workflow and "workflow_dispatch:" in workflow
    assert "scripts/ci/mutant-inputs-changed.sh" in workflow
    step = workflow.split("- name: Catch all required semantic policy mutants", 1)[1].split("\n\n", 1)[0]
    assert "steps.mutant-paths.outputs.relevant == 'true'" in step
    assert "github.event_name == 'schedule'" in step
    assert "github.event_name == 'workflow_dispatch'" in step
    for gate in ("pristine-harness.py check", "pristine-harness.py verify-goldens", "run-skill-tests.sh"):
        line = next(l for l in workflow.splitlines() if gate in l)
        assert "if:" not in line
