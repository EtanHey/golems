"""Explicit state and source-unit event construction for shell expansion."""

from __future__ import annotations

from dataclasses import dataclass, field
import re

from . import function_expansion as _function_expansion
from . import patterns as _patterns
from . import structure as _structure
from . import units as _units
from . import variables as _variables
from .positions import _parse_bash, _function_signature_parens
from .tokens import _shell_tokens


@dataclass
class ExpansionState:
    enabled: bool
    nocasematch: bool
    aliases: dict[str, str]
    function_bodies: dict[str, str]
    expanded_function_bodies: dict[str, str]
    command_vars: dict[str, str | None] = field(default_factory=dict)
    invoked: list[tuple[str, int, int]] = field(default_factory=list)
    offset: int = 0
    invocation_index: int = 0


@dataclass
class SourceUnit:
    source_unit: str
    line: str
    unit_nocasematch: bool
    parse_line: str
    tokens: list[str]
    literal_tokens: list[str]
    cmd_pos: list[bool]
    seg_of: list[int]
    scope_of: list[tuple[int, ...]]
    builtin_token_indices: list[int] = field(default_factory=list)
    alias_ineligible_builtin_indices: set[int] = field(default_factory=set)
    raw_alias_bodies: dict[str, str] = field(default_factory=dict)
    function_events: list[tuple] = field(default_factory=list)


@dataclass
class FunctionView:
    bodies: dict[str, str]
    expanded_bodies: dict[str, str]


@dataclass
class VariableView:
    variables: dict[str, str | None]


def make_source_unit(source_unit, nocasematch):
    line = _structure.normalize_function_signature_braces(
        source_unit.rstrip("\r\n")
    )
    unit_nocasematch = nocasematch or bool(
        re.search(
            r"(?:^|[;|&])\s*(?:builtin\s+)?shopt\s+-s\b"
            r"[^\n;|&]*\bnocasematch\b",
            line,
        )
    )
    parse_line = _structure.mask_quoted_braces(line)
    tokens, cmd_pos, seg_of, _scope_of = _parse_bash(parse_line)
    literal_tokens = _shell_tokens(line)
    return SourceUnit(
        source_unit, line, unit_nocasematch, parse_line,
        tokens, literal_tokens, cmd_pos, seg_of, _scope_of,
    )


def standalone_separator_at(unit, index, separators):
    tokens = unit.tokens
    if index < 0 or index >= len(tokens) or tokens[index] not in separators:
        return False
    token = tokens[index]
    return not (
        (index > 0 and tokens[index - 1] == token)
        or (index + 1 < len(tokens) and tokens[index + 1] == token)
    )


def command_is_parent_local(unit, command_index):
    tokens = unit.tokens
    prefix_tokens = tokens[:command_index]
    signature_parens = _function_signature_parens(prefix_tokens)
    subshell_depth = sum(
        1 if token == "(" else -1 if token == ")" else 0
        for index, token in enumerate(prefix_tokens)
        if index not in signature_parens
    )
    if subshell_depth > 0:
        return False
    if standalone_separator_at(unit, command_index - 1, {"|"}):
        return False
    for index in range(command_index + 1, len(tokens)):
        if tokens[index] not in {";", "|", "&"}:
            continue
        return not standalone_separator_at(unit, index, {"|", "&"})
    return True


def prepare_alias_metadata(unit):
    tokens = unit.tokens
    line = unit.line
    builtin_token_indices = [
        i for i, token in enumerate(tokens) if token == "builtin"
    ]
    alias_ineligible_builtin_indices = {
        token_index
        for alias_eligible, token_index in zip(
            _patterns.builtin_alias_eligibility(line),
            builtin_token_indices,
        )
        if not alias_eligible
    }
    raw_alias_bodies = {
        match.group(1): match.group(3)
        for match in re.finditer(
            r"(?:^|[;|&]\s*)(?:builtin\s+)?alias\s+"
            r"([A-Za-z_][A-Za-z0-9_]*)=(['\"])(.*?)\2"
            r"(?=\s*(?:[;|&]|$))",
            line,
        )
    }
    unit.builtin_token_indices = builtin_token_indices
    unit.alias_ineligible_builtin_indices = alias_ineligible_builtin_indices
    unit.raw_alias_bodies = raw_alias_bodies
    return unit


