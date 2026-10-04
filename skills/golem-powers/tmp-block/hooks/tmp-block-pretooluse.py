#!/usr/bin/env python3
"""tmp-block PreToolUse hook — fail-CLOSED deny of durable writes to the temp path-CLASS.

Phase-2 Fix-3 (weave 2026-06-07). Specimen S04: a worker ran
Write(/tmp/orqi-tts-answer-msg.md) and the era's /tmp guard "half-fired
(validated then allowed)" — hook JSON validation failed, the durable write
proceeded, Etan caught it live (A5 specimen bank [21], raw
orchestrator__10d0e9da [6219]). Adversary verdict on Fix-3: KEEP with scope
fix — "extend the deny to the canonicalized temp path-CLASS ($TMPDIR,
/private/tmp) and to Bash writes, else it's one directory away from useless"
(B-taxonomy-adversary.md [124], Attack 4 [100]).

Contract:
  - Write/Edit/NotebookEdit into the temp path-CLASS -> DENY with a redirect
    to the durable alternative (the repo or docs.local/).
  - Bash write-SHAPED commands targeting the class -> DENY. Creation verbs
    only: output redirect (incl. heredoc+redirect), tee, git worktree add.
    Reads/deletes (ls, cat, grep, rm, worktree list) are NEVER denied.
  - Temp path-CLASS (canonicalized via realpath, so the /tmp -> /private/tmp
    macOS symlink can't be used as a route-around): /tmp, /private/tmp,
    /var/folders, /private/var/folders, and the live $TMPDIR value.
  - FAIL CLOSED: any hook/validation error -> DENY (the S04 half-fire class,
    A5 cross-cutting #2 [207]). This includes an unwritable bypass ledger.
  - Calibration (adversary Attack 5.4 [113]: over-broad guards INDUCE
    route-arounds): WEAVE_ALLOW_TMP=1 (session env, or inline prefix on a
    Bash command) permits genuinely-ephemeral writes, but every use is
    LOGGED to a durable ledger — the log IS the bypass-detector seed.
  - No actor bypass: CLAUDE_WORKER does NOT exempt (A5 cross-cutting #3 —
    S04's violator was a worker).

Two-valued contract (2026-08-17, Etan ratified by voice):
  - *"none of y'all would be able to write to temp, but also not ask me so we
    don't get agent stuck."* Provably outside the temp class -> ALLOW.
    Everything else -> DENY with a reason the agent can act on. This hook
    NEVER emits a PreToolUse prompt.
  - A prompt suspends the pane until a human answers it, and a headless Codex
    or Cursor worker has no human in its pane at all. A deny comes back as a
    readable error the agent reroutes around by itself, so the residual
    failure mode is deliberately the recoverable one.

Rule 2 — WORKTREE CONVENTION (2026-08-09, Etan ratified by voice):
  - The fleet worktree location is the in-repo `<repo>/.worktrees/<name>`.
    Rule 1 already denied `git worktree add` into the TEMP class, and its
    message ADVISED this location — but nothing ENFORCED it, so
    `git worktree add <sibling-worktree-dir>` sailed through and 18 sibling `*.wt`
    directories accumulated. Etan's catch, verbatim: "I thought the guard's job
    was to guard it, so it actually goes the right way."
  - `git worktree add <target>` whose RESOLVED target has no `.worktrees`
    ancestor component -> DENY, naming the convention and the exact fixed
    command.
  - golems#676 lesson (git-guardian judged UNEXPANDED literals and blocked both
    a legitimate cleanup and the `gh issue create` filing the bug): judge the
    RESOLVED path, only in command position, never prose. Relative targets use
    a statically-resolvable `git -C` / `cd` anchor from their own command;
    otherwise ($UNSET_VAR, `$(...)`, globs), REFUSE and name the exact
    resolution failure. #676's requirement survives as that actionable reason
    — the two-valued contract replaced the prompt it originally chose.
  - Migration window hatch: WEAVE_ALLOW_WT_MIGRATION=1 (session env or inline
    prefix), allowed AND logged to the same ledger. It is location-scoped only:
    it never unlocks an unresolved target or the temp path-class, which still
    needs WEAVE_ALLOW_TMP.

Static-resolution governing rule (golems#676, #703, #711; 2026-08-13):
  - Ask whether every possible target value is statically determinable, not
    whether its spelling happens to have a literal prefix. Resolve bounded
    literal value sets (including `for f in a b`, assignment composition,
    literal `case` alternatives, and brace expansion), judge every resolved
    member through the existing Rule 1/Rule 2 path checks, and allow silently
    only when every member is safe. A literal prefix that proves the class
    counts as such a determination: it proves `temp`, `repo`, or — since
    2026-08-17 — `outside`, the third verdict Rule 1 needs so that a durable
    home-directory target with a dynamic suffix is allowed instead of refused.
  - The live specimen that closed the narrower prefix-only framing was:
    `for f in r3.fifo obs3.fifo; do (print -r -- "__quit__" > $f
    2>/dev/null &); done`. `$f` is not unknown: its complete value set is the
    adjacent literal loop list. Any unbounded member is REFUSED, and any
    temp/off-convention member preserves DENY precedence.

Known limits (stated per the adversary's induction-limit honesty rule):
inline-interpreter writes (python3 -c open(...)), cp/mv/rsync into the class,
and relative paths from a temp cwd are not statically caught — the ledger plus
a periodic temp-scan are the detectors for that frontier. For Rule 2: a
worktree add nested inside a quoted payload (`bash -c "git worktree add …"`,
an agent-spawn prompt string) is one token to this parser and is NOT caught —
this guard is the shell-level BACKSTOP; the cmuxlayer/golems generators that
emit worktree paths are fixed in their own lanes. A literal prefix proof still
carries a residual for dynamic suffixes the hook cannot evaluate, but a visible
`..` component inside a command-substitution body now disqualifies that proof.
The ledger and temp-dir scan remain the detectors for opaque substitutions that
do not contain visible traversal.

Exit codes: 0 = allow ({} on stdout, or a "TMP-BLOCK advisory" in hookSpecificOutput.additionalContext
for an unknown target with no temp hint, GO-5 E2) · 2 = deny
({"decision": "block", ...}). There is no prompt: the ask path stays removed.
"""

