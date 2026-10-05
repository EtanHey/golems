"""Source structure, function signatures, and compound buffering."""

from __future__ import annotations

import re

from .substitutions import _backtick_substitution, _dollar_substitution
from .quotes import ansi_c_quote, ansi_c_opens_at


function_name_pattern = r"[A-Za-z_][A-Za-z0-9_]*"
function_signature = (
    rf"(?:function\s+{function_name_pattern}(?:\s*\(\s*\))?"
    rf"|{function_name_pattern}\s*\(\s*\))"
)
function_open_re = re.compile(
    rf"(?:^|[;|&\n])\s*(?P<signature>{function_signature})"
    rf"(?P<gap>\s*)(?P<brace>\{{)",
    re.MULTILINE,
)
function_pending_re = re.compile(
    rf"(?:^|[;|&\n])\s*{function_signature}\s*\Z",
    re.MULTILINE,
)

def structural_source_with_status(source):
    structural = list(source)
    quote = None
    comment = False
    i = 0
    while i < len(source):
        char = source[i]
        if char in "\r\n":
            comment = False
            i += 1
            continue
        if comment:
            structural[i] = " "
            i += 1
            continue
        if quote not in {"'", "ansi-c"} and source.startswith("$(", i):
            found = _dollar_substitution(source, i)
            end = found[1] if found is not None else len(source)
            for nested_index in range(i, end):
                if source[nested_index] not in "\r\n":
                    structural[nested_index] = " "
            i = end
            continue
        if quote not in {"'", "ansi-c"} and char == "`":
            found = _backtick_substitution(source, i)
            end = found[1] if found is not None else len(source)
            for nested_index in range(i, end):
                if source[nested_index] not in "\r\n":
                    structural[nested_index] = " "
            i = end
            continue
        if quote == "ansi-c":
            if char == "'":
                quote = None
            else:
                structural[i] = " "
                if char == "\\" and i + 1 < len(source):
                    i += 1
                    if source[i] not in "\r\n":
                        structural[i] = " "
            i += 1
            continue
        if quote is not None:
            if char == quote:
                quote = None
            else:
                structural[i] = " "
                if char == "\\" and quote == '"' and i + 1 < len(source):
                    i += 1
                    if source[i] not in "\r\n":
                        structural[i] = " "
            i += 1
            continue
        if ansi_c_opens_at(source, i):
            quote = "ansi-c"
            i += 2
            continue
        if char in "'\"":
            quote = char
        elif char == "#" and (
            i == 0 or source[i - 1].isspace() or source[i - 1] in ";|&()"
        ):
            comment = True
            structural[i] = " "
        elif char == "\\" and i + 1 < len(source):
            structural[i] = " "
            i += 1
            if source[i] in "\r\n":
                structural[i] = " "
            else:
                structural[i] = "_"
        i += 1
    return "".join(structural), quote is None


def structural_source(source):
    return structural_source_with_status(source)[0]

def has_unclosed_function_definition(source):
    structural = structural_source(source)
    for match in function_open_re.finditer(structural):
        depth = 1
        for char in structural[match.end("brace"):]:
            if char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
                if depth == 0:
                    break
        if depth:
            return True
    return function_pending_re.search(structural) is not None

