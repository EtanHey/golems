"""Command positions, segment paths and parsed Bash token maps."""

from __future__ import annotations

import ast
import re

from .heredocs import _strip_heredoc_bodies
from .tokens import (
    _ASSIGNMENT_RE, _WRAPPER_CMDS, _is_command_sub_close,
    _is_command_sub_open, _is_separator, _shell_tokens,
)


def _segment_for_offset(command, offset):
    """Parser-compatible outer simple-command segment at a source offset."""
    tokens = _shell_tokens(_strip_heredoc_bodies(command[:offset]))
    return sum(1 for i in range(len(tokens)) if _is_separator(tokens, i))


def _nested_segment(outer, substitution_index, child, exposed=True):
    """Compose a stable recursive simple-command segment path."""
    prefix = (outer, ("sub", substitution_index, exposed))
    if isinstance(child, tuple):
        return (*prefix, *child)
    return (*prefix, child)


def _nested_alias_segment(outer, alias_index, child):
    """Compose an alias-expansion identity distinct from `$()` identities."""
    prefix = (outer, ("alias", alias_index))
    if isinstance(child, tuple):
        return (*prefix, *child)
    return (*prefix, child)


def _segment_is_fully_exposed(segment):
    """True when every recursive boundary was visible to the primary lexer."""
    if not isinstance(segment, tuple):
        return True
    markers = [
        part
        for part in segment
        if isinstance(part, tuple) and part and part[0] == "sub"
    ]
    return all(len(marker) > 2 and marker[2] for marker in markers)


def _segment_is_prefix(prefix, segment):
    """True when `prefix` is an ancestor identity of `segment`."""
    prefix_parts = prefix if isinstance(prefix, tuple) else (prefix,)
    segment_parts = segment if isinstance(segment, tuple) else (segment,)
    return segment_parts[:len(prefix_parts)] == prefix_parts


def _shell_integer_arithmetic(expression):
    """Evaluate a restricted integer subset of Bash arithmetic syntax."""
    try:
        tree = ast.parse(expression.replace(" ", ""), mode="eval")
    except (SyntaxError, ValueError):
        return None

    def evaluate(node):
        if isinstance(node, ast.Expression):
            return evaluate(node.body)
        if isinstance(node, ast.Constant) and type(node.value) is int:
            return node.value
        if isinstance(node, ast.UnaryOp):
            value = evaluate(node.operand)
            if isinstance(node.op, ast.UAdd):
                return value
            if isinstance(node.op, ast.USub):
                return -value
            if isinstance(node.op, ast.Invert):
                return ~value
        if isinstance(node, ast.BinOp):
            left = evaluate(node.left)
            right = evaluate(node.right)
            if isinstance(node.op, ast.Add):
                return left + right
            if isinstance(node.op, ast.Sub):
                return left - right
            if isinstance(node.op, ast.Mult):
                return left * right
            if isinstance(node.op, (ast.Div, ast.FloorDiv)):
                return int(left / right)
            if isinstance(node.op, ast.Mod):
                return left % right
            if isinstance(node.op, ast.LShift):
                return left << right
            if isinstance(node.op, ast.RShift):
                return left >> right
            if isinstance(node.op, ast.BitAnd):
                return left & right
            if isinstance(node.op, ast.BitOr):
                return left | right
            if isinstance(node.op, ast.BitXor):
                return left ^ right
        raise ValueError("unsupported arithmetic expression")

    try:
        return evaluate(tree)
    except (ArithmeticError, ValueError, TypeError):
        return None


# Wrapper options that consume the FOLLOWING token as a value (`env -u FOO
# tee`, `sudo -u root tee`, `nice -n 10 tee` — Codex P1 round 9): the value
# is not the command word.
_WRAPPER_VALUE_OPTS = {
    "-u", "--unset", "-C", "--chdir", "-g", "--group",
    "-S", "--split-string", "-n", "--adjustment", "-o", "-e", "--output",
}