import json
import os
import re
import sys
from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime
from typing import NamedTuple
from io import StringIO


def _deny_policy_import_failure():
    """Fail closed before the normal policy helpers are available (#411)."""
    reason = (
        "⛔ TMP-BLOCK: security policy unavailable; refusing tool call. "
        "FLAG THIS TO THE USER: reinstall hooks from the prompt: "
        "`! bash ~/Gits/golems/scripts/hooks/install-hooks.sh "
        "--host <host> --update --apply`"
    )
    json.dump(
        {
            "decision": "block",
            "reason": reason,
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": reason,
            },
        },
        sys.stdout,
    )
    sys.exit(2)

# S13 (GO-5): the shell parser lives in _shared/shell_parse.py; this hook keeps policy.
# realpath: a copy at ~/.claude/hooks/tmp-block/hooks/ finds ~/.claude/hooks/_shared,
# a symlink into hooks-live finds skills/golem-powers/_shared.
_SHARED_ROOT = os.path.realpath(
    os.path.join(os.path.dirname(os.path.realpath(__file__)), "..", "..", "_shared")
)
sys.path.insert(0, _SHARED_ROOT)
try:
    # A corrupt module must not contaminate the one-JSON denial before raising.
    with redirect_stdout(StringIO()), redirect_stderr(StringIO()):
        import harness_paths as _harness_paths_module  # noqa: E402
        import shell_parse as _shell_parse_module  # noqa: E402

        for _module, _filename in (
            (_harness_paths_module, "harness_paths.py"),
            (_shell_parse_module, "shell_parse.py"),
        ):
            if os.path.realpath(getattr(_module, "__file__", "")) != os.path.realpath(
                os.path.join(_SHARED_ROOT, _filename)
            ):
                raise ImportError(f"unexpected policy module origin: {_filename}")

        from harness_paths import _temp_prefixes, is_harness_scratchpad  # noqa: E402
        from shell_parse import (  # noqa: E402
            _ASSIGNMENT_RE,
            _QUOTED_LBRACE,
            _QUOTED_RBRACE,
            _UNRESOLVED_EVAL_MARKER,
            _WRAPPER_CMDS,
            _WRAPPER_VALUE_OPTS,
            _command_sub_word_continues,
            _executable_subcommands,
            _function_signature_parens,
            _invoked_alias_bodies,
            _is_command_sub_close,
            _is_command_sub_open,
            _is_separator,
            _mask_function_definition_bodies,
            _mask_quoted_operator_words,
            _nested_alias_segment,
            _nested_segment,
            _parse_bash,
            PolicyEvaluationDeadlineExceeded,
            cancel_policy_evaluation_deadline,
            policy_evaluation_deadline,
            policy_command_size_reason,
            _segment_is_fully_exposed,
            _segment_is_prefix,
            _shell_command_payloads,
            _shell_tokens,
            _strip_heredoc_bodies,
        )
except BaseException:  # policy dependency uncertainty must never become allow
    _deny_policy_import_failure()

