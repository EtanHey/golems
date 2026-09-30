from .common import *  # noqa: F403

def test_unset_function_removal_precedes_later_call():
    proc = run_hook(
        bash_payload(
            "f() { tee /tmp/leak </dev/null; }; unset -f f; f"
        )
    )
    assert_allowed(proc)


def test_pipeline_unset_does_not_remove_parent_function():
    proc = run_hook(
        bash_payload(
            "f() { tee /tmp/leak </dev/null; }; unset -f f | cat; f"
        )
    )
    assert_denied(proc)


def test_pipeline_unalias_does_not_remove_parent_alias():
    proc = run_hook(
        bash_payload(
            "shopt -s expand_aliases\n"
            "alias leak='tee /tmp/leak </dev/null'\n"
            "unalias leak | cat\n"
            "leak"
        )
    )
    assert_denied(proc)


def test_env_operand_does_not_use_shell_function_lookup():
    proc = run_hook(
        bash_payload(
            "f_tmp_block_unique() { tee /tmp/leak </dev/null; }; "
            "env f_tmp_block_unique"
        )
    )
    assert_allowed(proc)


def test_variable_invoked_function_body_is_scanned():
    proc = run_hook(
        bash_payload("f() { echo hi > /tmp/leak; }; x=f; $x")
    )
    assert_denied(proc)


def test_eval_invoked_function_body_is_scanned():
    proc = run_hook(
        bash_payload("f() { echo hi > /tmp/leak; }; eval f")
    )
    assert_denied(proc)


def test_eval_quoted_payload_invoked_function_body_is_scanned():
    proc = run_hook(
        bash_payload("f() { echo hi > /tmp/leak; }; eval 'f arg'")
    )
    assert_denied(proc)


def test_eval_variable_invoked_function_body_is_scanned():
    proc = run_hook(
        bash_payload('f() { echo hi > /tmp/leak; }; x=f; eval "$x"')
    )
    assert_denied(proc)


def test_eval_command_operand_does_not_use_shell_function_lookup():
    proc = run_hook(
        bash_payload("f() { tee /tmp/leak </dev/null; }; eval 'command f'")
    )
    assert_allowed(proc)


def test_eval_direct_redirect_is_scanned():
    proc = run_hook(bash_payload("eval 'echo hi > /tmp/leak'"))
    assert_denied(proc)


def test_eval_direct_tee_is_scanned():
    proc = run_hook(bash_payload("eval 'tee /tmp/leak </dev/null'"))
    assert_denied(proc)


def test_builtin_eval_direct_redirect_is_scanned():
    proc = run_hook(bash_payload("builtin eval 'echo hi > /tmp/leak'"))
    assert_denied(proc)


def test_eval_inherits_active_alias_state():
    proc = run_hook(
        bash_payload(
            "shopt -s expand_aliases\n"
            "alias leak='tee /tmp/leak </dev/null'\n"
            "eval leak"
        )
    )
    assert_denied(proc)


def test_variable_invoked_eval_direct_redirect_is_scanned():
    proc = run_hook(
        bash_payload("e=eval; $e 'echo hi > /tmp/leak'")
    )
    assert_denied(proc)


def test_recursively_wrapped_builtin_eval_is_scanned():
    proc = run_hook(
        bash_payload("builtin builtin eval 'echo hi > /tmp/leak'")
    )
    assert_denied(proc)


def test_function_positional_arguments_forwarded_to_eval_are_scanned():
    proc = run_hook(
        bash_payload("e() { eval \"$@\"; }; e 'echo hi > /tmp/leak'")
    )
    assert_denied(proc)


def test_variable_invoked_builtin_eval_is_scanned():
    proc = run_hook(
        bash_payload("b=builtin; $b eval 'echo hi > /tmp/leak'")
    )
    assert_denied(proc)


def test_indirect_eval_in_function_forwards_positional_arguments():
    proc = run_hook(
        bash_payload(
            "e() { x=eval; $x \"$@\"; }; "
            "e 'echo hi > /tmp/leak'"
        )
    )
    assert_denied(proc)


def test_eval_forwards_multi_digit_positional_argument():
    proc = run_hook(
        bash_payload(
            "e() { eval \"${10}\"; }; "
            "e a b c d e f g h i 'echo hi > /tmp/leak'"
        )
    )
    assert_denied(proc)


def test_command_wrapped_builtin_eval_is_scanned():
    proc = run_hook(
        bash_payload("command builtin eval 'echo hi > /tmp/leak'")
    )
    assert_denied(proc)


def test_nested_function_argument_mapping_reaches_eval():
    proc = run_hook(
        bash_payload(
            "g() { eval \"$2\"; }; "
            "f() { g x \"$1\"; }; "
            "f 'echo hi > /tmp/leak'"
        )
    )
    assert_denied(proc)


