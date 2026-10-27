"""T3 child retirement preserves review work and explicitly targets the child."""

import json
from pathlib import Path

import pytest

SKILLS = Path(__file__).resolve().parents[2] / "skills/golem-powers"
SITES = [
    ("agent-routing/SKILL.md", "4. **Settle:**", "5. **Review rounds:**"),
    ("agent-routing/SKILL.md", "**Settle at the terminal state:**", "cmux adapter: harvest"),
    ("agent-routing/references/t3-native.md", "## 4. On wake:", "## 5. Review rounds"),
    ("large-plan/SKILL.md", "6. **Settle**", "### cmux adapter:"),
    ("large-plan/SKILL.md", "| **Watch cleanup (plan done)** |", "\n"),
    ("large-plan/adapters/capabilities.yaml", "  monitor_cleanup:", "    claude_code:"),
    ("large-plan/workflows/collab.md", "17. **No watch cleanup**", "\n"),
    ("agent-routing/evals/evals.json", "result-available-merged-settle-unwatch", None),
    ("large-plan/evals/evals.json", "t3-lane-terminal-settle-now", None),
]


def anchored_site(text, path, start, end):
    offset = text.find(start)
    assert offset >= 0, f"{path}: missing anchor {start!r}"
    limit = text.find(end, offset + len(start))
    assert limit >= 0, f"{path}: missing anchor {end!r} after {start!r}"
    return text[offset:limit]


def site_text(path, start, end):
    text = (SKILLS / path).read_text()
    if end is None:
        matches = [e for e in json.loads(text)["evals"] if e.get("name") == start]
        assert len(matches) == 1, f"{path}: missing or duplicate eval {start!r}"
        return matches[0]["expected_output"]
    site = anchored_site(text, path, start, end)
    if path.endswith(".yaml"):
        # This adapter stores the cleanup rule as a JSON-compatible quoted scalar.
        return json.loads(site.split("t3:", 1)[1].strip())
    return site


def normalized(text):
    return " ".join(text.replace("`", "").split())


@pytest.mark.parametrize("path,start,end", SITES)
def test_t3_settle_detaches_provider_session(path, start, end):
    site = normalized(site_text(path, start, end))
    where = f"{path}: {start}"
    assert 't3_thread_organize {action: "settle", threadId: <childThreadId>}' in site, (
        f"{where} must settle the explicit childThreadId")
    assert "never omit threadid" in site.lower(), (
        f"{where} must forbid omitting threadId")
    assert "an omitted threadId settles the calling lead thread" in site, (
        f"{where} must explain the self-settle hazard")
    if start != "**Settle at the terminal state:**":
        assert "Goal Contract" in site, f"{where} must point to the worktree caveat"


def test_dispatch_step_four_keeps_the_implementer_through_review():
    site = normalized(site_text(*SITES[0]))
    for clause in ("at the PR's terminal state", "merged or handed off", "never at the first DONE",
                   "a PR in review rounds keeps its implementer"):
        assert clause in site, f"dispatch step 4 must say {clause!r}"


def test_goal_contract_describes_provider_release_timing():
    site = normalized(site_text(*SITES[1]))
    wording = ("releases its provider session (Claude: MCP children exit at once; shared Codex: "
               "the thread unloads and its MCPs close after Codex's unload delay); "
               "task_cancel alone does not detach.")
    assert wording in site, "Goal Contract must distinguish Claude release from shared Codex unload"


def test_detach_and_cancel_have_source_citations():
    site = site_text(*SITES[2])
    for source in ("96fc7b95", "Orchestrator.ts:3851-3854,3887-3910",
                   "OrchestratorMcpService.ts:2371-2423"):
        assert source in site, f"t3-native must cite {source}"


def test_goal_contract_preserves_worktrees_needed_by_review_or_fixes():
    site = normalized(site_text(*SITES[1]))
    caveat = ("Settle once nothing still needs the child's worktree (a pending reviewer or fix round): "
              "T3's hourly cleanup removes settled threads' worktree checkouts (it keeps the branch).")
    assert caveat in site, "Goal Contract must preserve worktrees needed by reviewers or fix rounds"
    assert "storageCleanup.ts:85-90,1017-1029,1236-1261" in site, "cite the cleanup policy"


@pytest.mark.parametrize("text,missing", [("end", "start"), ("start", "end")])
def test_missing_anchor_is_an_actionable_assertion(text, missing):
    with pytest.raises(AssertionError, match=f"fixture.md: missing anchor '{missing}'"):
        anchored_site(text, "fixture.md", "start", "end")


def test_cleanup_adapter_matches_the_skill_table():
    row = site_text(*SITES[4]).split("|")[2].strip()
    adapter = site_text(*SITES[5])
    assert adapter == normalized(row), "monitor_cleanup.t3 must match the skill table"
