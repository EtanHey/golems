from .common import *  # noqa: F403

def test_alias_to_function_keeps_parse_time_alias_expansion():
    proc = run_hook(
        bash_payload(
            "shopt -s expand_aliases\n"
            "alias leak='tee /tmp/leak </dev/null'\n"
            "f() { leak; }\n"
            "alias outer='f'\n"
            "outer"
        )
    )
    assert_denied(proc)


def test_alias_invocation_arguments_are_preserved():
    for definition, invocation in (
        ("alias leak='tee'", "leak /tmp/leak </dev/null"),
        (
            "alias wt='git worktree add'",
            "wt /workspace/off HEAD",
        ),
    ):
        proc = run_hook(
            bash_payload(
                f"shopt -s expand_aliases; {definition}\n{invocation}"
            )
        )
        assert_denied(proc)


def test_alias_synthesis_preserves_quoted_literal_metacharacters():
    proc = run_hook(
        bash_payload(
            "shopt -s expand_aliases; "
            'alias harmless="echo \'safe; tee /tmp/leak\'"\n'
            "harmless"
        )
    )
    assert_allowed(proc)


def test_alias_invocation_hatches_cover_first_expanded_command(tmp_path):
    ledger = tmp_path / "ledger.jsonl"
    commands = (
        (
            "alias leak='tee /tmp/leak </dev/null'",
            "WEAVE_ALLOW_TMP=1 leak",
        ),
        (
            "alias leak='git worktree add /workspace/off HEAD'",
            "WEAVE_ALLOW_WT_MIGRATION=1 leak",
        ),
    )
    for definition, invocation in commands:
        proc = run_hook(
            bash_payload(
                f"shopt -s expand_aliases; {definition}\n{invocation}"
            ),
            env_extra={"TMP_BLOCK_LEDGER": str(ledger)},
        )
        assert_allowed(proc)


def test_unalias_removes_tracked_alias_state():
    prefix = (
        "shopt -s expand_aliases; "
        "alias leak='tee /tmp/leak </dev/null'\n"
    )
    for removal in ("unalias leak", "unalias -a"):
        proc = run_hook(bash_payload(f"{prefix}{removal}\nleak"))
        assert_allowed(proc)


def test_alias_expansion_precedes_execution_in_multiline_compound():
    compounds = (
        "if true; then\n  unalias leak\n  leak\nfi",
        "{\n  unalias leak\n  leak\n}",
        "{\n  ./}\n  unalias leak\n  leak\n}",
        "{\n  echo hi >}\n  unalias leak\n  leak\n}",
        "{\n  echo hi >|}\n  unalias leak\n  leak\n}",
        "{\n  echo hi >&}\n  unalias leak\n  leak\n}",
        "{\n  echo hi <&}\n  unalias leak\n  leak\n}",
        "(\n  unalias leak\n  leak\n)",
        "(\n  echo hi >(cat)\n  unalias leak\n  leak\n)",
        "(\n  case x in x) true;; esac\n  unalias leak\n  leak\n)",
        "coproc {\n  unalias leak\n  leak\n}",
        "coproc LEAKER {\n  unalias leak\n  leak\n}",
        "coproc LEAKER if true; then\n  unalias leak\n  leak\nfi",
        "coproc LEAKER while true; do\n  unalias leak\n  leak\n  break\ndone",
        "if echo \\\nfi; then\n  unalias leak\n  leak\nfi",
        "i\\\nf true; then\n  unalias leak\n  leak\nfi",
    )
    for compound in compounds:
        proc = run_hook(
            bash_payload(
                "shopt -s expand_aliases\n"
                "alias leak='tee /tmp/leak </dev/null'\n"
                f"{compound}"
            )
        )
        assert_denied(proc)

    ordinary_brace_argument = run_hook(
        bash_payload(
            "shopt -s expand_aliases\n"
            "echo {\n"
            "alias leak='tee /tmp/leak </dev/null'\n"
            "leak"
        )
    )
    assert_denied(ordinary_brace_argument)

    attached_brace_word = run_hook(
        bash_payload(
            "shopt -s expand_aliases\n"
            "{foo\n"
            "alias leak='tee /tmp/leak </dev/null'\n"
            "leak"
        )
    )
    assert_denied(attached_brace_word)

    doubled_brace_word = run_hook(
        bash_payload(
            "shopt -s expand_aliases\n"
            "{{\n"
            "alias leak='tee /tmp/leak </dev/null'\n"
            "leak"
        )
    )
    assert_denied(doubled_brace_word)

    redirected_group_close = run_hook(
        bash_payload(
            "shopt -s expand_aliases\n"
            "{\n"
            "  true\n"
            "}>>/dev/null\n"
            "alias leak='tee /tmp/leak </dev/null'\n"
            "leak"
        )
    )
    assert_denied(redirected_group_close)


