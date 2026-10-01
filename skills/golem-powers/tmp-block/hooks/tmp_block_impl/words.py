"""Definitions moved byte-faithfully from the executable hook."""
import re
import os


# Simple, statically-resolvable variable references: `$NAME` / `${NAME}`.
# Anything richer (`${NAME:-default}`, `${NAME%/}`, `$(...)`, backticks) is
# deliberately NOT resolved — it is refused with its reason, never blocked
# blind on the unexpanded literal (golems#676).
_SIMPLE_VAR_RE = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)")


_MAX_STATIC_VALUES = 256


def _bounded_brace_values(raw):
    """Expand finite Bash brace alternatives/sequences, or raise if unbounded.

    This intentionally models only value sets whose complete membership is
    visible in the command. Ordinary globs stay unresolvable.
    """
    opening = None
    depth = 0
    for index, char in enumerate(raw):
        if char == "{" and (index == 0 or raw[index - 1] != "$"):
            if depth == 0:
                opening = index
            depth += 1
        elif char == "}" and depth:
            depth -= 1
            if depth:
                continue
            inner = raw[opening + 1:index]
            parts = []
            start = 0
            nested = 0
            for part_index, part_char in enumerate(inner):
                if part_char == "{":
                    nested += 1
                elif part_char == "}":
                    nested -= 1
                elif part_char == "," and nested == 0:
                    parts.append(inner[start:part_index])
                    start = part_index + 1
            if parts:
                parts.append(inner[start:])
            else:
                sequence = re.fullmatch(
                    r"(-?[0-9]+|[A-Za-z])\.\.(-?[0-9]+|[A-Za-z])"
                    r"(?:\.\.(-?[0-9]+))?",
                    inner,
                )
                if sequence:
                    first, last, raw_step = sequence.groups()
                    if first.lstrip("-").isdigit() != last.lstrip("-").isdigit():
                        raise Unresolvable("the brace sequence mixes value types")
                    numeric = first.lstrip("-").isdigit()
                    begin = int(first) if numeric else ord(first)
                    end = int(last) if numeric else ord(last)
                    step = int(raw_step) if raw_step is not None else 1
                    if step == 0:
                        raise Unresolvable("the brace sequence has a zero step")
                    step = abs(step) if end >= begin else -abs(step)
                    stop = end + (1 if step > 0 else -1)
                    sequence_values = list(range(begin, stop, step))
                    if len(sequence_values) > _MAX_STATIC_VALUES:
                        raise Unresolvable("the brace sequence exceeds the static-value limit")
                    parts = [
                        str(value) if numeric else chr(value)
                        for value in sequence_values
                    ]
                else:
                    continue
            expanded = []
            for part in parts:
                for suffix in _bounded_brace_values(raw[index + 1:]):
                    for middle in _bounded_brace_values(part):
                        expanded.append(raw[:opening] + middle + suffix)
                        if len(expanded) > _MAX_STATIC_VALUES:
                            raise Unresolvable(
                                "the brace expansion exceeds the static-value limit"
                            )
            return tuple(dict.fromkeys(expanded))
    if depth:
        raise Unresolvable("the target has an unmatched brace expansion")
    return (raw,)


def _bounded_word_values(raw, variables=None, value_sets=None):
    """Return every statically-known shell value for one word."""
    if _QUOTED_LBRACE in raw or _QUOTED_RBRACE in raw:
        raise Unresolvable("the target contains quoted brace characters")
    if "$(" in raw or "`" in raw:
        raise Unresolvable("the target contains a command substitution")
    values = [""]
    index = 0
    while index < len(raw):
        if raw[index] != "$":
            values = [value + raw[index] for value in values]
            index += 1
            continue
        match = _SIMPLE_VAR_RE.match(raw, index)
        if not match:
            raise Unresolvable(
                f"unsupported shell expansion near {raw[index:index + 12]!r}"
            )
        name = match.group(1) or match.group(2)
        candidates = None
        has_bounded_set = value_sets is not None and name in value_sets
        if has_bounded_set:
            candidates = value_sets[name]
            if candidates is None:
                raise Unresolvable(f"${name} has an unbounded value set")
        if not has_bounded_set and variables is not None and name in variables:
            scalar = variables[name]
            if scalar is None:
                raise Unresolvable(f"${name} has conditionally unknown state")
            candidates = (scalar,)
        if not has_bounded_set and candidates is None:
            environment_value = os.environ.get(name)
            if environment_value is not None:
                candidates = (environment_value,)
        if candidates is None:
            raise Unresolvable(f"${name} is not set in the hook environment")
        values = [prefix + candidate for prefix in values for candidate in candidates]
        if len(values) > _MAX_STATIC_VALUES:
            raise Unresolvable("the variable expansion exceeds the static-value limit")
        index = match.end()

    expanded = []
    for value in values:
        expanded.extend(_bounded_brace_values(value))
        if len(expanded) > _MAX_STATIC_VALUES:
            raise Unresolvable("the static value set exceeds the safety limit")
    if any(any(marker in value for marker in ("*", "?", "[")) for value in expanded):
        raise Unresolvable("the target contains a glob expansion")
    return tuple(dict.fromkeys(expanded))


def resolve_target(raw, anchor=None, variables=None):
    """Expand `raw` into an absolute path, or raise Unresolvable with a reason.

    Only statically-safe expansions are performed: `~`, `$NAME`/`${NAME}` that
    are actually set in the hook's environment, and joining of a relative path
    to an already-resolved absolute anchor. Everything else is refused
    (golems#676)."""
    s = raw.strip()
    if not s:
        raise Unresolvable("empty target")
    if _QUOTED_LBRACE in s or _QUOTED_RBRACE in s:
        raise Unresolvable("the target contains quoted brace characters")
    if "$(" in s or "`" in s:
        raise Unresolvable("the target contains a command substitution")
    out = []
    i = 0
    while i < len(s):
        if s[i] != "$":
            out.append(s[i])
            i += 1
            continue
        m = _SIMPLE_VAR_RE.match(s, i)
        if not m:
            raise Unresolvable(f"unsupported shell expansion near {s[i:i + 12]!r}")
        name = m.group(1) or m.group(2)
        if variables is not None and name in variables:
            value = variables[name]
            if value is None:
                raise Unresolvable(f"${name} has conditionally unknown state")
        else:
            value = os.environ.get(name)
            if not value:
                raise Unresolvable(f"${name} is not set in the hook environment")
        if value is None:
            raise Unresolvable(f"${name} is not set in the hook environment")
        out.append(value)
        i = m.end()
    expanded = "".join(out)
    if any(ch in expanded for ch in ("*", "?", "{", "[")):
        raise Unresolvable("the target contains a glob or brace expansion")
    expanded = os.path.expanduser(expanded)
    if not os.path.isabs(expanded):
        if anchor is None:
            raise Unresolvable("the relative path has no statically-resolvable anchor")
        expanded = os.path.join(anchor, expanded)
    return os.path.abspath(os.path.normpath(expanded))
