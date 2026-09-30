from .common import *  # noqa: F403

def test_sibling_substitution_hatch_does_not_cover_later_sibling(monkeypatch):
    command = 'echo "$(WEAVE_ALLOW_TMP=1 true) $(tee /tmp/leak </dev/null)"'

    decision, exit_code, _output = decision_for(command, monkeypatch)

    assert (decision, exit_code) == ("deny", 2)


def test_quoted_brace_does_not_close_parameter_expansion(monkeypatch):
    command = 'unset x; X=${x:-"}" # $(tee /tmp/leak </dev/null)}'

    decision, exit_code, _output = decision_for(command, monkeypatch)

    assert (decision, exit_code) == ("deny", 2)


def test_hatched_unquoted_substitution_is_not_double_counted(monkeypatch):
    command = "echo $(WEAVE_ALLOW_TMP=1 tee /tmp/leak </dev/null)"

    decision, exit_code, _output = decision_for(command, monkeypatch)

    assert (decision, exit_code) == ("allow", 0)


def test_hatched_exposed_worktree_keeps_outer_anchor_identity(monkeypatch):
    commands = (
        "cd / && echo $(WEAVE_ALLOW_WT_MIGRATION=1 "
        "git worktree add /off HEAD)",
        "cd / && echo $(WEAVE_ALLOW_TMP=1 git worktree add tmp/off HEAD)",
    )

    for command in commands:
        decision, exit_code, _output = decision_for(command, monkeypatch)
        assert (decision, exit_code) == ("allow", 0)


def test_exposed_worktree_does_not_reclassify_from_hook_cwd(monkeypatch):
    monkeypatch.chdir("/tmp")
    command = (
        "cd /workspace/golems && echo "
        "$(git worktree add tmp/.worktrees/off HEAD)"
    )

    decision, exit_code, _output = decision_for(command, monkeypatch)

    assert (decision, exit_code) == ("allow", 0)


def test_safe_direct_add_does_not_suppress_deeper_temp_add(monkeypatch):
    command = (
        "echo $(git worktree add /workspace/golems/.worktrees/safe HEAD; "
        'echo "$(git worktree add /tmp/.worktrees/leak HEAD)")'
    )

    decision, exit_code, _output = decision_for(command, monkeypatch)

    assert (decision, exit_code) == ("deny", 2)


def test_deeper_exposed_worktree_reuses_primary_cwd(monkeypatch):
    monkeypatch.chdir("/tmp")
    command = (
        "cd /workspace/golems && echo "
        "$(echo $(git worktree add tmp/.worktrees/off HEAD))"
    )

    decision, exit_code, _output = decision_for(command, monkeypatch)

    assert (decision, exit_code) == ("allow", 0)


def test_outer_hatch_does_not_cover_deeper_authoritative_worktree(monkeypatch):
    command = (
        "echo $(WEAVE_ALLOW_TMP=1 echo "
        "$(git worktree add /tmp/.worktrees/leak HEAD))"
    )

    decision, exit_code, _output = decision_for(command, monkeypatch)

    assert (decision, exit_code) == ("deny", 2)


def test_primary_temp_hit_promotes_without_recursive_temp_hit(monkeypatch):
    monkeypatch.chdir(Path.home())
    command = (
        "cd /tmp && echo $(WEAVE_ALLOW_TMP=1 echo "
        "$(git worktree add ../tmp/.worktrees/leak HEAD))"
    )

    decision, exit_code, _output = decision_for(command, monkeypatch)

    assert (decision, exit_code) == ("deny", 2)


def test_hidden_nested_worktree_inherits_enclosing_cwd(monkeypatch):
    monkeypatch.chdir(Path.home())
    command = (
        'echo "$(cd /tmp && echo '
        '"$(git worktree add ../tmp/.worktrees/leak HEAD)")"'
    )

    decision, exit_code, _output = decision_for(command, monkeypatch)

    assert (decision, exit_code) == ("deny", 2)


def test_partial_assignment_records_its_literal_head():
    _values, prefixes = state_for('P=/Users/x/Documents/f_$$.txt; echo done')

    assert prefixes["P"] == "/Users/x/Documents/f_"


def test_fully_static_assignment_records_no_head():
    values, prefixes = state_for('P=/Users/x/Documents/f.txt; echo done')

    assert values["P"] == "/Users/x/Documents/f.txt"
    assert "P" not in prefixes


def test_head_is_composed_through_a_known_variable(monkeypatch):
    monkeypatch.setenv("BASE", "/Users/x/Documents")

    _values, prefixes = state_for('P=$BASE/f_$$.txt; echo done')

    assert prefixes["P"] == "/Users/x/Documents/f_"


def test_unknown_leading_variable_yields_no_head(monkeypatch):
    monkeypatch.delenv("UNSET", raising=False)

    values, prefixes = state_for('P=$UNSET/f_$$.txt; echo done')

    assert values["P"] is None
    assert "P" not in prefixes


def test_unset_clears_a_tracked_head():
    values, prefixes = state_for('P=/Users/x/Documents/f_$$.txt; unset P; echo done')

    assert values["P"] == ""
    assert "P" not in prefixes


def test_conditionally_skipped_assignment_lends_no_head():
    """`false && P=...` never ran, so `$P` may hold anything -- no head."""
    values, prefixes = state_for(
        'false && P=/Users/x/Documents/f_$$.txt; echo done'
    )

    assert values.get("P") is None
    assert "P" not in prefixes


def test_conditionally_unknown_assignment_lends_no_head():
    """The same for an assignment whose execution the hook cannot decide."""
    values, prefixes = state_for(
        'some-cmd && P=/Users/x/Documents/f_$$.txt; echo done'
    )

    assert values.get("P") is None
    assert "P" not in prefixes


def test_reassignment_replaces_a_stale_head():
    _values, prefixes = state_for(
        'P=/Users/x/Documents/f_$$.txt; P=/var/data/g_$$.txt; echo done'
    )

    assert prefixes["P"] == "/var/data/g_"


