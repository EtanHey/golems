"""Per-load implementation package with explicit export and dependency registries."""

EXPORTS = (
    ('policy', ('Unresolvable', '_has_temp_hint', 'in_temp_class', 'on_convention', '_TMPDIR_TOKEN_RE', '_TEMP_HINT_RE', '_TEMP_PATH_TOKEN_RE', 'WORKTREE_DIR_NAME', '_CWD_CHANGING_CMDS')),
    ('runtime', ()),
    ('shell_targets', ('_bash_temp_targets',)),
    ('write_targets', ('ShellScan', 'scan_redirect_targets', 'scan_tee_targets', 'scan_worktree_targets')),
    ('worktree_args', ('_worktree_add_args', '_WORKTREE_VALUE_FLAGS')),
    ('worktrees', ('find_worktree_convention_issues',)),
    ('bypass', ('_hatched_segments', 'escape_hatch_covers', 'log_bypass', 'DEFAULT_LEDGER', 'HATCH_TMP', 'HATCH_WT')),
    ('tool_targets', ('canonical_tool', 'find_temp_targets', '_apply_patch_temp_targets', 'GUARDED_FILE_TOOLS', 'APPLY_PATCH_TOOL', 'TOOL_ALIASES', '_APPLY_PATCH_TARGET_RE')),
    ('resolution', ('resolve_targets',)),
    ('anchors', ('_bounded_loop_subshell_anchor', '_cwd_argument', '_shell_anchor_before', '_git_c_values', '_worktree_anchor')),
    ('compounds', ('_literal_branch_may_execute', '_bounded_compound_value_sets_before', '_enclosing_loop_changes_cwd')),
    ('assignments', ('_assignment_is_inside_control_compound', '_assignment_effects_between', '_literal_array_values_before')),
    ('variables', ('_static_shell_variables_before', '_static_shell_variable_state_before')),
    ('variable_builtins', ('BuiltinScan', 'invalidate_builtin_targets')),
    ('prefixes', ('_nearest_repo_root', '_literal_prefix_scan', '_has_literal_parent_component', '_literal_prefix_class', 'suggest_fixed_target', '_POSITIONAL_PARAM_RE')),
    ('words', ('_bounded_brace_values', '_bounded_word_values', 'resolve_target', '_SIMPLE_VAR_RE', '_MAX_STATIC_VALUES')),
    ('scope', ('_paren_contexts', '_segment_indices', '_process_substitution_parens', '_case_pattern_parens', '_literal_array_parens', '_success_chain_reaches', '_scope_affects_target')),
    ('shell_words', ('_direct_exposed_scope_keys', '_after_substitution_word', '_substitution_word_text')),
    ('chain_status', ('_segment_operator_before', '_segment_operator_after', '_chain_status_after')),
)

DEPENDENCIES = {
    'anchors': (
        'Unresolvable', '_ASSIGNMENT_RE', '_CWD_CHANGING_CMDS', '_SIMPLE_VAR_RE',
        '_bounded_compound_value_sets_before', '_case_pattern_parens', '_function_signature_parens',
        '_is_separator', '_literal_array_parens', '_process_substitution_parens', '_scope_affects_target',
        '_segment_indices', '_success_chain_reaches', 'resolve_target',
    ),
    'assignments': (
        'Unresolvable', '_ASSIGNMENT_RE', '_MAX_STATIC_VALUES', '_bounded_word_values', '_is_separator',
        '_segment_operator_after', '_segment_operator_before',
    ),
    'bypass': (
        '_ASSIGNMENT_RE', '_WRAPPER_CMDS', '_WRAPPER_VALUE_OPTS', '_executable_subcommands',
        '_invoked_alias_bodies', '_is_separator', '_nested_alias_segment', '_nested_segment',
        '_parse_bash', '_shell_command_payloads', '_shell_tokens', '_strip_heredoc_bodies', 'deny',
    ),
    'chain_status': (
        '_is_separator',
    ),
    'compounds': (
        'Unresolvable', '_ASSIGNMENT_RE', '_CWD_CHANGING_CMDS', '_MAX_STATIC_VALUES',
        '_assignment_effects_between', '_bounded_word_values', '_is_command_sub_close',
        '_is_command_sub_open', '_is_separator', '_literal_array_values_before', '_scope_affects_target',
        '_static_shell_variables_before',
    ),
    'prefixes': (
        'WORKTREE_DIR_NAME', '_QUOTED_LBRACE', '_QUOTED_RBRACE', '_SIMPLE_VAR_RE',
        '_executable_subcommands', '_substitution_word_text', 'in_temp_class', 'is_harness_scratchpad',
        'on_convention',
    ),
    'resolution': (
        'Unresolvable', '_bounded_compound_value_sets_before', '_bounded_word_values',
        '_enclosing_loop_changes_cwd', 'resolve_target',
    ),
    'scope': (
        '_is_separator',
    ),
    'shell_targets': (
        'ShellScan', 'Unresolvable', '_UNRESOLVED_EVAL_MARKER', '_direct_exposed_scope_keys',
        '_executable_subcommands', '_invoked_alias_bodies', '_mask_function_definition_bodies',
        '_mask_quoted_operator_words', '_nested_alias_segment', '_nested_segment', '_parse_bash',
        '_segment_is_fully_exposed', '_segment_is_prefix', '_shell_anchor_before',
        '_shell_command_payloads', '_strip_heredoc_bodies', '_worktree_add_args', 'scan_redirect_targets',
        'scan_tee_targets', 'scan_worktree_targets',
    ),
    'shell_words': (
        '_command_sub_word_continues', '_executable_subcommands', '_is_command_sub_open',
        '_strip_heredoc_bodies',
    ),
    'tool_targets': (
        '_bash_temp_targets', 'in_temp_class', 'ansi_c_readings', 'ansi_c_reading',
    ),
    'variables': (
        'BuiltinScan', '_ASSIGNMENT_RE', '_SIMPLE_VAR_RE', '_chain_status_after', '_is_separator',
        '_literal_prefix_scan', '_paren_contexts', '_segment_operator_after', '_segment_operator_before',
        '_success_chain_reaches', 'invalidate_builtin_targets',
    ),
    'words': (
        'Unresolvable', '_QUOTED_LBRACE', '_QUOTED_RBRACE',
    ),
    'worktree_args': (
        '_after_substitution_word', '_is_command_sub_open', '_is_separator',
    ),
    'worktrees': (
        'Unresolvable', '_direct_exposed_scope_keys', '_executable_subcommands', '_invoked_alias_bodies',
        '_literal_prefix_class', '_nested_alias_segment', '_nested_segment', '_parse_bash',
        '_shell_anchor_before', '_static_shell_variable_state_before', '_strip_heredoc_bodies',
        '_worktree_add_args', '_worktree_anchor', 'on_convention', 'resolve_targets',
    ),
    'write_targets': (
        'Unresolvable', '_after_substitution_word', '_bounded_loop_subshell_anchor',
        '_is_command_sub_open', '_literal_branch_may_execute', '_literal_prefix_class', '_nested_segment',
        '_shell_anchor_before', '_static_shell_variable_state_before', '_static_shell_variables_before',
        '_worktree_add_args', '_worktree_anchor', 'in_temp_class', 'resolve_targets',
    ),
}


def bind(modules, exports, **external):
    """Wire defining exports and explicitly supplied parser/callback dependencies."""
    for leaf, names in DEPENDENCIES.items():
        for name in names:
            value = external[name] if name in external else exports[name]
            setattr(modules[leaf], name, value)
