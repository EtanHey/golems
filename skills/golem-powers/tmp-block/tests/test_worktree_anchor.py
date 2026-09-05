"""Regression coverage for static worktree anchors around shell substitutions."""

import importlib.util
import io
import json
import os
import sys
from pathlib import Path

import pytest


HOOK_PATH = (
    Path(__file__).resolve().parents[1] / "hooks" / "tmp-block-pretooluse.py"
)
SPEC = importlib.util.spec_from_file_location("tmp_block_pretooluse", HOOK_PATH)
assert SPEC is not None and SPEC.loader is not None
HOOK = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(HOOK)


@pytest.fixture(autouse=True)
def isolate_checkout_root_from_host_temp_class(monkeypatch):
    """Keep checkout-location tests portable without exempting other temp paths."""
    checkout = HOOK_PATH.parents[4]
    original = HOOK.in_temp_class

    def classified(raw_path):
        if isinstance(raw_path, str):
            candidate = os.path.expanduser(
                raw_path.strip().strip('"').strip("'")
            )
            if os.path.isabs(candidate):
                candidate = os.path.normpath(candidate)
                try:
                    if os.path.commonpath((str(checkout), candidate)) == str(
                        checkout
                    ):
                        return False
                except ValueError:
                    pass
        return original(raw_path)

    monkeypatch.setattr(HOOK, "in_temp_class", classified)


def make_home_repo(tmp_path, monkeypatch):
    """Create the ~/Gits/golems checkout assumed by captured commands."""
    home = tmp_path / "home"
    repo = home / "Gits" / "golems"
    (repo / ".git").mkdir(parents=True)
    monkeypatch.setenv("HOME", str(home))
    # These specimens exercise repo/worktree classification, not Rule 1's
    # host-specific temp roots. pytest intentionally locates tmp_path there.
    monkeypatch.setattr(HOOK, "_temp_prefixes", lambda: set())
    return repo


def assert_no_prompt(payload):
    """The two-valued contract (2026-08-17) has no prompt path.

    This used to ban `hookSpecificOutput` outright, which was a sound proxy
    while `permissionDecision: "ask"` was the only reason to emit the key. It
    stopped being sound on 2026-08-19, when the refusal started carrying
    `permissionDecision: "deny"` as well — the dialect Codex documents for
    PreToolUse. So the tripwire now pins the thing the law actually forbids:
    the decision may be `deny`, never `ask`."""
    specific = payload.get("hookSpecificOutput")
    if not isinstance(specific, dict):
        assert specific is None, (
            f"hookSpecificOutput must be an object when present: {payload!r}"
        )
        return
    decision = specific.get("permissionDecision")
    assert decision != "ask", f"hook emitted a PreToolUse prompt: {payload!r}"
    assert decision in (None, "deny", "allow"), (
        f"unexpected permissionDecision: {decision!r} in {payload!r}"
    )


def decision_for(command, monkeypatch):
    """Run the imported hook and return its externally visible decision."""
    stdout = io.StringIO()
    monkeypatch.setattr(
        sys,
        "stdin",
        io.StringIO(
            json.dumps(
                {
                    "tool_name": "Bash",
                    "tool_input": {"command": command},
                    "session_id": "worktree-anchor-test",
                }
            )
        ),
    )
    monkeypatch.setattr(sys, "stdout", stdout)

    try:
        HOOK.main()
    except SystemExit as exc:
        exit_code = exc.code
    else:  # pragma: no cover - allow and deny both exit through the hook API
        raise AssertionError("hook did not exit")

    output = json.loads(stdout.getvalue() or "{}")
    assert_no_prompt(output)
    decision = output.get("decision")
    if decision == "block":
        return "deny", exit_code, output
    if decision in (None, "allow"):
        return "allow", exit_code, output
    raise AssertionError(f"unexpected hook decision: {decision!r}")


def test_exact_repro_command_substitution_before_add_is_allowed(
    tmp_path, monkeypatch
):
    make_home_repo(tmp_path, monkeypatch)
    command = (
        "cd ~/Gits/golems && git fetch -q origin feat/plan-council-skill && "
        "SHA=$(git rev-parse origin/feat/plan-council-skill) && "
        'echo "pinned=$SHA" && git worktree add --detach '
        '.worktrees/adv-check "$SHA" >/dev/null 2>&1 && '
        "cd .worktrees/adv-check/skills/golem-powers/plan-council && ..."
    )

    decision, exit_code, _output = decision_for(command, monkeypatch)

    assert (decision, exit_code) == ("allow", 0)