def test_local_assignment_indirect_eval_forwards_arguments():
    proc = run_hook(
        bash_payload(
            "e() { local x=eval; $x \"$@\"; }; "
            "e 'echo hi > /tmp/leak'"
        )
    )
    assert_denied(proc)


def test_eval_forwards_positional_slice():
    proc = run_hook(
        bash_payload(
            "e() { eval \"${@:2}\"; }; "
            "e x 'echo hi > /tmp/leak'"
        )
    )
    assert_denied(proc)


def test_command_option_wrapped_builtin_eval_is_scanned():
    proc = run_hook(
        bash_payload("command -p builtin eval 'echo hi > /tmp/leak'")
    )
    assert_denied(proc)


def test_eval_forwards_bounded_positional_slice():
    proc = run_hook(
        bash_payload(
            "e() { eval \"${@:2:1}\"; }; "
            "e x 'echo hi > /tmp/leak' ignored"
        )
    )
    assert_denied(proc)


def test_transitive_command_wrapper_suppresses_function_lookup():
    proc = run_hook(
        bash_payload(
            "g() { eval \"$2\"; }; "
            "f() { command g x \"$1\"; }; "
            "f 'echo hi > /tmp/leak'"
        )
    )
    assert_allowed(proc)


def test_eval_forwards_arithmetic_positional_slice():
    proc = run_hook(
        bash_payload(
            "e() { eval \"${@: +2:1}\"; }; "
            "e x 'echo hi > /tmp/leak' ignored"
        )
    )
    assert_denied(proc)


def test_negative_positional_slice_length_prevents_eval():
    proc = run_hook(
        bash_payload(
            "e() { eval \"${@:2:-1}\"; }; "
            "e x 'echo hi > /tmp/leak' ignored"
        )
    )
    assert_allowed(proc)


def test_command_lookup_option_does_not_execute_eval():
    proc = run_hook(
        bash_payload("command -v eval 'echo hi > /tmp/leak'")
    )
    assert_allowed(proc)


def test_eval_resolves_inherited_environment_payload():
    proc = run_hook(
        bash_payload('eval "$PAYLOAD"'),
        env_extra={"PAYLOAD": "echo hi > /tmp/leak"},
    )
    assert_denied(proc)


def test_negative_arithmetic_slice_length_prevents_eval():
    proc = run_hook(
        bash_payload(
            "e() { eval \"${@:2:1-2}\"; }; "
            "e x 'echo hi > /tmp/leak' ignored"
        )
    )
    assert_allowed(proc)


def test_eval_resolves_inherited_parameter_default_operator():
    proc = run_hook(
        bash_payload('eval "${PAYLOAD:-true}"'),
        env_extra={"PAYLOAD": "echo hi > /tmp/leak"},
    )
    assert_denied(proc)


def test_eval_resolves_positional_parameter_default_operator():
    proc = run_hook(
        bash_payload(
            "e() { eval \"${1:-true}\"; }; "
            "e 'echo hi > /tmp/leak'"
        )
    )
    assert_denied(proc)


def test_unset_variable_does_not_reuse_inherited_eval_payload():
    proc = run_hook(
        bash_payload('unset PAYLOAD; eval "$PAYLOAD"'),
        env_extra={"PAYLOAD": "echo hi > /tmp/leak"},
    )
    assert_allowed(proc)


def test_export_assignment_is_visible_to_eval():
    proc = run_hook(
        bash_payload(
            "export PAYLOAD='echo hi > /tmp/leak'; eval \"$PAYLOAD\""
        )
    )
    assert_denied(proc)


def test_eval_resolves_named_indirect_expansion():
    proc = run_hook(
        bash_payload(
            "PAYLOAD='echo hi > /tmp/leak'; ref=PAYLOAD; eval \"${!ref}\""
        )
    )
    assert_denied(proc)


def test_builtin_unset_does_not_reuse_inherited_eval_payload():
    proc = run_hook(
        bash_payload('builtin unset PAYLOAD; eval "$PAYLOAD"'),
        env_extra={"PAYLOAD": "echo hi > /tmp/leak"},
    )
    assert_allowed(proc)


def test_unset_function_mode_keeps_inherited_eval_variable():
    proc = run_hook(
        bash_payload('builtin unset -f PAYLOAD; eval "$PAYLOAD"'),
        env_extra={"PAYLOAD": "echo hi > /tmp/leak"},
    )
    assert_denied(proc)


def test_export_assignment_expands_known_variable_for_eval():
    proc = run_hook(
        bash_payload(
            "X='echo hi > /tmp/leak'; export PAYLOAD=\"$X\"; "
            "eval \"$PAYLOAD\""
        )
    )
    assert_denied(proc)


