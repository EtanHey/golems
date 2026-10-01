"""Definitions moved byte-faithfully from the executable hook."""
import re


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
                tokens, cmd_pos, seg_of, scope_of, seg_of[loop["start"]]
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
