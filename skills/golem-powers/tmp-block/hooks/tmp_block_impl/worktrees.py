"""Definitions moved byte-faithfully from the executable hook."""
import os
from shell_parse import shell_code_reading


# AIDEV-TODO: golems#445 — moved whole (219 lines); decompose behind the pristine harness.
def find_worktree_convention_issues(tool_name, tool_input, _budget=None, _initial_cwd=None):
    with shell_code_reading(tool_input.get("command", "")):
        return _find_worktree_convention_issues_in_reading(tool_name, tool_input, _budget, _initial_cwd)


def _find_worktree_convention_issues_in_reading(
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
        variables = _static_shell_variable_state_before(
            tokens, cmd_pos, seg_of, scope_of, seg, target_index
        )[0]
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
