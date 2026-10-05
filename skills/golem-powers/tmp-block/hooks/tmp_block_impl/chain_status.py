"""Definitions moved byte-faithfully from the executable hook."""




def _segment_operator_before(tokens, seg_of, segment):
    """Return the shell-list operator immediately before a non-empty segment."""
    words = [
        i
        for i, token_segment in enumerate(seg_of)
        if token_segment == segment and not _is_separator(tokens, i)
    ]
    if not words:
        return None
    parts = []
    index = words[0] - 1
    while index >= 0 and _is_separator(tokens, index):
        parts.append(tokens[index])
        index -= 1
    return "".join(reversed(parts)) or None


def _segment_operator_after(tokens, seg_of, segment):
    """Return the shell-list operator immediately after a non-empty segment."""
    words = [
        i
        for i, token_segment in enumerate(seg_of)
        if token_segment == segment and not _is_separator(tokens, i)
    ]
    if not words:
        return None
    parts = []
    index = words[-1] + 1
    while index < len(tokens) and _is_separator(tokens, index):
        parts.append(tokens[index])
        index += 1
    return "".join(parts) or None


def _chain_status_after(operator, prior_status, command_status):
    """Abstract Bash AND/OR-list status: True, False, or statically unknown."""
    if operator == "&&":
        if prior_status is False:
            return False
        if prior_status is True:
            return command_status
        return False if command_status is False else None
    if operator == "||":
        if prior_status is True:
            return True
        if prior_status is False:
            return command_status
        return True if command_status is True else None
    return command_status
