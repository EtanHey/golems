from pathlib import Path


EVALS_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = EVALS_DIR.parents[3]
AUDIT_WORKFLOW = (
    REPO_ROOT
    / "skills"
    / "golem-powers"
    / "skill-creator"
    / "workflows"
    / "audit-skill.md"
)


def test_audit_workflow_explicitly_skips_archived_skill_results() -> None:
    workflow = AUDIT_WORKFLOW.read_text()

    assert "SKIP_ARCHIVED_EVAL_RESULTS" in workflow
    assert "skills/golem-powers/_archive/" in workflow