def test_parent_aliases_expand_in_hidden_command_substitutions():
    commands = (
        'echo "$(leak)"',
        "echo \"`leak`\"",
        'echo "$(( $(leak) + 0 ))"',
    )
    for command in commands:
        proc = run_hook(
            bash_payload(
                "shopt -s expand_aliases\n"
                "alias leak='tee /tmp/leak </dev/null'\n"
                f"{command}"
            )
        )
        assert_denied(proc)


def test_parent_function_runs_in_hidden_command_substitution():
    proc = run_hook(
        bash_payload(
            "leakfn() { tee /tmp/leak </dev/null; }\n"
            'echo "$(leakfn)"'
        )
    )
    assert_denied(proc)


def test_same_unit_function_runs_in_hidden_command_substitution():
    proc = run_hook(
        bash_payload(
            "leakfn() { tee /tmp/leak </dev/null; }; "
            'echo "$(leakfn)"'
        )
    )
    assert_denied(proc)


def test_skipped_function_is_not_inherited_by_hidden_substitution():
    proc = run_hook(
        bash_payload(
            "if false; then "
            "leakfn() { tee /tmp/leak </dev/null; }; "
            "fi; "
            'echo "$(leakfn)"'
        )
    )
    assert_allowed(proc)


def test_executed_compound_function_is_inherited_by_hidden_substitution():
    commands = (
        "if true; then "
        "leakfn() { tee /tmp/leak </dev/null; }; "
        "fi; ",
        "{ leakfn() { tee /tmp/leak </dev/null; }; }; ",
    )
    for prefix in commands:
        proc = run_hook(
            bash_payload(prefix + 'echo "$(leakfn)"')
        )
        assert_denied(proc)


def test_literal_condition_inherits_only_executed_branch():
    false_else = run_hook(
        bash_payload(
            "if false; then :; else "
            "leakfn() { tee /tmp/leak </dev/null; }; "
            "fi; "
            'echo "$(leakfn)"'
        )
    )
    assert_denied(false_else)

    true_else = run_hook(
        bash_payload(
            "if true; then :; else "
            "leakfn() { tee /tmp/leak </dev/null; }; "
            "fi; "
            'echo "$(leakfn)"'
        )
    )
    assert_allowed(true_else)


def test_literal_condition_list_uses_last_command_status():
    proc = run_hook(
        bash_payload(
            "if false; true; then "
            "leakfn() { tee /tmp/leak </dev/null; }; "
            "fi; "
            'echo "$(leakfn)"'
        )
    )
    assert_denied(proc)


def test_literal_condition_honors_short_circuit_and_assignments():
    conditions = ("true || false", "X=1 true")
    for condition in conditions:
        proc = run_hook(
            bash_payload(
                f"if {condition}; then "
                "leakfn() { tee /tmp/leak </dev/null; }; "
                "fi; "
                'echo "$(leakfn)"'
            )
        )
        assert_denied(proc)


def test_literal_condition_honors_negation_and_elif():
    conditions = (
        "if ! false; then",
        "if false; then :; elif true; then",
    )
    for condition in conditions:
        proc = run_hook(
            bash_payload(
                f"{condition} "
                "leakfn() { tee /tmp/leak </dev/null; }; "
                "fi; "
                'echo "$(leakfn)"'
            )
        )
        assert_denied(proc)


def test_colon_is_a_statically_true_condition():
    proc = run_hook(
        bash_payload(
            "if :; then "
            "leakfn() { tee /tmp/leak </dev/null; }; "
            "fi; "
            'echo "$(leakfn)"'
        )
    )
    assert_denied(proc)


def test_skipped_unalias_does_not_mutate_alias_state():
    proc = run_hook(
        bash_payload(
            "shopt -s expand_aliases\n"
            "alias leak='tee /tmp/leak </dev/null'\n"
            "if false; then unalias leak; fi\n"
            "leak"
        )
    )
    assert_denied(proc)


def test_definite_for_loop_propagates_function_definition():
    proc = run_hook(
        bash_payload(
            "for x in one; do "
            "leakfn() { tee /tmp/leak </dev/null; }; "
            "done; "
            'echo "$(leakfn)"'
        )
    )
    assert_denied(proc)


def test_empty_quoted_for_word_still_executes_loop():
    proc = run_hook(
        bash_payload(
            'for x in ""; do '
            "leakfn() { tee /tmp/leak </dev/null; }; "
            "done; "
            'echo "$(leakfn)"'
        )
    )
    assert_denied(proc)


