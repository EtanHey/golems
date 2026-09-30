"""Verbatim compound-walk transitions for if, loops, and case."""

from __future__ import annotations

import re
from fnmatch import fnmatchcase

from .tokens import _ASSIGNMENT_RE
from .conditions import _CompoundFrame

def step_case_arm(walk, token):
    if (
        token in {";;", ";&", ";;&"}
        and walk.stack
        and walk.stack[-1]["kind"] == "case"
        and walk.stack[-1]["branch"] == "body"
    ):
        if token == ";;&" and walk.stack[-1]["selected"] is True:
            walk.stack[-1]["any_taken"] = False
        walk.stack[-1].update(
            branch="pattern",
            pattern=None,
            fallthrough_next=(token == ";&" and walk.stack[-1]["selected"]),
            selected=False,
            body_status=None,
            body_execute_next=True,
            body_negate_next=False,
        )
        walk.at_command_start = False
        return True
    if (
        token == "|"
        and walk.stack
        and walk.stack[-1]["kind"] == "case"
        and walk.stack[-1]["branch"] == "pattern"
    ):
        return True
    return False

def step_if_branch(walk, token):
    if token == "then" and walk.stack and walk.stack[-1]["kind"] == "if":
        compound = walk.stack[-1]
        condition = compound["condition"]
        if compound["any_taken"] is False and condition is True:
            compound["selected"] = True
            compound["any_taken"] = True
        elif compound["any_taken"] is True or condition is False:
            compound["selected"] = False
        else:
            compound["selected"] = "unknown"
            compound["any_taken"] = "unknown"
        compound["branch"] = "then"
        compound["body_status"] = None
        compound["body_execute_next"] = True
        compound["body_negate_next"] = False
        walk.at_command_start = True
        return True
    if token == "elif" and walk.stack and walk.stack[-1]["kind"] == "if":
        compound = walk.stack[-1]
        compound.update(
            branch="condition",
            condition=None,
            execute_next=compound["any_taken"] is False,
            negate_next=False,
            selected=False,
        )
        walk.at_command_start = True
        return True
    if token == "else" and walk.stack and walk.stack[-1]["kind"] == "if":
        compound = walk.stack[-1]
        compound["branch"] = "else"
        if compound["any_taken"] is False:
            compound["selected"] = True
        elif compound["any_taken"] is True:
            compound["selected"] = False
        else:
            compound["selected"] = "unknown"
        compound["body_status"] = None
        compound["body_execute_next"] = True
        compound["body_negate_next"] = False
        walk.at_command_start = True
        return True
    return False

def step_loop_do(walk, token):
    if token == "do" and walk.stack and walk.stack[-1]["kind"] == "loop":
        compound = walk.stack[-1]
        compound["branch"] = "body"
        if compound["loop_type"] == "for":
            compound["selected"] = (
                "unknown"
                if compound["literal_words"] == "unknown"
                else compound["literal_words"] > 0
            )
        elif compound["loop_type"] == "while":
            compound["selected"] = (
                "unknown"
                if compound["condition"] == "unknown"
                else compound["condition"] is True
            )
        elif compound["loop_type"] == "until":
            compound["selected"] = (
                "unknown"
                if compound["condition"] == "unknown"
                else compound["condition"] is False
            )
        elif compound["loop_type"] == "select":
            compound["selected"] = "unknown"
        else:
            compound["selected"] = False
        compound["body_status"] = None
        compound["body_execute_next"] = True
        compound["body_negate_next"] = False
        walk.at_command_start = True
        return True
    return False

def step_if_open(walk, token):
    if walk.at_command_start and token == "if":
        walk.stack.append(
            _CompoundFrame(**{
                "kind": "if",
                "condition": None,
                "branch": "condition",
                "execute_next": True,
                "negate_next": False,
                "any_taken": False,
                "selected": False,
                "body_status": None,
                "body_execute_next": True,
                "body_negate_next": False,
            })
        )
        walk.at_command_start = True
        return True
    return False

def step_case_open(walk, token):
    if walk.at_command_start and token == "case":
        walk.stack.append(
            _CompoundFrame(**{
                "kind": "case",
                "branch": "subject",
                "subject": None,
                "pattern": None,
                "selected": False,
                "any_taken": False,
                "fallthrough_next": False,
                "body_status": None,
                "body_execute_next": True,
                "body_negate_next": False,
            })
        )
        walk.at_command_start = False
        return True
    return False

