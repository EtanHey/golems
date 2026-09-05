"""RED→GREEN replay for the adversarial-council ballot validator (gen-18 Track 6 D8)."""

import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("council_lint", ROOT / "council_lint.py")
cl = importlib.util.module_from_spec(spec)
sys.modules["council_lint"] = cl
spec.loader.exec_module(cl)

RED = (ROOT / "fixtures" / "red-ballot.md").read_text()
GREEN = (ROOT / "fixtures" / "green-ballot.md").read_text()
REQUIRED = ["specs/feature-spec.md", "designs/architecture.md"]


def _rules(violations):
    return {v["rule"] for v in violations}


# ── Headline gate: RED trips every rule, GREEN trips none ──────────────────────────

def test_red_ballot_trips_all_four_rules():
    rules = _rules(cl.validate_ballot(RED, required_inputs=REQUIRED))
    assert rules == {"authorship-leak", "missing-sentinel", "unread-required-input", "missing-score"}


def test_green_ballot_is_clean():
    assert cl.validate_ballot(GREEN, required_inputs=REQUIRED) == []


# ── Rule 1: anonymization (authorship leak) ────────────────────────────────────────

def test_engine_token_is_an_authorship_leak():
    ballot = "## Candidate A\nScore: 7/10\nThis is orcClaude's entry.\nCOUNCIL-BALLOT-COMPLETE\n"
    assert any(v["rule"] == "authorship-leak" for v in cl.validate_ballot(ballot))


def test_first_person_authorship_claim_leaks():
    ballot = "## Candidate A\nScore: 7/10\nMy proposal handles the edge case.\nCOUNCIL-BALLOT-COMPLETE\n"
    assert any(v["rule"] == "authorship-leak" for v in cl.validate_ballot(ballot))


def test_possessive_is_mine_claim_leaks():
    # PR #537 Bugbot: "the design is mine" is an authorship leak even without "I wrote".
    ballot = "## Candidate A\nScore: 7/10\nThe design is mine and it is the cleanest.\nCOUNCIL-BALLOT-COMPLETE\n"
    assert any(v["rule"] == "authorship-leak" for v in cl.validate_ballot(ballot))


def test_inputs_after_verdicts_does_not_count():
    # PR #537 Bugbot: an Inputs-read section placed AFTER the candidates was not read
    # before opining, so it must not satisfy the required-input gate.
    ballot = (
        "## Candidate A\nScore: 7/10\nFine.\n"
        "## Inputs read\n- spec.md\n"
        "COUNCIL-BALLOT-COMPLETE\n"
    )
    assert any(v["rule"] == "unread-required-input" for v in cl.validate_ballot(ballot, required_inputs=["spec.md"]))


def test_required_input_matched_as_path_token_not_substring():
    # PR #537 Bugbot: required `a.md` must NOT be satisfied by `draft-a.md`.
    ballot = "## Inputs read\n- draft-a.md\n## Candidate A\nScore: 7/10\nFine.\nCOUNCIL-BALLOT-COMPLETE\n"
    assert any(v["rule"] == "unread-required-input" for v in cl.validate_ballot(ballot, required_inputs=["a.md"]))
    # …but a real path-segment match (basename under a dir) IS acknowledged.
    ok = "## Inputs read\n- specs/a.md\n## Candidate A\nScore: 7/10\nFine.\nCOUNCIL-BALLOT-COMPLETE\n"
    assert not any(v["rule"] == "unread-required-input" for v in cl.validate_ballot(ok, required_inputs=["a.md"]))


def test_lowercase_compound_engine_token_leaks():
    # PR #537 Bugbot: a lowercase compound engine name (agentcodex) is still a leak…
    ballot = "## Candidate A\nScore: 7/10\nThis is agentcodex's entry.\nCOUNCIL-BALLOT-COMPLETE\n"
    assert any(v["rule"] == "authorship-leak" for v in cl.validate_ballot(ballot))


def test_bare_word_cursor_is_not_an_engine_leak():
    # …but the bare word "cursor" (a text caret) must NOT trip the leak rule.
    ballot = (
        "## Inputs read\n- spec.md\n"
        "## Candidate A\nScore: 7/10\nThe cursor jumps to the wrong line on resize.\n"
        "COUNCIL-BALLOT-COMPLETE\n"
    )
    assert cl.validate_ballot(ballot, required_inputs=["spec.md"]) == []


def test_aux_sections_are_not_candidates():
    # PR #537 Bugbot: `## Entry criteria` / `## Candidate rubric` are aux sections — they
    # must not stop input-ack scanning nor be scored as candidates.
    ballot = (
        "## Candidate rubric\nScore on clarity and risk.\n"
        "## Inputs read\n- spec.md\n"
        "## Candidate A\nScore: 7/10\nThe retry path is bounded.\n"
        "COUNCIL-BALLOT-COMPLETE\n"
    )
    assert cl.validate_ballot(ballot, required_inputs=["spec.md"]) == []


def test_merit_critique_without_identity_is_clean():
    ballot = (
        "## Inputs read\n- spec.md\n"
        "## Candidate A\nScore: 7/10\nThe retry path is well-bounded but the TTL is unstated.\n"
        "COUNCIL-BALLOT-COMPLETE\n"
    )
    assert cl.validate_ballot(ballot, required_inputs=["spec.md"]) == []


# ── Rule 2: sentinel final-line ────────────────────────────────────────────────────

def test_missing_sentinel_flagged():
    ballot = "## Inputs read\n- spec.md\n## Candidate A\nScore: 7/10\nFine.\n"
    rules = _rules(cl.validate_ballot(ballot, required_inputs=["spec.md"]))
    assert "missing-sentinel" in rules


def test_custom_sentinel_respected():
    ballot = "## Candidate A\nScore: 7/10\nFine.\nEND-OF-BALLOT"
    assert not any(v["rule"] == "missing-sentinel" for v in cl.validate_ballot(ballot, sentinel="END-OF-BALLOT"))


# ── Rule 3: required inputs acknowledged ───────────────────────────────────────────

def test_unread_required_input_flagged():
    ballot = "## Inputs read\n- spec.md\n## Candidate A\nScore: 7/10\nFine.\nCOUNCIL-BALLOT-COMPLETE\n"
    rules = _rules(cl.validate_ballot(ballot, required_inputs=["spec.md", "design.md"]))
    assert "unread-required-input" in rules  # design.md not acknowledged


# ── Rule 4: every candidate scored ─────────────────────────────────────────────────

def test_missing_score_flagged():
    ballot = "## Candidate A\nNo score here, just prose.\nCOUNCIL-BALLOT-COMPLETE\n"
    assert any(v["rule"] == "missing-score" for v in cl.validate_ballot(ballot))


def test_score_equals_form_accepted():
    ballot = "## Candidate A\nScore = 7\nFine.\nCOUNCIL-BALLOT-COMPLETE\n"
    assert not any(v["rule"] == "missing-score" for v in cl.validate_ballot(ballot))