def test_newline_delimited_empty_for_word_executes_loop():
    proc = run_hook(
        bash_payload(
            'for x in ""\n'
            "do\n"
            "leakfn() { tee /tmp/leak </dev/null; }\n"
            "done\n"
            'echo "$(leakfn)"'
        )
    )
    assert_denied(proc)


def test_quoted_substitution_is_one_definite_for_word():
    proc = run_hook(
        bash_payload(
            'for x in "$(false)"; do '
            "leakfn() { tee /tmp/leak </dev/null; }; "
            "done; "
            'echo "$(leakfn)"'
        )
    )
    assert_denied(proc)


def test_unquoted_substitution_internals_are_not_for_words():
    proc = run_hook(
        bash_payload(
            "for x in $(false); do "
            "leakfn() { tee /tmp/leak </dev/null; }; "
            "done; "
            'echo "$(leakfn)"'
        )
    )
    assert_allowed(proc)


def test_literal_case_arm_propagates_function_definition():
    proc = run_hook(
        bash_payload(
            "case x in x) "
            "leakfn() { tee /tmp/leak </dev/null; };; "
            "esac; "
            'echo "$(leakfn)"'
        )
    )
    assert_denied(proc)


def test_later_literal_case_arm_propagates_function_definition():
    proc = run_hook(
        bash_payload(
            "case y in x) :;; y) "
            "leakfn() { tee /tmp/leak </dev/null; };; "
            "esac; "
            'echo "$(leakfn)"'
        )
    )
    assert_denied(proc)


def test_case_glob_arm_propagates_function_definition():
    proc = run_hook(
        bash_payload(
            "case x in *) "
            "leakfn() { tee /tmp/leak </dev/null; };; "
            "esac; "
            'echo "$(leakfn)"'
        )
    )
    assert_denied(proc)


def test_case_preserves_first_matching_arm():
    proc = run_hook(
        bash_payload(
            "case x in x) :;; x) "
            "leakfn() { tee /tmp/leak </dev/null; };; "
            "esac; "
            'echo "$(leakfn)"'
        )
    )
    assert_allowed(proc)


def test_case_matches_alternative_pattern():
    proc = run_hook(
        bash_payload(
            "case y in x|y) "
            "leakfn() { tee /tmp/leak </dev/null; };; "
            "esac; "
            'echo "$(leakfn)"'
        )
    )
    assert_denied(proc)


def test_case_resets_after_unmatched_fallthrough_arm():
    proc = run_hook(
        bash_payload(
            "case y in x) :;& y) "
            "leakfn() { tee /tmp/leak </dev/null; };; "
            "esac; "
            'echo "$(leakfn)"'
        )
    )
    assert_denied(proc)


def test_quoted_case_wildcard_remains_literal():
    proc = run_hook(
        bash_payload(
            'case x in "*") '
            "leakfn() { tee /tmp/leak </dev/null; };; "
            "esac; "
            'echo "$(leakfn)"'
        )
    )
    assert_allowed(proc)


def test_nested_case_arms_keep_independent_pattern_state():
    proc = run_hook(
        bash_payload(
            "case x in x) case y in z) :;; y) "
            "leakfn() { tee /tmp/leak </dev/null; };; "
            "esac;; esac; "
            'echo "$(leakfn)"'
        )
    )
    assert_denied(proc)


def test_dynamic_case_subject_is_treated_as_uncertain():
    proc = run_hook(
        bash_payload(
            "x=y; case $x in y) "
            "leakfn() { tee /tmp/leak </dev/null; };; "
            "esac; "
            'echo "$(leakfn)"'
        )
    )
    assert_denied(proc)


def test_tilde_case_subject_is_treated_as_uncertain():
    proc = run_hook(
        bash_payload(
            "HOME=/durable; case ~ in /durable) "
            "leakfn() { tee /tmp/leak </dev/null; };; "
            "esac; "
            'echo "$(leakfn)"'
        )
    )
    assert_denied(proc)


def test_function_body_preserves_quoted_redirect_text():
    proc = run_hook(bash_payload('f() { echo ">" "/tmp/leak"; }; f'))
    assert_allowed(proc)


def test_definite_while_and_until_propagate_function_definition():
    loops = ("while true", "until false")
    for loop in loops:
        proc = run_hook(
            bash_payload(
                f"{loop}; do "
                "leakfn() { tee /tmp/leak </dev/null; }; break; "
                "done; "
                'echo "$(leakfn)"'
            )
        )
        assert_denied(proc)


def test_short_circuit_inside_definite_loop_skips_function_definition():
    proc = run_hook(
        bash_payload(
            "for x in one; do "
            "false && leakfn() { tee /tmp/leak </dev/null; }; "
            "done; "
            'echo "$(leakfn)"'
        )
    )
    assert_allowed(proc)