def step_loop_open(walk, token):
    if walk.at_command_start and token in {"while", "until", "for", "select"}:
        literal_words = "unknown" if token == "for" else 0
        raw_literal_count_known = False
        if token == "for":
            if walk.raw_for_counts is not None and walk.for_loop_index < len(walk.raw_for_counts):
                literal_words = walk.raw_for_counts[walk.for_loop_index]
                raw_literal_count_known = True
            walk.for_loop_index += 1
        walk.stack.append(
            _CompoundFrame(**{
                "kind": "loop",
                "loop_type": token,
                "branch": (
                    "condition" if token in {"while", "until"} else "header"
                ),
                "in_words": False,
                "literal_words": literal_words,
                "raw_literal_count_known": raw_literal_count_known,
                "selected": False,
                "condition": None,
                "execute_next": True,
                "negate_next": False,
                "body_status": None,
                "body_execute_next": True,
                "body_negate_next": False,
            })
        )
        walk.at_command_start = token in {"while", "until"}
        return True
    return False

def step_case_subject(walk, token):
    if walk.stack and walk.stack[-1]["kind"] == "case":
        compound = walk.stack[-1]
        if compound["branch"] == "subject":
            if compound["subject"] is None:
                variable = re.fullmatch(r"\$([A-Za-z_][A-Za-z0-9_]*)", token)
                compound["subject"] = (
                    walk.static_vars[variable.group(1)]
                    if variable and variable.group(1) in walk.static_vars
                    else token
                )
            elif token == "in":
                compound["branch"] = "pattern"
        elif compound["branch"] == "pattern":
            if token == ")":
                compound["branch"] = "body"
                patterns = (
                    walk.raw_case_groups[walk.case_group_index]
                    if walk.raw_case_groups is not None
                    and walk.case_group_index < len(walk.raw_case_groups)
                    else [compound["pattern"]]
                )
                walk.case_group_index += 1
                dynamic_case = walk.unit_nocasematch or any(
                    marker in compound["subject"]
                    for marker in ("$", "`", "~")
                ) or any(
                    any(marker in pattern for marker in ("$", "`", "~"))
                    for pattern in patterns
                ) or any(
                    "[[:" in pattern or "[^" in pattern
                    for pattern in patterns
                )
                if compound["fallthrough_next"] is True:
                    compound["selected"] = True
                elif (
                    compound["fallthrough_next"] == "unknown"
                    or dynamic_case
                    or compound["any_taken"] == "unknown"
                ):
                    compound["selected"] = "unknown"
                    compound["any_taken"] = "unknown"
                else:
                    compound["selected"] = (
                        not compound["any_taken"]
                        and any(
                            fnmatchcase(compound["subject"], pattern)
                            for pattern in patterns
                        )
                    )
                compound["fallthrough_next"] = False
                if compound["selected"] is True:
                    compound["any_taken"] = True
                walk.at_command_start = True
                return True
            if compound["pattern"] is None:
                compound["pattern"] = token
        walk.at_command_start = False
        return True
    return False

def step_loop_header(walk, token):
    if (
        walk.stack
        and walk.stack[-1]["kind"] == "loop"
        and walk.stack[-1]["branch"] == "header"
    ):
        compound = walk.stack[-1]
        if compound["loop_type"] == "for":
            if token == "in":
                compound["in_words"] = True
            elif (
                compound["in_words"]
                and not compound["raw_literal_count_known"]
                and compound["literal_words"] != "unknown"
                and not any(
                marker in token for marker in ("$", "`", "*", "?", "[")
                )
            ):
                compound["literal_words"] += 1
        walk.at_command_start = False
        return True
    return False

def step_loop_condition(walk, token):
    if (
        walk.stack
        and walk.stack[-1]["kind"] == "loop"
        and walk.stack[-1]["branch"] == "condition"
        and walk.at_command_start
    ):
        compound = walk.stack[-1]
        if _ASSIGNMENT_RE.match(token):
            return True
        if token == "!":
            compound["negate_next"] = not compound["negate_next"]
            return True
        if compound["execute_next"]:
            if token in {"true", "false", ":"}:
                status = token in {"true", ":"}
                if compound["negate_next"]:
                    status = not status
                compound["condition"] = status
            else:
                compound["condition"] = "unknown"
        compound["negate_next"] = False
        walk.at_command_start = False
        return True
    return False

def step_if_condition(walk, token):
    if (
        walk.stack
        and walk.stack[-1]["kind"] == "if"
        and walk.stack[-1]["branch"] == "condition"
        and walk.at_command_start
    ):
        if _ASSIGNMENT_RE.match(token):
            return True
        if token == "!":
            walk.stack[-1]["negate_next"] = not walk.stack[-1]["negate_next"]
            return True
        if walk.stack[-1]["execute_next"]:
            if token in {"true", "false", ":"}:
                status = token in {"true", ":"}
                if walk.stack[-1]["negate_next"]:
                    status = not status
                walk.stack[-1]["condition"] = status
            else:
                walk.stack[-1]["condition"] = "unknown"
        walk.stack[-1]["negate_next"] = False
        walk.at_command_start = False
        return True
    return False
