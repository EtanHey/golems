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

def _after_stdlib(paths):
    # Never first: the stdlib (its zip, dir and lib-dynload) always wins over the
    # tree, while this copy's _shared still precedes any other copy's.
    import sysconfig
    stdlib = os.path.realpath(sysconfig.get_paths()["stdlib"])
    hits = [i for i, entry in enumerate(paths) if entry and (
        os.path.realpath(entry) == stdlib or os.path.realpath(entry).startswith(stdlib + os.sep)
        or entry.endswith(".zip"))]
    return hits[-1] + 1 if hits else len(paths)


if _SHARED_ROOT in sys.path:
    sys.path.remove(_SHARED_ROOT)
sys.path.insert(_after_stdlib(sys.path), _SHARED_ROOT)
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
            ansi_c_readings,
            ansi_c_reading,
            evaluate_shell_readings,
            ShellReadingBudgetExceeded,
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
            if not os.path.isfile(os.path.join(_IMPL_ROOT, "__init__.py")) or os.path.realpath(
                getattr(_package, "__file__", "")
            ) != os.path.realpath(os.path.join(_IMPL_ROOT, "__init__.py")):
                raise ImportError("unexpected tmp-block implementation origin")
            _impl_modules, _impl_exports = {}, {}
            for _leaf, _exports in _package.EXPORTS:
                _module = _impl_import(_IMPL_NAME + "." + _leaf)
                _expected = os.path.join(_IMPL_ROOT, _leaf + ".py")
                if not os.path.isfile(_expected) or os.path.realpath(
                    getattr(_module, "__file__", "")
                ) != os.path.realpath(_expected):
                    raise ImportError("unexpected tmp-block implementation origin")
                globals()["_" + _leaf] = _module
                _impl_modules[_leaf] = _module
                for _name in _exports:
                    globals()[_name] = getattr(_module, _name)
                    _impl_exports[_name] = getattr(_module, _name)
            _runtime.callbacks.bind(
                lambda raw: in_temp_class(raw), lambda: _temp_prefixes()
            )
            _policy._temp_prefixes = _runtime.callbacks.temp_prefixes
            _policy.is_harness_scratchpad = is_harness_scratchpad
        finally:
            sys.dont_write_bytecode = _previous_bytecode
except BaseException:
    _deny_policy_import_failure()


# Captured readings share the original deadline. A provisional allow/deny must
# not disarm it before the other reading has been checked.
_capturing_reading = False
_cancel_policy_deadline = cancel_policy_evaluation_deadline

def cancel_policy_evaluation_deadline():
    if not _capturing_reading:
        _cancel_policy_deadline()


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
    global _capturing_reading
    try:
        with policy_evaluation_deadline():
            raw = sys.stdin.read()
            try:
                payload = json.loads(raw)
                command = payload.get('tool_input', {}).get('command', '')
            except (ValueError, AttributeError):
                command = ''
            readings = ansi_c_readings(command) if isinstance(command, str) else ('zsh',)
            original_input = sys.stdin
            captured = []
            try:
                def evaluate():
                    global _capturing_reading
                    sys.stdin = StringIO(raw)
                    output = StringIO()
                    try:
                        _capturing_reading = True
                        with redirect_stdout(output):
                            _main_under_deadline()
                    except SystemExit as decision:
                        return decision.code, output.getvalue()
                    finally:
                        _capturing_reading = False
                for reading in readings:
                    with ansi_c_reading(reading):
                        captured.extend(evaluate_shell_readings(evaluate, lambda row: row[0] != 0))
                    if captured[-1][0] != 0:
                        break  # deny dominates; another reading cannot allow it
            finally:
                sys.stdin = original_input
                _capturing_reading = False
            code, output = next((row for row in captured if row[0] != 0), captured[0])
            cancel_policy_evaluation_deadline()
            sys.stdout.write(output)
            raise SystemExit(code)
    except (PolicyEvaluationDeadlineExceeded, ShellReadingBudgetExceeded) as exc:
        deny(f"⛔ TMP-BLOCK: {exc}.")


try:
    with redirect_stdout(StringIO()), redirect_stderr(StringIO()):
        _package.bind(_impl_modules, _impl_exports,
                      ansi_c_readings=ansi_c_readings,
                      ansi_c_reading=ansi_c_reading,
                      evaluate_shell_readings=evaluate_shell_readings,
                      _ASSIGNMENT_RE=_ASSIGNMENT_RE,
                      _QUOTED_LBRACE=_QUOTED_LBRACE,
                      _QUOTED_RBRACE=_QUOTED_RBRACE,
                      _UNRESOLVED_EVAL_MARKER=_UNRESOLVED_EVAL_MARKER,
                      _WRAPPER_CMDS=_WRAPPER_CMDS,
                      _WRAPPER_VALUE_OPTS=_WRAPPER_VALUE_OPTS,
                      _command_sub_word_continues=_command_sub_word_continues,
                      _executable_subcommands=_executable_subcommands,
                      _function_signature_parens=_function_signature_parens,
                      _invoked_alias_bodies=_invoked_alias_bodies,
                      _is_command_sub_close=_is_command_sub_close,
                      _is_command_sub_open=_is_command_sub_open,
                      _is_separator=_is_separator,
                      _mask_function_definition_bodies=_mask_function_definition_bodies,
                      _mask_quoted_operator_words=_mask_quoted_operator_words,
                      _nested_alias_segment=_nested_alias_segment,
                      _nested_segment=_nested_segment,
                      _parse_bash=_parse_bash,
                      _segment_is_fully_exposed=_segment_is_fully_exposed,
                      _segment_is_prefix=_segment_is_prefix,
                      _shell_command_payloads=_shell_command_payloads,
                      _shell_tokens=_shell_tokens,
                      _strip_heredoc_bodies=_strip_heredoc_bodies,
                      deny=deny,
                      in_temp_class=_runtime.callbacks.classify_temp,
                      is_harness_scratchpad=is_harness_scratchpad,
        )
except BaseException:
    _deny_policy_import_failure()

if __name__ == "__main__":
    main()
