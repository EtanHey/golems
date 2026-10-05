from pathlib import Path
import shutil
import subprocess
import tempfile

root = Path(__file__).resolve().parents[4]
(root / 'docs.local/human-confirm-gate').mkdir(parents=True, exist_ok=True)
gate = Path('skills/golem-powers/human-confirm-gate')
mutations = [
    ('unresolved-executor', 'commands.py', "if ('$' in word or '`' in word) and syntax.guarded_words(args):", 'if False:', 'test_gate.Gate.test_unresolved_executor_denies_non_push'),
    ('mutable-bindings', 'commands.py', "if any(positions[i] and t in ('eval', 'source', '.', 'read', 'unset', 'declare', 'typeset', 'local', 'let', 'trap') for i, t in enumerate(tokens[:limit])):", 'if False:', 'test_commands.Commands.test_assignment_scope_uncertainty_denies'),
    ('control-scope', 'commands.py', "if any(t in ('(', '&', '|', 'if', 'for', 'while', 'case') for t in tokens):", 'if False:', 'test_commands.Commands.test_assignment_scope_uncertainty_denies'),
    ('assignment-resolution', 'commands.py', 'word = resolve_word(word, current)', 'word = word', 'test_commands.Commands.test_resolved_normal_push'),
    ('xargs', 'commands.py', "if base == 'xargs' and any(os.path.basename(a) in ('git', 'gh', 'sh', 'bash', 'zsh', 'fish') for a in args):", 'if False:', 'test_commands.Commands.test_issue_500_expansions'),
    ('unresolved-eval', 'commands.py', ['if shell._UNRESOLVED_EVAL_MARKER in tokens:', "if base == 'eval' and any('$' in a or '`' in a for a in args):"], ['if False:', 'if False:'], 'test_commands.Commands.test_unknown_fails_closed'),
    ('push-literals', 'commands.py', '        literal(word)\n', '        pass\n', 'test_commands.Commands.test_unknown_fails_closed'),
    ('cwd-uncertain', 'commands.py', "repo is None or _state['config'] or overrides", "False or _state['config'] or overrides", 'test_integrity.Integrity.test_unknown_cwd_cannot_scope_push'),
    ('config-overrides', 'commands.py', "repo is None or _state['config'] or overrides", "repo is None or _state['config'] or False", 'test_integrity.Integrity.test_mirror_and_config_override_and_short_lease'),
    ('same-call-config', 'commands.py', "repo is None or _state['config'] or overrides", 'repo is None or False or overrides', 'test_r2.R2.test_r1_same_call_config_and_gh'),
    ('configured-mirror', 'commands.py', "line.split()[-1].lower() not in ('false', 'no', 'off', '0')", 'False', 'test_integrity.Integrity.test_mirror_and_config_override_and_short_lease'),
    ('configured-plus', 'commands.py', "' +' in line", 'False', 'test_gate.Gate.test_normal_push_cannot_inherit_force_config'),
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
    ('policy-bash', 'commands.py', "if syntax.policy_write(base, args, redirects, cwd or '/', Path.home()):", 'if False:', 'test_surfaces.Surfaces.test_r1_policy_surface'),
    ('policy-case', 'syntax.py', 'os.path.realpath(os.path.join(cwd, word)).casefold()', 'os.path.realpath(os.path.join(cwd, word))', 'test_surfaces.Surfaces.test_r1_policy_surface'),
    ('alternate-surface', 'human-confirm-pretooluse.py', "if not isinstance(args.get('command'), str):", "if name != 'Bash':", 'test_surfaces.Surfaces.test_r1_policy_surface'),
    ('notebook-path', 'human-confirm-pretooluse.py', "args.get('file_path', args.get('notebook_path', ''))", "args.get('file_path', '')", 'test_surfaces.Surfaces.test_r1_policy_surface'),
    ('agent-write', 'human-confirm-pretooluse.py', "if policy_path(target, payload.get('cwd', str(home)), home):", 'if False:', 'test_gate.Gate.test_agent_write_rejected'),
    ('fail-closed', 'human-confirm-pretooluse.py', '        denied = True', '        denied = False', 'test_gate.Gate.test_invalid_payload_fails_closed'),
    ('nofollow', 'tokens.py', 'os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK', 'os.O_RDONLY | os.O_NONBLOCK', 'test_integrity.Integrity.test_nofollow_and_uid'),
    ('uid', 'tokens.py', 'info.st_uid != os.getuid()', 'False', 'test_integrity.Integrity.test_nofollow_and_uid'),
    ('version', 'tokens.py', "token['version'] != 1", 'False', 'test_integrity.Integrity.test_version_nonce_and_anchor_mode'),
    ('nonce-filename', 'tokens.py', "path.name != nonce + '.json'", 'False', 'test_integrity.Integrity.test_version_nonce_and_anchor_mode'),
    ('mode', 'tokens.py', 'stat.S_IMODE(info.st_mode) != 0o600', 'False', 'test_integrity.Integrity.test_version_nonce_and_anchor_mode'),
    ('principal-swap', 'tokens.py', "'-I', kind", "'-I', 'lead' if kind == 'human' else 'human'", 'test_integrity.Integrity.test_separate_principal_keys'),
    ('signature', 'tokens.py', 'if verified.returncode:', 'if False:', 'test_integrity.Integrity.test_unsigned_fresh_token'),
    ('ttl', 'tokens.py', "if not (token['issued_at'] <= now < token['expires_at'] <= token['issued_at'] + 300):", 'if False:', 'test_gate.Gate.test_wrong_scope_expired_or_unsigned'),
    ('digest', 'tokens.py', "token['command_sha256'] != digest", 'False', 'test_gate.Gate.test_wrong_scope_expired_or_unsigned'),
    ('scope', 'tokens.py', "token['operations'] != ops", 'False', 'test_gate.Gate.test_wrong_scope_expired_or_unsigned'),
    ('session', 'tokens.py', "token['session_id'] != payload['session_id']", 'False', 'test_gate.Gate.test_wrong_scope_expired_or_unsigned'),
    ('expiry-recheck', 'tokens.py', "if time.time() >= token['expires_at']:", 'if False:', 'test_gate.Gate.test_expiry_during_metadata_lookup'),
    ('replay', 'tokens.py', 'os.O_CREAT | os.O_EXCL | os.O_WRONLY', 'os.O_CREAT | os.O_WRONLY', 'test_gate.Gate.test_human_consumed_once'),
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
        target = scratch / 'scripts/golems-confirm' if file == '@issuer' else scratch / gate / 'hooks' / file
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
