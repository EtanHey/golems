"""Ordered substitution, function, eval and alias expansion driver."""

import os
import re

from . import conditions as _conditions
from . import eval_payloads as _eval_payloads
from . import expansion_state as _expansion_state
from . import function_expansion as _function_expansion
from . import patterns as _patterns
from . import units as _units
from .heredocs import _mask_heredoc_body_lines
from .positions import _parse_bash, _segment_for_offset
from .substitutions import _executable_subcommands
from .tokens import _FUNCTION_LOOKUP_SUPPRESSORS
from .quotes import shell_code, shell_code_reading, _reading


def _emit_substitutions(command, expansion_state, unit, function_state_at):
    invoked, offset, invocation_index = (expansion_state.invoked, expansion_state.offset,
                                         expansion_state.invocation_index)
    enabled, aliases, nocasematch = (expansion_state.enabled, expansion_state.aliases,
                                     expansion_state.nocasematch)
    line, tokens, seg_of = unit.line, unit.tokens, unit.seg_of
    for body, sub_outer_seg, _sub_index, exposed in _executable_subcommands(
        line
    ):
        if exposed:
            continue
        token_index = next(
            (
                i
                for i, segment in enumerate(seg_of)
                if segment == sub_outer_seg
            ),
            len(tokens),
        )
        bodies, expanded_bodies = function_state_at(token_index)
        state = (enabled, aliases, bodies, expanded_bodies, nocasematch)
        for nested_body, _nested_seg, _nested_index in _invoked_alias_bodies(
            body,
            state,
        ):
            invoked.append(
                (
                    nested_body,
                    _segment_for_offset(command, offset) + sub_outer_seg,
                    invocation_index,
                )
            )
            invocation_index += 1
            expansion_state.invocation_index = invocation_index



def _emit_functions(command, expansion_state, unit, function_state_at,
                    variable_state_at, active_compounds_execute):
    invoked, offset, invocation_index = (expansion_state.invoked, expansion_state.offset,
                                         expansion_state.invocation_index)
    line, tokens, cmd_pos, seg_of = unit.line, unit.tokens, unit.cmd_pos, unit.seg_of
    if _function_expansion._argument_expander.get() is not None:
        cmd_pos = list(cmd_pos)
        _function_expansion.hide_function_bodies(tokens, cmd_pos)
    for i, token in enumerate(tokens):
        if not cmd_pos[i]:
            continue
        if not active_compounds_execute(
            tokens[:i],
            _patterns.case_pattern_groups(line),
            _patterns.literal_for_word_counts(line),
        ):
            continue
        segment_commands = [
            tokens[j]
            for j in range(i)
            if seg_of[j] == seg_of[i] and cmd_pos[j]
        ]
        if (
            segment_commands
            and os.path.basename(segment_commands[0])
            in _FUNCTION_LOOKUP_SUPPRESSORS
        ):
            continue
        bodies, expanded_bodies = function_state_at(i)
        resolved_token = token
        variable = re.fullmatch(r"\$([A-Za-z_][A-Za-z0-9_]*)", token)
        if variable:
            resolved_token = variable_state_at(i).get(variable.group(1), token)
        if resolved_token not in bodies:
            continue
        outer_seg = _segment_for_offset(command, offset) + seg_of[i]
        invocation_arguments = [
            tokens[j]
            for j in range(i + 1, len(tokens))
            if seg_of[j] == seg_of[i]
        ]
        target_body = expanded_bodies.get(resolved_token, bodies[resolved_token])
        if _function_expansion._argument_expander.get() is not None:
            invocation_arguments = _function_expansion.call_arguments(line, tokens, i)
            target_body = _function_expansion.expand_function_arguments(target_body, invocation_arguments, variable_state_at(i), source=line)
            target_body = _function_expansion.expand_function(
                expansion_state, target_body, bodies=bodies, expanded_bodies=expanded_bodies)
        else:
            target_body = _function_expansion.expand_function_arguments(
                _function_expansion.expand_function(
                    expansion_state, target_body, bodies=bodies, expanded_bodies=expanded_bodies),
                invocation_arguments)
        invoked.append((target_body, outer_seg, invocation_index))
        invocation_index += 1
        expansion_state.invocation_index = invocation_index