def test_top_level_short_circuit_skips_function_definition():
    proc = run_hook(
        bash_payload(
            "false && leakfn() { tee /tmp/leak </dev/null; }; "
            'echo "$(leakfn)"'
        )
    )
    assert_allowed(proc)


def test_unknown_short_circuit_remains_fail_closed():
    proc = run_hook(
        bash_payload(
            "test x = x && "
            "leakfn() { tee /tmp/leak </dev/null; }; "
            'echo "$(leakfn)"'
        )
    )
    assert_denied(proc)


def test_uncertain_unalias_does_not_remove_alias_state():
    proc = run_hook(
        bash_payload(
            "shopt -s expand_aliases\n"
            "alias leak='tee /tmp/leak </dev/null'\n"
            "if test x = y; then unalias leak; fi\n"
            "leak"
        )
    )
    assert_denied(proc)


def test_unsupported_for_header_remains_fail_closed():
    proc = run_hook(
        bash_payload(
            "for ((i=0;i<1;i++)); do "
            "leakfn() { tee /tmp/leak </dev/null; }; "
            "done; "
            'echo "$(leakfn)"'
        )
    )
    assert_denied(proc)


def test_select_body_remains_fail_closed():
    proc = run_hook(
        bash_payload(
            "select x in a; do "
            "leakfn() { tee /tmp/leak </dev/null; }; break; "
            "done <<<1; "
            'echo "$(leakfn)"'
        )
    )
    assert_denied(proc)


def test_function_definition_in_condition_is_inherited():
    proc = run_hook(
        bash_payload(
            "if leakfn() { tee /tmp/leak </dev/null; }; then :; fi; "
            'echo "$(leakfn)"'
        )
    )
    assert_denied(proc)


def test_case_fallthrough_uses_resolved_assignment_subject():
    proc = run_hook(
        bash_payload(
            "x=z; case $x in y) :;& q) "
            "leakfn() { tee /tmp/leak </dev/null; };; "
            "esac; "
            'echo "$(leakfn)"'
        )
    )
    assert_allowed(proc)


def test_skipped_assignment_does_not_override_case_subject():
    proc = run_hook(
        bash_payload(
            "x=y; false && x=z; case $x in y) "
            "leakfn() { tee /tmp/leak </dev/null; };; "
            "esac; "
            'echo "$(leakfn)"'
        )
    )
    assert_denied(proc)


def test_dynamic_assignment_invalidates_stale_case_subject():
    proc = run_hook(
        bash_payload(
            "v=y; x=z; x=$v; case $x in y) "
            "f() { tee /tmp/leak </dev/null; };; "
            "esac; "
            'echo "$(f)"'
        )
    )
    assert_denied(proc)


def test_posix_case_class_remains_fail_closed():
    proc = run_hook(
        bash_payload(
            "case x in [[:alpha:]]) "
            "leakfn() { tee /tmp/leak </dev/null; };; "
            "esac; "
            'echo "$(leakfn)"'
        )
    )
    assert_denied(proc)


def test_nocasematch_case_arm_remains_fail_closed():
    proc = run_hook(
        bash_payload(
            "shopt -s nocasematch\n"
            "case X in x) f() { tee /tmp/leak </dev/null; };; esac\n"
            'echo "$(f)"'
        )
    )
    assert_denied(proc)


def test_nocasematch_after_other_shopt_operand_remains_fail_closed():
    proc = run_hook(
        bash_payload(
            "shopt -s expand_aliases nocasematch; "
            "case X in x) f() { tee /tmp/leak </dev/null; };; esac; "
            'echo "$(f)"'
        )
    )
    assert_denied(proc)


def test_caret_negated_case_class_remains_fail_closed():
    proc = run_hook(
        bash_payload(
            "case x in [^a]) f() { tee /tmp/leak </dev/null; };; esac; "
            'echo "$(f)"'
        )
    )
    assert_denied(proc)


def test_command_builtin_suppresses_function_lookup():
    proc = run_hook(
        bash_payload(
            "leakfn() { tee /tmp/leak </dev/null; }; command leakfn"
        )
    )
    assert_allowed(proc)


def test_pipeline_function_definition_is_not_inherited():
    proc = run_hook(
        bash_payload("true | f() { tee /tmp/leak </dev/null; }; f")
    )
    assert_allowed(proc)


def test_boolean_after_function_definition_is_parent_local():
    proc = run_hook(
        bash_payload(
            "f() { tee /tmp/leak </dev/null; } && true; f"
        )
    )
    assert_denied(proc)