def test_cmuxlayer_loop_literal_worktree_prefix_is_allowed(monkeypatch, tmp_path):
    repo = tmp_path / "cmuxlayer"
    (repo / ".git").mkdir(parents=True)
    monkeypatch.setattr(HOOK, "_temp_prefixes", lambda: set())
    command = """cd __REPO_ROOT__
for p in "4:p4-readreality:fix/stability-p4-readreality" "6:p6-ping:fix/stability-p6-ping" "7:p7-spawnrobust:fix/stability-p7-spawnrobust"; do
  n=${p%%:*}; rest=${p#*:}; wt=${rest%%:*}; br=${rest#*:}
  git worktree add .worktrees/$wt -b $br origin/main 2>&1 | tail -1
  cat > docs.local/tasks/sv2-p$n-brief.md <<EOF
# stability-v2 Phase $n lane
You are cmuxlayerCodex, worker for cmuxlayerClaude (db7f3bb9), in
__REPO_ROOT__/.worktrees/$wt.
Read IN ORDER: docs.local/plan/stability-v2/README.md (phase map — your phase is P$n),
docs.local/plans/final-understanding-v2.md (contracts), docs.local/plan/stability-v2/collab.md.
Round-1 output is MERGED and deployed (delivery states, WatchSpec, SpawnSpec) — build ON those.
Rules: TDD failing-first; PREDICTION before suites, diff after; stop at PUSH + OPEN PR; no reviewer
spawns; sign per convention. COMPLETION: append the collab Log line AND inbox-ping
cmuxlayerClaude-9c55eb04 with the PR URL. If your ping reports an unarmed inbox, ALSO write the PR
URL as the last line of docs.local/plan/stability-v2/phase-$n/findings.md — belt and suspenders.
EOF
done
echo round2-prepped""".replace("__REPO_ROOT__", str(repo))

    decision, exit_code, _output = decision_for(command, monkeypatch)

    assert (decision, exit_code) == ("allow", 0)


def test_variable_only_worktree_prefix_remains_unresolvable(monkeypatch):
    command = "git worktree add $WT_DIR/$wt"

    decision, exit_code, _output = decision_for(command, monkeypatch)

    assert (decision, exit_code) == ("deny", 2)


def test_literal_parent_escape_after_variable_remains_unresolvable(monkeypatch):
    command = "git worktree add .worktrees/$wt/../x"

    decision, exit_code, _output = decision_for(command, monkeypatch)

    assert (decision, exit_code) == ("deny", 2)


def test_literal_parent_escape_is_not_prefix_proven(monkeypatch):
    monkeypatch.chdir(Path.home())
    command = "git worktree add .worktrees/../x"

    decision, exit_code, _output = decision_for(command, monkeypatch)

    assert (decision, exit_code) == ("deny", 2)


def test_prefix_proof_preserves_realpath_symlink_guard(tmp_path):
    repo = tmp_path / "repo"
    (repo / ".git").mkdir(parents=True)
    (repo / "outside").mkdir()
    (repo / ".worktrees").symlink_to(repo / "outside", target_is_directory=True)

    assert HOOK._literal_prefix_class(
        ".worktrees/$wt", str(repo), require_worktree=True
    ) != "repo"


def test_resolved_variable_before_literal_prefix_is_allowed(tmp_path, monkeypatch):
    make_home_repo(tmp_path, monkeypatch)
    command = 'git worktree add "$HOME/Gits/golems/.worktrees/$wt"'

    decision, exit_code, _output = decision_for(command, monkeypatch)

    assert (decision, exit_code) == ("allow", 0)


def test_absolute_prefix_under_another_repo_is_allowed(tmp_path, monkeypatch):
    make_home_repo(tmp_path, monkeypatch)
    repo = tmp_path / "other-repo"
    (repo / ".git").mkdir(parents=True)
    command = (
        "cd ~/Gits/golems && git worktree add "
        f"{repo}/.worktrees/$wt"
    )

    decision, exit_code, _output = decision_for(command, monkeypatch)

    assert (decision, exit_code) == ("allow", 0)


