"""Definitions moved byte-faithfully from the executable hook."""


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
