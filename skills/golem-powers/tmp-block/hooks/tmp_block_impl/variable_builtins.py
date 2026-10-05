"""Original builtin invalidation block, with call-local references."""
import re
from typing import Callable, NamedTuple


class BuiltinScan(NamedTuple):
    command_name: str
    command_args: list
    command_mutation_reaches: bool
    tokens: list
    mutation_reaches_target: Callable[[int], bool]
    invalidate_assignment_word: Callable[[str], None]
    invalidate_assignment_target: Callable[[str], None]


def invalidate_builtin_targets(scan):
    command_name = scan.command_name
    command_args = scan.command_args
    command_mutation_reaches = scan.command_mutation_reaches
    tokens = scan.tokens
    mutation_reaches_target = scan.mutation_reaches_target
    invalidate_assignment_word = scan.invalidate_assignment_word
    invalidate_assignment_target = scan.invalidate_assignment_target

    # `read NAME` assigns without an `NAME=value` token. Its runtime value
    # is intentionally not interpreted; seeing the mutation is sufficient
    # to make the prior static value unusable.
    if command_name == "read" and command_mutation_reaches:
        pending_value = False
        pending_assignment_target = False
        parsing_options = True
        saw_assignment_target = False
        for index in command_args:
            if not mutation_reaches_target(index):
                continue
            token = tokens[index]
            if token in {"<", "<<", "<<<"}:
                break
            if pending_value:
                pending_value = False
                continue
            if pending_assignment_target:
                invalidate_assignment_word(token)
                saw_assignment_target = True
                pending_assignment_target = False
                continue
            if parsing_options:
                if token == "--":
                    parsing_options = False
                    continue
                if token.startswith("-"):
                    for offset, option in enumerate(token[1:]):
                        if option not in {"a", "d", "i", "n", "N", "p", "t", "u"}:
                            continue
                        attached = token[offset + 2 :]
                        if option == "a":
                            if attached:
                                invalidate_assignment_word(attached)
                                saw_assignment_target = True
                            else:
                                pending_assignment_target = True
                        elif not attached:
                            pending_value = True
                        break
                    continue
                parsing_options = False
            invalidate_assignment_word(token)
            saw_assignment_target = True
        if (
            not saw_assignment_target
            and not pending_assignment_target
            and not pending_value
        ):
            invalidate_assignment_target("REPLY")

    if command_name == "printf" and command_mutation_reaches:
        for offset, index in enumerate(command_args):
            token = tokens[index]
            name = None
            if token == "-v" and offset + 1 < len(command_args):
                name = tokens[command_args[offset + 1]]
            elif token.startswith("-v") and len(token) > 2:
                name = token[2:]
            if name:
                invalidate_assignment_word(name)
                break

    if command_name in {"mapfile", "readarray"} and command_mutation_reaches:
        pending_value = False
        saw_assignment_target = False
        for index in command_args:
            token = tokens[index]
            if token in {"<", "<<", "<<<", ">", ">>"}:
                break
            if pending_value:
                pending_value = False
                continue
            if token.startswith("-"):
                for offset, option in enumerate(token[1:]):
                    if option not in {"d", "n", "O", "s", "u", "C", "c"}:
                        continue
                    if not token[offset + 2 :]:
                        pending_value = True
                    break
                continue
            invalidate_assignment_word(token)
            saw_assignment_target = True
            break
        if not saw_assignment_target and not pending_value:
            invalidate_assignment_target("MAPFILE")

    if command_name in {"for", "select"} and command_mutation_reaches and command_args:
        name = tokens[command_args[0]]
        if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name):
            invalidate_assignment_target(name)