def test_braced_variable_suffix_is_allowed(monkeypatch):
    command = 'git worktree add ".worktrees/${wt}"'

    decision, exit_code, _output = decision_for(command, monkeypatch)

    assert (decision, exit_code) == ("allow", 0)


def test_literal_prefix_after_non_repo_cd_remains_unresolvable(monkeypatch):
    command = "cd /elsewhere && git worktree add .worktrees/$wt"

    decision, exit_code, _output = decision_for(command, monkeypatch)

    assert (decision, exit_code) == ("deny", 2)


def test_command_substitution_before_static_cd_does_not_poison_anchor(
    tmp_path, monkeypatch
):
    make_home_repo(tmp_path, monkeypatch)
    command = "X=$(pwd) && cd ~/Gits/golems && git worktree add .worktrees/n HEAD"

    decision, exit_code, _output = decision_for(command, monkeypatch)

    assert (decision, exit_code) == ("allow", 0)


def test_true_subshell_cwd_change_remains_unresolvable(monkeypatch):
    command = "(cd /tmp && git worktree add wt HEAD)"

    decision, exit_code, _output = decision_for(command, monkeypatch)

    assert decision in {"ask", "deny"}
    assert exit_code in (0, 2)


def test_dynamic_cd_argument_remains_unresolvable(monkeypatch):
    command = "cd $(some-cmd) && git worktree add .worktrees/n"

    decision, exit_code, _output = decision_for(command, monkeypatch)

    assert (decision, exit_code) == ("deny", 2)


def test_resolved_off_convention_target_remains_denied(tmp_path, monkeypatch):
    make_home_repo(tmp_path, monkeypatch)
    command = "cd ~/Gits/golems && git worktree add ../golems.wt HEAD"

    decision, exit_code, _output = decision_for(command, monkeypatch)

    assert (decision, exit_code) == ("deny", 2)


def test_command_substitution_temp_write_remains_denied(monkeypatch):
    command = "X=$(echo secret >/tmp/leak.txt)"

    decision, exit_code, _output = decision_for(command, monkeypatch)

    assert (decision, exit_code) == ("deny", 2)


def test_command_substitution_off_convention_worktree_remains_denied(monkeypatch):
    monkeypatch.chdir(Path.home())
    command = "X=$(git worktree add ../off-convention HEAD)"

    decision, exit_code, _output = decision_for(command, monkeypatch)

    assert (decision, exit_code) == ("deny", 2)


def test_substitution_local_cd_does_not_anchor_parent_worktree(monkeypatch):
    monkeypatch.chdir(Path.home())
    command = "X=$(cd /var/lib/.worktrees) && git worktree add child HEAD"

    decision, exit_code, _output = decision_for(command, monkeypatch)

    assert (decision, exit_code) == ("deny", 2)


def test_assignment_substitution_preserves_following_command_position(monkeypatch):
    monkeypatch.chdir(Path.home())
    commands = (
        "X=$(echo ok) git worktree add ../off HEAD",
        "X=$(echo ok) tee /tmp/leak",
    )

    for command in commands:
        decision, exit_code, _output = decision_for(command, monkeypatch)
        assert (decision, exit_code) == ("deny", 2)


def test_substitution_embedded_in_target_remains_dynamic(monkeypatch):
    monkeypatch.chdir(Path.home())
    command = "git worktree add .worktrees/x$(printf /../../outside) HEAD"

    decision, exit_code, _output = decision_for(command, monkeypatch)

    assert (decision, exit_code) == ("deny", 2)


def test_substitution_valued_branch_flag_does_not_hide_target(monkeypatch):
    monkeypatch.chdir(Path.home())
    command = "git worktree add -b $(printf branch) ../off HEAD"

    decision, exit_code, _output = decision_for(command, monkeypatch)

    assert (decision, exit_code) == ("deny", 2)


def test_attached_substitution_option_value_does_not_hide_target(monkeypatch):
    monkeypatch.chdir(Path.home())
    command = "git worktree add --lock --reason=$(printf why) ../off HEAD"

    decision, exit_code, _output = decision_for(command, monkeypatch)

    assert (decision, exit_code) == ("deny", 2)