# Load implementation by the hook's real path, never a competing sys.path name.
try:
    with redirect_stdout(StringIO()), redirect_stderr(StringIO()):
        from hashlib import sha256 as _impl_digest
        from importlib import import_module as _impl_import
        from importlib import util as _impl_util
        from uuid import uuid4 as _impl_nonce

        _IMPL_ROOT = os.path.realpath(os.path.join(
            os.path.dirname(os.path.realpath(__file__)), "tmp_block_impl"
        ))
        _IMPL_NAME = "_golems_tmp_block_impl_" + _impl_digest(
            _IMPL_ROOT.encode()
        ).hexdigest()[:16] + "_" + _impl_nonce().hex
        _previous_bytecode, sys.dont_write_bytecode = sys.dont_write_bytecode, True
        try:
            _spec = _impl_util.spec_from_file_location(
                _IMPL_NAME, os.path.join(_IMPL_ROOT, "__init__.py"),
                submodule_search_locations=[_IMPL_ROOT],
            )
            _package = _impl_util.module_from_spec(_spec)
            sys.modules[_IMPL_NAME] = _package
            _spec.loader.exec_module(_package)
            _policy = _impl_import(_IMPL_NAME + ".policy")
            _runtime = _impl_import(_IMPL_NAME + ".runtime")
            _write_targets = _impl_import(_IMPL_NAME + ".write_targets")
            _worktree_args = _impl_import(_IMPL_NAME + ".worktree_args")
            _worktrees = _impl_import(_IMPL_NAME + ".worktrees")
            _bypass = _impl_import(_IMPL_NAME + ".bypass")
            _tool_targets = _impl_import(_IMPL_NAME + ".tool_targets")
            _resolution = _impl_import(_IMPL_NAME + ".resolution")
            _anchors = _impl_import(_IMPL_NAME + ".anchors")
            _compounds = _impl_import(_IMPL_NAME + ".compounds")
            _assignments = _impl_import(_IMPL_NAME + ".assignments")
            _variables = _impl_import(_IMPL_NAME + ".variables")
            _variable_builtins = _impl_import(_IMPL_NAME + ".variable_builtins")
            _prefixes = _impl_import(_IMPL_NAME + ".prefixes")
            _words = _impl_import(_IMPL_NAME + ".words")
            _scope = _impl_import(_IMPL_NAME + ".scope")
            _shell_words = _impl_import(_IMPL_NAME + ".shell_words")
            _chain_status = _impl_import(_IMPL_NAME + ".chain_status")
            for _module, _leaf in (
                (_package, "__init__.py"), (_policy, "policy.py"),
                (_runtime, "runtime.py"),
                (_write_targets, "write_targets.py"),
                (_worktree_args, "worktree_args.py"),
                (_worktrees, "worktrees.py"),
                (_bypass, "bypass.py"),
                (_tool_targets, "tool_targets.py"),
                (_resolution, "resolution.py"),
                (_anchors, "anchors.py"),
                (_compounds, "compounds.py"),
                (_assignments, "assignments.py"),
                (_variables, "variables.py"),
                (_variable_builtins, "variable_builtins.py"),
                (_prefixes, "prefixes.py"),
                (_words, "words.py"),
                (_scope, "scope.py"),
                (_shell_words, "shell_words.py"),
                (_chain_status, "chain_status.py"),
            ):
                _expected = os.path.join(_IMPL_ROOT, _leaf)
                if not os.path.isfile(_expected) or os.path.realpath(
                    getattr(_module, "__file__", "")
                ) != os.path.realpath(_expected):
                    raise ImportError("unexpected tmp-block implementation origin")
            for _name in (
                "Unresolvable", "_has_temp_hint", "in_temp_class", "on_convention",
                "_TMPDIR_TOKEN_RE", "_TEMP_HINT_RE", "_TEMP_PATH_TOKEN_RE",
                "WORKTREE_DIR_NAME", "_CWD_CHANGING_CMDS",
            ):
                globals()[_name] = getattr(_policy, _name)
            _runtime.callbacks.bind(
                lambda raw: in_temp_class(raw), lambda: _temp_prefixes()
            )
            _policy._temp_prefixes = _runtime.callbacks.temp_prefixes
            _policy.is_harness_scratchpad = is_harness_scratchpad
            for _name in ('ShellScan', 'scan_redirect_targets', 'scan_tee_targets', 'scan_worktree_targets'):
                globals()[_name] = getattr(_write_targets, _name)
            for _name in ('_worktree_add_args', '_WORKTREE_VALUE_FLAGS'):
                globals()[_name] = getattr(_worktree_args, _name)
            for _name in ('find_worktree_convention_issues',):
                globals()[_name] = getattr(_worktrees, _name)
            for _name in ('_hatched_segments', 'escape_hatch_covers', 'log_bypass', 'DEFAULT_LEDGER', 'HATCH_TMP', 'HATCH_WT'):
                globals()[_name] = getattr(_bypass, _name)
            for _name in ('canonical_tool', 'find_temp_targets', '_apply_patch_temp_targets', 'GUARDED_FILE_TOOLS', 'APPLY_PATCH_TOOL', 'TOOL_ALIASES', '_APPLY_PATCH_TARGET_RE'):
                globals()[_name] = getattr(_tool_targets, _name)
            for _name in ('resolve_targets',):
                globals()[_name] = getattr(_resolution, _name)
            for _name in ('_bounded_loop_subshell_anchor', '_cwd_argument', '_shell_anchor_before', '_git_c_values', '_worktree_anchor'):
                globals()[_name] = getattr(_anchors, _name)
            for _name in ('_literal_branch_may_execute', '_bounded_compound_value_sets_before', '_enclosing_loop_changes_cwd'):
                globals()[_name] = getattr(_compounds, _name)
            for _name in ('_assignment_is_inside_control_compound', '_assignment_effects_between', '_literal_array_values_before'):
                globals()[_name] = getattr(_assignments, _name)
            for _name in ('_static_shell_variables_before', '_static_shell_variable_state_before'):
                globals()[_name] = getattr(_variables, _name)
            BuiltinScan = _variable_builtins.BuiltinScan
            invalidate_builtin_targets = _variable_builtins.invalidate_builtin_targets
            for _name in ('_nearest_repo_root', '_literal_prefix_scan', '_has_literal_parent_component', '_literal_prefix_class', 'suggest_fixed_target', '_POSITIONAL_PARAM_RE'):
                globals()[_name] = getattr(_prefixes, _name)
            for _name in ('_bounded_brace_values', '_bounded_word_values', 'resolve_target', '_SIMPLE_VAR_RE', '_MAX_STATIC_VALUES'):
                globals()[_name] = getattr(_words, _name)
            for _name in ('_paren_contexts', '_segment_indices', '_process_substitution_parens', '_case_pattern_parens', '_literal_array_parens', '_success_chain_reaches', '_scope_affects_target'):
                globals()[_name] = getattr(_scope, _name)
            for _name in ('_direct_exposed_scope_keys', '_after_substitution_word', '_substitution_word_text'):
                globals()[_name] = getattr(_shell_words, _name)
            for _name in ('_segment_operator_before', '_segment_operator_after', '_chain_status_after'):
                globals()[_name] = getattr(_chain_status, _name)
        finally:
            sys.dont_write_bytecode = _previous_bytecode
