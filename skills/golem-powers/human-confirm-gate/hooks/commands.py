"""Structural classification only; never execute the inspected command."""
import os
import re
import shlex
import subprocess
import sys
from pathlib import Path

_SHARED = str(Path(__file__).resolve().parents[2] / '_shared')
if _SHARED not in sys.path:
    sys.path.append(_SHARED)  # after the stdlib: nothing in the tree may shadow it
import shell_parse as shell
import syntax
import forwarding
import gh_policy
import git_config


def literal(word):
    if any(c in word for c in '$`*?[]{}'):
        raise ValueError('dynamic command scope; use literal arguments')
    return word


def configured_alias(repo, name):
    if name == 'push':
        return None  # git never aliases a builtin; configured push routes: git_config.effective_push
    result = subprocess.run(['/usr/bin/git', '-C', repo, 'config', '--get', 'alias.' + name.lower()],
                            capture_output=True, text=True, timeout=1)
    if result.returncode not in (0, 1):
        raise ValueError('cannot resolve git alias')
    return result.stdout.strip() or None


def git_words(words, cwd):
    repo, aliases, overrides, i = cwd, {}, False, 0
    while i < len(words) and words[i].startswith('-'):
        option = words[i]
        if option in ('-C', '-c'):
            value = words[i + 1]; i += 2
            if option == '-C':
                if '$' in value or '`' in value: repo = None
                elif repo is not None: repo = os.path.realpath(os.path.join(repo, os.path.expanduser(value)))
            elif value.lower().startswith('alias.'):
                key, value = value.split('=', 1); aliases[key[6:].lower()] = value
            else:
                overrides = True
        elif option in ('--git-dir', '--work-tree', '--config-env', '--namespace'):
            overrides = True; i += 2
        else:
            overrides |= option.startswith(('--git-dir=', '--work-tree=', '--config-env=', '--namespace='))
            i += 1
    return repo, aliases, words[i:], overrides


def push_operation(args, repo):
    for word in args:
        literal(word)
    destructive = any(any(flag.startswith(a.split('=', 1)[0]) for flag in ('--force', '--force-with-lease', '--force-if-includes', '--delete', '--mirror', '--prune'))
                      or re.fullmatch(r'-[A-Za-z]*[fd][A-Za-z]*', a)
                      or a.startswith('+') or a.startswith(':') and a != ':' for a in args)
    if not destructive:
        return []
    leases = [a for a in args if a.startswith('--force-with-lease=')]
    # Lead authorization deliberately accepts only this narrow grammar.
    positional = [a for a in args if not a.startswith('-')]
    allowed_flags = set(leases) | {'--atomic', '--verbose', '-v'}
    if len(leases) == 1 and all(a in allowed_flags or not a.startswith('-') for a in args) and len(positional) == 2:
        match = re.fullmatch(r'--force-with-lease=(refs/heads/[^:]+):([0-9a-f]{40}|[0-9a-f]{64})', leases[0])
        if match:
            remote, refspec = positional
            source, sep, dest = refspec.partition(':')
            dest = dest if sep else source
            dest = dest if dest.startswith('refs/') else 'refs/heads/' + dest
            if dest == match[1] and source and not source.startswith('+'):
                return [dict(class_='lease', repo=repo, remote=remote, ref=dest,
                             sha=match[2], source=source)]
    refs = [a for a in positional[1:]]
    return [dict(class_='delete' if any(a.startswith(':') and a != ':' for a in refs) or any(a.startswith('--delete') or a == '-d' for a in args) else 'force',
                 repo=repo, refs=refs, remote=positional[0] if positional else '')]


_VAR = re.compile(r'\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))')


def resolve_word(word, bindings):
    def replace(match):
        value = bindings.get(match[1] or match[2])
        return value if value is not None and not any(c.isspace() for c in value) else match[0]
    return _VAR.sub(replace, word)


def expansion_is_protected(word, bindings):
    """Deny-only view of argv hidden inside a command-word binding.

    Never use split fields to authorize: quoting and IFS can change runtime
    argv. A protected field in any referenced literal binding is sufficient
    to refuse the ambiguous executable.
    """
    ifs = bindings.get('IFS', ' \t\n')
    for match in _VAR.finditer(word):
        value = bindings.get(match[1] or match[2])
        if value is not None:
            fields = re.split('[' + re.escape(ifs) + ']', value) if ifs else [value]
            if syntax.guarded_words(fields):
                return True
    return False