def test_attached_substitution_option_suffix_does_not_become_target(monkeypatch):
    monkeypatch.chdir(Path.home())
    command = (
        "git worktree add --lock --reason=$(printf why).worktrees/fake ../off HEAD"
    )

    decision, exit_code, _output = decision_for(command, monkeypatch)

    assert (decision, exit_code) == ("deny", 2)


def test_empty_quoted_option_suffix_does_not_consume_real_target(monkeypatch):
    monkeypatch.chdir(Path.home())
    command = "git worktree add --reason=$(printf why)'' ../off .worktrees/fake"

    decision, exit_code, _output = decision_for(command, monkeypatch)

    assert (decision, exit_code) == ("deny", 2)


def test_empty_dollar_quoted_option_suffix_does_not_consume_target(monkeypatch):
    monkeypatch.chdir(Path.home())
    commands = (
        "git worktree add --detach --lock --reason=$(printf why)$'' ../off",
        'git worktree add --detach --lock --reason=$(printf why)$"" ../off',
    )

    for command in commands:
        decision, exit_code, _output = decision_for(command, monkeypatch)
        assert (decision, exit_code) == ("deny", 2)


def test_repo_contained_traversal_inside_command_substitution_is_denied(
    monkeypatch,
):
    """A literal parent traversal stays disqualifying inside `$(...)`."""
    repo = HOOK_PATH.parents[4]
    monkeypatch.chdir(repo)
    commands = (
        f"echo secret > {repo}/docs.local$(printf /../../../../../private/tmp/leak.txt)",
        f"echo secret > {repo}/docs.local/$(printf ../../../../../private/tmp/leak.txt)",
    )

    for command in commands:
        decision, exit_code, _output = decision_for(command, monkeypatch)
        assert (decision, exit_code) == ("deny", 2), command


def test_repo_contained_timestamp_substitution_remains_allowed(monkeypatch):
    """A non-traversing dynamic suffix keeps the durable-head allow proof."""
    repo = HOOK_PATH.parents[4]
    monkeypatch.chdir(repo)
    command = f"echo complete > {repo}/docs.local/x-$(date +%s).log"

    decision, exit_code, _output = decision_for(command, monkeypatch)

    assert (decision, exit_code) == ("allow", 0)


def test_non_repo_head_with_literal_substitution_traversal_is_denied(monkeypatch):
    """The literal-`..` rule is independent of the durable head's class."""
    command = "echo secret > /workspace/golems$(printf /../../tmp/leak.txt)"

    decision, exit_code, _output = decision_for(command, monkeypatch)

    assert (decision, exit_code) == ("deny", 2)


def test_temp_redirect_with_unset_suffix_remains_denied(monkeypatch):
    monkeypatch.delenv("X", raising=False)
    command = "echo complete > /tmp/$X"

    decision, exit_code, _output = decision_for(command, monkeypatch)

    assert (decision, exit_code) == ("deny", 2)


def test_unset_variable_only_redirect_remains_unresolvable(monkeypatch):
    monkeypatch.delenv("UNSET_VAR", raising=False)
    command = 'echo complete > "$UNSET_VAR/x.log"'

    decision, exit_code, _output = decision_for(command, monkeypatch)

    assert (decision, exit_code) == ("deny", 2)


def test_every_dynamic_suffix_under_repo_is_silently_allowed(monkeypatch):
    repo = HOOK_PATH.parents[4]
    monkeypatch.chdir(repo)
    monkeypatch.delenv("UNSET", raising=False)
    commands = (
        'echo complete > "docs.local/logs/run-$(date +%s).log"',
        'echo complete > "docs.local/logs/run-`date +%s`.log"',
        'echo complete > "docs.local/logs/run-$UNSET.log"',
        'echo complete > "docs.local/logs/run-$1.log"',
        'echo complete > docs.local/logs/run-*.log',
        'echo complete > docs.local/logs/run-{a,b}.log',
    )

    for command in commands:
        decision, exit_code, _output = decision_for(command, monkeypatch)
        assert (decision, exit_code) == ("allow", 0), command


