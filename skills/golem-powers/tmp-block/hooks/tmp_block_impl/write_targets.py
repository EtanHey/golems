"""Definitions moved byte-faithfully from the executable hook."""
from typing import NamedTuple



class ShellScan(NamedTuple):
    command: object
    direct_command: object
    tokens: object
    cmd_pos: object
    seg_of: object
    scope_of: object
    exposed_scope_keys: object
    initial_cwd: object
    budget: object
    hits: object


def scan_redirect_targets(scan):
    command = scan.command
    direct_command = scan.direct_command
    tokens = scan.tokens
    cmd_pos = scan.cmd_pos
    seg_of = scan.seg_of
    scope_of = scan.scope_of
    exposed_scope_keys = scan.exposed_scope_keys
    _initial_cwd = scan.initial_cwd
    _budget = scan.budget
    hits = scan.hits

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
                            tokens, cmd_pos, seg_of, scope_of, seg_of[idx]
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


def scan_tee_targets(scan):
    command = scan.command
    direct_command = scan.direct_command
    tokens = scan.tokens
    cmd_pos = scan.cmd_pos
    seg_of = scan.seg_of
    scope_of = scan.scope_of
    exposed_scope_keys = scan.exposed_scope_keys
    _initial_cwd = scan.initial_cwd
    _budget = scan.budget
    hits = scan.hits

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
                            tokens, cmd_pos, seg_of, scope_of, seg_of[idx]
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
                            tokens, cmd_pos, seg_of, scope_of, seg_of[idx]
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


def scan_worktree_targets(scan):
    command = scan.command
    direct_command = scan.direct_command
    tokens = scan.tokens
    cmd_pos = scan.cmd_pos
    seg_of = scan.seg_of
    scope_of = scan.scope_of
    exposed_scope_keys = scan.exposed_scope_keys
    _initial_cwd = scan.initial_cwd
    _budget = scan.budget
    hits = scan.hits

    # 3. git worktree add <path> — creation only; `worktree list/remove` untouched.
    for raw, seg, scope, target_index in _worktree_add_args(
        tokens, cmd_pos, seg_of, scope_of
    ):
        variables = _static_shell_variables_before(
            tokens, cmd_pos, seg_of, scope_of, seg
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
