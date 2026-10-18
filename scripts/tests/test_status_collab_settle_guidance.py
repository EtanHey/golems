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


TOUCHED_SKILL_FILES = (
    LARGE_PLAN / "SKILL.md",
    LARGE_PLAN / "workflows/collab.md",
    LARGE_PLAN / "workflows/scaffold.md",
    LARGE_PLAN / "workflows/execute-phase.md",
    LARGE_PLAN / "adapters/codex.md",
    LARGE_PLAN / "evals/evals.json",
    AGENT_ROUTING / "SKILL.md",
    AGENT_ROUTING / "evals/evals.json",
    PR_LOOP / "references/merge-and-verification.md",
)


def test_no_private_tailnet_url_in_public_skills():
    # Review round 1 on #801: the guard covers all nine skill files this lane touched.
    assert len(TOUCHED_SKILL_FILES) == 9
    for path in TOUCHED_SKILL_FILES:
        assert ".ts.net" not in read(path), path


def test_cleanup_receipt_documents_an_executable_retirement_path_for_both_harnesses():
    # Review round 1 BLOCKING on #801: worktree-gc.sh refuses .t3/worktrees (KEEP-out-of-scope)
    # and a live cmux pane (KEEP-live), so the implementer retires its own tree directly.
    text = section(read(PR_LOOP / "references/merge-and-verification.md"), "### Cleanup Receipt")
    for token in (
        "git status --porcelain",
        "git ls-remote origin <branch>",
        "git rev-parse HEAD",
        'git -C "$MAIN" worktree remove "$WT"',
        "never `--force`",
        "T3 child",
        "LAST tool call",
        "cmux worker",
        "BEFORE writing DONE",
        "the lead closes the pane afterwards",
        "exited 0",
        "KEEP-out-of-scope",
        "<main>/.worktrees",
    ):
        assert token in text, token
    assert "removed` only after" in text
    # The old routes are gone: GC for the implementer's own tree, pane close before removal.
    assert "merged lane: the guarded GC above" not in text


def test_lane_close_gc_is_the_leads_leftover_sweep():
    text = read(PR_LOOP / "references/merge-and-verification.md")
    lane_close = text[text.index("**Worktree cleanup (lane close):**"):text.index("### Cleanup Receipt")]
    assert "leftovers" in lane_close
    assert "after the worker's pane is closed:" not in lane_close


def _rules_block(text, start_marker, end_marker):
    start = text.index(start_marker)
    return text[start:text.index(end_marker, start)]


def test_preflight_runs_before_the_learning_line_is_appended():
    # Review round 1 MAJOR on #801: appending `learning` first, then reporting the
    # pre-flight count "in that line", forces an edit in place or an extra line.
    scaffold = _rules_block(read(LARGE_PLAN / "workflows/scaffold.md"), "Rules:\n1.", "Start now.")
    assert scaffold.index("pre-flight") < scaffold.index("`learning`")
    assert "Report the count in your `learning` line" not in scaffold
    execute = _rules_block(read(LARGE_PLAN / "workflows/execute-phase.md"),
                           "**If running as part of a collab:**", "### 2.")
    assert execute.lower().index("pre-flight") < execute.index("`learning`")
    assert "in that line" not in execute


def test_collab_archival_never_moves_messages_out():
    # Review round 1 MAJOR on #801: moving messages out rewrites the traceability log.
    text = read(LARGE_PLAN / "workflows/collab.md")
    assert "Archive old messages" not in text
    complex_tier = section(text, "### Complex")
    assert "never moved" in complex_tier and "copy" in complex_tier


def test_scaffold_agent_rows_match_status_md():
    # Review round 1 MINOR on #801: the Agents table has no Status column; agent state
    # lives in STATUS.md, so scaffold must not demand agent rows with status = idle.
    collab = read(LARGE_PLAN / "workflows/collab.md")
    assert "| Agent | Status |" in collab
    scaffold = read(LARGE_PLAN / "workflows/scaffold.md")
    for line in scaffold.splitlines():
        if "**Agents**" in line or "Agents table" in line:
            assert "status = `idle`" not in line, line
    assert sum("STATUS.md" in line and "`idle`" in line for line in scaffold.splitlines()) >= 2


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


# Review round 2 (L panel) on #801: the retirement recipe is executed, not just grepped.

import os
import re
import subprocess

RECIPE_HEADING = "**How (retirement path, implementer-owned, both harnesses):**"


def retirement_recipe():
    text = section(read(PR_LOOP / "references/merge-and-verification.md"), "### Cleanup Receipt")
    how = text[text.index(RECIPE_HEADING):]
    match = re.search(r"```bash\n(.*?)\n\s*```", how, re.S)
    assert match, "the Cleanup Receipt How path carries one copy-pasteable bash block"
    return "\n".join(line.strip() for line in match.group(1).splitlines())


GIT_ENV = {
    "GIT_CONFIG_GLOBAL": os.devnull,
    "GIT_CONFIG_NOSYSTEM": "1",
    "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@example.com",
    "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@example.com",
}


def git(cwd, *args):
    env = {**os.environ, **GIT_ENV}
    return subprocess.run(["git", "-C", str(cwd), *args], check=True, env=env,
                          capture_output=True, text=True).stdout