def test_repo_contained_dynamic_tee_and_heredoc_redirect_are_allowed(monkeypatch):
    repo = HOOK_PATH.parents[4]
    monkeypatch.chdir(repo)
    monkeypatch.delenv("UNSET", raising=False)
    commands = (
        'printf complete | tee "docs.local/logs/run-$UNSET.log"',
        'D=docs.local/logs; printf complete | tee "$D/run-$UNSET.log"',
        'echo complete > >(tee docs.local/logs/run-*.log)',
        'echo complete > >(tee docs.local/logs/run-$(date +%s).log)',
        "cat <<'EOF' > docs.local/reports/report-*.md\nrm -rf quoted-prose\nEOF",
    )

    for command in commands:
        decision, exit_code, _output = decision_for(command, monkeypatch)
        assert (decision, exit_code) == ("allow", 0), command


def test_repo_contained_worktree_prefix_survives_every_resolution_failure(monkeypatch):
    repo = HOOK_PATH.parents[4]
    monkeypatch.chdir(repo)
    monkeypatch.delenv("WT", raising=False)
    commands = (
        f'cd "$(unknown-cwd)" && git worktree add "{repo}/.worktrees/$WT" HEAD',
        f'git worktree add "{repo}/.worktrees/build-*" HEAD',
        f'git worktree add "{repo}/docs.local/review-$WT" HEAD',
        f'ROOT="{repo}/docs.local"; git worktree add "$ROOT/review-$WT" HEAD',
    )

    for command in commands:
        decision, exit_code, _output = decision_for(command, monkeypatch)
        assert (decision, exit_code) == ("allow", 0), command


def test_targets_without_any_class_proof_are_refused(monkeypatch):
    """No literal head at all -> nothing is proven -> refuse, never prompt."""
    monkeypatch.delenv("UNSET", raising=False)
    commands = (
        'printf complete | tee "$UNSET/run.log"',
        'git worktree add "$UNSET/worktree" HEAD',
    )

    for command in commands:
        decision, exit_code, _output = decision_for(command, monkeypatch)
        assert (decision, exit_code) == ("deny", 2), command


def test_absolute_prefix_outside_every_repo_is_allowed(monkeypatch):
    """Etan 2026-08-17: provably outside the temp class -> allow.

    `/outside/` is neither temp nor inside any repository. Before the
    `outside` verdict this asked, which is what stranded panes on every
    `~/Documents` and `~/.local/share` probe.
    """
    monkeypatch.delenv("UNSET", raising=False)
    command = 'echo complete > "/outside/run-$UNSET.log"'

    decision, exit_code, _output = decision_for(command, monkeypatch)

    assert (decision, exit_code) == ("allow", 0)


def test_inline_assignment_repo_redirect_allows_and_temp_redirect_denies(monkeypatch):
    repo = HOOK_PATH.parents[4]
    monkeypatch.chdir(repo)
    monkeypatch.delenv("D", raising=False)
    monkeypatch.delenv("X", raising=False)

    decision, exit_code, _output = decision_for(
        'D=docs.local/stalker; echo x > "$D/logs/run-$(date +%s).log"',
        monkeypatch,
    )
    assert (decision, exit_code) == ("allow", 0)

    decision, exit_code, _output = decision_for(
        'D=/tmp; echo x > "$D/run-$X.log"', monkeypatch
    )
    assert (decision, exit_code) == ("deny", 2)

    decision, exit_code, _output = decision_for(
        'D=/tmp; git worktree add "$D/worktree-$X" HEAD', monkeypatch
    )
    assert (decision, exit_code) == ("deny", 2)


def test_command_local_assignment_is_not_visible_to_its_redirect(monkeypatch):
    repo = HOOK_PATH.parents[4]
    monkeypatch.chdir(repo)

    monkeypatch.setenv("D", "/tmp")
    decision, exit_code, _output = decision_for(
        'D=docs.local/safe cat > "$D/out.log"', monkeypatch
    )
    assert (decision, exit_code) == ("deny", 2)

    monkeypatch.setenv("D", "docs.local/safe")
    decision, exit_code, _output = decision_for(
        'D=/tmp cat > "$D/out.log"', monkeypatch
    )
    assert (decision, exit_code) == ("allow", 0)


def test_assignment_with_unknown_reference_cannot_fake_repo_containment(monkeypatch):
    repo = HOOK_PATH.parents[4]
    monkeypatch.chdir(repo)
    monkeypatch.delenv("D", raising=False)
    monkeypatch.delenv("UNSET", raising=False)
    commands = (
        'D=$UNSET/logs; echo x > "$D/file.log"',
        'D=$UNSET/logs; echo x | tee "$D/file.log"',
        'D=$UNSET/logs; git worktree add "$D/lane" HEAD',
    )

    for command in commands:
        decision, exit_code, _output = decision_for(command, monkeypatch)
        assert (decision, exit_code) == ("deny", 2), command


