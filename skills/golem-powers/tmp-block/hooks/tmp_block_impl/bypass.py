"""Definitions moved byte-faithfully from the executable hook."""
from datetime import datetime
import json
import os


DEFAULT_LEDGER = os.path.expanduser("~/.claude/logs/tmp-block-ledger.jsonl")

HATCH_TMP = "WEAVE_ALLOW_TMP"
HATCH_WT = "WEAVE_ALLOW_WT_MIGRATION"


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
    """Append the escape-hatch use to the durable ledger. A failure to write it
    is an explicit DENY: an unlogged bypass must not proceed."""
    ledger = os.path.expanduser(os.environ.get("TMP_BLOCK_LEDGER", DEFAULT_LEDGER))
    ledger_dir = os.path.dirname(ledger)
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
    try:
        if ledger_dir:
            os.makedirs(ledger_dir, exist_ok=True)
        with open(ledger, "a") as f:
            f.write(json.dumps(entry) + "\n")
    except OSError as exc:
        # GO-5 E2 keeps this a hard deny on its own: the generic hook-error path
        # is advisory now, and an unlogged bypass must never proceed.
        deny(
            f"⛔ TMP-BLOCK: {hatch} was set but the bypass ledger {ledger} could not be "
            f"written ({exc.__class__.__name__}: {exc}). An unlogged bypass must not "
            "proceed; fix the ledger path or drop the hatch."
        )