except BaseException:
    _deny_policy_import_failure()


def allow():
    cancel_policy_evaluation_deadline()
    json.dump({}, sys.stdout)
    sys.exit(0)


def advise(reason):
    """Allow with an advisory (GO-5 E2). Never a prompt, never a block.

    The model reads PreToolUse `hookSpecificOutput.additionalContext`; a bare
    `systemMessage` is shown to the human only (lead ruling: an advisory the
    model cannot see is a deleted gate). No `permissionDecision` is sent.
    """
    cancel_policy_evaluation_deadline()
    json.dump(
        {
            "hookSpecificOutput": {"hookEventName": "PreToolUse", "additionalContext": reason},
            "systemMessage": reason,
        },
        sys.stdout,
    )
    sys.exit(0)


def refuse_or_advise_dynamic(dynamic_targets, command):
    verb, path, _seg = dynamic_targets[0]
    reason = (
        f"⛔ TMP-BLOCK: cannot resolve this {verb.removeprefix('dynamic ')} "
        f"target statically — {path} contains an unresolvable shell expansion."
    )
    if _has_temp_hint(command):
        refuse_unresolvable(
            f"{reason} The command references a temp location (mktemp/TMPDIR//tmp), "
            "so it is refused rather than guessed. Write durable content in the repo or "
            "its docs.local/. Genuinely ephemeral? Re-run with WEAVE_ALLOW_TMP=1 — it is "
            "allowed AND logged to the durable ledger."
        )
    advise(
        f"TMP-BLOCK advisory: {path} could not be resolved statically; allowed because "
        "nothing in the command points at a temp location. Keep durable content in "
        "the repo or its docs.local/."
    )


def refuse_unresolvable(reason):
    """Decide, never prompt — an unresolvable target is denied, not asked about.

    Named for what it does. It was called `ask()` until 2026-08-17, and a
    safety guard whose refusal path is spelled `ask` is how a future
    contributor reintroduces the prompt in good faith.

    Ratified by Etan by voice, 2026-08-17: *"none of y'all would be able to
    write to temp, but also not ask me so we don't get agent stuck"*.

    A PreToolUse prompt is the worst of the three outcomes for a fleet. A deny
    comes back to the agent as a readable error it can route around on its own;
    a prompt suspends the pane until a human walks over and answers it, and a
    headless Codex or Cursor worker has no human to walk over at all. The
    2026-08-14/17 sessions lost hours to exactly that: probes into `~/Documents`
    and `~/.local/share` stranding panes overnight on a yes/no question.

    So the contract is two-valued. Provably outside the temp class -> allow.
    Everything else -> deny with an actionable reason. Guessing "allow" would
    let the temp writes this guard exists to stop through (a variable-routed
    `/private/tmp` write and every `$(mktemp)` form were escaping to a mere
    prompt before this change), so the residual failure mode is deliberately
    the recoverable one: an agent told NO rewrites its command.
    """
    deny(
        f"{reason} "
        "This guard decides instead of asking, so no pane is ever stranded on a "
        "yes/no question — rewrite the command with a target this hook can read "
        "statically (a literal path, or a variable assigned a fully-static "
        "value), and it will be allowed if it is outside the temp class."
    )


def deny(reason):
    """Emit the refusal in BOTH refusal dialects, then exit 2.

    `decision`/`reason` is the legacy Claude shape this guard has always
    emitted; Cursor honours it too (measured 2026-08-19: a Cursor shell write
    into /tmp came back to the agent as `Rejected: {"decision": "block", ...}`
    and the file was never created). `hookSpecificOutput.permissionDecision`
    is the shape Codex documents for PreToolUse
    (developers.openai.com/codex/hooks), and Codex rejects a `deny` whose
    `permissionDecisionReason` is empty — hence the fallback below, which must
    never be reachable but must never emit an empty reason if it is.

    Only fields all three harnesses accept go on the wire. In particular
    `continue`, `stopReason` and `suppressOutput` are NOT sent: Codex documents
    them as unsupported for PreToolUse, and a hook that returns one is marked
    failed **and the tool call proceeds** — a refusal that silently becomes an
    allow is precisely the S04 half-fire this guard exists to prevent."""
    cancel_policy_evaluation_deadline()
    reason = reason or "⛔ TMP-BLOCK: refused (no reason supplied)."
    json.dump(
        {
            "decision": "block",
            "reason": reason,
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": reason,
            },
        },
        sys.stdout,
    )
    sys.exit(2)


