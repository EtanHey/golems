"""Pin the source-copy law and its scratch/test-fixture boundaries."""
from pathlib import Path

CONTRACT = Path(__file__).resolve().parents[2] / "skills/golem-powers/_shared/lifecycle/CONTRACT.md"


def test_source_working_copies_require_registered_worktrees():
    text = CONTRACT.read_text()
    assert "Every source working copy for release, verify, test or dev runs" in text
    assert "registered worktree with an owner and a terminal state" in text
    assert '<repo>/.worktrees/<short>' in text
    assert 'isolation:"worktree"' in text
    for substitute in ("git clone", "git init", "bundle import", "directory copy", "archive-extract", "~/.<name>"):
        assert substitute in text


def test_runtime_directories_and_test_fixtures_have_distinct_rules():
    text = CONTRACT.read_text()
    assert "Runtime and scratch directories (sockets, HOME, state, caches) are NOT worktrees" in text
    assert "their own owned lane directory and their own disposition" in text
    assert "Test runners' own ephemeral OS-tmpdir fixtures" in text
    assert "mkdtemp" in text
    assert "Never redirect a test run's TMPDIR into a persistent tree" in text
    assert "hermetic tests assume no .env or other ancestors there" in text
    assert "not independently initialized repos" in text
    assert "text-enforced until a guard exists" in text


def test_etans_no_temp_clones_quote_is_verbatim():
    assert (
        "I hope that when we put the rule of not making those and doing everything much more. "
        "Safely, basically. would be better. Um, Like actually the leading work trees and making "
        "work trees the way to do the copies of repos and run them and deb and all that."
    ) in CONTRACT.read_text()
