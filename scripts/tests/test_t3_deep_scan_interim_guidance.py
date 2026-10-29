from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
ROUTING = REPO / "skills/golem-powers/agent-routing/SKILL.md"


def implementation_guidance():
    text = ROUTING.read_text()
    return text[text.index("### Implementation and review"):text.index("### Inner loop")]


def test_t3_interim_follows_existing_deep_scan_rule():
    text = implementation_guidance()
    assert "Deep scans run from `<repo>Codex --scan -E high`" in text
    assert "XS/S security PRs get a diff-scoped Standard scan" in text
    assert "M/L or anything touching auth/guards a full Deep scan" in text


def test_managed_profile_failure_requires_both_standard_passes_and_receipts():
    text = implementation_guidance().split("**T3 seats (interim):**", 1)[1]
    for phrase in (
        "If the Deep scan can't start from a T3 seat",
        "the parent must provide a managed filesystem permission profile",
        "Standard scan with its scope widened to every touched auth/guard path",
        "plus one full-repo Standard pass",
        "Record in the PR body",
        "Deep scan unavailable from T3 (interim)",
        "both scans' scope",
        "their reported token use",
        "Cost is never a reason to skip either pass",
        "Tell the Claude security reviewer, before its round, that Deep was unavailable and which Standard scopes ran.",
    ):
        assert phrase in text, phrase


def test_proven_deep_scan_route_precedes_interim_without_retired_pane_fallback():
    guidance = implementation_guidance()
    route = "Proven T3 Deep-scan route (try it before the interim below):"
    assert guidance.index("Deep scans run from") < guidance.index(route) < guidance.index("**T3 seats (interim):**")
    text = guidance[guidance.index(route):]
    assert "`delegate_task`" in text
    assert 'runtimeMode: "auto"' in text
    assert "completion wakes the lead" in text
    assert "runtimeMode `auto`" in text
    assert "`runtime_mode_escalation_denied`" in text
    assert "TBD by lead" not in guidance
    assert "cmux" not in text
    assert "<repo>Codex --scan" not in text