def _emit_eval(command, expansion_state, unit, function_state_at,
               variable_state_at, active_compounds_execute):
    invoked, offset, invocation_index = (expansion_state.invoked, expansion_state.offset,
                                         expansion_state.invocation_index)
    enabled = expansion_state.enabled
    line, tokens, cmd_pos, seg_of, literal_tokens = (unit.line, unit.tokens, unit.cmd_pos,
                                                    unit.seg_of, unit.literal_tokens)
    for i, token in enumerate(tokens):
        payload = _eval_payloads.detect_eval_payload(
            i,
            token,
            variable_state_at=variable_state_at,
            tokens=tokens,
            seg_of=seg_of,
            cmd_pos=cmd_pos,
            active_compounds_execute=active_compounds_execute,
            line=line,
            function_state_at=function_state_at,
            literal_tokens=literal_tokens,
        )
        if payload is None:
            continue
        eval_source, eval_variables, bodies, expanded_bodies = payload
        eval_outer_segment = _segment_for_offset(command, offset) + seg_of[i]
        level_key = ("eval", _reading.get(), str(command), offset, i)
        eval_source = _eval_payloads.resolve_eval_source(
            eval_source, eval_variables, enabled=False,
            expansion_state=expansion_state,
        )
        # Materialization can introduce syntax that was absent from the argument.
        # Both stages share one level choice, so replay also re-expands aliases
        # under the mode selected from the final executable source.
        with shell_code_reading(eval_source, "both", level_key):
            if enabled:
                eval_source = _function_expansion.expand_alias_commands(expansion_state, eval_source)
        with shell_code_reading(eval_source, "both", level_key) as reading:
            eval_source = shell_code(eval_source, reading)
            invoked.append(
                (
                    eval_source,
                    eval_outer_segment,
                    invocation_index,
                )
            )
            invocation_index += 1
            expansion_state.invocation_index = invocation_index
            if "$(" in eval_source or "`" in eval_source:
                invoked.append(
                    (
                        shell_code(eval_source.replace("$(", " ")
                                   .replace(")$", " ").replace("`", " "), reading),
                        eval_outer_segment,
                        invocation_index,
                    )
                )
                invocation_index += 1
                expansion_state.invocation_index = invocation_index
            eval_tokens, eval_cmd_pos, eval_seg_of, _ = _parse_bash(eval_source)
            for eval_index, name in enumerate(eval_tokens):
                if not eval_cmd_pos[eval_index]:
                    continue
                segment_commands = [
                    eval_tokens[j]
                    for j in range(eval_index)
                    if eval_seg_of[j] == eval_seg_of[eval_index]
                    and eval_cmd_pos[j]
                ]
                if (
                    segment_commands
                    and os.path.basename(segment_commands[0])
                    in _FUNCTION_LOOKUP_SUPPRESSORS
                ):
                    continue
                if not active_compounds_execute(
                    eval_tokens[:eval_index],
                    _patterns.case_pattern_groups(eval_source),
                    _patterns.literal_for_word_counts(eval_source),
                ):
                    continue
                invoked_names = (
                    [name]
                    if name in bodies
                    else list(bodies)
                    if "$" in name or "`" in name
                    else []
                )
                for invoked_name in invoked_names:
                    invoked.append(
                        (
                            shell_code(_function_expansion.expand_function(
                                expansion_state,
                                expanded_bodies.get(
                                    invoked_name,
                                    bodies[invoked_name],
                                ),
                                bodies=bodies,
                                expanded_bodies=expanded_bodies,
                            ), reading),
                            eval_outer_segment,
                            invocation_index,
                        )
                    )
                    invocation_index += 1
                    expansion_state.invocation_index = invocation_index


def _emit_alias(command, expansion_state, unit, function_state_at,
                active_compounds_execute):
    invoked, offset, invocation_index = (expansion_state.invoked, expansion_state.offset,
                                         expansion_state.invocation_index)
    enabled, aliases = expansion_state.enabled, expansion_state.aliases
    line, tokens, cmd_pos, seg_of = unit.line, unit.tokens, unit.cmd_pos, unit.seg_of
    if enabled:
        for i, token in enumerate(tokens):
            if (
                cmd_pos[i]
                and token in aliases
                and active_compounds_execute(
                    tokens[:i],
                    _patterns.case_pattern_groups(line),
                    _patterns.literal_for_word_counts(line),
                )
            ):
                bodies, expanded_bodies = function_state_at(i)
                outer_seg = _segment_for_offset(command, offset) + seg_of[i]
                expanded = _function_expansion.expand_alias(expansion_state, token)
                tail = [
                    tokens[j]
                    for j in range(i + 1, len(tokens))
                    if seg_of[j] == seg_of[i]
                ]
                if (
                    aliases[token].endswith((" ", "\t"))
                    and tail
                    and tail[0] in aliases
                ):
                    expanded = f"{expanded}{_function_expansion.expand_alias(expansion_state, tail.pop(0))}"
                if tail:
                    expanded = f"{expanded} {' '.join(tail)}"
                invoked.append(
                    (
                        _function_expansion.expand_function(
                            expansion_state,
                            expanded,
                            bodies=bodies,
                            expanded_bodies=expanded_bodies,
                        ),
                        outer_seg,
                        invocation_index,
                    )
                )
                invocation_index += 1
                expansion_state.invocation_index = invocation_index


