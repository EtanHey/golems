"""Synthetic regression corpus for session-level frustration classification.

False positives must stay silent and true frustration must preserve its expected
escalation tier. New production cases must be rewritten as synthetic examples
before entering this public corpus.
"""

import json
import subprocess
import sys
from pathlib import Path

import pytest


HOOK = Path(__file__).resolve().parents[1] / "frustration-capture-prompt.py"


FALSE_POSITIVES = [
    (
        "worker escalation relayed as a typed prompt",
        "ITEM-2 BLOCKER under lane rule 6: the standards document says core "
        "instructions install only after owner approval, but this item asks for "
        "new glossary prose before that approval. Please rule whether this is an "
        "exception or the item must stop. No commit, push, or PR yet.",
    ),
    (
        "mid-clarification voice answer",
        "Continue from the last three, but no, it is not the parser reading the "
        "file or the prompt. Continue because I missed that part.",
    ),
    (
        "spending and CI preference",
        "Let's file the frustration hook as something that needs fixing. It fires "
        "too often for no reason, probably on this prompt because it contains the "
        'word "no". I do not want to buy more hosted CI capacity; can we run the '
        "checks locally and merge remotely after review?",
    ),
]


TRUE_POSITIVES = [
    (
        "SSH frustration and direct ask",
        "Remote login is enabled and this connection worked before, so I don't know "
        "what you're bullshitting about. Hosted CI may be blocked after too many "
        "repeated pushes, so improve the local inner loop before opening another PR. "
        "You're listing possibilities instead of fixing the issue. Can you fucking "
        "figure out SSH? I can't believe it is still not working.",
        2,
    ),
    (
        "Cursor and Luna standing-rule rant",
        "I found another standing rule we need to enforce. We need to fucking get "
        "this under control; I have already explained that the automatic model router "
        "must remain enabled because pinning an expensive model drains quota. We have "
        "a cheaper worker available. I don't know why the agent ignored this; it is a "
        "fucking menace. What the fuck are you talking about? This really infuriated me.",
        3,
    ),
]


GENUINE_NO_CORRECTIONS = [
    "No, I meant the other file.",
    "No, the browser is Helium.",
    "No — the browser is Helium.",
    "No: the browser is Helium.",
    "No; the browser is Helium.",
    "No! I asked for the Hebrew version.",
    "No, I asked for master.",
    "no, do it the other way around",
    "Deploy status: no, you pushed to master again, I told you not to.",
    "No, you pushed to master again.",
    "No, you broke the build.",
    "No, you ignored the lint errors.",
    "DEPLOY STATUS: no, you broke prod.",
    "Server update: no, that is not what I asked for.",
]


STAGE_A_BRIEF_CONTROLS = [
    "You are voicelayerClaude-DESIGN (E5) — no, you should not touch master.",
    "Review this PR as an adversarial reviewer — no, you missed nothing; flag anything wrong.",
    "You are skillcreatorClaude-W1 — no, you keep the branch as named in your brief.",
]


NEGATIVE_NO_CUE_CASES = [
    "no rush, the build is still running",
    "no problem, the PR is merged already",
    "no worries, the deploy is done",
    "there is no way the test is flaky, it's timing",
    "no hurry — the migration is queued for tonight",
    "we have no budget, the plan is to wait",
    "no idea why the CI is red, can you look?",
    "I have no preference, the default is fine",
]


GENUINE_DIRECTED_PROFANITY = [
    "fuck this, you deleted my file again",
    "this is fucking broken, you did it again",
]


UNDIRECTED_TIER2_PROFANITY = [
    "this is fucking broken",
    "for fuck's sake",
    "this fucking sucks",
    "motherfucker",
    "you're a fucking idiot",
]


CONTRACTION_AND_STATUS_RESCUE = [
    "no, you're pushing to master again",
    "no, you're not reading the brief",
    "ITEM-3 STATUS: no, you're pushing to master again.",
    "DEPLOY STATUS: no, that's the wrong branch.",
]


KNOWN_FALSE_POSITIVE_NO_COMMAND_CUES = [
    "I have no time, can you run the build?",
    "we have no CI budget so run it locally",
    "there's no doc for this, use the source instead",
    "no one is around, open the PR yourself",
    "there's no reason to run the tests now",
    "no big deal, just send the digest when you can",
]


STATUS_RELAY_FALSE_POSITIVES = [
    "ITEM-3 STATUS: no green evidence yet, the tier logic is wrong.",
    "PR-701 STATUS: no reviewer assigned; the base branch is wrong.",
    "ITEM-7 UPDATE: no PR yet, worker says the plan is wrong.",
    "ITEM-2 BLOCKER: no commit yet, not that it matters.",
]