def test_declaration_assignments_expand_from_precommand_snapshot():
    proc = run_hook(
        bash_payload(
            "X='echo hi > /tmp/leak'; export X=true PAYLOAD=\"$X\"; "
            "eval \"$PAYLOAD\""
        )
    )
    assert_denied(proc)


def test_conflicting_unset_modes_preserve_inherited_eval_variable():
    proc = run_hook(
        bash_payload('unset -f -v PAYLOAD; eval "$PAYLOAD"'),
        env_extra={"PAYLOAD": "echo hi > /tmp/leak"},
    )
    assert_denied(proc)


def test_variable_invoked_builtin_declaration_is_visible_to_eval():
    proc = run_hook(
        bash_payload(
            "b=builtin; $b export PAYLOAD='echo hi > /tmp/leak'; "
            "eval \"$PAYLOAD\""
        )
    )
    assert_denied(proc)


def test_inherited_variable_invokes_eval():
    proc = run_hook(
        bash_payload("$E 'echo hi > /tmp/leak'"),
        env_extra={"E": "eval"},
    )
    assert_denied(proc)


def test_export_function_mode_preserves_inherited_eval_variable():
    proc = run_hook(
        bash_payload('export -f PAYLOAD=true; eval "$PAYLOAD"'),
        env_extra={"PAYLOAD": "echo hi > /tmp/leak"},
    )
    assert_denied(proc)


def test_eval_resolves_inherited_substring_expansion():
    proc = run_hook(
        bash_payload('eval "${PAYLOAD:0}"'),
        env_extra={"PAYLOAD": "echo hi > /tmp/leak"},
    )
    assert_denied(proc)


def test_standalone_assignment_expands_known_eval_variable():
    proc = run_hook(
        bash_payload(
            "PAYLOAD='echo hi > /tmp/leak'; X=$PAYLOAD; eval \"$X\""
        )
    )
    assert_denied(proc)


def test_eval_resolves_parameter_assignment_operator():
    proc = run_hook(
        bash_payload('eval "${PAYLOAD:=echo hi > /tmp/leak}"')
    )
    assert_denied(proc)


def test_standalone_assignment_resolves_parameter_operator():
    proc = run_hook(
        bash_payload(
            "PAYLOAD='echo hi > /tmp/leak'; "
            "X=${PAYLOAD:-true}; eval \"$X\""
        )
    )
    assert_denied(proc)


def test_eval_resolves_nested_assignment_operator_word():
    proc = run_hook(
        bash_payload(
            'eval "${PAYLOAD:=${X:-echo hi > /tmp/leak}}"'
        )
    )
    assert_denied(proc)


def test_eval_resolves_nested_default_operator_word():
    proc = run_hook(
        bash_payload(
            'eval "${V0:-${V1:-echo hi > /tmp/leak}}"'
        )
    )
    assert_denied(proc)


def test_eval_conservatively_scans_pattern_modified_positional():
    proc = run_hook(
        bash_payload(
            "e() { eval \"${1#zzz}\"; }; "
            "e 'echo hit > /tmp/leak'"
        )
    )
    assert_denied(proc)


def test_eval_conservatively_scans_command_substitution_value():
    proc = run_hook(
        bash_payload(
            "PAYLOAD=$(printf 'echo hit > /tmp/leak'); eval \"$PAYLOAD\""
        )
    )
    assert_denied(proc)


def test_eval_blocks_encoded_command_substitution_output():
    proc = run_hook(
        bash_payload(
            "PAYLOAD=$(printf 'echo hit \\x3e /tmp/leak'); eval \"$PAYLOAD\""
        )
    )
    assert_denied(proc)


def test_eval_conservatively_scans_positional_replacement_text():
    proc = run_hook(
        bash_payload(
            "e() { eval \"${1/x/echo hit > /tmp/leak}\"; }; e x"
        )
    )
    assert_denied(proc)


def test_eval_blocks_declaration_command_substitution_value():
    proc = run_hook(
        bash_payload(
            "export PAYLOAD=$(printf 'echo hit > /tmp/leak'); "
            "eval \"$PAYLOAD\""
        )
    )
    assert_denied(proc)


def test_eval_blocks_direct_command_substitution_value():
    proc = run_hook(
        bash_payload(
            "eval \"$(printf 'echo hit \\x3e /tmp/leak')\""
        )
    )
    assert_denied(proc)


def test_eval_conservatively_scans_named_parameter_modifier():
    proc = run_hook(
        bash_payload(
            "PAYLOAD='echo hit > /tmp/leak'; eval \"${PAYLOAD#zzz}\""
        )
    )
    assert_denied(proc)