# AIDEV-TODO: Decompose command-position analysis in a follow-up with its own goldens.
def _command_position_flags(tokens):
    """flags[i] is True iff tokens[i] sits in COMMAND position (first word of
    a simple command, allowing assignment/wrapper prefixes). `echo tee
    /tmp/x` passes a word, it does not run tee (Codex P2 round 6)."""
    flags = [False] * len(tokens)
    expecting = True
    pending_redirect = False
    pending_value = False
    substitution_expectations = []
    case_states = []
    skip_case_separators = 0
    coproc_pending = False
    for i, tok in enumerate(tokens):
        if skip_case_separators:
            skip_case_separators -= 1
            continue
        if pending_redirect:
            pending_redirect = False
            if tok == "(":
                # `>(...)` process substitution — its body runs commands
                # (Macroscope round 9: `echo >(tee /tmp/x)`).
                expecting = True
            elif _is_command_sub_open(tok):
                # A command substitution can itself supply the redirect
                # target (`echo >$(tee /tmp/x)`). The opener is an operand,
                # but its child body is executable command scope.
                substitution_expectations.append(expecting)
                expecting = True
                pending_value = False
            # Otherwise: redirect target, never a command word.
            continue
        if tok in (">", ">>"):
            pending_redirect = True
            continue
        if _is_command_sub_open(tok):
            prefix = tok[:-2]
            outer_expecting = expecting
            if prefix:
                flags[i] = expecting
                if expecting:
                    base = prefix.rsplit("/", 1)[-1]
                    if not (
                        _ASSIGNMENT_RE.match(prefix)
                        or base in _WRAPPER_CMDS
                        or prefix.startswith("-")
                    ):
                        outer_expecting = False
            substitution_expectations.append(outer_expecting)
            expecting = True
            pending_value = False
            continue
        if _is_command_sub_close(tok):
            expecting = substitution_expectations.pop() if substitution_expectations else False
            pending_value = False
            continue
        if coproc_pending:
            coproc_pending = False
            if (
                re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", tok)
                and i + 1 < len(tokens)
                and tokens[i + 1] == "{"
            ):
                expecting = True
                continue
            # Otherwise this token is the unnamed coprocess command; let it
            # fall through to normal command-position handling.
        if expecting and tok == "coproc":
            coproc_pending = True
            pending_value = False
            continue
        if expecting and tok in {
            "if",
            "then",
            "elif",
            "else",
            "while",
            "until",
            "do",
            "!",
            "{",
        }:
            # Reserved words introduce a condition/body command rather than
            # consuming command position themselves.
            pending_value = False
            continue
        if case_states and case_states[-1] == "await-in":
            if tok == "in":
                case_states[-1] = "pattern"
            expecting = False
            continue
        if case_states and case_states[-1] == "pattern":
            if tok == ")":
                case_states[-1] = "body"
                expecting = True
            elif tok == "esac":
                case_states.pop()
                expecting = False
            continue
        if (
            case_states
            and case_states[-1] == "body"
            and tok == ";"
        ):
            terminator_width = 0
            if tokens[i + 1:i + 3] in ([";", "&"],):
                terminator_width = 2
            elif tokens[i + 1:i + 2] in ([";"], ["&"]):
                terminator_width = 1
            if terminator_width:
                case_states[-1] = "pattern"
                expecting = False
                skip_case_separators = terminator_width
                continue
        if _is_separator(tokens, i) or tok == "(":
            expecting = True
            pending_value = False
            continue
        if tok == ")":
            expecting = False
            pending_value = False
            continue
        if expecting and pending_value:
            # Value of a wrapper option (`env -u FOO tee`) — not the command.
            pending_value = False
            continue
        flags[i] = expecting
        if expecting:
            base = tok.rsplit("/", 1)[-1]
            if tok == "case":
                case_states.append("await-in")
                expecting = False
                continue
            if _ASSIGNMENT_RE.match(tok) or base in _WRAPPER_CMDS:
                flags[i] = expecting
                continue  # prefix word — command position stays open
            if tok.startswith("-"):
                # Wrapper option (`env -i tee`, Codex P1 round 7); some
                # consume the next token as a value (round 9).
                if tok in _WRAPPER_VALUE_OPTS:
                    pending_value = True
                continue
        expecting = False
    # Function definitions are inert until invoked. Re-scan only the body of
    # the latest definition that exists at an invocation's execution point.
    definitions = []
    i = 0
    while i + 3 < len(tokens):
        name_idx = i
        body_open = None
        if (
            re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", tokens[i])
            and tokens[i + 1:i + 4] == ["(", ")", "{"]
        ):
            body_open = i + 3
        elif tokens[i] == "function" and i + 2 < len(tokens):
            name_idx = i + 1
            if tokens[i + 2] == "{":
                body_open = i + 2
            elif tokens[i + 2:i + 5] == ["(", ")", "{"]:
                body_open = i + 4
        if body_open is None:
            i += 1
            continue
        depth = 1
        close = body_open + 1
        while close < len(tokens) and depth:
            if tokens[close] == "{":
                depth += 1
            elif tokens[close] == "}":
                depth -= 1
            close += 1
        if depth:
            i += 1
            continue
        definitions.append((tokens[name_idx], name_idx, body_open + 1, close - 1))
        i = close
    for _name, name_idx, body_start, body_end in definitions:
        flags[name_idx] = False
        for body_index in range(body_start, body_end):
            flags[body_index] = False
    definitions_by_name = {}
    for definition in definitions:
        definitions_by_name.setdefault(definition[0], []).append(definition)

    def definition_at(name, execution_index):
        eligible = [
            definition
            for definition in definitions_by_name.get(name, ())
            if definition[3] < execution_index
        ]
        return eligible[-1] if eligible else None

    queue = []
    for j, token in enumerate(tokens):
        if flags[j] and token in definitions_by_name:
            definition = definition_at(token, j)
            if definition is not None:
                queue.append((definition, j))
    activated = set()
    while queue:
        definition, execution_index = queue.pop()
        name, name_idx, body_start, body_end = definition
        activation = (name_idx, execution_index)
        if activation in activated:
            continue
        activated.add(activation)
        body_flags = _command_position_flags(tokens[body_start:body_end])
        for offset, active in enumerate(body_flags, start=body_start):
            if not active:
                continue
            flags[offset] = True
            callee = tokens[offset]
            callee_definition = definition_at(callee, execution_index)
            if callee_definition is not None:
                queue.append((callee_definition, execution_index))
    return flags