POSSESSIVE_YOUR_FALSE_POSITIVES = [
    "we have no news, your existing branch is fine",
    "there is no ETA yet, your remaining tasks are queued",
    "no ticket for this — your morning briefing already covers it",
]


DIRECTED_PROFANITY_IMPORTANCE = [
    "fuck this, you deleted my file again",
    "this is fucking broken, you did it again",
    "can you fucking read it",
]


def run_hook(prompt: str) -> str:
    result = subprocess.run(
        [sys.executable, str(HOOK)],
        input=json.dumps({"user_prompt": prompt}),
        text=True,
        capture_output=True,
        timeout=1,
        check=False,
    )
    assert result.returncode == 0
    return result.stdout.strip()


@pytest.mark.parametrize(("label", "prompt"), FALSE_POSITIVES)
def test_false_positive_corpus_stays_silent(label: str, prompt: str):
    output = run_hook(prompt)
    assert output in ("", "{}"), f"{label} fired: {output!r}"


@pytest.mark.parametrize(("label", "prompt", "tier"), TRUE_POSITIVES)
def test_true_positive_corpus_keeps_observed_tiers(label: str, prompt: str, tier: int):
    output = run_hook(prompt)
    assert f"FRUSTRATION SIGNAL DETECTED - Tier {tier}" in output, (
        f"{label} did not classify as Tier {tier}: {output!r}"
    )


def test_injected_instruction_requires_validation_before_store():
    output = run_hook(TRUE_POSITIVES[0][1])
    context = json.loads(output)["hookSpecificOutput"]["additionalContext"]
    assert "check whether this is a genuine correction; store only if real" in context.lower()
    assert "MANDATORY" not in context


def test_neutral_transition_word_is_not_a_frustration_signal():
    assert run_hook("Anyway, here are the build logs.") in ("", "{}")


@pytest.mark.parametrize("prompt", NEGATIVE_NO_CUE_CASES)
def test_state_preference_and_polite_no_idioms_stay_silent(prompt: str):
    assert run_hook(prompt) in ("", "{}")


@pytest.mark.parametrize("prompt", STAGE_A_BRIEF_CONTROLS)
def test_second_person_status_rescue_does_not_escape_other_stage_a_guards(prompt: str):
    assert run_hook(prompt) in ("", "{}")


@pytest.mark.parametrize("prompt", GENUINE_NO_CORRECTIONS)
def test_bare_no_with_a_correctee_or_supplied_answer_still_fires(prompt: str):
    output = run_hook(prompt)
    assert "FRUSTRATION SIGNAL DETECTED - Tier 1" in output


@pytest.mark.parametrize("prompt", GENUINE_DIRECTED_PROFANITY)
def test_profanity_plus_second_person_failure_still_fires(prompt: str):
    output = run_hook(prompt)
    assert "FRUSTRATION SIGNAL DETECTED - Tier 2" in output


@pytest.mark.parametrize("prompt", UNDIRECTED_TIER2_PROFANITY)
def test_undirected_profanity_stays_tier_2(prompt: str):
    output = run_hook(prompt)
    assert "FRUSTRATION SIGNAL DETECTED - Tier 2" in output


@pytest.mark.parametrize("prompt", CONTRACTION_AND_STATUS_RESCUE)
def test_contractions_and_status_shaped_live_corrections_still_fire(prompt: str):
    output = run_hook(prompt)
    assert "FRUSTRATION SIGNAL DETECTED - Tier 1" in output


@pytest.mark.parametrize("prompt", KNOWN_FALSE_POSITIVE_NO_COMMAND_CUES)
def test_planning_commands_near_noncorrective_no_stay_silent(prompt: str):
    assert run_hook(prompt) in ("", "{}")


@pytest.mark.parametrize("prompt", STATUS_RELAY_FALSE_POSITIVES)
def test_status_relays_with_reported_wrongness_stay_silent(prompt: str):
    assert run_hook(prompt) in ("", "{}")


@pytest.mark.parametrize("prompt", POSSESSIVE_YOUR_FALSE_POSITIVES)
def test_possessive_your_near_noncorrective_no_stays_silent(prompt: str):
    assert run_hook(prompt) in ("", "{}")


@pytest.mark.parametrize("prompt", DIRECTED_PROFANITY_IMPORTANCE)
def test_first_time_directed_profanity_keeps_importance_eight(prompt: str):
    output = run_hook(prompt)
    assert "FRUSTRATION SIGNAL DETECTED - Tier 2" in output
    assert "importance >=8" in output
    assert "importance >=9" not in output


def test_continuation_exemption_only_suppresses_its_own_no():
    output = run_hook("No, I meant the other file. Then keep reading — no, continue.")
    assert "FRUSTRATION SIGNAL DETECTED - Tier 1" in output