def _commit_unit(expansion_state, unit, active_compounds_execute,
                 command_is_parent_local, variable_state_at):
    enabled, nocasematch, aliases = (expansion_state.enabled, expansion_state.nocasematch,
                                     expansion_state.aliases)
    function_bodies, expanded_function_bodies = (expansion_state.function_bodies,
                                                 expansion_state.expanded_function_bodies)
    command_vars, offset, invocation_index = (expansion_state.command_vars,
                                              expansion_state.offset,
                                              expansion_state.invocation_index)
    line, tokens, cmd_pos, seg_of = unit.line, unit.tokens, unit.cmd_pos, unit.seg_of
    function_events = unit.function_events
    source_unit = unit.source_unit
    alias_ineligible_builtin_indices = unit.alias_ineligible_builtin_indices
    raw_alias_bodies = unit.raw_alias_bodies
    apply_function_event = _expansion_state.apply_function_event
    for event in function_events:
        apply_function_event(
            function_bodies,
            expanded_function_bodies,
            event,
        )
    # Shell parses a complete line before executing it, so shopt/alias
    # changes here affect only subsequent lines.
    for i, token in enumerate(tokens):
        if not cmd_pos[i]:
            continue
        if not active_compounds_execute(
            tokens[:i],
            _patterns.case_pattern_groups(line),
            _patterns.literal_for_word_counts(line),
        ):
            continue
        definitely_executes = active_compounds_execute(
            tokens[:i],
            _patterns.case_pattern_groups(line),
            _patterns.literal_for_word_counts(line),
            require_definite=True,
        )
        if not command_is_parent_local(i):
            continue
        same_segment = [
            tokens[j]
            for j in range(i + 1, len(tokens))
            if seg_of[j] == seg_of[i]
        ]
        effective_token = token
        if (
            token == "builtin"
            and same_segment
            and not (
                enabled
                and token in aliases
                and i not in alias_ineligible_builtin_indices
            )
        ):
            effective_token = same_segment.pop(0)
        if effective_token == "shopt" and "expand_aliases" in same_segment:
            if "-s" in same_segment:
                enabled = True
            elif "-u" in same_segment and definitely_executes:
                enabled = False
        if effective_token == "shopt" and "nocasematch" in same_segment:
            if "-s" in same_segment:
                nocasematch = True
            elif "-u" in same_segment and definitely_executes:
                nocasematch = False
        if effective_token == "alias":
            for definition in same_segment:
                if "=" not in definition:
                    continue
                name, body = definition.split("=", 1)
                if re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", name):
                    aliases[name] = raw_alias_bodies.get(name, body)
        if effective_token == "unalias" and definitely_executes:
            if "-a" in same_segment:
                aliases.clear()
            else:
                for name in same_segment:
                    if not name.startswith("-"):
                        aliases.pop(name, None)
    command_vars = variable_state_at(len(tokens))
    offset += len(source_unit)
    expansion_state.enabled = enabled
    expansion_state.nocasematch = nocasematch
    expansion_state.command_vars = command_vars
    expansion_state.offset = offset
    expansion_state.invocation_index = invocation_index


def _invoked_alias_bodies(command, _initial_state=None):
    """Return alias bodies expanded on later lines when Bash enables them."""
    expansion_state = _expansion_state.initial_state(_initial_state)
    executable_source = _mask_heredoc_body_lines(command)
    for source_unit in _units.parse_units(executable_source):
        unit = _expansion_state.make_source_unit(source_unit, expansion_state.nocasematch)

        def active_compounds_execute(prefix_tokens, raw_case_groups=None,
                                     raw_for_counts=None, require_definite=False):
            return _conditions.active_compounds_execute(
                prefix_tokens, raw_case_groups, raw_for_counts,
                require_definite, unit_nocasematch=unit.unit_nocasematch,
            )

        def command_is_parent_local(command_index):
            return _expansion_state.command_is_parent_local(unit, command_index)

        _expansion_state.prepare_alias_metadata(unit)
        line_definitions = _expansion_state.collect_line_definitions(
            unit, expansion_state, active_compounds_execute,
        )
        unit.function_events = _expansion_state.build_function_events(
            unit, line_definitions, active_compounds_execute,
            command_is_parent_local,
        )

        def function_state_at(token_index):
            return _expansion_state.function_state_at(unit, expansion_state, token_index)

        def variable_state_at(token_index):
            return _expansion_state.variable_state_at(
                unit, expansion_state, token_index,
                command_is_parent_local, active_compounds_execute,
            )

        _emit_substitutions(command, expansion_state, unit, function_state_at)
        _emit_functions(command, expansion_state, unit, function_state_at,
                        variable_state_at, active_compounds_execute)
        _emit_eval(command, expansion_state, unit, function_state_at,
                   variable_state_at, active_compounds_execute)
        _emit_alias(command, expansion_state, unit, function_state_at,
                    active_compounds_execute)
        _commit_unit(expansion_state, unit, active_compounds_execute,
                     command_is_parent_local, variable_state_at)
    return expansion_state.invoked