def lane(tmp_path):
    """A main checkout with a bare origin and a pushed, clean linked worktree."""
    remote, main, wt = tmp_path / "origin.git", tmp_path / "main", tmp_path / "wt" / "lane"
    git(tmp_path, "init", "-q", "--bare", str(remote))
    git(tmp_path, "init", "-q", "-b", "master", str(main))
    (main / ".gitignore").write_text("docs.local/\nnode_modules/\n")
    git(main, "add", ".gitignore")
    git(main, "commit", "-q", "-m", "init")
    git(main, "remote", "add", "origin", str(remote))
    git(main, "push", "-q", "origin", "master")
    git(main, "worktree", "add", "-q", "-b", "lane", str(wt))
    (wt / "f.txt").write_text("work\n")
    git(wt, "add", "f.txt")
    git(wt, "commit", "-q", "-m", "work")
    git(wt, "push", "-q", "origin", "lane")
    return main, wt


def retire(wt):
    env = {**os.environ, **GIT_ENV}
    return subprocess.run(["bash", "-c", retirement_recipe()], cwd=wt, env=env,
                          capture_output=True, text=True)


def test_recipe_removes_a_pushed_clean_worktree(tmp_path):
    main, wt = lane(tmp_path)
    out = retire(wt)
    assert out.returncode == 0, out.stderr
    assert not wt.exists()
    assert f"removed: {wt}" in out.stdout
    assert str(wt) not in git(main, "worktree", "list")


def test_recipe_keeps_an_unpushed_commit(tmp_path):
    _, wt = lane(tmp_path)
    (wt / "g.txt").write_text("local only\n")
    git(wt, "add", "g.txt")
    git(wt, "commit", "-q", "-m", "unpushed")
    out = retire(wt)
    assert wt.exists() and "kept because" in out.stdout and "removed" not in out.stdout


def test_recipe_keeps_ignored_docs_local(tmp_path):
    _, wt = lane(tmp_path)
    (wt / "docs.local").mkdir()
    (wt / "docs.local" / "report.md").write_text("unarchived\n")
    out = retire(wt)
    assert (wt / "docs.local" / "report.md").exists()
    assert "kept because docs.local unarchived" in out.stdout


def test_recipe_keeps_nested_docs_local_without_a_tracked_sibling(tmp_path):
    # Review round 3 BLOCKING on #801: `git status --porcelain --ignored` collapses a
    # directory holding only ignored files to `!! scratch/`, so a status grep misses it.
    _, wt = lane(tmp_path)
    (wt / "scratch" / "docs.local").mkdir(parents=True)
    (wt / "scratch" / "docs.local" / "REPORT.md").write_text("unarchived\n")
    out = retire(wt)
    assert (wt / "scratch" / "docs.local" / "REPORT.md").exists()
    assert "kept because docs.local unarchived" in out.stdout and "removed" not in out.stdout


def test_recipe_removes_when_only_regenerable_caches_are_ignored(tmp_path):
    _, wt = lane(tmp_path)
    (wt / "node_modules" / "pkg").mkdir(parents=True)
    (wt / "node_modules" / "pkg" / "index.js").write_text("cache\n")
    out = retire(wt)
    assert out.returncode == 0, out.stderr
    assert not wt.exists() and f"removed: {wt}" in out.stdout


def test_recipe_pins_main_discovery_and_ls_remote_sha():
    recipe = retirement_recipe()
    assert 'MAIN=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")' in recipe
    assert "| cut -f1" in recipe and "git rev-parse HEAD" in recipe
    assert "-type d -name docs.local" in recipe and "-prune" in recipe
    assert "--force" not in recipe


def test_t3_completion_lead_overwrites_status_without_a_second_line():
    text = read(LARGE_PLAN / "workflows/collab.md")
    assert "wakes the lead, which overwrites STATUS.md and appends one line" not in text
    status = section(text, "## Status and wakes")
    assert "appends no second line" in status


def test_collab_template_task_board_is_a_pointer_and_status_md_has_its_own_template():
    collab = read(LARGE_PLAN / "workflows/collab.md")
    template = collab[collab.index("## Collab File Structure (MANDATORY)"):collab.index("## Scaffolding a Collab")]
    board = template[template.index("## Task Board"):template.index("## Key Constraints")]
    assert "|" not in board, "the collab template's Task Board is a one-line pointer, not a table"
    status_tpl = collab[collab.index("## STATUS.md template"):collab.index("## Scaffolding a Collab")]
    assert "| Phase/Task | Owner | Status | PR |" in status_tpl and "| Agent | Status |" in status_tpl
    scaffold = read(LARGE_PLAN / "workflows/scaffold.md")
    assert "Create `STATUS.md`" in scaffold and "collab.md#statusmd-template" in scaffold
    kickoff = _rules_block(scaffold, "Rules:\n1.", "Start now.")
    assert "STATUS.md" in kickoff and "board state" in kickoff


def test_recipe_uses_the_upstream_branch_when_the_local_name_differs(tmp_path):
    # Review-fix rounds check out `-B <local> origin/<pr-branch>` and push HEAD:<pr-branch>.
    main, _ = lane(tmp_path)
    wt = tmp_path / "wt" / "fix"
    git(main, "fetch", "-q", "origin")
    git(main, "worktree", "add", "-q", "-b", "fix-local", str(wt), "origin/lane")
    (wt / "h.txt").write_text("fix\n")
    git(wt, "add", "h.txt")
    git(wt, "commit", "-q", "-m", "fix")
    git(wt, "push", "-q", "origin", "HEAD:lane")
    out = retire(wt)
    assert out.returncode == 0, out.stderr
    assert not wt.exists() and f"removed: {wt}" in out.stdout