# AIDEV-TODO: Refactor this whole-function move in #372 after dedicated goldens.
def has_unclosed_compound_command(source):
    """Track multiline reserved-word compounds at command boundaries."""
    structural = structural_source(source)
    compacted = []
    i = 0
    while i < len(source):
        if source[i] == "\\" and i + 1 < len(source):
            if source[i + 1] == "\n":
                i += 2
                continue
            if (
                source[i + 1] == "\r"
                and i + 2 < len(source)
                and source[i + 2] == "\n"
            ):
                i += 3
                continue
        compacted.append(structural[i])
        i += 1
    tokens = re.findall(
        r"\n|&&|\|\||;;&|;&|;;|[<>]\(|&>>|<<<|<<-|>>|<>|>\||>&|<&|&>|"
        r"[;|&()<>]|"
        r"(?:^|(?<=[\s;|&()<>]))\{(?=$|[\s;|&()<>])|"
        r"(?:^|(?<=[\s;|&()<>]))\}(?=$|[\s;|&()<>])|"
        r"'[^']*'|\"[^\"]*\"|[^\s;|&()<>]+",
        "".join(compacted),
    )
    expected_closers = []
    group_closers = []
    case_states = []
    at_command_start = True
    pending_redirect = False
    time_prefix_state = None
    coproc_pending = False
    for index, token in enumerate(tokens):
        if token in {"<(", ">("}:
            group_closers.append((")", False))
            at_command_start = True
            continue
        if token in {
            "<",
            ">",
            "<<",
            ">>",
            "<<<",
            "<<-",
            "<>",
            ">|",
            ">&",
            "<&",
            "&>",
            "&>>",
        }:
            pending_redirect = True
            continue
        if pending_redirect:
            pending_redirect = False
            if token not in {"\n", ";", "&&", "||", "|", "&"}:
                at_command_start = False
                continue
        if case_states and case_states[-1]["state"] == "await-in":
            if token == "in":
                case_states[-1]["state"] = "pattern"
            at_command_start = False
            continue
        if case_states and case_states[-1]["state"] == "pattern":
            case_state = case_states[-1]
            if token == "esac" and not case_state["started"]:
                case_states.pop()
                if expected_closers and expected_closers[-1] == "esac":
                    expected_closers.pop()
                at_command_start = False
            elif token == "(":
                if case_state["started"]:
                    case_state["depth"] += 1
                else:
                    case_state["started"] = True
            elif token == ")":
                if case_state["depth"]:
                    case_state["depth"] -= 1
                else:
                    case_state["state"] = "body"
                    at_command_start = True
            elif token not in {"\n", "|"}:
                case_state["started"] = True
            continue
        if (
            case_states
            and case_states[-1]["state"] == "body"
            and token in {";;", ";&", ";;&"}
        ):
            case_states[-1].update(
                state="pattern",
                started=False,
                depth=0,
            )
            at_command_start = False
            continue
        if token == "{":
            if at_command_start:
                group_closers.append(("}", None))
                at_command_start = True
            continue
        if token == "}":
            if group_closers and group_closers[-1][0] == "}":
                group_closers.pop()
            at_command_start = False
            continue
        if token == "(":
            function_signature_paren = (
                index > 0
                and index + 1 < len(tokens)
                and re.match(r"^[A-Za-z_]", tokens[index - 1])
                and tokens[index + 1] == ")"
            )
            if not function_signature_paren:
                group_closers.append((")", None))
            at_command_start = True
            continue
        if token == ")":
            function_signature_paren = (
                index > 1
                and tokens[index - 1] == "("
                and re.match(r"^[A-Za-z_]", tokens[index - 2])
            )
            if (
                not function_signature_paren
                and group_closers
                and group_closers[-1][0] == ")"
            ):
                _closer, restore_command_start = group_closers.pop()
                at_command_start = (
                    False
                    if restore_command_start is None
                    else restore_command_start
                )
            else:
                at_command_start = False
            continue
        if token in {"\n", ";", "&&", "||", "|", "&"}:
            at_command_start = True
            time_prefix_state = None
            coproc_pending = False
            continue
        if coproc_pending:
            coproc_pending = False
            if (
                re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", token)
                and index + 1 < len(tokens)
                and tokens[index + 1]
                in {
                    "{",
                    "(",
                    "if",
                    "case",
                    "while",
                    "until",
                    "for",
                    "select",
                }
            ):
                continue
        if at_command_start and token == "coproc":
            coproc_pending = True
            continue
        if at_command_start and token == "time":
            time_prefix_state = "options"
            continue
        if (
            at_command_start
            and time_prefix_state == "options"
            and token == "-p"
        ):
            time_prefix_state = "post-p"
            continue
        if (
            at_command_start
            and time_prefix_state in {"options", "post-p"}
            and token == "--"
        ):
            time_prefix_state = "command"
            continue
        if at_command_start and token == "!":
            time_prefix_state = None
            continue
        time_prefix_state = None
        if not re.match(r"^[A-Za-z_]", token):
            if at_command_start:
                at_command_start = False
            continue
        if not at_command_start:
            continue
        if token == "if":
            expected_closers.append("fi")
            at_command_start = True
        elif token == "case":
            expected_closers.append("esac")
            case_states.append(
                {"state": "await-in", "started": False, "depth": 0}
            )
            at_command_start = False
        elif token in {"while", "until", "for", "select"}:
            expected_closers.append("done")
            at_command_start = token in {"while", "until"}
        elif token in {"then", "elif", "else", "do"}:
            at_command_start = True
        elif expected_closers and token == expected_closers[-1]:
            expected_closers.pop()
            if token == "esac" and case_states:
                case_states.pop()
            at_command_start = False
        else:
            at_command_start = False
    return bool(expected_closers or group_closers)


def normalize_function_signature_braces(source):
    """Turn signature/newline/brace into whitespace without moving offsets."""
    structural = structural_source(source)
    normalized = list(source)
    for match in function_open_re.finditer(structural):
        gap_start, gap_end = match.span("gap")
        for i in range(gap_start, gap_end):
            if normalized[i] in "\\\r\n":
                normalized[i] = " "
    return "".join(normalized)

def mask_quoted_braces(source):
    masked = list(source)
    quote = None
    i = 0
    while i < len(source):
        char = source[i]
        if quote is None and ansi_c_opens_at(source, i):
            _value, end = ansi_c_quote(source, i)
            for index in range(i, end):
                if masked[index] in '{}':
                    masked[index] = '_'
            i = end
            continue
        if quote != "'" and source.startswith("$(", i):
            found = _dollar_substitution(source, i)
            if found is not None:
                _body, end = found
                for nested_index in range(i, end):
                    if masked[nested_index] in "{}":
                        masked[nested_index] = "_"
                i = end
                continue
        if quote != "'" and char == "`":
            found = _backtick_substitution(source, i)
            if found is not None:
                _body, end = found
                for nested_index in range(i, end):
                    if masked[nested_index] in "{}":
                        masked[nested_index] = "_"
                i = end
                continue
        if quote is not None:
            if char == quote:
                quote = None
            elif char in "{}":
                masked[i] = "_"
            elif char == "\\" and quote == '"' and i + 1 < len(source):
                i += 1
            i += 1
            continue
        if char in "'\"":
            quote = char
        elif char == "\\" and i + 1 < len(source):
            i += 1
        i += 1
    return "".join(masked)