def _bash_temp_targets(command, _budget=None, _initial_cwd=None):
    """Return [(verb, path, segment)] for write-shaped constructs targeting the
    class. `segment` is the simple-command index (split on ;|&) — a
    `WEAVE_ALLOW_TMP=1` assignment prefix only applies to its own simple
    command in Bash (Codex P1 round 3: `WEAVE_ALLOW_TMP=1 true && echo x >
    /tmp/y` must not unlock the second segment)."""
    if _budget is None:
        _budget = [max(65536, len(command) * 32)]
        _initial_cwd = os.getcwd()
    _budget[0] -= len(command)
    if _budget[0] < 0:
        raise ValueError("executable-substitution analysis budget exhausted")
    if _UNRESOLVED_EVAL_MARKER in command:
        return [
            (
                "unresolved dynamic eval",
                "/tmp/unresolved-dynamic-eval",
                0,
            )
        ]
    direct_command = _mask_function_definition_bodies(command)
    tokens, cmd_pos, seg_of, scope_of = _parse_bash(
        _mask_quoted_operator_words(direct_command)
    )
    exposed_scope_keys = _direct_exposed_scope_keys(direct_command, scope_of)
    hits = []

    scan = ShellScan(
        command, direct_command, tokens, cmd_pos, seg_of, scope_of,
        exposed_scope_keys, _initial_cwd, _budget, hits,
    )
    scan_redirect_targets(scan)
    scan_tee_targets(scan)
    scan_worktree_targets(scan)
    for body, outer_seg, sub_index, exposed in _executable_subcommands(
        _strip_heredoc_bodies(direct_command)
    ):
        try:
            child_cwd = _shell_anchor_before(
                tokens,
                cmd_pos,
                seg_of,
                scope_of,
                outer_seg,
                (),
                _initial_cwd,
            )
        except Unresolvable:
            child_cwd = None
        child_hits = _bash_temp_targets(body, _budget, child_cwd)
        authoritative_exposed_worktrees = 0
        if exposed:
            child_tokens, child_cmd, child_segs, child_scopes = _parse_bash(body)
            child_scope_keys = _direct_exposed_scope_keys(body, child_scopes)
            for _raw, child_seg, _scope, _target_index in _worktree_add_args(
                child_tokens, child_cmd, child_segs, child_scopes
            ):
                authoritative_exposed_worktrees += 1
                authoritative_child_seg = child_seg
                if len(_scope) == 1 and _scope[0] in child_scope_keys:
                    child_outer, child_sub_index = child_scope_keys[_scope[0]]
                    authoritative_child_seg = _nested_segment(
                        child_outer,
                        child_sub_index,
                        max(0, child_seg - child_outer),
                        True,
                    )
                full_authoritative_seg = _nested_segment(
                    outer_seg,
                    sub_index,
                    authoritative_child_seg,
                    exposed,
                )
                candidates = [
                    i
                    for i, (verb, _path, seg) in enumerate(hits)
                    if verb == "git worktree add"
                    and _segment_is_prefix(seg, full_authoritative_seg)
                    and seg != full_authoritative_seg
                ]
                if candidates:
                    match = max(
                        candidates,
                        key=lambda i: len(hits[i][2])
                        if isinstance(hits[i][2], tuple)
                        else 1,
                    )
                    verb, path, _seg = hits.pop(match)
                    hits.append((verb, path, full_authoritative_seg))
        for verb, path, _child_seg in child_hits:
            full_child_seg = _nested_segment(
                outer_seg, sub_index, _child_seg, exposed
            )
            if (
                verb == "git worktree add"
                and authoritative_exposed_worktrees
                and _segment_is_fully_exposed(_child_seg)
            ):
                # The primary parse inherited the real outer cwd and is
                # authoritative only when it produced a classification for
                # this exposed occurrence. Otherwise retain the child's temp
                # hit so a later worktree hatch cannot unlock it.
                candidates = [
                    i
                    for i, (existing_verb, _existing_path, existing_seg)
                    in enumerate(hits)
                    if existing_verb == verb
                    and _segment_is_prefix(existing_seg, full_child_seg)
                ]
                match = next(
                    (i for i in candidates if hits[i][1] == path),
                    candidates[0] if candidates else None,
                )
                if match is not None:
                    existing_verb, existing_path, _existing_seg = hits.pop(match)
                    hits.append((existing_verb, existing_path, full_child_seg))
                else:
                    hits.append((verb, path, full_child_seg))
                authoritative_exposed_worktrees -= 1
                continue
            if exposed:
                duplicate = (verb, path, outer_seg)
                try:
                    hits.remove(duplicate)
                except ValueError:
                    pass
            hits.append(
                (
                    verb,
                    path,
                    full_child_seg,
                )
            )
    for body, outer_seg, payload_index in _shell_command_payloads(
        tokens, cmd_pos, seg_of
    ):
        try:
            child_cwd = _shell_anchor_before(
                tokens,
                cmd_pos,
                seg_of,
                scope_of,
                outer_seg,
                (),
                _initial_cwd,
            )
        except Unresolvable:
            child_cwd = None
        for verb, path, child_seg in _bash_temp_targets(
            body, _budget, child_cwd
        ):
            hits.append(
                (
                    verb,
                    path,
                    _nested_segment(
                        outer_seg, payload_index, child_seg, False
                    ),
                )
            )
    for body, outer_seg, alias_index in _invoked_alias_bodies(command):
        try:
            alias_cwd = _shell_anchor_before(
                tokens,
                cmd_pos,
                seg_of,
                scope_of,
                outer_seg,
                (),
                _initial_cwd,
            )
        except Unresolvable:
            alias_cwd = None
        for verb, path, child_seg in _bash_temp_targets(
            body, _budget, alias_cwd
        ):
            hits.append(
                (
                    verb,
                    path,
                    _nested_alias_segment(outer_seg, alias_index, child_seg),
                )
            )
    return hits


