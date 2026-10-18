"""STATUS + one collab line, wake words, workers ask the lead, settle, worktree cleanup.

Audit row 7 (skill-edits 2026-10-18). The orc rulings of 2026-10-18 21:40 and 22:00 #5
replace big status ledgers and status messages in orc's T3 thread with one STATUS file
overwritten in place plus one appended collab line per status change. Workers ask their
lead, never Etan, about routing; the lead settles idle workers; the implementer removes
its own worktree at DONE. The skill text must carry those rules verbatim.
"""

import json
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SKILLS = REPO / "skills/golem-powers"
LARGE_PLAN = SKILLS / "large-plan"
AGENT_ROUTING = SKILLS / "agent-routing"
PR_LOOP = SKILLS / "pr-loop"
ATTRIBUTION = "(Etan 2026-10-18, via orc collab)"

# 21:40 protocol and 22:00 #5, verbatim (RULES-VERBATIM.md).
WHERE_UPDATES_GO = (
    "leads post progress HERE, appended with `cat >> … <<'EOF'`, never edited in place. "
    "No more status messages into orc's T3 thread."
)
WHAT_WAKES_ORC = (
    "`@orc`, a header `### <lead> → orc`, or a BLOCKED/DONE line. Use them only for: "
    "blocked, a lane done, or something Etan must decide."
)
STATUS_TRACKING = (
    "a STATUS file overwritten in place, plus ONE line per status change appended here "
    "(traceability). No big ledgers."
)


def read(path):
    return path.read_text()


def section(text, heading):
    start = text.index(heading)
    level = heading.split(" ")[0]
    rest = text[start + len(heading):]
    ends = [i for i in (rest.find("\n" + level + " "),) if i >= 0]
    return text[start:start + len(heading) + (min(ends) if ends else len(rest))]


def evals(skill):
    return json.loads(read(skill / "evals/evals.json"))["evals"]


def test_collab_workflow_carries_status_and_wake_rules_verbatim():
    text = section(read(LARGE_PLAN / "workflows/collab.md"), "## Status and wakes")
    for rule in (WHERE_UPDATES_GO, WHAT_WAKES_ORC, STATUS_TRACKING):
        assert rule in text, rule
    assert "STATUS.md" in text and "overwritten in place" in text
    assert "`@etan`" in text and "fleet-latest.html" in text
    assert "`<lead>-w<N>`" in text
    assert ATTRIBUTION in text


def test_no_per_commit_message_ledger_remains():
    # "No big ledgers": a commit is not a status change, so it gets no collab line.
    stale = (
        "Before EVERY commit",
        "If you git commit without a corresponding Messages entry",
        "Update Messages BEFORE every git commit",
        "Update collab.md Messages before every commit",
        "Update collab.md Messages BEFORE committing",
    )
    for rel in ("workflows/collab.md", "workflows/execute-phase.md", "workflows/scaffold.md"):
        text = read(LARGE_PLAN / rel)
        for phrase in stale:
            assert phrase not in text, f"{rel}: {phrase}"


def test_large_plan_skill_points_at_status_and_settles_lanes():
    text = read(LARGE_PLAN / "SKILL.md")
    assert "workflows/collab.md#status-and-wakes" in text
    assert "STATUS.md" in text
    t3 = section(text, "### T3-native execution (default in T3)")
    for token in ("Settle", "task_cancel", "unwatch_pull_request", "Idle"):
        assert token in t3, token


def test_phase_exit_has_the_implementer_remove_its_own_worktree():
    text = read(LARGE_PLAN / "SKILL.md")
    exit_gate = text[text.index("**Phase exit:**"):text.index("## Phase N+1")]
    assert "the implementer removes its worktree at DONE" in exit_gate
    assert "regenerable caches need no OK" in exit_gate
    assert "verifies" in exit_gate and "never removes" in exit_gate


def test_goal_contract_routes_worker_questions_to_the_lead_and_settles():
    text = section(read(AGENT_ROUTING / "SKILL.md"), "## Goal Contract")
    assert "workers never ask Etan routing questions" in text
    assert "settle idle workers" in text
    assert "t3_pending_request_respond" in text
    for token in ("task_cancel", "unwatch_pull_request", "close the pane", "Idle"):
        assert token in text, token
    assert ATTRIBUTION in text


def test_cleanup_receipt_has_the_implementer_remove_its_worktree_at_done():
    text = section(read(PR_LOOP / "references/merge-and-verification.md"), "### Cleanup Receipt")
    assert "the implementer removes its worktree at DONE" in text
    assert "regenerable caches need no OK" in text
    for cache in ("node_modules", "__pycache__"):
        assert cache in text, cache
    # A pushed branch preserves the artifact, so an unmerged handoff no longer keeps the tree.
    assert "kept because PR #N awaits lead merge" not in text
    assert "The lead verifies the receipt" in text
    assert ATTRIBUTION in text


def test_no_private_tailnet_url_in_public_skills():
    for path in (LARGE_PLAN / "workflows/collab.md", LARGE_PLAN / "SKILL.md",
                 AGENT_ROUTING / "SKILL.md", PR_LOOP / "references/merge-and-verification.md"):
        assert ".ts.net" not in read(path), path


def test_evals_cover_status_questions_settle_and_worktree_cleanup():
    plan = {e["name"]: e for e in evals(LARGE_PLAN) if e["id"] >= 40}
    routing = {e["name"]: e for e in evals(AGENT_ROUTING) if e["id"] >= 100}
    for name in ("lead-pr-done-status-overwrite-one-line", "implementer-done-removes-worktree"):
        assert name in plan, name
    for name in ("worker-routing-question-asks-lead", "result-available-merged-settle-unwatch"):
        assert name in routing, name
    for group in (evals(LARGE_PLAN), evals(AGENT_ROUTING)):
        ids = [e["id"] for e in group]
        assert len(ids) == len(set(ids)), ids