def test_eval_blocks_printf_v_assignment_value():
    proc = run_hook(
        bash_payload(
            "printf -v PAYLOAD '%b' 'echo hit \\x3e /tmp/leak'; "
            "eval \"$PAYLOAD\""
        )
    )
    assert_denied(proc)


def test_eval_blocks_nameref_declaration_value():
    proc = run_hook(
        bash_payload(
            "declare -n PAYLOAD=REF; REF='echo hit > /tmp/leak'; "
            "eval \"$PAYLOAD\""
        )
    )
    assert_denied(proc)


def test_eval_blocks_read_assignment_value():
    proc = run_hook(
        bash_payload(
            "read -r PAYLOAD <<< 'echo hit > /tmp/leak'; "
            "eval \"$PAYLOAD\""
        )
    )
    assert_denied(proc)


def test_eval_blocks_grouped_nameref_declaration_value():
    proc = run_hook(
        bash_payload(
            "declare -gn PAYLOAD=REF; REF='echo hit > /tmp/leak'; "
            "eval \"$PAYLOAD\""
        )
    )
    assert_denied(proc)


def test_eval_blocks_default_read_reply_value():
    proc = run_hook(
        bash_payload(
            "read -r <<< 'echo hit > /tmp/leak'; eval \"$REPLY\""
        )
    )
    assert_denied(proc)


def test_eval_blocks_read_reply_after_option_operand():
    proc = run_hook(
        bash_payload(
            "read -p PROMPT <<< 'echo hit > /tmp/leak'; "
            "eval \"$REPLY\""
        )
    )
    assert_denied(proc)


def test_eval_blocks_read_array_destination():
    proc = run_hook(
        bash_payload(
            "read -a PAYLOAD <<< 'echo hit > /tmp/leak'; "
            "eval \"$PAYLOAD\""
        )
    )
    assert_denied(proc)


def test_eval_blocks_positional_parameter_assigned_by_set():
    proc = run_hook(
        bash_payload(
            "set -- 'echo hit > /tmp/leak'; "
            "eval \"$1\""
        )
    )
    assert_denied(proc)


def test_eval_blocks_mapfile_array_destination():
    proc = run_hook(
        bash_payload(
            "mapfile PAYLOAD <<< 'echo hit > /tmp/leak'; "
            "eval \"$PAYLOAD\""
        )
    )
    assert_denied(proc)


def test_eval_blocks_default_readarray_destination():
    proc = run_hook(
        bash_payload(
            "readarray <<< 'echo hit > /tmp/leak'; "
            "eval \"$MAPFILE\""
        )
    )
    assert_denied(proc)


def test_direct_tee_in_false_branch_is_skipped():
    proc = run_hook(
        bash_payload("if false; then tee /tmp/leak </dev/null; fi")
    )
    assert_allowed(proc)


def test_exec_operand_does_not_use_shell_function_lookup():
    proc = run_hook(
        bash_payload("f() { tee /tmp/leak </dev/null; }; exec f")
    )
    assert_allowed(proc)


def test_compound_status_controls_following_short_circuit():
    proc = run_hook(
        bash_payload(
            "if true; then true; fi && "
            "leakfn() { tee /tmp/leak </dev/null; }; "
            'echo "$(leakfn)"'
        )
    )
    assert_denied(proc)


def test_false_if_without_else_returns_success():
    proc = run_hook(
        bash_payload(
            "if false; then :; fi && "
            "leakfn() { tee /tmp/leak </dev/null; }; "
            'echo "$(leakfn)"'
        )
    )
    assert_denied(proc)


def test_unknown_if_branch_remains_fail_closed():
    proc = run_hook(
        bash_payload(
            "if test x = x; then "
            "leakfn() { tee /tmp/leak </dev/null; }; "
            "fi; "
            'echo "$(leakfn)"'
        )
    )
    assert_denied(proc)


def test_unknown_else_branch_remains_fail_closed():
    proc = run_hook(
        bash_payload(
            "if test x = y; then :; else "
            "leakfn() { tee /tmp/leak </dev/null; }; "
            "fi; "
            'echo "$(leakfn)"'
        )
    )
    assert_denied(proc)


def test_unknown_loop_condition_remains_fail_closed():
    proc = run_hook(
        bash_payload(
            "while test x = x; do "
            "leakfn() { tee /tmp/leak </dev/null; }; break; "
            "done; "
            'echo "$(leakfn)"'
        )
    )
    assert_denied(proc)


def test_dynamic_only_for_list_remains_fail_closed():
    proc = run_hook(
        bash_payload(
            "v=one; for x in $v; do "
            "leakfn() { tee /tmp/leak </dev/null; }; "
            "done; "
            'echo "$(leakfn)"'
        )
    )
    assert_denied(proc)


