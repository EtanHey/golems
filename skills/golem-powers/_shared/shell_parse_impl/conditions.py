"""Compound command execution walker and explicit state records."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .tokens import _ASSIGNMENT_RE


@dataclass
class _CompoundFrame:
    kind: str
    branch: str
    condition: Any = None
    execute_next: Any = None
    negate_next: Any = None
    any_taken: Any = None
    selected: Any = None
    body_status: Any = None
    body_execute_next: Any = None
    body_negate_next: Any = None
    loop_type: Any = None
    in_words: Any = None
    literal_words: Any = None
    raw_literal_count_known: Any = None
    subject: Any = None
    pattern: Any = None
    fallthrough_next: Any = None

    def __getitem__(self, name):
        return getattr(self, name)

    def __setitem__(self, name, value):
        setattr(self, name, value)

    def get(self, name, default=None):
        return getattr(self, name, default)

    def update(self, **changes):
        for name, value in changes.items():
            setattr(self, name, value)


@dataclass
class _CompoundWalk:
    raw_case_groups: Any
    raw_for_counts: Any
    unit_nocasematch: bool
    normalized_tokens: list[str] = field(default_factory=list)
    stack: list[_CompoundFrame] = field(default_factory=list)
    at_command_start: bool = True
    top_status: Any = None
    top_execute_next: Any = True
    top_negate_next: bool = False
    case_group_index: int = 0
    for_loop_index: int = 0
    static_vars: dict[str, str] = field(default_factory=dict)
    normalized_index: int = 0


def short_circuit_execution(status, operator):
    if status == "unknown" or status is None:
        return "unknown"
    return status is (operator == "&&")


def _normalize_tokens(prefix_tokens):
    normalized_tokens = []
    token_index = 0
    while token_index < len(prefix_tokens):
        token = prefix_tokens[token_index]
        if (
            token == ";"
            and token_index + 2 < len(prefix_tokens)
            and prefix_tokens[token_index + 1:token_index + 3] == [";", "&"]
        ):
            normalized_tokens.append(";;&")
            token_index += 3
            continue
        if (
            token == ";"
            and token_index + 1 < len(prefix_tokens)
            and prefix_tokens[token_index + 1] == "&"
        ):
            normalized_tokens.append(";&")
            token_index += 2
            continue
        if (
            token in {";", "|", "&"}
            and token_index + 1 < len(prefix_tokens)
            and prefix_tokens[token_index + 1] == token
        ):
            normalized_tokens.append(token * 2)
            token_index += 2
            continue
        normalized_tokens.append(token)
        token_index += 1
    return normalized_tokens

def _step_separator(walk, token):
    if token in {"\n", ";", "&&", "||", "|", "&"}:
        if (
            walk.stack
            and walk.stack[-1]["kind"] == "if"
            and walk.stack[-1]["branch"] == "condition"
        ):
            current = walk.stack[-1]["condition"]
            if token in {"&&", "||"}:
                walk.stack[-1]["execute_next"] = short_circuit_execution(
                    current, token
                )
            else:
                walk.stack[-1]["execute_next"] = True
            walk.stack[-1]["negate_next"] = False
        elif (
            walk.stack
            and walk.stack[-1]["kind"] == "loop"
            and walk.stack[-1]["branch"] == "condition"
        ):
            current = walk.stack[-1]["condition"]
            if token in {"&&", "||"}:
                walk.stack[-1]["execute_next"] = short_circuit_execution(
                    current, token
                )
            else:
                walk.stack[-1]["execute_next"] = True
            walk.stack[-1]["negate_next"] = False
        elif walk.stack and walk.stack[-1].get("branch") in {"then", "else", "body"}:
            compound = walk.stack[-1]
            current = compound["body_status"]
            if token in {"&&", "||"}:
                compound["body_execute_next"] = short_circuit_execution(
                    current, token
                )
            else:
                compound["body_execute_next"] = True
            compound["body_negate_next"] = False
        elif not walk.stack:
            if token in {"&&", "||"}:
                walk.top_execute_next = short_circuit_execution(
                    walk.top_status, token
                )
            else:
                walk.top_execute_next = True
            walk.top_negate_next = False
        walk.at_command_start = True
        return True
    return False

def _step_completion(walk, token):
    if token == "fi" and walk.stack and walk.stack[-1]["kind"] == "if":
        completed = walk.stack.pop()
        if completed["selected"] is True:
            completed_status = completed["body_status"]
        elif (
            completed["selected"] is False
            and completed["any_taken"] is False
            and completed["condition"] is False
        ):
            completed_status = True
        else:
            completed_status = "unknown"
        if walk.stack and walk.stack[-1].get("branch") in {"then", "else", "body"}:
            walk.stack[-1]["body_status"] = completed_status
        elif not walk.stack:
            walk.top_status = completed_status
        walk.at_command_start = False
        return True
    if token in {"done", "esac"} and walk.stack:
        expected_kind = "case" if token == "esac" else "loop"
        if walk.stack[-1]["kind"] == expected_kind:
            completed = walk.stack.pop()
            completed_status = (
                completed["body_status"]
                if completed["selected"] is True
                else "unknown"
            )
            if walk.stack and walk.stack[-1].get("branch") in {
                "then",
                "else",
                "body",
            }:
                walk.stack[-1]["body_status"] = completed_status
            elif not walk.stack:
                walk.top_status = completed_status
        walk.at_command_start = False
        return True
    return False

def _step_status(walk, token):
    if (
        walk.stack
        and walk.stack[-1].get("branch") in {"then", "else", "body"}
        and walk.at_command_start
    ):
        compound = walk.stack[-1]
        if _ASSIGNMENT_RE.match(token):
            return True
        if token == "!":
            compound["body_negate_next"] = not compound["body_negate_next"]
            return True
        if compound["body_execute_next"]:
            if token in {"true", "false", ":"}:
                status = token in {"true", ":"}
                if compound["body_negate_next"]:
                    status = not status
                compound["body_status"] = status
            else:
                compound["body_status"] = "unknown"
        compound["body_negate_next"] = False
        walk.at_command_start = False
        return True
    if walk.at_command_start and not walk.stack:
        if _ASSIGNMENT_RE.match(token):
            assignment = _ASSIGNMENT_RE.match(token)
            name = assignment.group("name")
            value = token.split("=", 1)[1]
            lookahead = walk.normalized_index + 1
            while (
                lookahead < len(walk.normalized_tokens)
                and _ASSIGNMENT_RE.match(walk.normalized_tokens[lookahead])
            ):
                lookahead += 1
            standalone = (
                lookahead == len(walk.normalized_tokens)
                or walk.normalized_tokens[lookahead]
                in {"\n", ";", "&&", "||", "|", "&"}
            )
            if (
                walk.top_execute_next is True
                and standalone
            ):
                if (
                    assignment.group("subscript")
                    or assignment.group("append")
                    or any(marker in value for marker in ("$", "`", "~"))
                ):
                    walk.static_vars.pop(name, None)
                else:
                    walk.static_vars[name] = value
            return True
        if token == "!":
            walk.top_negate_next = not walk.top_negate_next
            return True
        if walk.top_execute_next:
            if token in {"true", "false", ":"}:
                walk.top_status = token in {"true", ":"}
                if walk.top_negate_next:
                    walk.top_status = not walk.top_status
            else:
                walk.top_status = "unknown"
        walk.top_negate_next = False

    walk.at_command_start = False

    return True

def _reachability(walk, require_definite):
    if walk.top_execute_next is False:
        return False
    if require_definite and walk.top_execute_next is not True:
        return False
    for compound in walk.stack:
        if compound["kind"] == "loop":
            if compound["branch"] == "condition":
                if compound["execute_next"] is False:
                    return False
                if require_definite and compound["execute_next"] is not True:
                    return False
                continue
            if compound["branch"] != "body" or not compound["selected"]:
                return False
            if compound["body_execute_next"] is False:
                return False
            if require_definite and (
                compound["selected"] is not True
                or compound["body_execute_next"] is not True
            ):
                return False
            continue
        if compound["kind"] == "case":
            if compound["branch"] != "body" or not compound["selected"]:
                return False
            if compound["body_execute_next"] is False:
                return False
            if require_definite and (
                compound["selected"] is not True
                or compound["body_execute_next"] is not True
            ):
                return False
            continue
        if compound["kind"] != "if":
            return False
        if compound["branch"] == "condition":
            if compound["execute_next"] is False:
                return False
            if require_definite and compound["execute_next"] is not True:
                return False
            continue
        if compound["branch"] not in {"then", "else"}:
            return False
        if compound["selected"] is False:
            return False
        if compound["body_execute_next"] is False:
            return False
        if require_definite and (
            compound["selected"] is not True
            or compound["body_execute_next"] is not True
        ):
            return False
    return True


def active_compounds_execute(
    prefix_tokens, raw_case_groups=None, raw_for_counts=None,
    require_definite=False, *, unit_nocasematch=False,
):
    """True when every currently open compound branch definitely runs."""

    walk = _CompoundWalk(raw_case_groups, raw_for_counts, unit_nocasematch)
    walk.normalized_tokens = _normalize_tokens(prefix_tokens)
    for walk.normalized_index, token in enumerate(walk.normalized_tokens):
        if steps.step_case_arm(walk, token):
            continue
        if _step_separator(walk, token):
            continue
        if steps.step_if_branch(walk, token):
            continue
        if _step_completion(walk, token):
            continue
        if steps.step_loop_do(walk, token):
            continue
        if steps.step_if_open(walk, token):
            continue
        if steps.step_case_open(walk, token):
            continue
        if steps.step_loop_open(walk, token):
            continue
        if steps.step_case_subject(walk, token):
            continue
        if steps.step_loop_header(walk, token):
            continue
        if steps.step_loop_condition(walk, token):
            continue
        if steps.step_if_condition(walk, token):
            continue
        _step_status(walk, token)
    return _reachability(walk, require_definite)


# Load while the facade suppresses package bytecode, after _CompoundFrame exists.
from . import condition_steps as steps  # noqa: E402
