"""Definitions moved byte-faithfully from the executable hook."""
import re
import os


def _static_shell_variables_before(
    tokens, cmd_pos, seg_of, scope_of, target_segment
):
    """Known assignment-only/export state visible to `target_segment`."""
    return _static_shell_variable_state_before(
        tokens, cmd_pos, seg_of, scope_of, target_segment
    )[0]


def _static_shell_variable_state_before(
    tokens, cmd_pos, seg_of, scope_of, target_segment, target_index=None
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
    namerefs = {}
    paren_contexts = _paren_contexts(tokens)
    if target_index is None:
        target_index = next(
            (
                index
                for index, segment in enumerate(seg_of)
                if segment == target_segment and not _is_separator(tokens, index)
            ),
            len(tokens),
        )
    target_context = (
        paren_contexts[target_index]
        if target_index < len(paren_contexts)
        else ()
    )

    def mutation_reaches_target(index):
        """A child-shell mutation cannot change a later parent-shell value."""
        context = paren_contexts[index]
        return target_context[: len(context)] == context

    def invalidate(name):
        variables[name] = None
        prefixes.pop(name, None)

    def invalidate_assignment_target(name):
        invalidate(name)
        seen = {name}
        while name in namerefs:
            referenced = namerefs[name]
            if referenced is None:
                invalidate_all()
                return
            if referenced in seen:
                return
            invalidate(referenced)
            seen.add(referenced)
            name = referenced

    def invalidate_all():
        for name in tuple(variables):
            invalidate(name)

    def assignment_target_base(raw):
        """Resolve a builtin's variable-name operand to its base name."""
        indirect = _SIMPLE_VAR_RE.fullmatch(raw)
        if indirect:
            reference = indirect.group(1) or indirect.group(2)
            raw = (
                variables[reference]
                if reference in variables
                else os.environ.get(reference)
            )
        if not isinstance(raw, str):
            return None
        target = re.fullmatch(
            r"([A-Za-z_][A-Za-z0-9_]*)(?:\[[^]]+\])?", raw
        )
        return target.group(1) if target else None

    def invalidate_assignment_word(raw):
        """Invalidate a literal/indirect builtin target, or all on ambiguity."""
        name = assignment_target_base(raw)
        if name is None:
            invalidate_all()
        else:
            invalidate_assignment_target(name)

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
        segment_scope = scope_of[indices[0]]
        command_words = [
            i
            for i in indices
            if (
                scope_of[i] == segment_scope
                and cmd_pos[i]
                and not _ASSIGNMENT_RE.match(tokens[i])
            )
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

        command_index = command_words[0] if command_words else None
        command_name = (
            os.path.basename(tokens[command_index]).lower()
            if command_index is not None
            else ""
        )
        if command_name in {"command", "builtin"}:
            for index in indices:
                if index <= command_index or scope_of[index] != segment_scope:
                    continue
                if tokens[index].startswith("-"):
                    continue
                command_index = index
                command_name = os.path.basename(tokens[index]).lower()
                break
        exported = command_name in {"export", "readonly", "declare", "typeset"}
        unset = command_name == "unset"

        def assignment_is_modelled(index):
            assignment = _ASSIGNMENT_RE.match(tokens[index])
            next_is_array = (
                index + 1 < len(tokens)
                and seg_of[index + 1] == segment
                and tokens[index + 1] == "("
            )
            return not (
                assignment.group("subscript")
                or assignment.group("append")
                or next_is_array
            )

        modelled_assignments = (assignment_only or exported) and all(
            assignment_is_modelled(index) for index in assignments
        )
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
                if command_index is not None
                and i > command_index
                and re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", tokens[i])
            ]
            if state_is_parent_local and state_execution is not False:
                for name in names:
                    variables[name] = ""
                    prefixes.pop(name, None)
        elif modelled_assignments and state_is_parent_local:
            if state_execution is None:
                for index in assignments:
                    name = _ASSIGNMENT_RE.match(tokens[index]).group("name")
                    # The assignment may not have run at all, so the variable
                    # may still hold whatever it held before — no head to
                    # claim, not even a partial one.
                    variables[name] = None
                    prefixes.pop(name, None)
            elif state_execution is True:
                for index in assignments:
                    name = _ASSIGNMENT_RE.match(tokens[index]).group("name")
                    value = tokens[index].split("=", 1)[1]
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

        declared_namerefs = {}
        if (
            exported
            and command_name in {"declare", "typeset"}
            and "-n" in (tokens[index] for index in indices)
            and state_is_parent_local
            and state_execution is not False
        ):
            for index in assignments:
                assignment = _ASSIGNMENT_RE.match(tokens[index])
                name = assignment.group("name")
                if (
                    not assignment.group("subscript")
                    and not assignment.group("append")
                ):
                    value = variables.get(name)
                    declared_namerefs[name] = (
                        value
                        if isinstance(value, str)
                        and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", value)
                        else None
                    )

        # golems#481: an assignment-shaped token that is executable but falls
        # outside the resolver's model must invalidate any earlier value. A
        # stale in-convention value is not evidence that the later worktree
        # target is safe. Command-local prefixes remain excluded because Bash
        # applies them only to that command's environment, and child-shell
        # mutations do not leak back to a later parent command.
        for index in assignments:
            assignment = _ASSIGNMENT_RE.match(tokens[index])
            name = assignment.group("name")
            array_assignment = not assignment_is_modelled(index)
            command_local_prefix = (
                command_index is not None
                and index < command_index
                and not array_assignment
            )
            if (
                not modelled_assignments
                and not command_local_prefix
                and (cmd_pos[index] or command_name == "eval")
                and mutation_reaches_target(index)
            ):
                invalidate_assignment_target(name)
            elif (
                name in namerefs
                and name not in declared_namerefs
                and state_is_parent_local
                and state_execution is not False
                and mutation_reaches_target(index)
            ):
                invalidate_assignment_target(name)
        namerefs.update(declared_namerefs)

        command_args = [
            index
            for index in indices
            if (
                command_index is not None
                and index > command_index
                and scope_of[index] == segment_scope
            )
        ]
        command_mutation_reaches = (
            command_index is not None
            and mutation_reaches_target(command_index)
            and state_is_parent_local
            and state_execution is not False
        )

        # `eval` reparses its joined arguments as shell code. Only plain
        # NAME=literal words expose all assignment targets to this pass; any
        # other body can mutate arbitrary tracked variables and must fail
        # closed instead of preserving stale state.
        literal_eval_word = re.compile(
            r"[A-Za-z_][A-Za-z0-9_]*=[^$`*?\[\]{};&|<>()\s]*"
        )
        opaque_eval = (
            command_name == "eval"
            and bool(command_args)
            and not all(
                literal_eval_word.fullmatch(tokens[index])
                for index in command_args
            )
        )
        if command_mutation_reaches and (
            opaque_eval or command_name in {"source", "."}
        ):
            invalidate_all()

        invalidate_builtin_targets(BuiltinScan(
            command_name, command_args, command_mutation_reaches, tokens,
            mutation_reaches_target, invalidate_assignment_word,
            invalidate_assignment_target,
        ))

        chain_status = _chain_status_after(
            operator, chain_status, command_status
        )
    return variables, prefixes
