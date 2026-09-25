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
    it never unlocks the temp path-class, which still needs WEAVE_ALLOW_TMP.

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

Exit codes: 0 = allow ({} on stdout) · 2 = deny ({"decision": "block", ...}).
There is no third code: the two-valued contract removed the ask path, so
`hookSpecificOutput` is never emitted.
"""

import json
import os
import re
import sys
from datetime import datetime

# S13 (GO-5): the shell parser lives in _shared/shell_parse.py; this hook keeps policy.
# realpath: a copy at ~/.claude/hooks/tmp-block/hooks/ finds ~/.claude/hooks/_shared,
# a symlink into hooks-live finds skills/golem-powers/_shared.
sys.path.insert(0, os.path.join(os.path.dirname(os.path.realpath(__file__)), "..", "..", "_shared"))
from harness_paths import _temp_prefixes, is_harness_scratchpad  # noqa: E402
from shell_parse import (  # noqa: E402 F401 (the _RAW_* regexes are pinned by tests via this module)
    _ASSIGNMENT_RE,
    _QUOTED_LBRACE,
    _QUOTED_RBRACE,
    _RAW_FOR_WORD_RE,
    _RAW_SHELL_TOKEN_RE,
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
    _segment_is_fully_exposed,
    _segment_is_prefix,
    _shell_command_payloads,
    _shell_tokens,
    _strip_heredoc_bodies,
)

DEFAULT_LEDGER = os.path.expanduser("~/.claude/logs/tmp-block-ledger.jsonl")

GUARDED_FILE_TOOLS = ("Write", "Edit", "NotebookEdit")

# The apply_patch envelope Codex reports for every file edit. Its own class:
# the target paths live inside the patch body, not in a `file_path` key.
APPLY_PATCH_TOOL = "apply_patch"

# ── Cross-agent tool names (measured 2026-08-19) ─────────────────────────────
#
# This hook is loaded by three harnesses, and each one spells the same tool
# differently. Claude Code sends `Bash`/`Write`/`Edit`/`NotebookEdit`. Cursor
# reads `~/.claude/settings.json` unconditionally (bundle 2026.08.11-e8db854,
# `claudeUserConfigPath`), maps `Bash -> Shell` and `Edit -> Write`, and sends
# `tool_name: "Shell"` with the same `tool_input.command`. Codex reads
# `~/.codex/hooks.json` and sends `Bash` for shell and unified exec, and
# `apply_patch` for every file edit (developers.openai.com/codex/hooks,
# "Tool coverage").
#
# Until this map existed, a Cursor shell call arrived as `Shell`, missed the
# `tool_name != "Bash"` gate in main(), and was ALLOWED silently — the guard
# was loaded into every Cursor session and enforcing nothing on shell. Cursor
# `Write` was already denied, because Cursor spells that one exactly as Claude
# does.
TOOL_ALIASES = {
    "Shell": "Bash",  # Cursor: the shell tool, measured payload {command, cwd, timeout}
}


def canonical_tool(tool_name):
    """Map a host-specific PreToolUse tool name onto this guard's own names.

    Unknown names pass through unchanged and fall out of the dispatch gate in
    main() as "not a guarded tool" — the same allow the guard has always given
    a tool it does not police. Adding an alias here is the whole cost of
    covering a new harness."""
    return TOOL_ALIASES.get(tool_name, tool_name)


# apply_patch envelope headers that CREATE or REWRITE a path. `Delete File` is
# absent on purpose: the contract has never denied a delete.
_APPLY_PATCH_TARGET_RE = re.compile(
    r"^\*\*\*\s+(Add File|Update File|Move to):\s*(.+?)\s*$", re.MULTILINE
)


# $TMPDIR token with an identifier boundary: `$TMPDIR/x`, `${TMPDIR}/x`,
# `${TMPDIR:-/tmp}/x`, `${TMPDIR%/}/x` — but not `$TMPDIR_EXTRA`/`${TMPDIR2}`.
_TMPDIR_TOKEN_RE = re.compile(r"^\$(?:TMPDIR(?![A-Za-z0-9_])|\{TMPDIR(?![A-Za-z0-9_]))")


# git worktree add flags that consume a value.
_WORKTREE_VALUE_FLAGS = {"-b", "-B", "--reason"}

# Rule 2: the ratified in-repo worktree directory name.
WORKTREE_DIR_NAME = ".worktrees"

HATCH_TMP = "WEAVE_ALLOW_TMP"
HATCH_WT = "WEAVE_ALLOW_WT_MIGRATION"


# Simple, statically-resolvable variable references: `$NAME` / `${NAME}`.
# Anything richer (`${NAME:-default}`, `${NAME%/}`, `$(...)`, backticks) is
# deliberately NOT resolved — it is refused with its reason, never blocked
# blind on the unexpanded literal (golems#676).
_SIMPLE_VAR_RE = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)")
_POSITIONAL_PARAM_RE = re.compile(r"\$(?:[1-9][0-9]*|[@*])")

# Command words that move the shell's cwd, making a relative target
# unresolvable from the hook's own cwd.
_CWD_CHANGING_CMDS = {"cd", "pushd", "popd", "chdir"}


class Unresolvable(Exception):
    """The target cannot be judged statically -> REFUSE with the reason.

    golems#676: git-guardian blocked a legitimate cleanup because it counted
    components of an UNEXPANDED literal. A guard that cannot see the real path
    must not guess — it must say so. #676 answered that with a prompt; the
    2026-08-17 two-valued contract keeps the requirement (name the exact
    resolution failure) and drops the prompt (see refuse_unresolvable)."""


def allow():
    json.dump({}, sys.stdout)
    sys.exit(0)


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


def in_temp_class(raw_path):
    """True if raw_path canonicalizes into the temp path-CLASS."""
    if not isinstance(raw_path, str):
        return False
    s = raw_path.strip().strip('"').strip("'")
    if not s:
        return False
    # A $TMPDIR token (incl. `${TMPDIR:-/tmp}`-style expansions, Codex P1
    # round 9) is temp-intent by definition; an identifier boundary is
    # required so `$TMPDIR_EXTRA`/`${TMPDIR2}` do NOT match (Bugbot Low).
    if _TMPDIR_TOKEN_RE.match(s):
        return True
    if not (s.startswith("/") or s.startswith("~")):
        return False
    # Check BOTH the lexical form and the symlink-resolved form (Bugbot HIGH
    # 6b9b2c5c): a /tmp-shaped path whose symlink resolves to durable storage
    # is still temp-class (the path itself dies on reboot), and a
    # durable-shaped path that resolves INTO the class is caught by realpath.
    expanded = os.path.expanduser(s)
    candidates = {os.path.normpath(expanded)}
    try:
        candidates.add(os.path.realpath(expanded))
    except (OSError, ValueError):
        pass
    prefixes = _temp_prefixes()
    for cand in candidates:
        # The harness session scratchpad is the one sanctioned temp location
        # (see is_harness_scratchpad). Skipping the candidate — rather than
        # returning False outright — keeps the both-forms conservatism above:
        # a scratchpad path whose symlink resolves into the bare temp class
        # is still a temp write, because the OTHER candidate then matches.
        if is_harness_scratchpad(cand, prefixes):
            continue
        for prefix in prefixes:
            if cand == prefix or cand.startswith(prefix + "/"):
                return True
    return False


def _literal_branch_may_execute(tokens, target_index):
    """Conservatively reject only commands in statically skipped if branches."""
    stack = []
    at_command_start = True
    for token in tokens[:target_index]:
        if token in {"\n", ";", "|", "&"}:
            at_command_start = True
            continue
        if token == "then" and stack:
            stack[-1]["branch"] = "then"
            at_command_start = True
            continue
        if token == "else" and stack:
            stack[-1]["branch"] = "else"
            at_command_start = True
            continue
        if token == "fi" and stack:
            stack.pop()
            at_command_start = False
            continue
        if at_command_start and token == "if":
            stack.append({"condition": "unknown", "branch": "condition"})
            at_command_start = True
            continue
        if stack and stack[-1]["branch"] == "condition" and at_command_start:
            if _ASSIGNMENT_RE.match(token) or token == "!":
                continue
            if token in {"true", ":"}:
                stack[-1]["condition"] = True
            elif token == "false":
                stack[-1]["condition"] = False
        at_command_start = False
    for compound in stack:
        if compound["branch"] == "then" and compound["condition"] is False:
            return False
        if compound["branch"] == "else" and compound["condition"] is True:
            return False
    return True


def _direct_exposed_scope_keys(command, scope_of):
    """Map top-level lexer scope IDs to recursive substitution identities."""
    scope_ids = []
    for scope in scope_of:
        if len(scope) == 1 and scope[0] not in scope_ids:
            scope_ids.append(scope[0])
    exposed = [
        (outer_seg, sub_index)
        for _body, outer_seg, sub_index, is_exposed in _executable_subcommands(
            _strip_heredoc_bodies(command)
        )
        if is_exposed
    ]
    return dict(zip(scope_ids, exposed))


def _after_substitution_word(tokens, scope_of, opener, parent_scope):
    """Return the first token after the shell word containing `opener`.

    Command substitutions are tokenized into child scopes, while any literal
    suffix returns to the parent scope. A `)$+` close marker records that the
    same shell word continues, so option values such as `--reason=$(x)suffix`
    can be skipped without mistaking `suffix` for the worktree path.
    """
    j = opener + 1
    while True:
        while j < len(tokens) and scope_of[j] != parent_scope:
            j += 1
        if (
            j == 0
            or not _command_sub_word_continues(tokens[j - 1])
            or j >= len(tokens)
        ):
            return j
        if tokens[j] in (";", "|", "&", ">", ">>", "(", ")"):
            return j
        suffix = tokens[j]
        j += 1
        if not _is_command_sub_open(suffix):
            return j


def _substitution_word_text(tokens, scope_of, opener):
    """Rebuild the token span for one shell word containing `$(...)`."""
    if not _is_command_sub_open(tokens[opener]):
        return tokens[opener]
    end = _after_substitution_word(
        tokens, scope_of, opener, scope_of[opener]
    )
    return " ".join(tokens[opener:end])


def _worktree_add_args(tokens, cmd_pos, seg_of, scope_of):
    """Return [(raw_path_token, segment, scope, index)] for each creation."""
    found = []
    for idx in range(len(tokens) - 1):
        if tokens[idx] == "worktree" and tokens[idx + 1] == "add":
            # Require a git invocation earlier in the same statement segment —
            # match by basename so `/usr/bin/git worktree add` is covered too
            # (Bugbot f8d22aeb).
            seg_start = idx
            while seg_start > 0 and not _is_separator(tokens, seg_start - 1):
                seg_start -= 1
            if not any(
                (tok == "git" or tok.endswith("/git"))
                and cmd_pos[j]
                and scope_of[j] == scope_of[idx]
                for j, tok in enumerate(tokens[seg_start:idx], start=seg_start)
            ):
                continue
            skip_next = False
            j = idx + 2
            while j < len(tokens):
                arg = tokens[j]
                if scope_of[j] != scope_of[idx]:
                    break
                if skip_next:
                    skip_next = False
                    if _is_command_sub_open(arg):
                        j = _after_substitution_word(
                            tokens, scope_of, j, scope_of[idx]
                        )
                        continue
                    j += 1
                    continue
                if arg in (";", "|", "&", ">", ">>"):
                    break
                if arg in _WORKTREE_VALUE_FLAGS:
                    skip_next = True
                    j += 1
                    continue
                if arg.startswith("-"):
                    j += 1
                    if _is_command_sub_open(arg):
                        # `--reason=$(...)` carries its value in a child
                        # substitution scope. Skip that scope, then resume in
                        # the parent to find the actual worktree path.
                        j = _after_substitution_word(
                            tokens, scope_of, j - 1, scope_of[idx]
                        )
                    continue
                found.append((arg, seg_of[idx], scope_of[idx], j))
                break  # first non-flag arg is the worktree path
    return found


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

    # 1. Output redirects (covers heredoc bodies piped via `... <<EOF > path`).
    for idx, tok in enumerate(tokens):
        if tok in (">", ">>"):
            if idx + 1 < len(tokens):
                target_index = idx + 1
                target = tokens[idx + 1]
                if (
                    target in ("<", ">")
                    and idx + 2 < len(tokens)
                    and tokens[idx + 2] == "("
                ):
                    # The outer redirect feeds a process substitution; the
                    # nested tee/write command owns the actual file target.
                    continue
                if (
                    target == "("
                    and idx > 0
                    and tokens[idx - 1] in ("<", ">")
                ):
                    continue
                if target == "&":
                    # `>&N` / `>&-` is an fd dup — but `>&word` is Bash's
                    # second redirect-both-to-file form (Codex P1): the word
                    # after `&` is the real target unless it is an fd/dash.
                    if idx + 2 >= len(tokens):
                        continue
                    target_index = idx + 2
                    target = tokens[idx + 2]
                    if target.isdigit() or target == "-":
                        continue
                if in_temp_class(target):
                    hits.append(("output redirect", target, seg_of[idx]))
                else:
                    variables, variable_prefixes = (
                        _static_shell_variable_state_before(
                            tokens, cmd_pos, seg_of, seg_of[idx]
                        )
                    )
                    anchor = None
                    try:
                        anchor = _shell_anchor_before(
                            tokens,
                            cmd_pos,
                            seg_of,
                            scope_of,
                            seg_of[idx],
                            scope_of[idx],
                            _initial_cwd,
                            variables,
                        )
                    except Unresolvable:
                        anchor = _bounded_loop_subshell_anchor(
                            tokens,
                            cmd_pos,
                            seg_of,
                            scope_of,
                            idx + 1,
                            target,
                            _initial_cwd,
                            variables,
                        )
                    try:
                        resolved = resolve_targets(
                            target,
                            anchor,
                            variables,
                            tokens=tokens,
                            cmd_pos=cmd_pos,
                            seg_of=seg_of,
                            scope_of=scope_of,
                            target_index=target_index,
                        )
                    except Unresolvable:
                        resolved = None
                    if resolved is not None:
                        temp_target = next(
                            (candidate for candidate in resolved if in_temp_class(candidate)),
                            None,
                        )
                        if temp_target is not None:
                            hits.append(("output redirect", temp_target, seg_of[idx]))
                        continue
                    prefix_class = _literal_prefix_class(
                        target,
                        anchor,
                        variables=variables,
                        variable_prefixes=variable_prefixes,
                        tokens=tokens,
                        scope_of=scope_of,
                        target_index=target_index,
                    )
                    if prefix_class == "temp":
                        hits.append(("output redirect", target, seg_of[idx]))
                        continue
                    if prefix_class in ("repo", "outside", "scratchpad"):
                        continue
                    # The substitution may rewrite an apparently durable
                    # prefix into the temp class (`/repo$(printf
                    # /../../tmp/x)`). Preserve this uncertainty for main()
                    # to REFUSE as unresolvable; it is not enough evidence
                    # for Rule 1's hard temp-class deny.
                    hits.append(("dynamic output redirect", target, seg_of[idx]))

    # 2. tee targets (skip flags; stop at statement separators/parens) —
    # parens are standalone tokens so `> >(tee /tmp/out.md)` process
    # substitution is covered too (Codex P1 round 4).
    for idx, tok in enumerate(tokens):
        if (
            (tok == "tee" or tok.endswith("/tee"))
            and cmd_pos[idx]
            and _literal_branch_may_execute(tokens, idx)
        ):
            j = idx + 1
            while j < len(tokens):
                arg = tokens[j]
                if scope_of[j] != scope_of[idx]:
                    j += 1
                    continue
                if arg in (";", "|", "&", ">", ">>", "(", ")"):
                    break
                if arg.startswith("-"):
                    j += 1
                    continue
                if _is_command_sub_open(arg):
                    variables, variable_prefixes = (
                        _static_shell_variable_state_before(
                            tokens, cmd_pos, seg_of, seg_of[idx]
                        )
                    )
                    anchor = None
                    try:
                        anchor = _shell_anchor_before(
                            tokens,
                            cmd_pos,
                            seg_of,
                            scope_of,
                            seg_of[idx],
                            scope_of[idx],
                            _initial_cwd,
                            variables,
                        )
                    except Unresolvable:
                        pass
                    prefix_class = _literal_prefix_class(
                        arg,
                        anchor,
                        variables=variables,
                        variable_prefixes=variable_prefixes,
                        tokens=tokens,
                        scope_of=scope_of,
                        target_index=j,
                    )
                    if prefix_class == "temp":
                        hits.append(("tee", arg, seg_of[idx]))
                    elif prefix_class not in ("repo", "outside", "scratchpad"):
                        hits.append(("dynamic tee", arg, seg_of[idx]))
                    j = _after_substitution_word(
                        tokens, scope_of, j, scope_of[idx]
                    )
                    continue
                if in_temp_class(arg):
                    hits.append(("tee", arg, seg_of[idx]))
                else:
                    variables, variable_prefixes = (
                        _static_shell_variable_state_before(
                            tokens, cmd_pos, seg_of, seg_of[idx]
                        )
                    )
                    anchor = None
                    try:
                        anchor = _shell_anchor_before(
                            tokens,
                            cmd_pos,
                            seg_of,
                            scope_of,
                            seg_of[idx],
                            scope_of[idx],
                            _initial_cwd,
                            variables,
                        )
                    except Unresolvable:
                        anchor = _bounded_loop_subshell_anchor(
                            tokens,
                            cmd_pos,
                            seg_of,
                            scope_of,
                            j,
                            arg,
                            _initial_cwd,
                            variables,
                        )
                    try:
                        resolved = resolve_targets(
                            arg,
                            anchor,
                            variables,
                            tokens=tokens,
                            cmd_pos=cmd_pos,
                            seg_of=seg_of,
                            scope_of=scope_of,
                            target_index=j,
                        )
                    except Unresolvable:
                        resolved = None
                    if resolved is not None:
                        temp_target = next(
                            (candidate for candidate in resolved if in_temp_class(candidate)),
                            None,
                        )
                        if temp_target is not None:
                            hits.append(("tee", temp_target, seg_of[idx]))
                    else:
                        prefix_class = _literal_prefix_class(
                            arg,
                            anchor,
                            variables=variables,
                            variable_prefixes=variable_prefixes,
                            tokens=tokens,
                            scope_of=scope_of,
                            target_index=j,
                        )
                        if prefix_class == "temp":
                            hits.append(("tee", arg, seg_of[idx]))
                        # `outside` proves the class as fully as `repo` does.
                        # Omitting it here was a second instance of the same
                        # two-class defect: `tee ~/Documents/t_$$.txt` refused
                        # while the identical `> ~/Documents/t_$$.txt` allowed.
                        elif prefix_class not in ("repo", "outside", "scratchpad"):
                            hits.append(("dynamic tee", arg, seg_of[idx]))
                j += 1

    # 3. git worktree add <path> — creation only; `worktree list/remove` untouched.
    for raw, seg, scope, target_index in _worktree_add_args(
        tokens, cmd_pos, seg_of, scope_of
    ):
        variables = _static_shell_variables_before(
            tokens, cmd_pos, seg_of, seg
        )
        hit_seg = seg
        if len(scope) == 1 and scope[0] in exposed_scope_keys:
            outer_seg, sub_index = exposed_scope_keys[scope[0]]
            hit_seg = _nested_segment(
                outer_seg, sub_index, max(0, seg - outer_seg)
            )
        if in_temp_class(raw):
            hits.append(("git worktree add", raw, hit_seg))
            continue
        try:
            anchor = _worktree_anchor(
                tokens,
                cmd_pos,
                seg_of,
                scope_of,
                seg,
                scope,
                _initial_cwd,
                variables,
            )
            resolved = resolve_targets(
                raw,
                anchor,
                variables,
                tokens=tokens,
                cmd_pos=cmd_pos,
                seg_of=seg_of,
                scope_of=scope_of,
                target_index=target_index,
            )
        except Unresolvable:
            if _literal_prefix_class(
                raw,
                None,
                variables=variables,
                tokens=tokens,
                scope_of=scope_of,
                target_index=target_index,
            ) == "temp":
                hits.append(("git worktree add", raw, hit_seg))
            # Rule 2 refuses with the specific resolution failure. Rule 1
            # only denies a path it can prove belongs to the temp class.
            continue
        temp_target = next(
            (candidate for candidate in resolved if in_temp_class(candidate)),
            None,
        )
        if temp_target is not None:
            hits.append(("git worktree add", temp_target, hit_seg))
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
                # authoritative for this exposed occurrence. Preserve its
                # path classification while promoting it to the full nested
                # identity discovered by recursion.
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


def find_temp_targets(tool_name, tool_input):
    """Return [(verb, path, segment)] of temp-class write targets for this tool
    call. Raises ValueError on malformed payload shapes (-> fail CLOSED)."""
    if not isinstance(tool_input, dict):
        raise ValueError(f"tool_input for {tool_name} is not a dict")

    if tool_name in GUARDED_FILE_TOOLS:
        path = tool_input.get("file_path") or tool_input.get("notebook_path")
        if not isinstance(path, str) or not path:
            # A guarded file tool with no path is a schema glitch — falling
            # through as "" would recreate the S04 validation-error-then-
            # allow path (Codex P2 round 7).
            raise ValueError(f"{tool_name} payload missing file_path")
        if in_temp_class(path):
            return [(tool_name, path, 0)]
        return []

    if tool_name == "Bash":
        command = tool_input.get("command", "")
        if not isinstance(command, str):
            raise ValueError("Bash command is not a string")
        return _bash_temp_targets(command)

    if tool_name == APPLY_PATCH_TOOL:
        return _apply_patch_temp_targets(tool_input)

    return []


def _apply_patch_temp_targets(tool_input, cwd=None):
    """Temp-class targets named inside a Codex apply_patch envelope.

    Codex reports every file edit as `apply_patch` with the envelope in
    `tool_input.command` (developers.openai.com/codex/hooks, "Tool coverage"),
    so the paths this guard has to judge are the `*** Add File:` /
    `*** Update File:` / `*** Move to:` headers rather than a `file_path` key.

    A relative header is joined onto the payload `cwd` when the payload
    supplies a usable absolute one. When it does not, the literal is judged as
    written — which leaves relative-path-from-a-temp-cwd uncaught, the same
    already-documented residual the Bash path has."""
    command = tool_input.get("command")
    if not isinstance(command, str):
        # Same fail-closed reasoning as the Bash and file-tool payload checks:
        # an unreadable envelope must not fall through as "no targets".
        raise ValueError("apply_patch command is not a string")
    if cwd is None:
        cwd = tool_input.get("cwd")
    base = cwd if isinstance(cwd, str) and os.path.isabs(cwd) else None
    hits = []
    for match in _APPLY_PATCH_TARGET_RE.finditer(command):
        verb, path = match.group(1), match.group(2)
        if not path:
            continue
        candidate = path
        if base and not os.path.isabs(os.path.expanduser(candidate)):
            candidate = os.path.join(base, candidate)
        if in_temp_class(candidate):
            hits.append((f"apply_patch {verb}", candidate, 0))
    return hits


# ── Rule 2: worktree location convention ─────────────────────────────────────


def _segment_operator_before(tokens, seg_of, segment):
    """Return the shell-list operator immediately before a non-empty segment."""
    words = [
        i
        for i, token_segment in enumerate(seg_of)
        if token_segment == segment and not _is_separator(tokens, i)
    ]
    if not words:
        return None
    parts = []
    index = words[0] - 1
    while index >= 0 and _is_separator(tokens, index):
        parts.append(tokens[index])
        index -= 1
    return "".join(reversed(parts)) or None


def _segment_operator_after(tokens, seg_of, segment):
    """Return the shell-list operator immediately after a non-empty segment."""
    words = [
        i
        for i, token_segment in enumerate(seg_of)
        if token_segment == segment and not _is_separator(tokens, i)
    ]
    if not words:
        return None
    parts = []
    index = words[-1] + 1
    while index < len(tokens) and _is_separator(tokens, index):
        parts.append(tokens[index])
        index += 1
    return "".join(parts) or None


def _chain_status_after(operator, prior_status, command_status):
    """Abstract Bash AND/OR-list status: True, False, or statically unknown."""
    if operator == "&&":
        if prior_status is False:
            return False
        if prior_status is True:
            return command_status
        return False if command_status is False else None
    if operator == "||":
        if prior_status is True:
            return True
        if prior_status is False:
            return command_status
        return True if command_status is True else None
    return command_status


def _static_shell_variables_before(tokens, cmd_pos, seg_of, target_segment):
    """Known assignment-only/export state visible to `target_segment`."""
    return _static_shell_variable_state_before(
        tokens, cmd_pos, seg_of, target_segment
    )[0]


def _static_shell_variable_state_before(
    tokens, cmd_pos, seg_of, target_segment
):
    """Return (values, literal_prefixes) visible to `target_segment`.

    `values[name]` is the fully-static value, `""` when the variable is
    knowably unset, or None when the hook cannot know it. `prefixes[name]`
    exists only for that last case and carries the literal head every value
    the variable can hold must start with — `P=/private/tmp/x_$$.txt` yields
    `/private/tmp/x_`, which is still enough to prove the temp class.
    """
    # Assignment prefixes on the target command are excluded: Bash expands
    # that command's arguments and redirects against the previous environment
    # before applying its command-local assignments.
    variables = {}
    prefixes = {}

    def track(name, value, resolved):
        """Record a value and, when it is unknown, its provable literal head."""
        if resolved is None:
            literal, found_dynamic = _literal_prefix_scan(
                value, variables, prefixes
            )
            if found_dynamic and literal:
                prefixes[name] = literal
            else:
                prefixes.pop(name, None)
        else:
            prefixes.pop(name, None)
        variables[name] = resolved

    chain_status = None
    for segment in range(target_segment):
        indices = [
            i
            for i, token_segment in enumerate(seg_of)
            if token_segment == segment and not _is_separator(tokens, i)
        ]
        if not indices:
            continue
        assignments = [i for i in indices if _ASSIGNMENT_RE.match(tokens[i])]
        command_words = [
            i
            for i in indices
            if cmd_pos[i] and not _ASSIGNMENT_RE.match(tokens[i])
        ]
        assignment_only = bool(assignments) and all(
            _ASSIGNMENT_RE.match(tokens[i]) for i in indices
        )
        operator = _segment_operator_before(tokens, seg_of, segment)
        operator_after = _segment_operator_after(tokens, seg_of, segment)
        if operator == "&&":
            executes = chain_status
        elif operator == "||":
            executes = None if chain_status is None else not chain_status
        elif operator in {"|", "&"}:
            executes = None
        else:
            executes = True

        command_name = (
            os.path.basename(tokens[command_words[0]]).lower()
            if command_words
            else ""
        )
        exported = command_name in {"export", "readonly", "declare", "typeset"}
        unset = command_name == "unset"
        if assignment_only or exported or unset:
            command_status = True
        elif command_name in {"true", ":"}:
            command_status = True
        elif command_name == "false":
            command_status = False
        else:
            command_status = None

        target_requires_state_change = executes is None and (
            operator == "&&"
            and _success_chain_reaches(tokens, seg_of, segment, target_segment)
        )
        state_execution = True if target_requires_state_change else executes
        state_is_parent_local = operator not in {"|", "&"} and operator_after not in {
            "|", "&"
        }

        if unset:
            names = [
                tokens[i]
                for i in indices
                if i > command_words[0]
                and re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", tokens[i])
            ]
            if state_is_parent_local and state_execution is not False:
                for name in names:
                    variables[name] = ""
                    prefixes.pop(name, None)
        elif (assignment_only or exported) and state_is_parent_local:
            if state_execution is None:
                for index in assignments:
                    name, _value = tokens[index].split("=", 1)
                    # The assignment may not have run at all, so the variable
                    # may still hold whatever it held before — no head to
                    # claim, not even a partial one.
                    variables[name] = None
                    prefixes.pop(name, None)
            elif state_execution is True:
                for index in assignments:
                    name, value = tokens[index].split("=", 1)
                    static_shape = _SIMPLE_VAR_RE.sub("", value)
                    if any(
                        marker in static_shape
                        for marker in ("$", "`", "*", "?", "[", "{")
                    ):
                        track(name, value, None)
                        continue
                    unresolved = False

                    def expand_assignment_reference(match):
                        nonlocal unresolved
                        reference = match.group(1) or match.group(2)
                        if reference in variables:
                            referenced_value = variables[reference]
                            if referenced_value is not None:
                                return referenced_value
                            unresolved = True
                            return ""
                        environment_value = os.environ.get(reference)
                        if environment_value is not None:
                            return environment_value
                        unresolved = True
                        return ""

                    expanded = _SIMPLE_VAR_RE.sub(
                        expand_assignment_reference, value
                    )
                    track(name, value, None if unresolved else expanded)

        chain_status = _chain_status_after(
            operator, chain_status, command_status
        )
    return variables, prefixes


_MAX_STATIC_VALUES = 256


def _bounded_brace_values(raw):
    """Expand finite Bash brace alternatives/sequences, or raise if unbounded.

    This intentionally models only value sets whose complete membership is
    visible in the command. Ordinary globs stay unresolvable.
    """
    opening = None
    depth = 0
    for index, char in enumerate(raw):
        if char == "{" and (index == 0 or raw[index - 1] != "$"):
            if depth == 0:
                opening = index
            depth += 1
        elif char == "}" and depth:
            depth -= 1
            if depth:
                continue
            inner = raw[opening + 1:index]
            parts = []
            start = 0
            nested = 0
            for part_index, part_char in enumerate(inner):
                if part_char == "{":
                    nested += 1
                elif part_char == "}":
                    nested -= 1
                elif part_char == "," and nested == 0:
                    parts.append(inner[start:part_index])
                    start = part_index + 1
            if parts:
                parts.append(inner[start:])
            else:
                sequence = re.fullmatch(
                    r"(-?[0-9]+|[A-Za-z])\.\.(-?[0-9]+|[A-Za-z])"
                    r"(?:\.\.(-?[0-9]+))?",
                    inner,
                )
                if sequence:
                    first, last, raw_step = sequence.groups()
                    if first.lstrip("-").isdigit() != last.lstrip("-").isdigit():
                        raise Unresolvable("the brace sequence mixes value types")
                    numeric = first.lstrip("-").isdigit()
                    begin = int(first) if numeric else ord(first)
                    end = int(last) if numeric else ord(last)
                    step = int(raw_step) if raw_step is not None else 1
                    if step == 0:
                        raise Unresolvable("the brace sequence has a zero step")
                    step = abs(step) if end >= begin else -abs(step)
                    stop = end + (1 if step > 0 else -1)
                    sequence_values = list(range(begin, stop, step))
                    if len(sequence_values) > _MAX_STATIC_VALUES:
                        raise Unresolvable("the brace sequence exceeds the static-value limit")
                    parts = [
                        str(value) if numeric else chr(value)
                        for value in sequence_values
                    ]
                else:
                    continue
            expanded = []
            for part in parts:
                for suffix in _bounded_brace_values(raw[index + 1:]):
                    for middle in _bounded_brace_values(part):
                        expanded.append(raw[:opening] + middle + suffix)
                        if len(expanded) > _MAX_STATIC_VALUES:
                            raise Unresolvable(
                                "the brace expansion exceeds the static-value limit"
                            )
            return tuple(dict.fromkeys(expanded))
    if depth:
        raise Unresolvable("the target has an unmatched brace expansion")
    return (raw,)


def _bounded_word_values(raw, variables=None, value_sets=None):
    """Return every statically-known shell value for one word."""
    if _QUOTED_LBRACE in raw or _QUOTED_RBRACE in raw:
        raise Unresolvable("the target contains quoted brace characters")
    if "$(" in raw or "`" in raw:
        raise Unresolvable("the target contains a command substitution")
    values = [""]
    index = 0
    while index < len(raw):
        if raw[index] != "$":
            values = [value + raw[index] for value in values]
            index += 1
            continue
        match = _SIMPLE_VAR_RE.match(raw, index)
        if not match:
            raise Unresolvable(
                f"unsupported shell expansion near {raw[index:index + 12]!r}"
            )
        name = match.group(1) or match.group(2)
        candidates = None
        has_bounded_set = value_sets is not None and name in value_sets
        if has_bounded_set:
            candidates = value_sets[name]
            if candidates is None:
                raise Unresolvable(f"${name} has an unbounded value set")
        if not has_bounded_set and variables is not None and name in variables:
            scalar = variables[name]
            if scalar is None:
                raise Unresolvable(f"${name} has conditionally unknown state")
            candidates = (scalar,)
        if not has_bounded_set and candidates is None:
            environment_value = os.environ.get(name)
            if environment_value is not None:
                candidates = (environment_value,)
        if candidates is None:
            raise Unresolvable(f"${name} is not set in the hook environment")
        values = [prefix + candidate for prefix in values for candidate in candidates]
        if len(values) > _MAX_STATIC_VALUES:
            raise Unresolvable("the variable expansion exceeds the static-value limit")
        index = match.end()

    expanded = []
    for value in values:
        expanded.extend(_bounded_brace_values(value))
        if len(expanded) > _MAX_STATIC_VALUES:
            raise Unresolvable("the static value set exceeds the safety limit")
    if any(any(marker in value for marker in ("*", "?", "[")) for value in expanded):
        raise Unresolvable("the target contains a glob expansion")
    return tuple(dict.fromkeys(expanded))


def _assignment_is_inside_control_compound(
    tokens, cmd_pos, first_index, assignment_index
):
    """True when an assignment is guarded by a nested shell compound.

    The enclosing loop/case binding ends at ``first_index``.  Only compounds
    opened after that point can make a later assignment conditional; commands
    that precede a straight-line assignment must not weaken it.
    """
    close_for = {
        "if": "fi",
        "case": "esac",
        "for": "done",
        "select": "done",
        "while": "done",
        "until": "done",
    }

    def group_runs_out_of_parent(opening_index, opener):
        closer = {"{": "}", "(": ")"}[opener]
        depth = 1
        for index in range(opening_index + 1, len(tokens)):
            if tokens[index] == opener:
                depth += 1
            elif tokens[index] == closer:
                depth -= 1
                if depth == 0:
                    return (
                        index + 1 < len(tokens)
                        and tokens[index + 1] in {"|", "&"}
                    )
        return True

    stack = []
    at_command_start = True
    pending_operator = None
    for index in range(first_index + 1, assignment_index):
        token = tokens[index]
        if token in {"\n", ";", "&&", "||", "|", "&"}:
            at_command_start = True
            pending_operator = token
            continue
        if token in {"{", "("} and at_command_start:
            stack.append(
                (
                    {"{": "}", "(": ")"}[token],
                    token == "("
                    or pending_operator in {"&&", "||", "|", "&"}
                    or group_runs_out_of_parent(index, token),
                )
            )
            pending_operator = None
            continue
        if token in {"then", "else", "elif", "do"}:
            at_command_start = True
            pending_operator = None
            continue
        if token == ")" and stack and stack[-1][0] == "esac":
            at_command_start = True
            pending_operator = None
            continue
        if (
            stack
            and token == stack[-1][0]
            and token != ")"
            and (
                cmd_pos[index]
                or (
                    token == "esac"
                    and index > 0
                    and _is_separator(tokens, index - 1)
                )
            )
        ):
            stack.pop()
            at_command_start = False
            pending_operator = None
            continue
        if at_command_start and token in close_for:
            stack.append((close_for[token], True))
            at_command_start = True
            pending_operator = None
            continue
        at_command_start = False
        pending_operator = None
    return any(conditional for _closer, conditional in stack)


def _assignment_effects_between(
    tokens, cmd_pos, seg_of, name, first_index, target_index
):
    """Return ordered `(guaranteed, raw_value)` assignment effects."""
    effects = []
    accepted_assignment_indices = set()
    for segment in range(seg_of[first_index], seg_of[target_index] + 1):
        indices = [
            index
            for index, token_segment in enumerate(seg_of)
            if token_segment == segment
            and first_index < index < target_index
            and not _is_separator(tokens, index)
        ]
        if not indices:
            continue
        assignments = [
            index
            for index in indices
            if _ASSIGNMENT_RE.match(tokens[index])
            and tokens[index].split("=", 1)[0] == name
        ]
        if not assignments:
            continue
        command_words = [
            index
            for index in indices
            if cmd_pos[index] and not _ASSIGNMENT_RE.match(tokens[index])
        ]
        assignment_only = all(_ASSIGNMENT_RE.match(tokens[index]) for index in indices)
        declaration = bool(command_words) and os.path.basename(
            tokens[command_words[0]]
        ) in {"local", "declare", "typeset", "export", "readonly"}
        operator_before = _segment_operator_before(tokens, seg_of, segment)
        operator_after = _segment_operator_after(tokens, seg_of, segment)
        preceding = [
            index
            for index in indices
            if index < assignments[0]
            and index not in accepted_assignment_indices
        ]
        declaration_prefix = declaration and all(
            tokens[index]
            in {"local", "declare", "typeset", "export", "readonly"}
            or tokens[index].startswith("-")
            for index in preceding
        )
        conditional = (
            not (assignment_only or declaration)
            or
            (preceding and not declaration_prefix)
            or _assignment_is_inside_control_compound(
                tokens, cmd_pos, first_index, assignments[0]
            )
            or (
                segment != seg_of[first_index]
                and operator_before in {"&&", "||", "|", "&"}
            )
            or operator_after in {"|", "&"}
        )
        accepted_assignment_indices.update(assignments)
        effects.append(
            (
                not conditional,
                tokens[assignments[-1]].split("=", 1)[1],
            )
        )
    return effects


def _literal_array_values_before(
    tokens, cmd_pos, before_index, variables, value_sets
):
    """Return bounded values from preceding `name=(literal words...)` forms."""
    arrays = {}
    index = 0
    while index + 1 < before_index:
        mutation = re.fullmatch(
            r"([A-Za-z_][A-Za-z0-9_]*)\[[^]]+\](?:\+)?=.*",
            tokens[index],
        )
        if mutation and cmd_pos[index]:
            arrays[mutation.group(1)] = None
            index += 1
            continue
        assignment = re.fullmatch(
            r"([A-Za-z_][A-Za-z0-9_]*)=", tokens[index]
        )
        if not assignment or not cmd_pos[index] or tokens[index + 1] != "(":
            index += 1
            continue
        depth = 1
        close = index + 2
        while close < before_index and depth:
            if tokens[close] == "(":
                depth += 1
            elif tokens[close] == ")":
                depth -= 1
            close += 1
        name = assignment.group(1)
        if depth:
            arrays[name] = None
            break
        values = []
        try:
            for word_index in range(index + 2, close - 1):
                if _is_separator(tokens, word_index):
                    continue
                values.extend(
                    _bounded_word_values(
                        tokens[word_index], variables, value_sets
                    )
                )
                if len(values) > _MAX_STATIC_VALUES:
                    raise Unresolvable(
                        "the array value set exceeds the static-value limit"
                    )
        except Unresolvable:
            arrays[name] = None
        else:
            arrays[name] = tuple(dict.fromkeys(values))
        index = close
    return arrays


def _bounded_compound_value_sets_before(
    tokens, cmd_pos, seg_of, scope_of, target_index, variables
):
    """Values guaranteed by enclosing literal `for`/`select` and `case` arms."""
    target_scope = scope_of[target_index]
    value_sets = {}

    # Literal loop lists. Active headers are processed outer-to-inner so an
    # inner list can compose an outer loop variable.
    loop_stack = []
    for index in range(target_index):
        token = tokens[index]
        if (
            token in {"for", "select", "while", "until"}
            and cmd_pos[index]
            and scope_of[index] == target_scope
        ):
            loop_stack.append(
                {
                    "type": token,
                    "start": index,
                    "state": "header",
                    "do": None,
                }
            )
            continue
        if token == "do" and loop_stack and loop_stack[-1]["state"] == "header":
            loop = loop_stack[-1]
            loop["state"] = "body"
            loop["do"] = index
            if loop["type"] not in {"for", "select"}:
                continue
            name_index = loop["start"] + 1
            if name_index >= index or not re.fullmatch(
                r"[A-Za-z_][A-Za-z0-9_]*", tokens[name_index]
            ):
                continue
            name = tokens[name_index]
            in_index = next(
                (
                    candidate
                    for candidate in range(name_index + 1, index)
                    if tokens[candidate] == "in"
                ),
                None,
            )
            if in_index is None:
                value_sets[name] = None
                continue
            header_variables = _static_shell_variables_before(
                tokens, cmd_pos, seg_of, seg_of[loop["start"]]
            )
            literal_arrays = _literal_array_values_before(
                tokens,
                cmd_pos,
                loop["start"],
                header_variables,
                value_sets,
            )
            loop_values = []
            try:
                word_index = in_index + 1
                while word_index < index:
                    if _is_separator(tokens, word_index):
                        word_index += 1
                        continue
                    word = tokens[word_index]
                    if (
                        _is_command_sub_open(word)
                        and word_index + 2 < index
                        and tokens[word_index + 1] in {"false", "true"}
                        and _is_command_sub_close(tokens[word_index + 2])
                    ):
                        word_index += 3
                        continue
                    array_reference = re.fullmatch(
                        r"\$\{([A-Za-z_][A-Za-z0-9_]*)\[(@|\*|[0-9]+)\]\}",
                        word,
                    )
                    if array_reference:
                        array_values = literal_arrays.get(array_reference.group(1))
                        if array_values is None:
                            raise Unresolvable(
                                f"${array_reference.group(1)} has no bounded literal array"
                            )
                        selector = array_reference.group(2)
                        if selector in {"@", "*"}:
                            loop_values.extend(array_values)
                        else:
                            selected = int(selector)
                            if selected < len(array_values):
                                loop_values.append(array_values[selected])
                    else:
                        loop_values.extend(
                            _bounded_word_values(
                                word, header_variables, value_sets
                            )
                        )
                    if len(loop_values) > _MAX_STATIC_VALUES:
                        raise Unresolvable(
                            "the loop value set exceeds the static-value limit"
                        )
                    word_index += 1
            except Unresolvable:
                value_sets[name] = None
            else:
                value_sets[name] = tuple(dict.fromkeys(loop_values))
            continue
        if token == "done" and loop_stack:
            completed = loop_stack.pop()
            if completed["type"] in {"for", "select"}:
                name_index = completed["start"] + 1
                if name_index < len(tokens):
                    value_sets.pop(tokens[name_index], None)

    # Literal case alternatives constrain a variable subject exactly while
    # that arm executes. Fallthrough arms remain unbounded.
    case_stack = []
    index = 0
    while index < target_index:
        token = tokens[index]
        if (
            token == "case"
            and cmd_pos[index]
            and scope_of[index] == target_scope
        ):
            subject = tokens[index + 1] if index + 1 < target_index else ""
            subject_match = re.fullmatch(
                r"\$([A-Za-z_][A-Za-z0-9_]*)|\$\{([A-Za-z_][A-Za-z0-9_]*)\}",
                subject,
            )
            case_stack.append(
                {
                    "state": "await-in",
                    "name": (
                        (subject_match.group(1) or subject_match.group(2))
                        if subject_match
                        else None
                    ),
                    "patterns": [],
                    "fallthrough": False,
                    "body_start": None,
                    "body_index": None,
                }
            )
            index += 1
            continue
        if case_stack:
            case = case_stack[-1]
            if case["state"] == "await-in":
                if token == "in":
                    case["state"] = "pattern"
                index += 1
                continue
            if case["state"] == "pattern":
                if token == ")":
                    case["state"] = "body"
                    case["body_start"] = seg_of[index]
                    case["body_index"] = index
                    patterns = case["patterns"]
                    bounded = bool(patterns) and not case["fallthrough"] and all(
                        not any(marker in pattern for marker in ("$", "`", "*", "?", "[", "{"))
                        for pattern in patterns
                    )
                    if case["name"] and bounded:
                        current = value_sets.get(case["name"])
                        candidates = tuple(dict.fromkeys(patterns))
                        if current:
                            candidates = tuple(
                                value for value in current if value in candidates
                            )
                        value_sets[case["name"]] = candidates or None
                    elif case["name"]:
                        value_sets[case["name"]] = None
                elif token != "|" and not _is_separator(tokens, index):
                    case["patterns"].append(token)
                index += 1
                continue
            terminator = None
            width = 0
            if tokens[index:index + 3] == [";", ";", "&"]:
                terminator, width = ";;&", 3
            elif tokens[index:index + 2] == [";", ";"]:
                terminator, width = ";;", 2
            elif tokens[index:index + 2] == [";", "&"]:
                terminator, width = ";&", 2
            if terminator:
                if case["name"]:
                    value_sets.pop(case["name"], None)
                case.update(
                    state="pattern",
                    patterns=[],
                    fallthrough=terminator != ";;",
                    body_start=None,
                    body_index=None,
                )
                index += width
                continue
            if token == "esac":
                completed = case_stack.pop()
                if completed["name"]:
                    value_sets.pop(completed["name"], None)
                index += 1
                continue
        index += 1

    # A later explicit parent-shell assignment wins over a loop/case binding.
    for name in list(value_sets):
        first_index = 0
        for loop in loop_stack:
            name_index = loop["start"] + 1
            if name_index < len(tokens) and tokens[name_index] == name:
                first_index = loop["do"]
        for case in case_stack:
            if case["name"] == name and case["body_index"] is not None:
                first_index = case["body_index"]
        effects = _assignment_effects_between(
            tokens, cmd_pos, seg_of, name, first_index, target_index
        )
        for guaranteed, raw_value in effects:
            prior_sets = dict(value_sets)
            prior_sets.pop(name, None)
            try:
                assigned_values = _bounded_word_values(
                    raw_value, variables, prior_sets
                )
            except Unresolvable:
                value_sets[name] = None
                continue
            if guaranteed:
                value_sets[name] = assigned_values
            else:
                existing = value_sets[name]
                value_sets[name] = (
                    None
                    if existing is None
                    else tuple(dict.fromkeys((*existing, *assigned_values)))
                )
    return value_sets


def _enclosing_loop_changes_cwd(
    tokens, cmd_pos, scope_of, target_index
):
    """Whether an enclosing loop can carry a cwd change into another pass."""
    target_scope = scope_of[target_index]
    stack = []
    ranges = []
    for index, token in enumerate(tokens):
        if (
            token in {"for", "select", "while", "until"}
            and cmd_pos[index]
            and scope_of[index] == target_scope
        ):
            stack.append({"do": None})
        elif token == "do" and stack and stack[-1]["do"] is None:
            stack[-1]["do"] = index
        elif token == "done" and stack:
            loop = stack.pop()
            if loop["do"] is not None:
                ranges.append((loop["do"], index))

    for body_start, body_end in ranges:
        if not (body_start < target_index < body_end):
            continue
        if any(
            os.path.basename(tokens[index]) in _CWD_CHANGING_CMDS
            and cmd_pos[index]
            and _scope_affects_target(scope_of[index], target_scope)
            for index in range(body_start + 1, body_end)
        ):
            return True
    return False


def resolve_targets(
    raw,
    anchor=None,
    variables=None,
    *,
    tokens=None,
    cmd_pos=None,
    seg_of=None,
    scope_of=None,
    target_index=None,
):
    """Resolve every bounded value a shell target can produce."""
    value_sets = None
    if (
        tokens is not None
        and cmd_pos is not None
        and seg_of is not None
        and scope_of is not None
        and target_index is not None
    ):
        value_sets = _bounded_compound_value_sets_before(
            tokens, cmd_pos, seg_of, scope_of, target_index, variables or {}
        )
    raw_values = _bounded_word_values(raw, variables, value_sets)
    if (
        tokens is not None
        and cmd_pos is not None
        and scope_of is not None
        and target_index is not None
        and any(not os.path.isabs(value) for value in raw_values)
        and _enclosing_loop_changes_cwd(
            tokens, cmd_pos, scope_of, target_index
        )
    ):
        raise Unresolvable(
            "an enclosing loop can change cwd between target evaluations"
        )
    return tuple(
        dict.fromkeys(resolve_target(value, anchor, variables) for value in raw_values)
    )


def resolve_target(raw, anchor=None, variables=None):
    """Expand `raw` into an absolute path, or raise Unresolvable with a reason.

    Only statically-safe expansions are performed: `~`, `$NAME`/`${NAME}` that
    are actually set in the hook's environment, and joining of a relative path
    to an already-resolved absolute anchor. Everything else is refused
    (golems#676)."""
    s = raw.strip()
    if not s:
        raise Unresolvable("empty target")
    if _QUOTED_LBRACE in s or _QUOTED_RBRACE in s:
        raise Unresolvable("the target contains quoted brace characters")
    if "$(" in s or "`" in s:
        raise Unresolvable("the target contains a command substitution")
    out = []
    i = 0
    while i < len(s):
        if s[i] != "$":
            out.append(s[i])
            i += 1
            continue
        m = _SIMPLE_VAR_RE.match(s, i)
        if not m:
            raise Unresolvable(f"unsupported shell expansion near {s[i:i + 12]!r}")
        name = m.group(1) or m.group(2)
        if variables is not None and name in variables:
            value = variables[name]
            if value is None:
                raise Unresolvable(f"${name} has conditionally unknown state")
        else:
            value = os.environ.get(name)
            if not value:
                raise Unresolvable(f"${name} is not set in the hook environment")
        if value is None:
            raise Unresolvable(f"${name} is not set in the hook environment")
        out.append(value)
        i = m.end()
    expanded = "".join(out)
    if any(ch in expanded for ch in ("*", "?", "{", "[")):
        raise Unresolvable("the target contains a glob or brace expansion")
    expanded = os.path.expanduser(expanded)
    if not os.path.isabs(expanded):
        if anchor is None:
            raise Unresolvable("the relative path has no statically-resolvable anchor")
        expanded = os.path.join(anchor, expanded)
    return os.path.abspath(os.path.normpath(expanded))


def _segment_indices(seg_of, segment):
    """Token indices belonging to one parsed simple-command segment."""
    return [i for i, seg in enumerate(seg_of) if seg == segment]


def _process_substitution_parens(tokens):
    """Parenthesis indices belonging to `<(...)` / `>(...)`, not subshells."""
    indices = set()
    stack = []
    for i, token in enumerate(tokens):
        if token == "(":
            stack.append((i, i > 0 and tokens[i - 1] in ("<", ">")))
        elif token == ")" and stack:
            opened, process_substitution = stack.pop()
            if process_substitution:
                indices.update((opened, i))
    return indices


def _case_pattern_parens(tokens):
    """Parentheses that terminate literal case patterns, not subshells."""
    indices = set()
    stack = []
    index = 0
    while index < len(tokens):
        token = tokens[index]
        if token == "case":
            stack.append("await-in")
        elif stack and stack[-1] == "await-in" and token == "in":
            stack[-1] = "pattern"
        elif stack and stack[-1] == "pattern" and token == ")":
            indices.add(index)
            stack[-1] = "body"
        elif stack and stack[-1] == "body":
            if tokens[index:index + 2] == [";", ";"]:
                stack[-1] = "pattern"
                index += 1
            elif token == "esac":
                stack.pop()
        index += 1
    return indices


def _literal_array_parens(tokens):
    """Parentheses delimiting a literal shell array assignment."""
    indices = set()
    for opener in range(1, len(tokens)):
        if tokens[opener] != "(" or not re.fullmatch(
            r"[A-Za-z_][A-Za-z0-9_]*=", tokens[opener - 1]
        ):
            continue
        depth = 1
        for closer in range(opener + 1, len(tokens)):
            if tokens[closer] == "(":
                depth += 1
            elif tokens[closer] == ")":
                depth -= 1
                if depth == 0:
                    indices.update((opener, closer))
                    break
    return indices


def _bounded_loop_subshell_anchor(
    tokens,
    cmd_pos,
    seg_of,
    scope_of,
    target_index,
    raw,
    initial_cwd,
    variables,
):
    """Prove the cwd for the lane's immediate bounded-loop subshell form."""
    function_parens = _function_signature_parens(tokens)
    process_parens = _process_substitution_parens(tokens)
    case_parens = _case_pattern_parens(tokens)
    array_parens = _literal_array_parens(tokens)
    stack = []
    opener = None
    for index, token in enumerate(tokens):
        if index > target_index:
            break
        if (
            token == "("
            and index not in function_parens
            and index not in process_parens
            and index not in case_parens
            and index not in array_parens
        ):
            stack.append(index)
        elif (
            token == ")"
            and index not in function_parens
            and index not in process_parens
            and index not in case_parens
            and index not in array_parens
            and stack
        ):
            stack.pop()
    if stack:
        opener = stack[-1]
    if opener is None:
        return None

    do_index = next(
        (index for index in range(opener - 1, -1, -1) if tokens[index] == "do"),
        None,
    )
    if do_index is None or any(
        not _is_separator(tokens, index)
        for index in range(do_index + 1, opener)
    ):
        return None
    if any(tokens[index] == "done" for index in range(do_index + 1, target_index)):
        return None

    allowed_before = {"for", "select", "while", "until", "done"}
    if any(
        cmd_pos[index]
        and tokens[index] not in allowed_before
        and not _ASSIGNMENT_RE.match(tokens[index])
        for index in range(opener)
    ):
        return None

    value_sets = _bounded_compound_value_sets_before(
        tokens, cmd_pos, seg_of, scope_of, target_index, variables
    )
    referenced = {
        match.group(1) or match.group(2)
        for match in _SIMPLE_VAR_RE.finditer(raw)
    }
    if not referenced or any(
        name not in value_sets or value_sets[name] is None
        for name in referenced
    ):
        return None
    return initial_cwd


def _success_chain_reaches(tokens, seg_of, segment, target_segment):
    """True when every command boundary through the target is `&&`.

    A cwd change after `&&` is a valid anchor when the eventual worktree add
    is gated by the same success chain: the add cannot run unless the cd did.
    A `;`, pipeline, or background boundary breaks that guarantee.
    """
    current = _segment_indices(seg_of, segment)
    target = _segment_indices(seg_of, target_segment)
    if not current or not target:
        return False
    current_words = [i for i in current if not _is_separator(tokens, i)]
    target_words = [i for i in target if not _is_separator(tokens, i)]
    if not current_words or not target_words:
        return False
    i = current_words[-1] + 1
    while i < target_words[0]:
        if tokens[i:i + 2] == ["&", "&"]:
            i += 2
            continue
        if _is_separator(tokens, i):
            return False
        i += 1
    return True


def _scope_affects_target(command_scope, target_scope):
    """A parent or matching substitution scope can affect the target cwd."""
    return (
        len(command_scope) <= len(target_scope)
        and target_scope[:len(command_scope)] == command_scope
    )


def _cwd_argument(
    tokens, cmd_pos, seg_of, scope_of, segment, target_segment, target_scope
):
    """Return the path argument for a cwd-changing command in `segment`.

    `popd`/`chdir`, missing arguments, and multiple cwd-changing commands are
    deliberately unresolvable rather than guessed."""
    found = []
    indices = _segment_indices(seg_of, segment)
    for pos, i in enumerate(indices):
        base = tokens[i].rsplit("/", 1)[-1]
        if (
            base not in _CWD_CHANGING_CMDS
            or not cmd_pos[i]
            or not _scope_affects_target(scope_of[i], target_scope)
        ):
            continue
        if base not in ("cd", "pushd"):
            raise Unresolvable(f"{base} does not expose a static directory argument")
        segment_start = indices[0]
        if segment_start > 0 and tokens[segment_start - 1] == "|":
            raise Unresolvable(f"{base} runs conditionally or in a pipeline")
        if (
            segment_start > 1
            and tokens[segment_start - 2:segment_start] == ["&", "&"]
            and not _success_chain_reaches(tokens, seg_of, segment, target_segment)
        ):
            raise Unresolvable(f"{base} runs conditionally after &&")
        arg = None
        for j in indices[pos + 1:]:
            if tokens[j].startswith("-"):
                continue
            arg = tokens[j]
            break
        if arg is None:
            raise Unresolvable(f"{base} has no static directory argument")
        found.append(arg)
    if len(found) > 1:
        raise Unresolvable("multiple cwd changes in one command segment")
    return found[0] if found else None


def _shell_anchor_before(
    tokens,
    cmd_pos,
    seg_of,
    scope_of,
    target_segment,
    target_scope,
    initial_cwd=None,
    variables=None,
):
    """Resolve shell cwd changes that precede `target_segment`, in order."""
    function_parens = _function_signature_parens(tokens)
    process_substitution_parens = _process_substitution_parens(tokens)
    case_pattern_parens = _case_pattern_parens(tokens)
    literal_array_parens = _literal_array_parens(tokens)
    has_parentheses = any(
        tok in ("(", ")")
        and i not in function_parens
        and i not in process_substitution_parens
        and i not in case_pattern_parens
        and i not in literal_array_parens
        and seg_of[i] <= target_segment
        and _scope_affects_target(scope_of[i], target_scope)
        for i, tok in enumerate(tokens)
    )
    if has_parentheses:
        raise Unresolvable("subshell cwd changes cannot anchor the parent shell")
    anchor = initial_cwd
    pending_error = None
    for segment in range(target_segment):
        try:
            raw = _cwd_argument(
                tokens,
                cmd_pos,
                seg_of,
                scope_of,
                segment,
                target_segment,
                target_scope,
            )
        except Unresolvable as exc:
            anchor = None
            pending_error = exc
            continue
        if raw is None:
            continue
        try:
            anchor = resolve_target(raw, anchor, variables)
            pending_error = None
        except Unresolvable as exc:
            anchor = None
            pending_error = exc
    if anchor is None:
        raise pending_error or Unresolvable("the shell cwd cannot be resolved statically")
    return anchor


def _git_c_values(tokens, cmd_pos, seg_of, scope_of, segment, target_scope):
    """Return every `git -C <dir>` value for the add's own segment."""
    indices = _segment_indices(seg_of, segment)
    git_pos = next(
        (
            pos
            for pos, i in enumerate(indices)
            if (tokens[i] == "git" or tokens[i].endswith("/git"))
            and cmd_pos[i]
            and scope_of[i] == target_scope
        ),
        None,
    )
    if git_pos is None:
        return []
    values = []
    for pos in range(git_pos + 1, len(indices)):
        i = indices[pos]
        if scope_of[i] != target_scope:
            continue
        if tokens[i] == "worktree":
            break
        if tokens[i] != "-C":
            continue
        if pos + 1 >= len(indices) or tokens[indices[pos + 1]] == "worktree":
            raise Unresolvable("git -C has no directory value")
        values.append(tokens[indices[pos + 1]])
    return values


def _worktree_anchor(
    tokens,
    cmd_pos,
    seg_of,
    scope_of,
    segment,
    target_scope,
    initial_cwd=None,
    variables=None,
    raw=None,
    target_index=None,
):
    """Resolve one add's anchor with git-compatible precedence.

    Repeated `git -C` values compose left-to-right. An absolute `-C` resets an
    uncertain earlier `cd`, while a relative first `-C` still needs that shell
    cwd to be statically known."""
    values = _git_c_values(tokens, cmd_pos, seg_of, scope_of, segment, target_scope)
    try:
        anchor = _shell_anchor_before(
            tokens,
            cmd_pos,
            seg_of,
            scope_of,
            segment,
            target_scope,
            initial_cwd,
            variables,
        )
    except Unresolvable:
        anchor = None
    if values:
        for raw in values:
            anchor = resolve_target(raw, anchor, variables)
        return anchor
    if anchor is None and raw is not None and target_index is not None:
        anchor = _bounded_loop_subshell_anchor(
            tokens,
            cmd_pos,
            seg_of,
            scope_of,
            target_index,
            raw,
            initial_cwd,
            variables or {},
        )
    if anchor is None:
        # Re-run to preserve the specific cd/pushd failure in the refusal.
        return _shell_anchor_before(
            tokens,
            cmd_pos,
            seg_of,
            scope_of,
            segment,
            target_scope,
            initial_cwd,
            variables,
        )
    current = [
        i for i in _segment_indices(seg_of, segment) if scope_of[i] == target_scope
    ]
    if any(tokens[i] in ("--work-tree", "--git-dir") for i in current):
        raise Unresolvable("git --work-tree/--git-dir does not expose a safe cwd anchor")
    return anchor


def on_convention(path):
    """True iff the RESOLVED path sits inside a `.worktrees/` directory.

    Both the lexical and the symlink-resolved forms must conform, so a
    `.worktrees` symlink pointing at a sibling `*.wt` dir is not a route-around."""
    candidates = {os.path.normpath(path)}
    try:
        candidates.add(os.path.normpath(os.path.realpath(path)))
    except (OSError, ValueError):
        pass
    for cand in candidates:
        parts = [p for p in cand.split(os.sep) if p]
        if WORKTREE_DIR_NAME not in parts[:-1]:
            return False
    return True


def _nearest_repo_root(start):
    """Walk up from `start` to the nearest directory holding a `.git` entry
    (a file in a linked worktree, a directory in the main checkout)."""
    cur = os.path.abspath(start)
    while True:
        if os.path.exists(os.path.join(cur, ".git")):
            return cur
        parent = os.path.dirname(cur)
        if parent == cur:
            return None
        cur = parent


def _literal_prefix_scan(word, variables=None, variable_prefixes=None):
    """Return (literal_prefix, found_dynamic) for one shell word.

    Walks left to right expanding only constructs whose value the hook can
    know for certain, and stops at the first one it cannot. `found_dynamic`
    distinguishes "the whole word is literal" (no proof needed — the caller
    resolves it outright) from "a literal head, then something unreadable".

    `variable_prefixes` supplies the literal head of a variable whose own
    value is only partially static (`P=~/Documents/x_$$.txt`), so a target
    routed through a variable proves exactly what the same path spelled
    inline proves. Every value that variable can hold starts with that head.
    """
    prefix = []
    i = 0
    found_dynamic = False
    while i < len(word):
        if word[i] != "$":
            if word[i] in "`*?{[":
                found_dynamic = True
                break
            prefix.append(word[i])
            i += 1
            continue
        if word.startswith("$(", i):
            found_dynamic = True
            break
        match = _SIMPLE_VAR_RE.match(word, i)
        if match:
            name = match.group(1) or match.group(2)
            if variables is not None and name in variables:
                value = variables[name]
            else:
                value = os.environ.get(name)
            if value:
                prefix.append(value)
                i = match.end()
                continue
            if value is None and variable_prefixes:
                # Unknown value, known head. An explicitly-unset variable
                # (value == "") is knowably empty and contributes nothing.
                partial = variable_prefixes.get(name)
                if partial:
                    prefix.append(partial)
            found_dynamic = True
            break
        if word.startswith("${", i) or _POSITIONAL_PARAM_RE.match(word, i):
            found_dynamic = True
            break
        found_dynamic = True
        break
    return "".join(prefix), found_dynamic


def _has_literal_parent_component(text):
    """Return whether shell text contains a literal `..` path component."""
    return ".." in [part for part in text.split(os.sep) if part]


def _literal_prefix_class(
    raw, anchor, *, require_worktree=False, variables=None,
    variable_prefixes=None, tokens=None, scope_of=None, target_index=None,
):
    """Return `repo`/`temp`/`outside` when a literal prefix proves a class.

    golems#676 says never block blind. The 2026-08-12 cmuxlayer loop proved
    Rule 2's `.worktrees/$wt` prefix, and the 2026-08-13 live Rule 1 specimen
    (`$D/logs/post-rerun-$(date +%s).log`) proves the same fact for a durable
    repo redirect. A dynamic suffix could theoretically contain `..`; the
    accepted residual remains for suffixes without visible traversal. Literal
    `..` is disqualifying in both the outer word and command-substitution
    bodies, and Rule 1 additionally rejects prefixes in the temp class.
    """
    s = raw.strip()
    if _QUOTED_LBRACE in s or _QUOTED_RBRACE in s:
        return None
    word_text = s
    if tokens is not None and scope_of is not None and target_index is not None:
        word_text = _substitution_word_text(tokens, scope_of, target_index)
    if _has_literal_parent_component(s) or any(
        _has_literal_parent_component(body)
        for body, _outer_seg, _sub_index, _exposed
        in _executable_subcommands(word_text)
    ):
        return None

    # Resolve known simple variables. Stop at the first construct whose value
    # the hook cannot know; every shell-dynamic form follows this one path.
    prefix, found_dynamic = _literal_prefix_scan(
        s, variables, variable_prefixes
    )
    if not found_dynamic or not prefix:
        return None

    # The sentinel represents the first unresolvable construct, preserving
    # `.worktrees` as a non-terminal component after lexical normalization.
    probe = os.path.expanduser(prefix + "__tmp_block_dynamic_suffix__")
    if os.path.isabs(probe):
        probe = os.path.normpath(probe)
        repo = _nearest_repo_root(probe)
    else:
        repo = _nearest_repo_root(anchor) if anchor else None
        if repo is None:
            return None
        probe = os.path.normpath(os.path.join(anchor, probe))
    # `scratchpad` is its own verdict, decided before any of the temp/repo/
    # outside reasoning below. Keeping it independent is deliberate: the
    # `outside` proof and the head-proving machinery are under review
    # (2026-08-17 lead note, the `<repo>$(printf /../../tmp/x)` ask->allow
    # question), and the harness-scratchpad allowlist must not move with
    # whichever way that lands.
    # Only Rule 1 consumes it; worktree-convention callers still require repo
    # membership and get None, exactly as they do for `outside`.
    if is_harness_scratchpad(probe):
        return None if require_worktree else "scratchpad"
    if in_temp_class(probe):
        return "temp"
    if repo is None:
        # An absolute prefix that is provably NOT temp answers Rule 1 in full,
        # even when it belongs to no repository. Returning None here was the
        # 2026-08-14 live defect: `P=~/Documents/blprobe_$$.txt; ... > "$P"`
        # prompted on every run because `~/Documents` is neither temp nor a
        # repo, so a guard that can only prove two classes had to ask about
        # the entire home directory. `outside` is the third proof, and only
        # Rule 1 consumes it — worktree-convention callers still require repo
        # membership and get None as before.
        return None if require_worktree else "outside"
    if require_worktree:
        if not on_convention(probe):
            return None
    real_repo = os.path.normpath(os.path.realpath(repo))
    real_probe = os.path.normpath(os.path.realpath(probe))
    try:
        return "repo" if (
            os.path.commonpath((repo, probe)) == repo
            and os.path.commonpath((real_repo, real_probe)) == real_repo
        ) else None
    except ValueError:
        return None


def suggest_fixed_target(resolved, anchor=None):
    """The exact path the ratified convention wants for this add."""
    name = os.path.basename(resolved.rstrip(os.sep)) or "worktree"
    parent = os.path.dirname(resolved.rstrip(os.sep))
    base = os.path.basename(parent)
    # The observed drift shape names its own repo: `<repo>.wt/<name>`.
    if base.endswith(".wt"):
        candidate = os.path.join(os.path.dirname(parent), base[: -len(".wt")])
        if os.path.exists(os.path.join(candidate, ".git")):
            return candidate, os.path.join(candidate, WORKTREE_DIR_NAME, name)
    repo = _nearest_repo_root(anchor or os.getcwd())
    if repo:
        return repo, os.path.join(repo, WORKTREE_DIR_NAME, name)
    return "<repo>", f"<repo>/{WORKTREE_DIR_NAME}/{name}"


def find_worktree_convention_issues(
    tool_name, tool_input, _budget=None, _initial_cwd=None
):
    """Return (deny_hits, unresolved_hits) for `git worktree add` targets.

    deny_hits: [(verb, resolved_path, segment, raw, anchor)] — resolved and
    off-convention. unresolved_hits: [(raw, segment, why)] — unresolvable, so the
    call is refused WITH its reason rather than blocked blind."""
    if tool_name != "Bash":
        return [], []
    command = tool_input.get("command", "")
    if not isinstance(command, str):
        raise ValueError("Bash command is not a string")
    if _budget is None:
        _budget = [max(65536, len(command) * 32)]
        _initial_cwd = os.getcwd()
    _budget[0] -= len(command)
    if _budget[0] < 0:
        raise ValueError("executable-substitution analysis budget exhausted")
    tokens, cmd_pos, seg_of, scope_of = _parse_bash(command)
    exposed_scope_keys = _direct_exposed_scope_keys(command, scope_of)
    adds = _worktree_add_args(tokens, cmd_pos, seg_of, scope_of)
    deny_hits = []
    unresolved_hits = []
    for raw, seg, scope, target_index in adds:
        variables = _static_shell_variables_before(
            tokens, cmd_pos, seg_of, seg
        )
        hit_seg = seg
        if len(scope) == 1 and scope[0] in exposed_scope_keys:
            outer_seg, sub_index = exposed_scope_keys[scope[0]]
            hit_seg = _nested_segment(
                outer_seg, sub_index, max(0, seg - outer_seg)
            )
        try:
            anchor = _worktree_anchor(
                tokens,
                cmd_pos,
                seg_of,
                scope_of,
                seg,
                scope,
                _initial_cwd,
                variables,
                raw,
                target_index,
            )
        except Unresolvable as exc:
            if _literal_prefix_class(
                raw,
                None,
                variables=variables,
                tokens=tokens,
                scope_of=scope_of,
                target_index=target_index,
            ) == "repo":
                continue
            unresolved_hits.append((raw, hit_seg, str(exc)))
            continue
        except Exception as exc:  # noqa: BLE001 — degrade to a refusal, per #676
            if _literal_prefix_class(
                raw,
                None,
                variables=variables,
                tokens=tokens,
                scope_of=scope_of,
                target_index=target_index,
            ) == "repo":
                continue
            unresolved_hits.append((raw, hit_seg, f"{exc.__class__.__name__}: {exc}"))
            continue
        try:
            resolved_values = resolve_targets(
                raw,
                anchor,
                variables,
                tokens=tokens,
                cmd_pos=cmd_pos,
                seg_of=seg_of,
                scope_of=scope_of,
                target_index=target_index,
            )
        except Unresolvable as exc:
            if _literal_prefix_class(
                raw,
                anchor,
                variables=variables,
                tokens=tokens,
                scope_of=scope_of,
                target_index=target_index,
            ) == "repo":
                continue
            unresolved_hits.append((raw, hit_seg, str(exc)))
            continue
        except Exception as exc:  # noqa: BLE001 — degrade to a refusal, per #676
            if _literal_prefix_class(
                raw,
                anchor,
                variables=variables,
                tokens=tokens,
                scope_of=scope_of,
                target_index=target_index,
            ) == "repo":
                continue
            unresolved_hits.append((raw, hit_seg, f"{exc.__class__.__name__}: {exc}"))
            continue
        resolved = next(
            (candidate for candidate in resolved_values if not on_convention(candidate)),
            None,
        )
        if resolved is not None:
            deny_hits.append(("git worktree add", resolved, hit_seg, raw, anchor))
    for body, outer_seg, sub_index, exposed in _executable_subcommands(
        _strip_heredoc_bodies(command)
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
        child_denies, child_asks = find_worktree_convention_issues(
            tool_name, {"command": body}, _budget, child_cwd
        )
        nested_denies = [
            (
                verb,
                path,
                _nested_segment(outer_seg, sub_index, child_seg, exposed),
                raw,
                anchor,
            )
            for verb, path, child_seg, raw, anchor in child_denies
        ]
        nested_unresolved = [
            (
                raw,
                _nested_segment(outer_seg, sub_index, child_seg, exposed),
                why,
            )
            for raw, child_seg, why in child_asks
        ]
        if exposed:
            for i, (verb, path, nested_seg, raw, anchor) in enumerate(
                nested_denies
            ):
                match = next(
                    (
                        j
                        for j, existing in enumerate(deny_hits)
                        if existing[0] == verb
                        and existing[2] == outer_seg
                        and existing[3] == raw
                    ),
                    None,
                )
                if match is not None:
                    existing = deny_hits.pop(match)
                    nested_denies[i] = (
                        verb,
                        existing[1],
                        nested_seg,
                        raw,
                        existing[4],
                    )
            for raw, _nested_seg, why in nested_unresolved:
                match = next(
                    (
                        j
                        for j, existing in enumerate(unresolved_hits)
                        if existing[0] == raw and existing[1] == outer_seg
                    ),
                    None,
                )
                if match is not None:
                    unresolved_hits.pop(match)
        deny_hits.extend(nested_denies)
        unresolved_hits.extend(nested_unresolved)
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
        child_denies, child_asks = find_worktree_convention_issues(
            tool_name, {"command": body}, _budget, alias_cwd
        )
        deny_hits.extend(
            (
                verb,
                path,
                _nested_alias_segment(outer_seg, alias_index, child_seg),
                raw,
                anchor,
            )
            for verb, path, child_seg, raw, anchor in child_denies
        )
        unresolved_hits.extend(
            (
                raw,
                _nested_alias_segment(outer_seg, alias_index, child_seg),
                why,
            )
            for raw, child_seg, why in child_asks
        )
    return deny_hits, unresolved_hits


def _hatched_segments(command, var=HATCH_TMP, _budget=None):
    """Segments whose simple command carries a `<var>=1` assignment
    prefix. Bash scopes `VAR=1 cmd` to that simple command alone, so the
    hatch covers exactly its own segment: a hatch on a harmless first command
    does not unlock a later `&&` write (Codex P1 round 3), and a hatch on the
    writing command in a later segment IS honored (Codex P2 round 4)."""
    if _budget is None:
        _budget = [max(65536, len(command) * 32)]
    _budget[0] -= len(command)
    if _budget[0] < 0:
        raise ValueError("hatch-scope analysis budget exhausted")
    active = _strip_heredoc_bodies(command)
    tokens = _shell_tokens(active)
    hatched = set()
    seg = 0
    at_segment_start = True
    pending_value = False
    for i, tok in enumerate(tokens):
        if _is_separator(tokens, i):
            seg += 1
            at_segment_start = True
            pending_value = False
            continue
        if at_segment_start:
            if tok == "(":
                # Subshell opener: an assignment inside `( ... )` does not
                # scope to the outer command's redirects (Macroscope round 5:
                # `( WEAVE_ALLOW_TMP=1 ) > /tmp/x` must not hatch). The hatch
                # must sit on a top-level simple command.
                at_segment_start = False
                continue
            if pending_value:
                pending_value = False
                continue
            if _ASSIGNMENT_RE.match(tok):
                if tok == f"{var}=1":
                    hatched.add(seg)
                continue  # still in the assignment prefix
            base = tok.rsplit("/", 1)[-1]
            if base in _WRAPPER_CMDS:
                # `env WEAVE_ALLOW_TMP=1 cmd ...` sets the var for cmd
                # (Bugbot Medium round 9) — keep scanning the prefix.
                continue
            if tok.startswith("-"):
                if tok in _WRAPPER_VALUE_OPTS:
                    pending_value = True
                continue
            at_segment_start = False
    for body, outer_seg, sub_index, exposed in _executable_subcommands(active):
        for child_seg in _hatched_segments(body, var, _budget):
            hatched.add(
                _nested_segment(outer_seg, sub_index, child_seg, exposed)
            )
    alias_tokens, _alias_cmd, alias_segs, alias_scopes = _parse_bash(active)
    for body, outer_seg, payload_index in _shell_command_payloads(
        alias_tokens, _alias_cmd, alias_segs
    ):
        child_hatched = _hatched_segments(body, var, _budget)
        for child_seg in child_hatched:
            hatched.add(
                _nested_segment(
                    outer_seg, payload_index, child_seg, False
                )
            )
        if outer_seg in hatched:
            _child_tokens, _child_cmd, child_segs, _child_scopes = _parse_bash(
                body
            )
            for child_seg in set(child_segs):
                hatched.add(
                    _nested_segment(
                        outer_seg, payload_index, child_seg, False
                    )
                )
    for body, outer_seg, alias_index in _invoked_alias_bodies(command):
        invocation_hatched = any(
            token == f"{var}=1"
            and alias_segs[i] == outer_seg
            and alias_scopes[i] == ()
            for i, token in enumerate(alias_tokens)
        )
        if invocation_hatched:
            hatched.add(_nested_alias_segment(outer_seg, alias_index, 0))
        for child_seg in _hatched_segments(body, var, _budget):
            hatched.add(
                _nested_alias_segment(outer_seg, alias_index, child_seg)
            )
    return hatched


def escape_hatch_covers(tool_name, tool_input, segments, var=HATCH_TMP):
    """True if the `var` escape hatch covers ALL flagged segments of this call.

    Session env hatch (`export <var>=1`) covers everything. The inline hatch
    covers per-segment, matching Bash assignment-prefix scope. The two hatches
    are independent: the worktree-migration hatch never unlocks the temp class."""
    if os.environ.get(var) == "1":
        return True
    if tool_name == "Bash":
        command = tool_input.get("command", "")
        if isinstance(command, str) and segments:
            hatched = _hatched_segments(command, var)
            return all(seg in hatched for seg in segments)
    return False


def log_bypass(tool_name, tool_input, targets, session_id, hatch=f"{HATCH_TMP}=1"):
    """Append the escape-hatch use to the durable ledger. Any failure here
    propagates -> DENY: an unlogged bypass must not proceed."""
    ledger = os.path.expanduser(os.environ.get("TMP_BLOCK_LEDGER", DEFAULT_LEDGER))
    ledger_dir = os.path.dirname(ledger)
    if ledger_dir:
        os.makedirs(ledger_dir, exist_ok=True)
    entry = {
        "ts": datetime.now().astimezone().isoformat(),
        "tool": tool_name,
        "targets": [{"verb": verb, "path": path} for verb, path, _seg in targets],
        "session_id": session_id,
        "cwd": os.getcwd(),
        "hatch": hatch,
    }
    # Keyed off the payload, not the tool name: `tool` now carries the HOST's
    # spelling (`Shell` from Cursor, `apply_patch` from Codex) so a ledger audit
    # can tell the panes apart, and branching on that name would have dropped
    # the command text for every non-Claude bypass.
    command = tool_input.get("command")
    if isinstance(command, str) and command:
        entry["command"] = command[:300]
    else:
        entry["file_path"] = str(
            tool_input.get("file_path") or tool_input.get("notebook_path") or ""
        )[:300]
    with open(ledger, "a") as f:
        f.write(json.dumps(entry) + "\n")


def main():
    try:
        hook_input = json.load(sys.stdin)
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
            if escape_hatch_covers(tool_name, tool_input, segments, HATCH_WT):
                log_bypass(
                    host_tool_name,
                    tool_input,
                    [(verb, path, seg) for verb, path, seg, _raw, _anchor in deny_hits]
                    + [("git worktree add (unresolved)", raw, seg) for raw, seg, _w in unresolved_hits],
                    session_id,
                    hatch=f"{HATCH_WT}=1",
                )
                if dynamic_targets and not dynamic_targets_hatched:
                    verb, path, _seg = dynamic_targets[0]
                    refuse_unresolvable(
                        f"⛔ TMP-BLOCK: cannot resolve this {verb.removeprefix('dynamic ')} "
                        f"target statically — {path} contains an unresolvable shell expansion."
                    )
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
            verb, path, _seg = dynamic_targets[0]
            refuse_unresolvable(
                f"⛔ TMP-BLOCK: cannot resolve this {verb.removeprefix('dynamic ')} "
                f"target statically — {path} contains an unresolvable shell expansion. "
                "An unreadable target could expand into /tmp, /private/tmp, "
                "/var/folders or $TMPDIR, so it is refused rather than guessed. "
                "Write durable content in the repo or its docs.local/. Genuinely "
                "ephemeral? Re-run with WEAVE_ALLOW_TMP=1 — it is allowed AND "
                "logged to the durable ledger."
            )

        allow()
    except SystemExit:
        raise
    except Exception as exc:  # FAIL CLOSED — the S04 half-fire class.
        deny(
            f"⛔ TMP-BLOCK FAIL-CLOSED: hook error ({exc.__class__.__name__}: {exc}) — "
            "denying instead of allowing. The S04 specimen broke exactly here: the era's "
            "/tmp guard hit a validation error and let the write through (A5 [21]; "
            "cross-cutting #2 [207]). If this is a false fire, fix the hook or use "
            "WEAVE_ALLOW_TMP=1 after verifying the target is genuinely ephemeral."
        )


if __name__ == "__main__":
    main()