def _main_under_deadline():
    raw_input = ""
    try:
        raw_input = sys.stdin.read()
        hook_input = json.loads(raw_input)
        if not isinstance(hook_input, dict):
            raise ValueError("hook input is not a JSON object")
        host_tool_name = hook_input.get("tool_name")
        if not isinstance(host_tool_name, str) or not host_tool_name:
            # A matcher fired without a tool name — schema glitch. Defaulting
            # to "unguarded tool" here would recreate the S04
            # validation-error-then-allow path (Codex P2 round 6).
            raise ValueError("hook payload missing tool_name")
        # Judge the canonical name, but keep the host's spelling for the ledger
        # so a bypass audit can still tell a Cursor pane from a Claude one.
        tool_name = canonical_tool(host_tool_name)
        tool_input = hook_input.get("tool_input", {})
        session_id = hook_input.get("session_id", "unknown")

        if (
            tool_name not in GUARDED_FILE_TOOLS
            and tool_name != "Bash"
            and tool_name != APPLY_PATCH_TOOL
        ):
            allow()

        if tool_name == "Bash":
            size_reason = policy_command_size_reason(tool_input.get("command", ""))
            if size_reason:
                deny(f"⛔ TMP-BLOCK: {size_reason}.")

        # ── Rule 1: the temp path-CLASS (deny dominates) ─────────────────────
        dynamic_targets = []
        dynamic_targets_hatched = False
        targets = find_temp_targets(tool_name, tool_input)
        if targets:
            proven = [
                target for target in targets
                if not target[0].startswith("dynamic ")
            ]
            if escape_hatch_covers(
                tool_name, tool_input, [seg for _v, _p, seg in targets], HATCH_TMP
            ):
                # An explicit ephemeral sanction ends the call here, exactly as
                # before Rule 2 existed: a hatched temp write must not then be
                # re-denied (and double-logged) by the location rule.
                log_bypass(host_tool_name, tool_input, targets, session_id)
                if proven:
                    allow()
                dynamic_targets = targets
                dynamic_targets_hatched = True
            else:
                if not proven:
                    # Defer the unresolvable refusal until after Rule 2. An
                    # executable worktree violation inside the substitution
                    # is stronger evidence and must retain deny precedence.
                    dynamic_targets = targets
                else:
                    listed = "; ".join(
                        f"{verb} -> {path}" for verb, path, _seg in proven
                    )
                    deny(
                        f"⛔ TMP-BLOCK: durable-content write into the temp path-class denied ({listed}). "
                        "/tmp, /private/tmp, /var/folders and $TMPDIR are wiped on reboot and invisible "
                        "to the fleet — put durable content in the repo or its docs.local/ "
                        "(e.g. <repo>/docs.local/), and create worktrees under <repo>/.worktrees/. "
                        "Genuinely ephemeral? Re-run with WEAVE_ALLOW_TMP=1 — it is allowed AND "
                        "logged to the durable ledger (the log is the bypass detector). "
                        "[S04 fail-closed guard, weave 2026-06-07 Fix-3]"
                    )

        # ── Rule 2: the ratified worktree location ───────────────────────────
        deny_hits, unresolved_hits = find_worktree_convention_issues(tool_name, tool_input)
        if deny_hits or unresolved_hits:
            segments = [seg for _v, _p, seg, _raw, _anchor in deny_hits]
            segments += [seg for _raw, seg, _why in unresolved_hits]
            # golems#480: a hatch may authorize a resolved migration, but it
            # cannot manufacture evidence for any target the static resolver
            # could not determine. Mixed resolved/unresolved calls therefore
            # fail closed as well.
            if (
                not unresolved_hits
                and not any(
                    in_temp_class(path)
                    for _verb, path, _seg, _raw, _anchor in deny_hits
                )
                and escape_hatch_covers(
                    tool_name, tool_input, segments, HATCH_WT
                )
            ):
                log_bypass(
                    host_tool_name,
                    tool_input,
                    [(verb, path, seg) for verb, path, seg, _raw, _anchor in deny_hits]
                    + [("git worktree add (unresolved)", raw, seg) for raw, seg, _w in unresolved_hits],
                    session_id,
                    hatch=f"{HATCH_WT}=1",
                )
                if dynamic_targets and not dynamic_targets_hatched:
                    refuse_or_advise_dynamic(dynamic_targets, tool_input.get("command", ""))
                allow()
            if deny_hits:
                # A resolved violation outranks an unresolvable one: it names
                # the exact fixed command instead of a resolution failure.
                verb, resolved, _seg, raw, anchor = deny_hits[0]
                repo, fixed = suggest_fixed_target(resolved, anchor)
                shown = f"{raw} -> {resolved}" if raw != resolved else resolved
                deny(
                    f"⛔ WORKTREE-CONVENTION: `git worktree add` target is outside the ratified "
                    f"in-repo location ({shown}). Fleet convention, ratified by Etan by voice "
                    f"2026-08-09: worktrees live at <repo>/{WORKTREE_DIR_NAME}/<name> — sibling "
                    f"`<repo>.wt/` directories are drift (18 accumulated while this guard only "
                    f"ADVISED the location instead of enforcing it). "
                    f"Fixed command: git -C {repo} worktree add {fixed} <same flags>. "
                    f"Moving an existing off-convention worktree during the migration window? "
                    f"Re-run with {HATCH_WT}=1 — allowed AND logged to the durable ledger "
                    f"(the log is the bypass detector)."
                )
            raw, _seg, why = unresolved_hits[0]
            refuse_unresolvable(
                f"⛔ WORKTREE-CONVENTION: cannot resolve this `git worktree add` target "
                f"statically — {raw} ({why}). The ratified location is "
                f"<repo>/{WORKTREE_DIR_NAME}/<name>; re-issue the add with a target this "
                f"hook can read statically under {WORKTREE_DIR_NAME}/ — "
                f"git -C <repo> worktree add <repo>/{WORKTREE_DIR_NAME}/<name>. "
                f"(golems#676: judge the resolved path — never block on an unexpanded literal.)"
            )

        if dynamic_targets and not dynamic_targets_hatched:
            refuse_or_advise_dynamic(dynamic_targets, tool_input.get("command", ""))

        allow()
    except SystemExit:
        raise
    except PolicyEvaluationDeadlineExceeded:
        raise
    except Exception as exc:  # GO-5 E2: a hook bug is an advisory, not a block on every call ...
        if _has_temp_hint(raw_input):
            # ... unless the payload itself points at a temp location: the S04
            # class ("validation error, write proceeded") stays a hard deny.
            deny(
                f"⛔ TMP-BLOCK FAIL-CLOSED: hook error ({exc.__class__.__name__}: {exc}) on a "
                "payload that mentions a temp location — denying instead of allowing (S04). "
                "If this is a false fire, fix the hook or use WEAVE_ALLOW_TMP=1 after "
                "verifying the target is genuinely ephemeral."
            )
        advise(
            f"TMP-BLOCK advisory: hook error ({exc.__class__.__name__}: {exc}); this call "
            "was NOT checked for temp writes. Keep durable content in the repo or its "
            "docs.local/, and report the error so the hook gets fixed."
        )