def collect_line_definitions(unit, expansion_state, active_compounds_execute):
    line = unit.line
    tokens = unit.tokens
    line_definitions = []
    source_definitions = _units.raw_function_definitions(line)
    source_definition_index = 0
    line_pos = 0
    while line_pos + 3 < len(tokens):
        function_name = None
        body_open = None
        if (
            re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", tokens[line_pos])
            and tokens[line_pos + 1:line_pos + 4] == ["(", ")", "{"]
        ):
            function_name = tokens[line_pos]
            body_open = line_pos + 3
        elif tokens[line_pos] == "function" and line_pos + 2 < len(tokens):
            function_name = tokens[line_pos + 1]
            if tokens[line_pos + 2] == "{":
                body_open = line_pos + 2
            elif tokens[line_pos + 2:line_pos + 5] == ["(", ")", "{"]:
                body_open = line_pos + 4
        if body_open is None:
            line_pos += 1
            continue
        depth = 1
        close = body_open + 1
        while close < len(tokens) and depth:
            if tokens[close] == "{":
                depth += 1
            elif tokens[close] == "}":
                depth -= 1
            close += 1
        if not depth:
            raw_body = " ".join(tokens[body_open + 1:close - 1])
            if source_definition_index < len(source_definitions):
                source_name, source_body = source_definitions[
                    source_definition_index
                ]
                source_definition_index += 1
                if source_name == function_name:
                    raw_body = source_body
            expanded_body = _function_expansion.expand_alias_commands(expansion_state, raw_body)
            prefix_tokens = tokens[:line_pos]
            prefix = " ".join(tokens[:line_pos])
            signature_parens = _function_signature_parens(prefix_tokens)
            subshell_depth = sum(
                1
                if token == "("
                else -1
                if token == ")"
                else 0
                for index, token in enumerate(prefix_tokens)
                if index not in signature_parens
            )
            pipeline_local = standalone_separator_at(unit,
                line_pos - 1, {"|"}
            ) or standalone_separator_at(unit, close, {"|", "&"})
            inheritable = (
                not _structure.has_unclosed_function_definition(prefix)
                and subshell_depth <= 0
                and not pipeline_local
                and active_compounds_execute(
                    prefix_tokens,
                    _patterns.case_pattern_groups(line),
                    _patterns.literal_for_word_counts(line),
                )
            )
            line_definitions.append(
                (
                    close,
                    function_name,
                    raw_body,
                    expanded_body,
                    inheritable,
                )
            )
            line_pos = close
            continue
        line_pos += 1
    return line_definitions


def build_function_events(unit, line_definitions, active_compounds_execute, command_is_parent_local):
    tokens, cmd_pos, seg_of, line = unit.tokens, unit.cmd_pos, unit.seg_of, unit.line
    function_events = [
        (close, "define", name, raw_body, expanded_body, inheritable)
        for close, name, raw_body, expanded_body, inheritable in line_definitions
    ]
    for i, token in enumerate(tokens):
        if token != "unset" or not cmd_pos[i]:
            continue
        same_segment = [
            tokens[j]
            for j in range(i + 1, len(tokens))
            if seg_of[j] == seg_of[i]
        ]
        if "-f" not in same_segment or not active_compounds_execute(
            tokens[:i],
            _patterns.case_pattern_groups(line),
            _patterns.literal_for_word_counts(line),
            require_definite=True,
        ):
            continue
        if not command_is_parent_local(i):
            continue
        for name in same_segment:
            if not name.startswith("-"):
                function_events.append((i, "remove", name, None, None, True))
    function_events.sort(key=lambda event: event[0])
    return function_events


def apply_function_event(bodies, expanded_bodies, event):
    _position, action, name, raw_body, expanded_body, inheritable = event
    if not inheritable:
        return
    if action == "remove":
        bodies.pop(name, None)
        expanded_bodies.pop(name, None)
        return
    bodies[name] = raw_body
    if expanded_body != raw_body:
        expanded_bodies[name] = expanded_body
    else:
        expanded_bodies.pop(name, None)


def initial_state(_initial_state):
    if _initial_state is None:
        enabled = False
        nocasematch = False
        aliases = {}
        function_bodies = {}
        expanded_function_bodies = {}
    else:
        enabled, initial_aliases, initial_functions, initial_expanded = (
            _initial_state[:4]
        )
        nocasematch = _initial_state[4] if len(_initial_state) > 4 else False
        aliases = dict(initial_aliases)
        function_bodies = dict(initial_functions)
        expanded_function_bodies = dict(initial_expanded)
    invoked = []
    offset = 0
    invocation_index = 0
    command_vars = {}
    return ExpansionState(
        enabled, nocasematch, aliases, function_bodies,
        expanded_function_bodies, command_vars=command_vars,
        invoked=invoked, offset=offset, invocation_index=invocation_index,
    )


def function_state_at(unit, state, token_index):
    view = FunctionView(
        dict(state.function_bodies), dict(state.expanded_function_bodies)
    )
    bodies, expanded_bodies = view.bodies, view.expanded_bodies
    for event in unit.function_events:
        if event[0] >= token_index:
            break
        apply_function_event(bodies, expanded_bodies, event)
    return bodies, expanded_bodies


def variable_state_at(unit, state, token_index,
                      command_is_parent_local, active_compounds_execute):
    variables = _variables.variable_state_at(
        token_index,
        command_vars=state.command_vars,
        tokens=unit.tokens,
        cmd_pos=unit.cmd_pos,
        seg_of=unit.seg_of,
        command_is_parent_local=command_is_parent_local,
        active_compounds_execute=active_compounds_execute,
        line=unit.line,
    )
    return VariableView(variables).variables
