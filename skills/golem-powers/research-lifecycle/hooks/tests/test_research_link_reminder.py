import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

HOOK = Path(__file__).resolve().parents[1] / "research-link-reminder.py"
LAUNCHER = Path(__file__).resolve().parents[5] / "scripts" / "hooks" / "fail-open.py"
DOC = "https://docs.google.com/document/d/FIXTURE_DOC_ID_0001/edit?tab=t.0"


def run(payload, *, raw=None, env_extra=None, launcher=False):
    env = {k: v for k, v in os.environ.items() if k != "RESEARCH_LINK_HOOK_DISABLED"}
    env.update(env_extra or {})
    argv = [sys.executable, "-I", "-B", str(LAUNCHER), str(HOOK)] if launcher else [sys.executable, str(HOOK)]
    return subprocess.run(argv, input=raw if raw is not None else json.dumps(payload), text=True,
                          capture_output=True, timeout=5, check=False, env=env)


def context(result):
    assert result.returncode == 0
    if not result.stdout.strip():
        return None
    out = json.loads(result.stdout)
    assert out["hookSpecificOutput"]["hookEventName"] == "UserPromptSubmit"
    assert "permissionDecision" not in out["hookSpecificOutput"] and "decision" not in out
    return out["hookSpecificOutput"]["additionalContext"]


@pytest.mark.parametrize("prompt", [
    DOC,
    f"its huge.. {DOC}",
    f"send luna to grab ya those?\n{DOC}\n{DOC.replace('1AbC', '1ZyX')}",
    "https://docs.google.com/document/u/0/d/FIXTURE_DOC_ID_0002/edit",
    "here's what gemini found https://gemini.google.com/share/a1b2c3d4e5f6",
    "https://g.co/gemini/share/a1b2c3d4e5f6",
])
def test_research_link_prompts_get_the_reminder(prompt):
    text = context(run({"hook_event_name": "UserPromptSubmit", "prompt": prompt}))
    assert text is not None and text.startswith("Load /research-lifecycle first")


def test_reminder_says_when_to_skip():
    text = context(run({"prompt": DOC}))
    assert "Skip this only when the prompt itself says the doc is not research" in text


def test_reminder_names_each_link_kind_once():
    text = context(run({"prompt": f"{DOC} {DOC} https://gemini.google.com/share/a1b2c3d4e5f6"}))
    assert "(Google Docs document, Gemini share)" in text


@pytest.mark.parametrize("prompt", [
    "Check the build status",
    "Gemini deep research this: best Hebrew STT",
    "https://docs.google.com/spreadsheets/d/FIXTURE_DOC_ID_0001/edit#gid=0",
    "https://docs.google.com/presentation/d/FIXTURE_DOC_ID_0001/edit",
    "https://drive.google.com/file/d/FIXTURE_DOC_ID_0001/view",
    "https://gemini.google.com/app",
    f"review this diff:\n```diff\n+See the design doc: {DOC}\n```",
    f"~~~diff\n+ {DOC}\n~~~",
    f"````markdown\n```\n{DOC}\n```\n````",
    f"~~~~\n~~~\n{DOC}\n~~~~",
    f"  ```js\nconst doc = '{DOC}';\n  ```",
    f"unclosed fence:\n```\n{DOC}",
    f"two backticks ``{DOC}`` inline",
    f"the README now says `{DOC}`, is that ok?",
    f"This session is being continued from a previous conversation that ran out of context.\nSummary: report at {DOC}",
    f"<task-notification><summary>done</summary>{DOC}</task-notification>",
])
def test_other_prompts_get_nothing(prompt):
    assert context(run({"prompt": prompt})) is None


@pytest.mark.parametrize("prompt", [
    f"```\nquoted\n```\nand the report: {DOC}",
    f"~~~\nquoted\n~~~\n{DOC}",
    f"````\n```\ninner\n```\n````\n{DOC}",
    f"``` not a fence because the info string has a ` backtick {DOC}",
])
def test_link_after_a_closed_fence_still_gets_the_reminder(prompt):
    assert context(run({"prompt": prompt})) is not None


def test_encoded_links_are_out_of_scope():
    # A literal-URL recognizer: a fully percent-encoded link is not decoded (no coverage claimed).
    assert context(run({"prompt": "https%3A%2F%2Fdocs.google.com%2Fdocument%2Fd%2F0123456789abcdefghij"})) is None


def test_reads_user_prompt_key_too():
    assert context(run({"user_prompt": DOC})) is not None


def test_disabled_by_env():
    assert context(run({"prompt": DOC}, env_extra={"RESEARCH_LINK_HOOK_DISABLED": "1"})) is None


@pytest.mark.parametrize("raw", ["{not json", "", "[]", json.dumps({"prompt": 7})])
def test_bad_input_fails_open_silently(raw):
    result = run(None, raw=raw)
    assert result.returncode == 0 and result.stdout == ""


def test_runs_under_the_fail_open_launcher_as_registered():
    text = context(run({"prompt": DOC}, launcher=True))
    assert text is not None and text.startswith("Load /research-lifecycle first")


def test_manifest_registers_it_non_blocking():
    manifest = json.loads((LAUNCHER.parent / "manifest.json").read_text())
    entries = [e for hooks in manifest["hosts"].values() for e in hooks if e["id"] == "research-link-reminder"]
    assert entries, "research-link-reminder missing from scripts/hooks/manifest.json"
    for e in entries:
        assert e["event"] == "UserPromptSubmit"
        assert "--fail-closed" not in e["command"]
        assert e["command"].endswith("{hooks}/research-lifecycle/hooks/research-link-reminder.py")
