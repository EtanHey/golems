"""Definitions moved byte-faithfully from the executable hook."""
import re
import os


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
