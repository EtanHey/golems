"""Cleanup is part of done: every merge or DONE report carries a CLEANUP RECEIPT.

Cleanliness standard, Mechanism 1 (2026-09-24). Every PR adds files and nothing in
the PR loop or a plan's exit criteria removed them, so repos grew to hundreds of
worktrees and branches. The receipt makes cleanup a line a gate or a human reads:
/pr-loop defines it, /large-plan refuses to close a phase without one per worker.
"""

import json
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SKILLS = REPO / "skills/golem-powers"
PR_LOOP = SKILLS / "pr-loop"
LARGE_PLAN = SKILLS / "large-plan"
RECEIPT_LINES = (
    "CLEANUP RECEIPT (mandatory in the merge comment or the DONE report):",
    "- worktree: <path> removed | kept because <reason>",
    "- branch: <name> deleted local+remote | kept because <reason>",
    "- files this PR added outside src/tests: <list or none>",
    "- docs.local this lane created: <paths>; rolled into <day>/README or deleted",
)


def read(path):
    return path.read_text()


def eval_text(skill):
    return json.dumps(json.loads(read(skill / "evals/evals.json"))["evals"])


def test_merge_reference_carries_receipt_after_worktree_removal():
    text = read(PR_LOOP / "references/merge-and-verification.md")
    removal = text.index("git worktree remove <worktree-path>")
    heading = text.index("### Cleanup Receipt")
    assert heading > removal
    for line in RECEIPT_LINES:
        assert line in text[heading:], line


def test_receipt_file_dispositions_follow_the_docs_ruling():
    # R2-7 (2026-09-24): no docs/adr; decision records go to BrainLayer.
    text = read(PR_LOOP / "references/merge-and-verification.md")
    block = text[text.index("### Cleanup Receipt"):]
    assert "docs/adr" not in block and "|adr|" not in block
    assert "docs/reference|docs/rationale|README" in block
    assert "stored to BrainLayer <chunk-id> and deleted" in block


def test_pr_loop_skill_points_at_the_receipt():
    text = read(PR_LOOP / "SKILL.md")
    assert "references/merge-and-verification.md#cleanup-receipt" in text
    assert "CLEANUP RECEIPT" in text


def test_worker_handoff_and_adapters_carry_the_receipt():
    for rel in ("references/dispatch-and-handoffs.md", "adapters/codex.md"):
        assert "CLEANUP RECEIPT" in read(PR_LOOP / rel), rel


def test_large_plan_phase_close_requires_receipts_and_prune():
    text = read(LARGE_PLAN / "SKILL.md")
    assert "not closed until every worker's CLEANUP RECEIPT is present" in text
    for step in ("git worktree prune", "delete merged branches", "docs.local/<sprint>/"):
        assert step in text, step
    for rel in ("adapters/codex.md", "adapters/capabilities.yaml", "workflows/execute-phase.md"):
        assert "CLEANUP RECEIPT" in read(LARGE_PLAN / rel), rel


def test_evals_cover_receipt_on_merge_and_on_phase_close():
    assert "CLEANUP RECEIPT" in eval_text(PR_LOOP)
    assert "cleanup-receipt" in eval_text(PR_LOOP)
    assert "CLEANUP RECEIPT" in eval_text(LARGE_PLAN)
    assert "git worktree prune" in eval_text(LARGE_PLAN)