def test_skipped_assignment_cannot_fake_repo_containment(monkeypatch):
    repo = HOOK_PATH.parents[4]
    monkeypatch.chdir(repo)
    monkeypatch.setenv("D", "/")
    command = 'false && D=.worktrees; git worktree add "$D/x" HEAD'

    decision, exit_code, _output = decision_for(command, monkeypatch)

    assert (decision, exit_code) == ("deny", 2)


def test_failed_and_chain_cannot_fake_repo_containment(monkeypatch):
    repo = HOOK_PATH.parents[4]
    monkeypatch.chdir(repo)
    monkeypatch.setenv("D", "/tmp")
    command = (
        'false && true && D=.worktrees; '
        'git worktree add "$D/x" HEAD'
    )

    decision, exit_code, _output = decision_for(command, monkeypatch)

    assert (decision, exit_code) == ("deny", 2)


def test_unset_invalidates_tracked_assignment(monkeypatch):
    repo = HOOK_PATH.parents[4]
    monkeypatch.chdir(repo)
    monkeypatch.delenv("D", raising=False)
    command = (
        f'D="{repo}/docs.local"; unset D; '
        'echo x > "$D/tmp/out"'
    )

    decision, exit_code, _output = decision_for(command, monkeypatch)

    assert (decision, exit_code) == ("deny", 2)


def test_nested_shell_temp_redirect_is_scanned(monkeypatch):
    command = "bash -c 'cat > /tmp/out.log'"

    decision, exit_code, _output = decision_for(command, monkeypatch)

    assert (decision, exit_code) == ("deny", 2)


def test_outer_hatch_covers_nested_shell_temp_redirect(monkeypatch):
    command = "WEAVE_ALLOW_TMP=1 bash -c 'cat > /tmp/out.log'"

    decision, exit_code, _output = decision_for(command, monkeypatch)

    assert (decision, exit_code) == ("allow", 0)


def test_inline_assignment_can_prove_dynamic_worktree_anchor(monkeypatch):
    repo = HOOK_PATH.parents[4]
    monkeypatch.chdir(repo)
    monkeypatch.delenv("ROOT", raising=False)
    monkeypatch.delenv("WT", raising=False)
    command = (
        f'ROOT="{repo}"; git -C "$ROOT" worktree add '
        '".worktrees/lane-$WT" HEAD'
    )

    decision, exit_code, _output = decision_for(command, monkeypatch)

    assert (decision, exit_code) == ("allow", 0)


def test_literal_parent_escape_redirect_remains_unresolvable(monkeypatch):
    command = "echo complete > ../outside/post-rerun-$(date +%s).log"

    decision, exit_code, _output = decision_for(command, monkeypatch)

    assert (decision, exit_code) == ("deny", 2)


def test_temp_tee_target_remains_denied(monkeypatch):
    monkeypatch.delenv("X", raising=False)
    commands = (
        "echo complete | tee /tmp/$X",
        "echo complete > >(tee /tmp/run-$(date +%s).log)",
    )

    for command in commands:
        decision, exit_code, _output = decision_for(command, monkeypatch)
        assert (decision, exit_code) == ("deny", 2), command


def test_dynamic_tee_target_does_not_treat_child_arguments_as_targets(monkeypatch):
    command = "tee $(basename /tmp/x)"

    decision, exit_code, _output = decision_for(command, monkeypatch)

    assert (decision, exit_code) == ("deny", 2)


def test_empty_quoted_dynamic_tee_suffix_keeps_next_real_target(monkeypatch):
    command = "tee $(basename durable)'' /tmp/x"

    decision, exit_code, _output = decision_for(command, monkeypatch)

    assert (decision, exit_code) == ("deny", 2)


def test_redirect_target_substitution_keeps_inner_tee_executable(monkeypatch):
    command = "echo >$(tee /tmp/leak)"

    decision, exit_code, _output = decision_for(command, monkeypatch)

    assert (decision, exit_code) == ("deny", 2)


