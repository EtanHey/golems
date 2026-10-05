"""Definitions moved byte-faithfully from the executable hook."""
import os
import re


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
            and _ASSIGNMENT_RE.match(tokens[index]).group("name") == name
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
                (
                    "$UNRESOLVED_ASSIGNMENT"
                    if (
                        _ASSIGNMENT_RE.match(tokens[assignments[-1]]).group("subscript")
                        or _ASSIGNMENT_RE.match(tokens[assignments[-1]]).group("append")
                    )
                    else tokens[assignments[-1]].split("=", 1)[1]
                ),
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