def _parse_bash(command):
    """Tokenize once and derive the position maps both rules need:
    command flags, simple-command segments, and command-substitution scopes.
    Heredoc BODIES are stripped and quoted text merges into its token, so
    neither rule can fire on prose (golems#676 second manifestation: the guard
    blocked the `gh issue create` that FILED the bug, because the title carried
    the pattern as text)."""
    tokens = _shell_tokens(_strip_heredoc_bodies(command))
    cmd_pos = _command_position_flags(tokens)
    seg_of = []
    seg = 0
    for i in range(len(tokens)):
        seg_of.append(seg)
        if _is_separator(tokens, i):
            seg += 1
    scope_of = []
    scope_stack = []
    next_scope = 0
    for tok in tokens:
        if _is_command_sub_open(tok):
            scope_of.append(tuple(scope_stack))
            next_scope += 1
            scope_stack.append(next_scope)
            continue
        scope_of.append(tuple(scope_stack))
        if _is_command_sub_close(tok) and scope_stack:
            scope_stack.pop()
    return tokens, cmd_pos, seg_of, scope_of


def _function_signature_parens(tokens):
    """Token indices for `name()`/`function name()` syntax, not subshells."""
    indices = set()
    for i in range(len(tokens) - 2):
        if (
            re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", tokens[i])
            and tokens[i + 1:i + 3] == ["(", ")"]
            and i + 3 < len(tokens)
            and tokens[i + 3] == "{"
        ):
            indices.update((i + 1, i + 2))
        if (
            tokens[i] == "function"
            and i + 4 < len(tokens)
            and tokens[i + 2:i + 5] == ["(", ")", "{"]
        ):
            indices.update((i + 2, i + 3))
    return indices