def test_redirect_target_substitution_keeps_inner_worktree_executable(monkeypatch):
    monkeypatch.chdir(Path.home())
    command = "echo >$(git worktree add ../off HEAD)"

    decision, exit_code, _output = decision_for(command, monkeypatch)

    assert (decision, exit_code) == ("deny", 2)


def test_backtick_redirect_target_keeps_inner_tee_executable(monkeypatch):
    command = "echo >`tee /tmp/leak`"

    decision, exit_code, _output = decision_for(command, monkeypatch)

    assert (decision, exit_code) == ("deny", 2)


def test_backtick_redirect_target_keeps_inner_worktree_executable(monkeypatch):
    monkeypatch.chdir(Path.home())
    command = "echo >`git worktree add ../off HEAD`"

    decision, exit_code, _output = decision_for(command, monkeypatch)

    assert (decision, exit_code) == ("deny", 2)


def test_arithmetic_redirect_target_is_not_executable_command_scope(monkeypatch):
    command = "tee=1 tmp=1 x=1; echo >$((tee /tmp/x))"

    decision, exit_code, _output = decision_for(command, monkeypatch)

    # Refused as unresolvable, NOT as a proven temp write: the arithmetic
    # expansion is data, so `tee /tmp/x` inside it never becomes a command.
    assert (decision, exit_code) == ("deny", 2)


def test_arithmetic_expansion_keeps_nested_substitution_executable(monkeypatch):
    command = "X=$(( $(tee /tmp/leak </dev/null) + 1 ))"

    decision, exit_code, _output = decision_for(command, monkeypatch)

    assert (decision, exit_code) == ("deny", 2)


def test_double_quotes_keep_substitutions_executable(monkeypatch):
    monkeypatch.chdir(Path.home())
    commands = (
        'X="$(tee /tmp/leak </dev/null)"',
        'X="`git worktree add ../off HEAD`"',
    )

    for command in commands:
        decision, exit_code, _output = decision_for(command, monkeypatch)
        assert (decision, exit_code) == ("deny", 2)


def test_escaped_nested_backticks_remain_executable(monkeypatch):
    command = "X=`echo \\`tee /tmp/leak </dev/null\\``"

    decision, exit_code, _output = decision_for(command, monkeypatch)

    assert (decision, exit_code) == ("deny", 2)


def test_recursive_hit_keeps_unhatched_outer_segment(monkeypatch):
    command = (
        "WEAVE_ALLOW_TMP=1 echo ok; "
        "X=$(( $(tee /tmp/leak </dev/null) + 1 ))"
    )

    decision, exit_code, _output = decision_for(command, monkeypatch)

    assert (decision, exit_code) == ("deny", 2)


def test_deeply_nested_executable_substitution_is_not_depth_bypassed(monkeypatch):
    inner = "tee /tmp/leak </dev/null"
    for _ in range(9):
        inner = f"echo $(( $({inner}) + 1 ))"
    command = f"X=$({inner})"

    decision, exit_code, _output = decision_for(command, monkeypatch)

    assert (decision, exit_code) == ("deny", 2)


def test_recursive_extractor_ignores_shell_comments(monkeypatch):
    commands = (
        "echo ok # $(tee /tmp/leak)",
        "echo ok # `git worktree add ../off HEAD`",
    )

    for command in commands:
        decision, exit_code, _output = decision_for(command, monkeypatch)
        assert (decision, exit_code) == ("allow", 0)


def test_nested_hatch_does_not_leak_across_child_segments(monkeypatch):
    command = (
        "X=$(WEAVE_ALLOW_TMP=1 echo ok; "
        "X=$(( $(tee /tmp/leak </dev/null) + 1 )))"
    )

    decision, exit_code, _output = decision_for(command, monkeypatch)

    assert (decision, exit_code) == ("deny", 2)


def test_parameter_expansion_hash_does_not_hide_substitution(monkeypatch):
    command = "unset x; X=${x:- # $(tee /tmp/leak </dev/null)}"

    decision, exit_code, _output = decision_for(command, monkeypatch)

    assert (decision, exit_code) == ("deny", 2)


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


def state_for(command):
    """(values, literal_prefixes) visible to the command's last segment."""
    tokens, cmd_pos, seg_of, _scopes = HOOK._parse_bash(command)
    return HOOK._static_shell_variable_state_before(
        tokens, cmd_pos, seg_of, max(seg_of) if seg_of else 0
    )


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
