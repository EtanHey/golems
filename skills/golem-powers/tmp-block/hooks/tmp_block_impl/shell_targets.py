"""Definitions moved byte-faithfully from the executable hook."""
import os


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