def opaque_executable(word, args, script=False):
    """A whole command or forwarded argv can hide every protected field."""
    return syntax.unresolved(word, Path.home()) and (
        syntax.guarded_words(args) or
        forwarding.UNKNOWN in word.replace("\ue000", "{").replace("\ue001", "}") or
        not args and (word in ('$@', '${@}', '$*', '${*}') or script and _VAR.fullmatch(word)) or
        any(a in ('$@', '${@}', '$*', '${*}') for a in args))


def assigned_bindings(tokens, positions, limit, initial, scopes, target=()):
    values = dict(initial)
    if any(t in ('(', '&', '|', 'if', 'for', 'while', 'case') for t in tokens[:limit]):
        return {}  # Parent bindings are uncertain across control/subshell scope.
    if any(positions[i] and t in ('eval', 'source', '.', 'read', 'unset', 'declare', 'typeset', 'local', 'let', 'trap') for i, t in enumerate(tokens[:limit])):
        return {}  # These builtins can invalidate earlier literal assignments.
    for i, word in enumerate(tokens[:limit]):
        match = shell._ASSIGNMENT_RE.match(word)
        previous = max((j for j in range(i) if positions[j]), default=-1)
        env_assignment = (previous >= 0 and os.path.basename(tokens[previous]) in ('env', 'export') and
                          all('=' in t or t in ('-i', '--ignore-environment', '--') for t in tokens[previous + 1:i]))
        if scopes[i] == target and (positions[i] or env_assignment) and match and not match['subscript'] and not match['append']:
            name, value = word.split('=', 1)
            value = resolve_word(value, values)
            values[name] = value if '$' not in value and '`' not in value else None
    return values


GIT_BUILTINS = set("add am archive bisect blame branch cat-file checkout cherry cherry-pick clean clone commit config describe diff difftool fetch for-each-ref gc grep help init log ls-files ls-remote ls-tree merge mergetool mv notes pull push range-diff rebase reflog remote reset restore revert rev-list rev-parse rm show show-ref sparse-checkout stash status submodule switch tag update-index update-ref version worktree"
                   # Local-only git commands: an alias never shadows a git command.
                   " annotate apply bugreport bundle check-attr check-ignore check-mailmap check-ref-format"
                   " checkout-index column commit-graph commit-tree count-objects diagnose diff-files diff-index"
                   " diff-tree fast-export fmt-merge-msg format-patch fsck hash-object index-pack interpret-trailers"
                   " maintenance merge-base merge-file merge-tree mktag mktree multi-pack-index name-rev"
                   " pack-objects pack-refs patch-id prune read-tree repack rerere shortlog show-branch"
                   " stripspace symbolic-ref var verify-commit verify-pack verify-tag whatchanged write-tree".split())