def main():
    try:
        with policy_evaluation_deadline():
            _main_under_deadline()
    except PolicyEvaluationDeadlineExceeded as exc:
        deny(f"⛔ TMP-BLOCK: {exc}.")










try:
    with redirect_stdout(StringIO()), redirect_stderr(StringIO()):
        _anchors.Unresolvable = Unresolvable
        _anchors._ASSIGNMENT_RE = _ASSIGNMENT_RE
        _anchors._CWD_CHANGING_CMDS = _CWD_CHANGING_CMDS
        _anchors._SIMPLE_VAR_RE = _SIMPLE_VAR_RE
        _anchors._bounded_compound_value_sets_before = _bounded_compound_value_sets_before
        _anchors._case_pattern_parens = _case_pattern_parens
        _anchors._function_signature_parens = _function_signature_parens
        _anchors._is_separator = _is_separator
        _anchors._literal_array_parens = _literal_array_parens
        _anchors._process_substitution_parens = _process_substitution_parens
        _anchors._scope_affects_target = _scope_affects_target
        _anchors._segment_indices = _segment_indices
        _anchors._success_chain_reaches = _success_chain_reaches
        _anchors.resolve_target = resolve_target
        _assignments.Unresolvable = Unresolvable
        _assignments._ASSIGNMENT_RE = _ASSIGNMENT_RE
        _assignments._MAX_STATIC_VALUES = _MAX_STATIC_VALUES
        _assignments._bounded_word_values = _bounded_word_values
        _assignments._is_separator = _is_separator
        _assignments._segment_operator_after = _segment_operator_after
        _assignments._segment_operator_before = _segment_operator_before
        _assignments.re = re
        _bypass._ASSIGNMENT_RE = _ASSIGNMENT_RE
        _bypass._WRAPPER_CMDS = _WRAPPER_CMDS
        _bypass._WRAPPER_VALUE_OPTS = _WRAPPER_VALUE_OPTS
        _bypass._executable_subcommands = _executable_subcommands
        _bypass._invoked_alias_bodies = _invoked_alias_bodies
        _bypass._is_separator = _is_separator
        _bypass._nested_alias_segment = _nested_alias_segment
        _bypass._nested_segment = _nested_segment
        _bypass._parse_bash = _parse_bash
        _bypass._shell_command_payloads = _shell_command_payloads
        _bypass._shell_tokens = _shell_tokens
        _bypass._strip_heredoc_bodies = _strip_heredoc_bodies
        _bypass.datetime = datetime
        _bypass.deny = deny
        _bypass.json = json
        _chain_status._is_separator = _is_separator
        _compounds.Unresolvable = Unresolvable
        _compounds._ASSIGNMENT_RE = _ASSIGNMENT_RE
        _compounds._CWD_CHANGING_CMDS = _CWD_CHANGING_CMDS
        _compounds._MAX_STATIC_VALUES = _MAX_STATIC_VALUES
        _compounds._assignment_effects_between = _assignment_effects_between
        _compounds._bounded_word_values = _bounded_word_values
        _compounds._is_command_sub_close = _is_command_sub_close
        _compounds._is_command_sub_open = _is_command_sub_open
        _compounds._is_separator = _is_separator
        _compounds._literal_array_values_before = _literal_array_values_before
        _compounds._scope_affects_target = _scope_affects_target
        _compounds._static_shell_variables_before = _static_shell_variables_before
        _compounds.re = re
        _prefixes.WORKTREE_DIR_NAME = WORKTREE_DIR_NAME
        _prefixes._QUOTED_LBRACE = _QUOTED_LBRACE
        _prefixes._QUOTED_RBRACE = _QUOTED_RBRACE
        _prefixes._SIMPLE_VAR_RE = _SIMPLE_VAR_RE
        _prefixes._executable_subcommands = _executable_subcommands
        _prefixes._substitution_word_text = _substitution_word_text
        _prefixes.in_temp_class = _runtime.callbacks.classify_temp
        _prefixes.is_harness_scratchpad = is_harness_scratchpad
        _prefixes.on_convention = on_convention
        _prefixes.re = re
        _resolution.Unresolvable = Unresolvable
        _resolution._bounded_compound_value_sets_before = _bounded_compound_value_sets_before
        _resolution._bounded_word_values = _bounded_word_values
        _resolution._enclosing_loop_changes_cwd = _enclosing_loop_changes_cwd
        _resolution.resolve_target = resolve_target
        _scope._is_separator = _is_separator
        _scope.re = re
        _shell_words._command_sub_word_continues = _command_sub_word_continues
        _shell_words._executable_subcommands = _executable_subcommands
        _shell_words._is_command_sub_open = _is_command_sub_open
        _shell_words._strip_heredoc_bodies = _strip_heredoc_bodies
        _tool_targets._bash_temp_targets = _bash_temp_targets
        _tool_targets.in_temp_class = _runtime.callbacks.classify_temp
        _tool_targets.re = re
        _variable_builtins.NamedTuple = NamedTuple
        _variable_builtins.re = re
        _variables.BuiltinScan = BuiltinScan
        _variables._ASSIGNMENT_RE = _ASSIGNMENT_RE
        _variables._SIMPLE_VAR_RE = _SIMPLE_VAR_RE
        _variables._chain_status_after = _chain_status_after
        _variables._is_separator = _is_separator
        _variables._literal_prefix_scan = _literal_prefix_scan
        _variables._paren_contexts = _paren_contexts
        _variables._segment_operator_after = _segment_operator_after
        _variables._segment_operator_before = _segment_operator_before
        _variables._success_chain_reaches = _success_chain_reaches
        _variables.invalidate_builtin_targets = invalidate_builtin_targets
        _variables.re = re
        _words.Unresolvable = Unresolvable
        _words._QUOTED_LBRACE = _QUOTED_LBRACE
        _words._QUOTED_RBRACE = _QUOTED_RBRACE
        _words.re = re
        _worktree_args._after_substitution_word = _after_substitution_word
        _worktree_args._is_command_sub_open = _is_command_sub_open
        _worktree_args._is_separator = _is_separator
        _worktrees.Unresolvable = Unresolvable
        _worktrees._direct_exposed_scope_keys = _direct_exposed_scope_keys
        _worktrees._executable_subcommands = _executable_subcommands
        _worktrees._invoked_alias_bodies = _invoked_alias_bodies
        _worktrees._literal_prefix_class = _literal_prefix_class
        _worktrees._nested_alias_segment = _nested_alias_segment
        _worktrees._nested_segment = _nested_segment
        _worktrees._parse_bash = _parse_bash
        _worktrees._shell_anchor_before = _shell_anchor_before
        _worktrees._static_shell_variable_state_before = _static_shell_variable_state_before
        _worktrees._strip_heredoc_bodies = _strip_heredoc_bodies
        _worktrees._worktree_add_args = _worktree_add_args
        _worktrees._worktree_anchor = _worktree_anchor
        _worktrees.on_convention = on_convention
        _worktrees.resolve_targets = resolve_targets
        _write_targets.NamedTuple = NamedTuple
        _write_targets.Unresolvable = Unresolvable
        _write_targets._after_substitution_word = _after_substitution_word
        _write_targets._bounded_loop_subshell_anchor = _bounded_loop_subshell_anchor
        _write_targets._is_command_sub_open = _is_command_sub_open
        _write_targets._literal_branch_may_execute = _literal_branch_may_execute
        _write_targets._literal_prefix_class = _literal_prefix_class
        _write_targets._nested_segment = _nested_segment
        _write_targets._shell_anchor_before = _shell_anchor_before
        _write_targets._static_shell_variable_state_before = _static_shell_variable_state_before
        _write_targets._static_shell_variables_before = _static_shell_variables_before
        _write_targets._worktree_add_args = _worktree_add_args
        _write_targets._worktree_anchor = _worktree_anchor
        _write_targets.in_temp_class = _runtime.callbacks.classify_temp
        _write_targets.resolve_targets = resolve_targets
except BaseException:
    _deny_policy_import_failure()

if __name__ == "__main__":
    main()
