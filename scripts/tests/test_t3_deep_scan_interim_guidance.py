"""PHX ruling: T3's managed-profile failure requires both Standard scan passes."""

from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
ROUTING = REPO / "skills/golem-powers/agent-routing/SKILL.md"


def implementation_guidance():
    text = ROUTING.read_text()
    return text[text.index("### Implementation and review"):text.index("### Inner loop")]


def interim_guidance():
    text = implementation_guidance()
    return text[text.index("**T3 seats (interim):**"):]


def test_t3_interim_follows_existing_deep_scan_rule():
    text = implementation_guidance()
    assert "Deep scans run from `<repo>Codex --scan -E high`" in text
    assert "XS/S security PRs get a diff-scoped Standard scan" in text
    assert "M/L or anything touching auth/guards a full Deep scan" in text
    assert text.index("Deep scans run from") < text.index("**T3 seats (interim):**")


def test_managed_profile_failure_requires_both_standard_passes_and_receipts():
    text = interim_guidance()
    for phrase in (
        "the parent must provide a managed filesystem permission profile",
        "Standard scan with its scope widened to every touched auth/guard path",
        "plus one full-repo Standard pass",
        "Record in the PR body",
        "Deep scan unavailable from T3 (interim)",
        "both scans' scope",
        "their reported token use",
        "Cost is never a reason to skip either pass",
    ):
        assert phrase in text, phrase


def test_deep_scan_route_awaits_lead_proof_without_retired_pane_fallback():
    text = interim_guidance()
    assert "Proven T3 Deep-scan route: <TBD by lead>" in text
    assert "cmux" not in text
    assert "<repo>Codex --scan" not in text