def operations(command, cwd, alias_lookup=configured_alias, depth=0, bindings=None, _state=None, rejoined=False, _script=False, _unknown_tail=False, _shell_zero=None):
    if depth > 8 or shell.policy_command_size_reason(command):
        raise ValueError('command inspection budget exceeded')
    if shell.executable_shell_structure_has_open_state(command):
        raise ValueError('unparseable shell input')
    command = forwarding.preserve_empty_words(command)
    tokens, positions, segments, scopes = shell._parse_bash(command)
    syntax.hide_function_bodies(tokens, positions)
    bindings = dict(bindings or {})
    if shell._UNRESOLVED_EVAL_MARKER in tokens:
        raise ValueError('unresolved eval payload')
    result = []
    # The literal-name proof needs the whole raw command; nested bodies inherit it.
    _state = _state if _state is not None else {'config': False, 'literal': syntax.single_quoted_names(command, shell)}
    split_map = {} if rejoined else syntax.split_words(command, shell)

    def splits(word):  # an expansion that may word-split; rejoined argv has lost its quoting
        return ('$' in word or '`' in word) and split_map.get(word, True)
    # Quoted heredoc prose is data: its backticks/apostrophes are not substitutions.
    nested = [(body, seg) for body, seg, _, _ in shell._executable_subcommands(syntax.mask_heredoc_bodies(command, shell))]
    function_expansion = shell._impl_module('function_expansion')
    def bind_function(body, args, local=None):
        values = dict(bindings); values.update(local or {})
        return forwarding.bind(body, [resolve_word(a, values) for a in args], shell,
                               zero=_shell_zero, ifs=values.get('IFS', ' \t\n'))
    token = function_expansion._argument_expander.set(bind_function)
    try:
        invoked = shell._invoked_alias_bodies(command)
        nested += [(body, seg) for body, seg, _ in invoked]
    finally:
        function_expansion._argument_expander.reset(token)
    for body, segment in nested:
        limit = max((i + 1 for i, seg in enumerate(segments) if seg <= segment), default=0)
        child_bindings = assigned_bindings(tokens, positions, limit, bindings, scopes)
        result += operations(body, cwd, alias_lookup, depth + 1, child_bindings, _state, _shell_zero=_shell_zero)
    # This supplemental view may deny, never authorize or classify an operand.
    # Keep the original argv (including substitution bodies) for every policy.
    outer, flags, segs, outer_scopes = syntax.substitution_argv(command, shell)
    syntax.hide_function_bodies(outer, flags)
    for i, word in enumerate(outer):
        if not flags[i] or syntax.looked_up(outer, flags, i): continue
        current = assigned_bindings(outer, flags, i, bindings, outer_scopes, outer_scopes[i])
        if (not shell._ASSIGNMENT_RE.match(word) and syntax.executable(word)[0] not in syntax.DATA and
                expansion_is_protected(word, current)):
            raise ValueError('protected argv hidden in executable expansion')
        word = resolve_word(word, current)
        args, _ = syntax.argv_at(outer, segs, outer_scopes, i)
        pending = [(word, args, depth)]
        while pending:
            executable, argv, level = pending.pop()
            executable = resolve_word(executable, current)
            argv = [resolve_word(a, current) for a in argv]
            base = syntax.executable(executable)[0]
            if (not shell._ASSIGNMENT_RE.match(executable) and base not in syntax.DATA and
                    opaque_executable(executable, argv, _script)):
                raise ValueError('unresolved executable for protected operation')
            if level > 8: raise ValueError('command inspection budget exceeded')
            for child in syntax.wrapper_payload(base, argv):
                if child: pending.append((child[0], child[1:], level + 1))
    for i, word in enumerate(tokens):
        if not positions[i] or syntax.looked_up(tokens, positions, i): continue
        current = assigned_bindings(tokens, positions, i, bindings, scopes, scopes[i])
        if (not shell._ASSIGNMENT_RE.match(word) and syntax.executable(word)[0] not in syntax.DATA and
                expansion_is_protected(word, current)):
            raise ValueError('protected argv hidden in executable expansion')
        word = resolve_word(word, current)
        assignment = bool(shell._ASSIGNMENT_RE.match(word))
        base, direct = ('', None) if assignment else syntax.executable(word)
        args, redirects = syntax.argv_at(tokens, segments, scopes, i)
        args = [resolve_word(a, current) for a in args]
        redirects = [(op, resolve_word(target, current)) for op, target in redirects]
        if direct is not None: args = [direct, *args]  # a per-subcommand executable is `git <sub>`
        if any(target.casefold().endswith('/.git/config') or target.casefold() == '.git/config'
               for target in syntax.write_targets(base, args, redirects)):
            _state['config'] = True
        policy_hint = any(shell._ASSIGNMENT_RE.match(t) and (positions[j] or j and tokens[j - 1] == 'export') and
                          syntax.policy_path(t.split('=', 1)[1], cwd or '/', Path.home())
                          for j, t in enumerate(tokens[:i]))
        uncertain_policy_target = policy_hint and any('$' in t or '`' in t for t in syntax.write_targets(base, args, redirects))
        if syntax.anchor_tamper(word, args, cwd, Path.home()):
            raise ValueError('agent changes to the confirmation trust anchor or pinned hook tree are forbidden')
        if syntax.policy_write(base, args, redirects, cwd or '/', Path.home()) or uncertain_policy_target:
            raise ValueError('agent writes/deletes to confirmation policy/tokens are forbidden')
        if assignment:
            continue  # a prefix assignment is not the executable; the next word is
        if base not in syntax.DATA and opaque_executable(word, args, _script):
            raise ValueError('unresolved executable for protected operation')
        for child in syntax.wrapper_payload(base, args):
            child_bindings = dict(current)
            if base == 'env':
                for arg in args[:args.index(child[0])]:
                    if shell._ASSIGNMENT_RE.match(arg):
                        name, value = arg.split('=', 1); child_bindings[name] = value
            result += operations(syntax.joined(child), cwd, alias_lookup, depth + 1, child_bindings, _state, rejoined=True, _unknown_tail=_unknown_tail or getattr(child, 'unknown_tail', False))
        # Unknown executors carrying a protected argv are conservative. Data
        # operands of echo/printf/cat/etc. are not command positions.
        if base not in syntax.DATA and base not in syntax.SHELLS and segments[i] not in {seg for _, seg, _ in invoked}:
            for j, arg in enumerate(args):
                if syntax.executable(arg)[0] in ('git', 'gh') and syntax.guarded_words(args[j + 1:]):
                    result += operations(syntax.joined(args[j:]), cwd, alias_lookup, depth + 1, current, _state, rejoined=True)
                elif ' ' in arg:
                    try:
                        words = shlex.split(arg)
                    except ValueError:  # prose with an apostrophe; a Git/GH payload still denies
                        words = arg.split()
                        if any(syntax.executable(w)[0] in ('git', 'gh') for w in words) and syntax.guarded_words(words):
                            raise ValueError('unparseable protected payload')
                    if words and syntax.executable(words[0])[0] in ('git', 'gh') and syntax.guarded_words(words[1:]):
                        result += operations(arg, cwd, alias_lookup, depth + 1, current, _state, rejoined=True)
        if base in ('source', '.') and args and any(m in args[0].replace('\ue000', '{').replace('\ue001', '}') for m in ('${process-substitution}', '${positional-unknown}')):
            raise ValueError('opaque sourced script')
        if base == 'eval' and any('$' in a or '`' in a for a in args):
            raise ValueError('unresolved eval payload; use a literal command')
        if base == 'xargs' and any(syntax.executable(a)[0] in ('git', 'gh', 'sh', 'bash', 'zsh', 'fish') for a in args):
            raise ValueError('xargs supplies unresolved arguments; use a literal command')
        if base == 'env' and any(a == '-S' or a.startswith('--split-string') for a in args):
            if any(syntax.guarded_words(shlex.split(a)) for a in args):
                raise ValueError('env split-string is opaque; use an explicit command')
        if base in syntax.SHELLS:
            body = syntax.shell_payload(base, args)
            if body is not None: body = body.replace("\ue000", "{").replace("\ue001", "}")
            if body is not None:
                tail = syntax.shell_program(base, args)[1]
                if tail is not None:
                    zero = tail[0] if tail else None if _unknown_tail else base
                    body = forwarding.bind(body, tail[1:], shell, zero, _unknown_tail,
                                           current.get('IFS', ' \t\n'))
                result += operations(body, cwd, alias_lookup, depth + 1, current, _state, _script=True, _shell_zero=zero if tail is not None else None)
            else:
                if any(op == '<<<' for op, _ in redirects):
                    for op, body in redirects:
                        if op == '<<<': result += operations(body, cwd, alias_lookup, depth + 1, current, _state, _script=True)
                elif any(op == '<<' for op, _ in redirects):
                    delimiters = {target for op, target in redirects if op == '<<'}
                    for delimiter, body in syntax.heredoc_bodies(command, shell):
                        if delimiter in delimiters: result += operations(body, cwd, alias_lookup, depth + 1, current, _state, _script=True)
                elif syntax.shell_reads_stdin(base, args):
                    raise ValueError('opaque shell script/stdin source')
        if base == 'trap' and args:
            result += operations(args[0], cwd, alias_lookup, depth + 1, current, _state)
        if base in ('cd', 'pushd', 'popd'):
            # Directory stacks, `cd -`, CDPATH and dynamic targets make cwd unknown.
            operands = [a for a in args if a not in ('-P', '-L', '-e', '-@', '-n', '--')]
            target = operands[0] if len(operands) == 1 and base != 'popd' else None
            target = str(Path.home()) if base == 'cd' and not operands else target
            searched = target is not None and not target.startswith(('/', '.', '~', '$')) and (
                'CDPATH' in command or os.environ.get('CDPATH'))
            if cwd is None or target is None or searched or target.startswith(('-', '+')) or syntax.unresolved(target, Path.home()):
                cwd = None
            else:
                cwd = os.path.realpath(os.path.join(cwd, syntax.expand_home(target, Path.home())))
        if base == 'git':
            repo, aliases, words, overrides = git_words(args, cwd)
            if not words: continue
            sub, *tail = words
            literal(sub)
            if sub == 'config' and not any(a.startswith(('--get', '--list', '-l', '--show')) for a in tail):
                _state['config'] = True
                setter = git_config.destructive_setter(tail)  # storing a force/delete push route
                if setter: result.append(dict(setter, repo=repo))
            if sub == 'remote' and tail[:1] in (['add'], ['set-url']): _state['config'] = True
            relevant = sub in ('push', 'send-pack', 'filter-repo', 'filter-branch', 'replace') or sub not in GIT_BUILTINS
            if relevant and (repo is None or _state['config'] or overrides):
                raise ValueError('uncertain repository/config scope for protected operation')
            if relevant and any(prefix.startswith(('GIT_CONFIG', 'GIT_DIR=', 'GIT_WORK_TREE=', 'HOME=')) for prefix in tokens[:i]):
                raise ValueError('Git environment changes obscure repository/config scope')
            alias = aliases.get(sub.lower())
            if sub == 'push' or sub not in GIT_BUILTINS:
                alias = alias or alias_lookup(repo, sub.lower())
            if alias:
                body = alias[1:] if alias.startswith('!') else 'git ' + alias
                result += operations(body + ' ' + shlex.join(tail), repo, alias_lookup, depth + 1, current, _state, rejoined=True)
            elif sub in ('push', 'send-pack'):
                if any('refs/replace/' in a for a in tail):
                    result.append(dict(class_='rewrite', repo=repo, refs=tail))
                digest = None
                if sub == 'push' and alias_lookup is configured_alias:
                    # Judge the refspecs git would really use (config push/mirror routes).
                    tail, digest = git_config.effective_push(tail, repo)
                pushes = push_operation(tail, repo)
                for op in pushes:
                    if digest is not None: op['push_config_sha256'] = digest
                result += pushes
            elif sub in ('filter-repo', 'filter-branch', 'replace'):
                result.append(dict(class_='rewrite', repo=repo, refs=tail))
            elif sub == 'rebase':
                for j, arg in enumerate(tail):
                    if arg in ('-x', '--exec'):
                        result += operations(tail[j + 1], repo, alias_lookup, depth + 1, current, _state, rejoined=True)
                    elif arg.startswith('--exec='):
                        result += operations(arg.split('=', 1)[1], repo, alias_lookup, depth + 1, current, _state, rejoined=True)
            elif sub == 'submodule' and 'foreach' in tail:
                body = tail[tail.index('foreach') + 1:]
                while body and body[0].startswith('-'): body = body[1:]
                result += operations(' '.join(body), repo, alias_lookup, depth + 1, current, _state, rejoined=True)
            elif sub == 'bisect' and tail[:1] == ['run']:
                result += operations(syntax.joined(tail[1:]), repo, alias_lookup, depth + 1, current, _state, rejoined=True)
        elif base == 'gh':
            if cwd is None and syntax.guarded_words(args): raise ValueError('unknown settings cwd')
            result += gh_policy.operations(args, cwd, _state['literal'], splits)
    # Normalize and deduplicate repeated wrapper/substitution views.
    unique = []
    for op in result:
        if 'class_' in op: op['class'] = op.pop('class_')
        if op not in unique: unique.append(op)
    return unique
