from pathlib import Path
import shutil
import subprocess
import tempfile

root = Path(__file__).resolve().parents[4]
(root / 'docs.local/human-confirm-gate').mkdir(parents=True, exist_ok=True)
gate = Path('skills/golem-powers/human-confirm-gate')
mutations = [
    ('wrapper-option-arity', 'syntax.py', "'watch': {'-n', '--interval'}", "'watch': {'-n', '--interval', '-d'}", 'test_surfaces.Surfaces.test_r1_policy_surface'),
    ('unresolved-executor', 'commands.py', "if ('$' in word or '`' in word) and syntax.guarded_words(args):", 'if False:', 'test_gate.Gate.test_unresolved_executor_denies_non_push'),
    ('mutable-bindings', 'commands.py', "if any(positions[i] and t in ('eval', 'source', '.', 'read', 'unset', 'declare', 'typeset', 'local', 'let', 'trap') for i, t in enumerate(tokens[:limit])):", 'if False:', 'test_commands.Commands.test_assignment_scope_uncertainty_denies'),
    ('control-scope', 'commands.py', "if any(t in ('(', '&', '|', 'if', 'for', 'while', 'case') for t in tokens[:limit]):", 'if False:', 'test_commands.Commands.test_assignment_scope_uncertainty_denies'),
    ('assignment-resolution', 'commands.py', 'word = resolve_word(word, current)', 'word = word', 'test_commands.Commands.test_resolved_normal_push'),
    ('xargs', 'commands.py', "if base == 'xargs' and any(syntax.executable(a)[0] in ('git', 'gh', 'sh', 'bash', 'zsh', 'fish') for a in args):", 'if False:', 'test_commands.Commands.test_issue_500_expansions'),
    ('unresolved-eval', 'commands.py', ['if shell._UNRESOLVED_EVAL_MARKER in tokens:', "if base == 'eval' and any('$' in a or '`' in a for a in args):"], ['if False:', 'if False:'], 'test_commands.Commands.test_unknown_fails_closed'),
    ('push-literals', 'commands.py', '        literal(word)\n', '        pass\n', 'test_commands.Commands.test_unknown_fails_closed'),
    ('cwd-uncertain', 'commands.py', "repo is None or _state['config'] or overrides", "False or _state['config'] or overrides", 'test_integrity.Integrity.test_unknown_cwd_cannot_scope_push'),
    ('config-overrides', 'commands.py', "repo is None or _state['config'] or overrides", "repo is None or _state['config'] or False", 'test_integrity.Integrity.test_mirror_and_config_override_and_short_lease'),
    ('same-call-config', 'commands.py', "repo is None or _state['config'] or overrides", 'repo is None or False or overrides', 'test_r2.R2.test_r1_same_call_config_and_gh'),
    ('configured-mirror', 'git_config.py', 'return value is None or value.strip().strip(\'"\').strip().lower() not in FALSE', 'return False', 'test_integrity.Integrity.test_mirror_and_config_override_and_short_lease'),
    ('configured-plus', 'git_config.py', "return value.startswith('+') or value.startswith(':') and value != ':'", "return value.startswith(':') and value != ':'", 'test_git_routes.GitRoutes.test_destructive_config_setters_deny'),
    ('git-env', 'commands.py', "if relevant and any(prefix.startswith(('GIT_CONFIG', 'GIT_DIR=', 'GIT_WORK_TREE=', 'HOME=')) for prefix in tokens[:i]):", 'if False:', 'test_commands.Commands.test_unknown_fails_closed'),
    ('alias-case', 'commands.py', 'aliases[key[6:].lower()] = value', 'aliases[key[6:]] = value', 'test_r2.R2.test_r1_same_call_config_and_gh'),
    ('send-pack', 'commands.py', "elif sub in ('push', 'send-pack'):", "elif sub == 'push':", 'test_r2.R2.test_r1_shell_inputs_and_git_executors'),
    ('rebase-exec', 'commands.py', "elif sub == 'rebase':", "elif sub == 'unused':", 'test_r2.R2.test_r1_shell_inputs_and_git_executors'),
    ('submodule-exec', 'commands.py', "elif sub == 'submodule' and 'foreach' in tail:", 'elif False:', 'test_r2.R2.test_r1_shell_inputs_and_git_executors'),
    ('bisect-exec', 'commands.py', "elif sub == 'bisect' and tail[:1] == ['run']:", 'elif False:', 'test_r2.R2.test_r1_shell_inputs_and_git_executors'),
    ('rewrite', 'commands.py', "elif sub in ('filter-repo', 'filter-branch', 'replace'):", 'elif False:', 'test_commands.Commands.test_deny_shapes'),
    ('shell-input', 'commands.py', 'if base in syntax.SHELLS:', 'if False:', 'test_r2.R2.test_r1_shell_inputs_and_git_executors'),
    ('trap', 'commands.py', "if base == 'trap' and args:", 'if False:', 'test_r2.R2.test_r1_shell_inputs_and_git_executors'),
    ('wrapper-unwrap', 'syntax.py', 'if base not in WRAPPERS:', 'if True:', 'test_surfaces.Surfaces.test_r1_policy_surface'),
    ('find-unwrap', 'syntax.py', "if base == 'find':", 'if False:', 'test_surfaces.Surfaces.test_r1_policy_surface'),
    ('unknown-wrapper', 'commands.py', 'if base not in syntax.DATA and base not in syntax.SHELLS:', 'if False:', 'test_r2.R2.test_r1_wrappers'),
    ('redirect-consumption', 'syntax.py', "if word in ('>', '>>', '>|', '<', '<<', '<<<', '<>', '&>', '&>>'):", 'if False:', 'test_gate.Gate.test_denies_without_token_and_allows_normal'),
    ('gh-settings', 'commands.py', "elif base == 'gh':", "elif base == 'unused-gh':", 'test_r2.R2.test_r1_same_call_config_and_gh'),
    ('gh-graphql', 'gh_policy.py', "if path == 'graphql':", 'if False:', 'test_r2.R2.test_r1_same_call_config_and_gh'),
    ('gh-endpoint-normalize', 'gh_policy.py', "return re.sub('/+', '/', unquote(value)).strip('/')", 'return value', 'test_r2.R2.test_r1_same_call_config_and_gh'),
    ('ordinary-gh-overblock', 'gh_policy.py', 'guarded = settings_path(path, method)', "guarded = method not in ('GET', 'HEAD', 'OPTIONS')", 'test_r2.R2.test_r1_ordinary_commands'),
    ('policy-bash', 'commands.py', "if syntax.policy_write(base, args, redirects, cwd or '/', Path.home()) or uncertain_policy_target:", 'if False:', 'test_surfaces.Surfaces.test_r1_policy_surface'),
    ('policy-case', 'syntax.py', "os.path.realpath(os.path.join(cwd or '/', expand_home(raw, home))).casefold()", "os.path.realpath(os.path.join(cwd or '/', expand_home(raw, home)))", 'test_surfaces.Surfaces.test_r1_policy_surface'),
    ('alternate-surface', 'human-confirm-pretooluse.py', "if not isinstance(args.get('command'), str):", "if name != 'Bash':", 'test_surfaces.Surfaces.test_r1_policy_surface'),
    ('notebook-path', 'human-confirm-pretooluse.py', "args.get('file_path', args.get('notebook_path', ''))", "args.get('file_path', '')", 'test_surfaces.Surfaces.test_r1_policy_surface'),
    ('agent-write', 'human-confirm-pretooluse.py', "if policy_path(target, payload.get('cwd', str(home)), home):", 'if False:', 'test_gate.Gate.test_agent_write_rejected'),
    ('fail-closed', 'human-confirm-pretooluse.py', '        denied = True', '        denied = False', 'test_gate.Gate.test_invalid_payload_fails_closed'),
    ('nofollow', 'tokens.py', 'fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)', 'fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK)', 'test_integrity.Integrity.test_nofollow_and_uid'),
    ('uid', 'tokens.py', 'or info.st_uid != os.getuid() or info.st_size > 65536', 'or False or info.st_size > 65536', 'test_integrity.Integrity.test_nofollow_and_uid'),
    ('version', 'tokens.py', "token['version'] != 1", 'False', 'test_integrity.Integrity.test_version_nonce_and_anchor_mode'),
    ('nonce-filename', 'tokens.py', "path.name != nonce + '.json'", 'False', 'test_integrity.Integrity.test_version_nonce_and_anchor_mode'),
    ('mode', 'tokens.py', 'stat.S_IMODE(info.st_mode) != 0o600', 'False', 'test_gate.Gate.test_signature_mode_and_ref_sha'),
    ('principal-swap', 'tokens.py', "'-I', kind", "'-I', 'lead' if kind == 'human' else 'human'", 'test_integrity.Integrity.test_separate_principal_keys'),
    ('signature', 'tokens.py', "if not verify_signature(raw, anchor, kind, str(path) + '.sig'):", 'if False:', 'test_integrity.Integrity.test_unsigned_fresh_token'),
    ('ttl', 'tokens.py', "if not (token['issued_at'] <= now < token['expires_at'] <= token['issued_at'] + 300):", 'if False:', 'test_gate.Gate.test_wrong_scope_expired_or_unsigned'),
    ('digest', 'tokens.py', "token['command_sha256'] != digest", 'False', 'test_gate.Gate.test_wrong_scope_expired_or_unsigned'),
    ('scope', 'tokens.py', "token['operations'] != ops", 'False', 'test_gate.Gate.test_wrong_scope_expired_or_unsigned'),
    ('session', 'tokens.py', "token['session_id'] != payload['session_id']", 'False', 'test_gate.Gate.test_wrong_scope_expired_or_unsigned'),
    ('expiry-recheck', 'tokens.py', "if time.time() >= token['expires_at']:", 'if False:', 'test_gate.Gate.test_expiry_during_metadata_lookup'),
    ('replay', 'tokens.py', 'os.open(spent, os.O_CREAT | os.O_EXCL | os.O_WRONLY', 'os.open(spent, os.O_CREAT | os.O_WRONLY', 'test_gate.Gate.test_human_consumed_once'),
    ('lead-class', 'tokens.py', "if len(ops) != 1 or ops[0]['class'] != 'lease':", 'if False:', 'test_integrity.Integrity.test_lead_class_exact_command_and_collab_directory'),
    ('lead-exact-words', 'tokens.py', 'if words != prefix + expected:', 'if False:', 'test_integrity.Integrity.test_lead_class_exact_command_and_collab_directory'),
    ('collab-directory', 'tokens.py', 'if collab_root not in collab.resolve().parents:', 'if False:', 'test_integrity.Integrity.test_lead_class_exact_command_and_collab_directory'),
    ('collab-log', 'tokens.py', 'if line not in collab.read_text().splitlines():', 'if False:', 'test_gate.Gate.test_lead_scope'),
    ('default-branch', 'tokens.py', 'branch == default', 'False', 'test_gate.Gate.test_lead_scope'),
    ('closed-pr', 'tokens.py', "pr['state'] != 'OPEN'", 'False', 'test_gate.Gate.test_lead_scope'),
    ('merged-pr', 'tokens.py', "pr['mergedAt'] is not None", 'False', 'test_gate.Gate.test_lead_scope'),
    ('foreign-pr', 'tokens.py', "pr['isCrossRepository']", 'False', 'test_gate.Gate.test_lead_scope'),
    ('head-ref', 'tokens.py', "pr['headRefName'] != branch", 'False', 'test_gate.Gate.test_lead_scope'),
    ('head-sha', 'tokens.py', "pr['headRefOid'] != ops[0]['sha']", 'False', 'test_gate.Gate.test_lead_scope'),
    ('lease-sha', 'commands.py', '([0-9a-f]{40}|[0-9a-f]{64})', '([0-9a-f]{7,64})', 'test_integrity.Integrity.test_mirror_and_config_override_and_short_lease'),
    ('issuer-public-key', '@issuer', "if not re.match(r'^(?:ssh-|ecdsa-|sk-)[^\\s]+ [A-Za-z0-9+/=]+', key.read_text()):", 'if False:', 'test_issue.Issue.test_helper_refuses_software_private_key'),
    ('issuer-scope', '@issuer', "if not ops or any(op['class'] != args.action or not matches(op) for op in ops):", 'if False:', 'test_issue.Issue.test_helper_refuses_detectable_agent_and_invalid_scope'),
    ('issuer-agent', '@issuer', '    owner_terminal()', '    pass', 'test_issue.Issue.test_issuer_does_not_skip_agent_detection'),
    ('issuer-agent-only', '@issuer', "'-Y', 'sign', '-U', '-q'", "'-Y', 'sign', '-q'", 'test_issue.Issue.test_owner_helper_signs_via_public_key_agent_interface'),
    ('issuer-orphan', '@issuer', "raise ValueError('cannot establish owner login-terminal ancestry')", 'return', 'test_issue.Issue.test_orphan_and_agent_markers_refuse'),
    ('anchor-fingerprint', 'tokens.py', 'if hashlib.sha256(raw).hexdigest() not in pinned_fingerprints(PINS):', 'if False:', 'test_anchor.Anchor.test_anchor_rewrite_denies_human_and_lead_tokens'),
    ('anchor-pin-in-policy-dir', 'tokens.py', 'not in pinned_fingerprints(PINS):', "not in parse_pins((home / ANCHOR.parent / 'human-confirm.anchor.sha256').read_bytes()):", 'test_anchor.Anchor.test_policy_dir_rewrite_cannot_mint_tokens_even_with_a_same_dir_pin'),
    ('pin-working-tree', 'tokens.py', ['if committed.returncode or committed.stdout != pins.read_bytes():', 'return parse_pins(committed.stdout)'], ['if False:', 'return parse_pins(pins.read_bytes())'], 'test_anchor.Anchor.test_only_the_committed_pin_counts'),
    ('pin-grammar', 'tokens.py', "[0-9a-f]{64}(?: +[A-Za-z0-9._-]+)?)?')", "[0-9a-f]{64}(?:\\s+\\S+)?)?')", 'test_anchor.Platform.test_pin_grammar_matches_shared_vectors'),
    ('anchor-grammar-runtime', 'tokens.py', '    describe_anchor(raw)\n    return raw', '    return raw', 'test_anchor.Anchor.test_pin_requires_owner_review_of_principals_and_keys'),
    ('pin-confirm', 'tokens.py', 'if confirm is None or not confirm(rows):', 'if False:', 'test_anchor.Anchor.test_pin_requires_owner_review_of_principals_and_keys'),
    ('pin-one-key-per-principal', 'tokens.py', "or fields[0] in seen", "or False", 'test_anchor.Anchor.test_pin_requires_owner_review_of_principals_and_keys'),
    ('ssh-keygen-list-reader', 'syntax.py', "and 'l' in a and 'Y' not in a for a in args)", "and False for a in args)", 'test_anchor.Anchor.test_unrelated_commands_stay_allowed'),
    ('ancestors-anchor-only', 'syntax.py', "    if ancestors and roots[0].startswith(target.rstrip('/') + '/'):", "    if ancestors and any(r.startswith(target.rstrip('/') + '/') for r in roots):", 'test_anchor.Anchor.test_unrelated_commands_stay_allowed'),
    ('anchor-flags', 'tokens.py', "and getattr(info, 'st_flags', 0) & stat.UF_IMMUTABLE)", ')', 'test_anchor.Anchor.test_missing_immutable_flags_or_unsafe_metadata_deny'),
    ('anchor-dir-lock', 'tokens.py', 'locked(os.fstat(directory), stat.S_ISDIR, 0o700)', 'True', 'test_anchor.Anchor.test_missing_immutable_flags_or_unsafe_metadata_deny'),
    ('anchor-nofollow', 'tokens.py', 'os.open(ANCHOR.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)', 'os.open(ANCHOR.name, os.O_RDONLY | os.O_NONBLOCK, dir_fd=directory)', 'test_anchor.Anchor.test_symlinked_anchor_denies_even_with_identical_bytes'),
    ('anchor-links', 'tokens.py', 'and info.st_nlink == 1', '', 'test_anchor.Anchor.test_hard_links_cannot_be_added_and_preexisting_aliases_deny'),
    ('flag-unresolved', 'syntax.py', 'if any(unresolved(a, home) for a in args):\n        return True', 'if False:\n        return True', 'test_anchor.Anchor.test_flag_changes_that_could_reach_the_anchor_deny'),
    ('flag-recursive', 'syntax.py', "and 'R' in a for a in args)", "and False for a in args)", 'test_anchor.Anchor.test_flag_changes_that_could_reach_the_anchor_deny'),
    ('flag-case', 'syntax.py', '    base = os.path.basename(word).casefold()\n    if base in DATA:', '    base = os.path.basename(word)\n    if base in DATA:', 'test_anchor.Anchor.test_flag_changes_that_could_reach_the_anchor_deny'),
    ('flag-setfile', 'syntax.py', "FLAG_EXECUTORS = {'chflags', 'setfile'}", "FLAG_EXECUTORS = {'chflags'}", 'test_anchor.Anchor.test_flag_changes_that_could_reach_the_anchor_deny'),
    ('flag-indirect', 'syntax.py', 'if base in INDIRECT or base not in WRAPPERS', 'if base not in WRAPPERS', 'test_anchor.Anchor.test_flag_changes_that_could_reach_the_anchor_deny'),
    ('flag-wrapper-cwd', 'syntax.py', 'flag_write(executor, args[j + 1:], None, home)', 'flag_write(executor, args[j + 1:], cwd, home)', 'test_anchor.Anchor.test_flag_changes_that_could_reach_the_anchor_deny'),
    ('flag-unresolved-executor', 'syntax.py', '        if any(flag_clear(a) for a in args):\n            return flag_write', '        if False:\n            return flag_write', 'test_anchor.Anchor.test_flag_changes_that_could_reach_the_anchor_deny'),
    ('flag-unresolved-numeric', 'syntax.py', 'if any(flag_clear(a, numeric=True) for a in args) and any(', 'if False and any(', 'test_anchor.Anchor.test_flag_changes_that_could_reach_the_anchor_deny'),
    ('flag-renamed-binary', 'syntax.py', '    return any(flag_clear(a) for a in args) and any(', '    return False and any(', 'test_anchor.Anchor.test_flag_changes_that_could_reach_the_anchor_deny'),
    ('anchor-non-reader', 'syntax.py', "if any(anchor_path(c, cwd, home, ancestors=base in ('ln', 'link')) for a in args for c in _candidates(a)):", 'if False:', 'test_anchor.Anchor.test_opaque_writers_cannot_change_the_locked_anchor'),
    ('ln-ancestor', 'syntax.py', "ancestors=base in ('ln', 'link')", 'ancestors=False', 'test_anchor.Anchor.test_symlink_aliases_are_policy_targets_and_cannot_write'),
    ('option-value', 'syntax.py', "    if '=' in arg: yield arg.split('=', 1)[1]\n", '', 'test_anchor.Anchor.test_opaque_writers_cannot_change_the_locked_anchor'),
    ('pinned-tree', 'syntax.py', "(home / '.config/golems/human-confirm-anchor', gate, gate.parent / '_shared')", "(home / '.config/golems/human-confirm-anchor',)", 'test_anchor.Anchor.test_pinned_tree_is_protected'),
    ('cd-stack', 'commands.py', "target.startswith(('-', '+'))", 'False', 'test_anchor.Anchor.test_flag_changes_that_could_reach_the_anchor_deny'),
    ('popd', 'commands.py', "if base in ('cd', 'pushd', 'popd'):", "if base in ('cd', 'pushd'):", 'test_anchor.Anchor.test_flag_changes_that_could_reach_the_anchor_deny'),
    ('pin-replace-objects', 'tokens.py', ["[GIT, '--no-replace-objects', '-C'", "'GIT_NO_REPLACE_OBJECTS': '1', "], ["[GIT, '-C'", ''], 'test_anchor.Platform.test_pin_is_read_from_the_named_tree_without_object_replacement'),
    ('pin-ceiling', 'tokens.py', ", 'GIT_CEILING_DIRECTORIES': str(tree.parent)}", '}', 'test_anchor.Platform.test_pin_is_read_from_the_named_tree_without_object_replacement'),
    ('pin-nested-marker', 'tokens.py', "if any(os.path.lexists(directory / '.git') for directory in pins.parents[:3]):", 'if False:', 'test_anchor.Platform.test_pin_is_read_from_the_named_tree_without_object_replacement'),
    ('pin-discovered-repo', 'tokens.py', ["'--no-replace-objects', '-C', str(tree), 'cat-file'", 'timeout=2, env=env)'], ["'--no-replace-objects', 'cat-file'", 'timeout=2, env=env, cwd=pins.parent)'], 'test_anchor.Platform.test_pin_is_read_from_the_named_tree_without_object_replacement'),
    ('import-stdlib-first', 'human-confirm-pretooluse.py', "sys.path[:] = [p for p in sys.path if p and os.path.realpath(p) not in (HERE, os.path.realpath(SHARED))]", 'pass', 'test_anchor.Platform.test_hook_imports_put_the_stdlib_first_and_never_read_tree_bytecode'),
    ('import-no-bytecode', 'human-confirm-pretooluse.py', "sys.pycache_prefix = '/dev/null/golems-human-confirm'", 'pass', 'test_anchor.Platform.test_hook_imports_put_the_stdlib_first_and_never_read_tree_bytecode'),
    ('import-stray-check', 'human-confirm-pretooluse.py', 'if stray_importables():', 'if False:', 'test_anchor.Platform.test_compiled_file_beside_the_sources_denies_every_call'),
    ('launcher-preload', '@launcher', 'import pkgutil  # noqa: F401', 'import os  # noqa: F401', 'test_anchor.Platform.test_launcher_preloads_runpy_lazy_imports_from_the_stdlib'),
    ('trusted-gh-checks', 'tokens.py', ' and not info.st_mode & 0o022 and info.st_uid in (0, os.getuid())', '', 'test_anchor.Platform.test_trusted_gh_is_a_fixed_owner_checked_candidate_never_caller_path'),
    ('exec-casefold', 'syntax.py', "base = os.path.basename(word).casefold()\n    return ('git'", "base = os.path.basename(word)\n    return ('git'", 'test_git_routes.GitRoutes.test_casefolded_executors_and_wrappers_deny'),
    ('exec-family', 'syntax.py', "return ('git', base[4:]) if base.startswith('git-') and len(base) > 4 else (base, None)", 'return (base, None)', 'test_git_routes.GitRoutes.test_per_subcommand_executables_map_to_git'),
    ('effective-push', 'commands.py', 'tail, digest = git_config.effective_push(tail, repo)', 'digest = None', 'test_git_routes.GitRoutes.test_configured_delete_and_force_deny_on_next_call'),
    ('config-refs', 'git_config.py', "refs = [] if positional else [value.strip() for value in config.get(prefix + 'push', [])]", 'refs = []', 'test_git_routes.GitRoutes.test_configured_delete_and_force_deny_on_next_call'),
    ('config-mirror', 'git_config.py', "if truthy(last(prefix + 'mirror', 'false')):", 'if False:', 'test_git_routes.GitRoutes.test_effective_remote_and_explicit_refs'),
    ('branch-pushremote', 'git_config.py', "remote = (last('branch.' + branch + '.pushremote') or last('remote.pushdefault')", "remote = (last('remote.pushdefault')", 'test_git_routes.GitRoutes.test_effective_remote_and_explicit_refs'),
    ('remote-pushdefault', 'git_config.py', "or last('remote.pushdefault')\n", "\n", 'test_git_routes.GitRoutes.test_push_default_and_option_values'),
    ('push-option-cluster', 'git_config.py', "elif re.fullmatch(r'-[A-Za-z]+', word) and 'o' in word:", 'elif False:', 'test_git_routes.GitRoutes.test_push_default_and_option_values'),
    ('matching-colon', 'git_config.py', "return value.startswith('+') or value.startswith(':') and value != ':'", "return value.startswith('+') or value.startswith(':')", 'test_git_routes.GitRoutes.test_destructive_config_setters_deny'),
    ('route-digest', 'commands.py', "if digest is not None: op['push_config_sha256'] = digest", 'pass', 'test_git_routes.GitRoutes.test_remote_config_change_invalidates_prior_token'),
    ('config-setter', 'commands.py', 'setter = git_config.destructive_setter(tail)', 'setter = None', 'test_git_routes.GitRoutes.test_destructive_config_setters_deny'),
    ('edit-check', 'human-confirm-pretooluse.py', "if destructive_edit(name, args, payload.get('cwd', str(home))):", 'if False:', 'test_git_routes.GitRoutes.test_edit_and_write_destructive_git_config_deny'),
    ('edit-simulated', 'git_config.py', "            text = text.replace(old, new) if edit.get('replace_all') else text.replace(old, new, 1)\n    return destructive_config(text)", "            text = text.replace(old, new) if edit.get('replace_all') else text.replace(old, new, 1)\n    return destructive_config(str(args.get('new_string', '')))", 'test_git_routes.GitRoutes.test_edit_and_write_destructive_git_config_deny'),
    ('gh-host-check', 'gh_policy.py', "if url.hostname.lower() != 'api.github.com':", 'if False:', 'test_false_positives.GhMutants.test_api_host_is_checked'),
    ('gh-graphql-input-opaque', 'gh_policy.py', ["opaque |= arg == '--input'; i += 1", "opaque |= arg.startswith('--input=')"], ['i += 1', 'pass'], 'test_false_positives.GhMutants.test_graphql_input_is_opaque'),
    ('gh-transfer', 'gh_policy.py', "'environments', 'transfer')", "'environments')", 'test_false_positives.GhMutants.test_transfer_is_settings'),
    ('heredoc-views-agree', 'syntax.py', ' or _shell_heredoc_starts(command, shell) != starts:', ':', 'test_false_positives.FalsePositives.test_fp_a_ambiguous_heredoc_views_keep_the_full_scan'),
    ('heredoc-quoted-only', 'syntax.py', '            elif quoted:', '            else:', 'test_false_positives.FalsePositives.test_fp_a_ambiguous_heredoc_views_keep_the_full_scan'),
    ('heredoc-mask', 'commands.py', 'shell._executable_subcommands(syntax.mask_heredoc_bodies(command, shell))', 'shell._executable_subcommands(command)', 'test_false_positives.FalsePositives.test_fp_a_quoted_heredoc_prose_is_data'),
    ('apostrophe-protected', 'commands.py', "raise ValueError('unparseable protected payload')", 'pass', 'test_false_positives.FalsePositives.test_fp_b_apostrophes_in_quoted_args'),
    ('assignment-prefix', 'commands.py', '        if assignment:\n            continue', '        pass', 'test_false_positives.FalsePositives.test_fp_d_assignment_prefixes_are_not_executables'),
    ('gh-id-route', 'gh_policy.py', 'if not _EXPANSION.fullmatch(part) or parts[k - 1] not in ID_FAMILIES:', 'if False:', 'test_false_positives.FalsePositives.test_fp_e_shell_ids_under_comment_families'),
    ('graphql-variables-data', 'gh_policy.py', "if key not in ('query', 'operationName'): return False", 'pass', 'test_false_positives.FalsePositives.test_graphql_variables_are_graphql_syntax'),
    ('command-lookup', 'commands.py', 'if not positions[i] or syntax.looked_up(tokens, positions, i): continue', 'if not positions[i]: continue', 'test_false_positives.FalsePositives.test_command_lookup_runs_nothing'),
    ('command-v-wrapper', 'syntax.py', "if base == 'command' and any('v' in a or 'V' in a for a in options):", 'if False:', 'test_false_positives.FalsePositives.test_command_lookup_runs_nothing'),
    ('git-local-builtins', 'commands.py', '" maintenance merge-base merge-file', '" maintenance merge-file', 'test_false_positives.FalsePositives.test_git_local_commands_need_no_alias_lookup'),
    ('shell-stdin', 'commands.py', "elif syntax.shell_reads_stdin(base, args) or any(op == '<' and target == '(' for op, target in redirects):", 'elif False:', 'test_false_positives.FalsePositives.test_fp_c_script_operands_are_not_stdin'),
    ('shell-stdin-flag', 'syntax.py', "stdin |= char == 's'", 'stdin |= False', 'test_false_positives.FalsePositives.test_fp_c_script_operands_are_not_stdin'),
    ('shell-noexec', 'syntax.py', "if char == 'n' and arg[0] == '-':", 'if False:', 'test_false_positives.FalsePositives.test_fp_c_script_operands_are_not_stdin'),
    ('shell-long-unknown', 'syntax.py', "                raise ValueError('unknown shell option')\n            continue", '                i += 1\n            continue', 'test_false_positives.R2Mechanisms.test_shell_option_tables'),
    ('shell-zsh-table', 'syntax.py', "'zsh': ('o', {'--emulate'},", "'zsh': ('o', set(),", 'test_false_positives.R2Mechanisms.test_shell_option_tables'),
    ('shell-fish-table', 'syntax.py', "'fish': ('cCdopf',", "'fish': ('c',", 'test_false_positives.R2Mechanisms.test_shell_option_tables'),
    ('fish-payloads', 'syntax.py', "if base == 'fish' and name in ('--command', '--init-command') and eq:", 'if False:', 'test_false_positives.R2Mechanisms.test_shell_option_tables'),
    ('gh-dynamic-get', 'gh_policy.py', "if method in ('GET', 'HEAD') and len(positional) == 1: return []  # a literal-led read", 'pass', 'test_false_positives.FalsePositives.test_fp_e_shell_ids_under_comment_families'),
    ('gh-led-expansion', 'gh_policy.py', "if any(a[:1] in ('$', '`') for a in positional) or any(splits(a) for a in args):", 'if any(splits(a) for a in args):', 'test_false_positives.R2Mechanisms.test_dynamic_routes_need_a_literal_lead_and_no_splitting'),
    ('gh-split-unknown', 'gh_policy.py', "if any(a[:1] in ('$', '`') for a in positional) or any(splits(a) for a in args):", "if any(a[:1] in ('$', '`') for a in positional):", 'test_false_positives.R2Mechanisms.test_dynamic_routes_need_a_literal_lead_and_no_splitting'),
    ('split-param', 'syntax.py', "re.match(r'[{A-Za-z0-9_@*#?!$-]', text[i + 1:i + 2]):\n            splits = True", "re.match(r'[{A-Za-z0-9_@*#?!$-]', text[i + 1:i + 2]):\n            pass", 'test_false_positives.R2Mechanisms.test_word_splitting_evidence'),
    ('split-substitution', 'syntax.py', 'inner(found[0]); word.append(text[i:found[1]]); splits, started, i = True, True, found[1]', 'inner(found[0]); word.append(text[i:found[1]]); splits, started, i = False, True, found[1]', 'test_false_positives.R2Mechanisms.test_word_splitting_evidence'),
    ('split-inner-bodies', 'syntax.py', 'for key, value in split_words(body, shell).items():', 'for key, value in {}.items():', 'test_false_positives.R2Mechanisms.test_word_splitting_evidence'),
    ('rejoined-quoting', 'commands.py', 'split_map = {} if rejoined else syntax.split_words(command, shell)', 'split_map = syntax.split_words(command, shell)', 'test_false_positives.R2Mechanisms.test_rejoined_argv_has_lost_its_quoting'),
    ('graphql-literal-names', 'gh_policy.py', ' & set(literal_names)', '', 'test_false_positives.FalsePositives.test_graphql_variables_are_graphql_syntax'),
    ('graphql-literal-proof', 'commands.py', "'literal': syntax.single_quoted_names(command, shell)}", "'literal': set()}", 'test_false_positives.FalsePositives.test_graphql_variables_are_graphql_syntax'),
    ('literal-every-use', 'syntax.py', "            quoting[_NAME.match(text, i + 1)[1]] = False", '            pass', 'test_false_positives.R2Mechanisms.test_graphql_names_are_literal_only_when_every_use_is_single_quoted'),
    ('literal-unquoted-heredoc', 'syntax.py', '    if starts and (not all(quoted for _, _, quoted, _ in starts) or _shell_heredoc_starts(command, shell) != starts):\n        return set()', '    pass', 'test_false_positives.R2Mechanisms.test_graphql_names_are_literal_only_when_every_use_is_single_quoted'),
]
control = subprocess.run(['python3', '-m', 'unittest', 'discover', '-s', str(gate / 'tests')], cwd=root, capture_output=True, text=True)
(root / 'docs.local/human-confirm-gate/r2-mutation-control.log').write_text(control.stdout + control.stderr)
assert control.returncode == 0, 'baseline must pass before mutation proof'
print('baseline PASS', flush=True)
failed = []
for name, file, old, new, test in mutations:
    with tempfile.TemporaryDirectory(dir=root / 'docs.local/human-confirm-gate') as tmp:
        scratch = Path(tmp)
        shutil.copytree(root / gate, scratch / gate, ignore=shutil.ignore_patterns('__pycache__'))
        shutil.copytree(root / 'skills/golem-powers/_shared', scratch / 'skills/golem-powers/_shared', ignore=shutil.ignore_patterns('__pycache__'))
        (scratch / 'scripts/hooks').mkdir(parents=True)
        shutil.copy(root / 'scripts/hooks/fail-open.py', scratch / 'scripts/hooks/fail-open.py')
        shutil.copy(root / 'scripts/hooks/manifest.json', scratch / 'scripts/hooks/manifest.json')
        shutil.copy(root / 'scripts/golems-confirm', scratch / 'scripts/golems-confirm')
        (scratch / 'docs.local/human-confirm-gate').mkdir(parents=True)
        private = root / 'docs.local/human-confirm-anchor-integrity/test_private_f1b.py'
        if test.startswith('test_private_f1b.'):
            if not private.exists():
                print(name, 'SKIPPED (private tests absent)', flush=True); continue
            shutil.copy(private, scratch / gate / 'tests' / private.name)
        target = {'@issuer': scratch / 'scripts/golems-confirm',
                  '@launcher': scratch / 'scripts/hooks/fail-open.py'}.get(file, scratch / gate / 'hooks' / file)
        text = target.read_text()
        changed = text
        for before, after in zip(old if isinstance(old, list) else [old], new if isinstance(new, list) else [new]):
            assert before in changed, name
            changed = changed.replace(before, after, 1)
        compile(changed, str(target), 'exec')
        target.write_text(changed)
        run = subprocess.run(['python3', '-m', 'unittest', test], cwd=scratch, env=dict(__import__('os').environ, PYTHONPATH=str(scratch / gate / 'tests')), capture_output=True, text=True)
        # Syntax/import failures are not mutation proof.
        assert 'SyntaxError' not in run.stderr and 'ModuleNotFoundError' not in run.stderr, run.stderr
        killed = run.returncode != 0 and 'FAIL:' in run.stderr
        print(name, 'RED' if killed else 'SURVIVED', flush=True)
        (root / 'docs.local/human-confirm-gate' / ('r2-mutant-' + name + '.log')).write_text(run.stdout + run.stderr)
        if not killed: failed.append(name)
assert not failed, failed
