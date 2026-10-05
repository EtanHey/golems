"""Resolved rm breadth scanner moved from git_safety.py."""

from __future__ import annotations

import os
import re
import shlex
import fnmatch
import stat
from functools import lru_cache

from . import shell_parse
from .paths import _expand_tilde

CreatedPath = str | None | tuple[str | None, str]

def _skip_options(
    words: list[str], position: int, options_with_values: set[str]
) -> int:
    """Return the first non-option position for a command wrapper."""
    while position < len(words):
        word = words[position]
        if word == "--":
            return position + 1
        if not word.startswith("-") or word == "-":
            return position
        option = word.split("=", 1)[0]
        position += 1
        if option in options_with_values and "=" not in word:
            position += 1
    return position


def _without_redirections(source: str) -> str:
    """Blank shell redirections before shlex erases quote/escape provenance.

    Literal quoted or escaped operators remain deletion operands. Consume a
    redirect's entire shell word, including concatenated quotes/substitutions,
    without consuming the next command or a process-substitution argument.
    """
    structure = shell_parse.executable_shell_structure(source)
    result = list(source)
    index = 0
    while index < len(source):
        if structure[index:index + 2] in {"<(", ">("}:
            try:
                _, index = shell_parse.process_substitution_at(source, index)
            except ValueError:
                return source  # preserve malformed syntax for the fail-closed lexer
            continue
        if structure[index] not in "<>":
            index += 1
            continue
        start = index
        # A preceding unquoted descriptor belongs to the redirection only when
        # it is the complete word (foo2>log still leaves operand foo2).
        while start > 0 and structure[start - 1].isdigit():
            start -= 1
        if start > 0 and structure[start - 1] not in " \t\r\n;|&()":
            start = index
        if index > 0 and structure[index - 1] == "&":
            start = index - 1
        match = re.match(r"(?:<<<|<<-|<<|>>|<>|>\||>&|<&|>|<)", structure[index:])
        end = index + len(match.group())
        while end < len(source) and source[end] in " \t":
            end += 1
        try:
            while end < len(source) and source[end] not in " \t\r\n;|&()<>":
                if source[end] in "'\"":
                    end = shell_parse._data_argument_quote_end(source, end) + 1
                    if end > len(source):
                        return source
                elif source[end] == "\\":
                    end += 2
                elif source.startswith("$(", end):
                    end = shell_parse._data_dollar_paren_end(source, end)
                elif source[end] == "`":
                    end = shell_parse._data_backtick_end(source, end)
                else:
                    end += 1
        except ValueError:
            return source
        for offset in range(start, min(end, len(source))):
            result[offset] = " "
        index = end
    return "".join(result)


def _created_target_reason(api, target, cwd, variables, _created_paths):
    """A future filesystem operand cannot be trusted from today's realpath."""
    if not _created_paths:
        return None
    expanded, complete = api["_expand_known_vars"](target, variables)
    expanded, tilde_complete = _expand_tilde(expanded, variables)
    resolved = os.path.abspath(os.path.join(cwd, expanded)) if complete and tilde_complete and cwd else None
    for path in _created_paths:
        known_directory = isinstance(path, tuple)
        if known_directory:
            path = path[0]
        if (resolved is None or path is None or api["_within"](path, resolved)
                or (not known_directory and api["_within"](resolved, path))):
            return "deletion target affected by earlier path creation cannot be evaluated safely"
    return None


def _rsync_destination(words, position):
    """Separate rsync option values from operands, including trailing options.

    Unknown long options after operands make the destination ambiguous; protect
    that boundary instead of treating a possible option value as a directory.
    """
    value_options = {
        "--exclude", "--include", "--exclude-from", "--include-from", "--filter",
        "--files-from", "--rsh", "--rsync-path", "--log-file", "--log-file-format",
        "--backup-dir", "--suffix", "--temp-dir", "--partial-dir", "--link-dest",
        "--compare-dest", "--copy-dest", "--block-size", "--bwlimit", "--timeout",
        "--contimeout", "--max-delete", "--min-size", "--max-size", "--max-alloc",
        "--remote-option", "--out-format", "--password-file", "--modify-window",
        "--chmod", "--chown", "--usermap", "--groupmap", "--iconv", "--address",
        "--port", "--checksum-choice", "--compress-choice", "--compress-level",
        "--skip-compress", "--info", "--debug", "--write-batch", "--only-write-batch",
        "--read-batch", "--protocol", "--sockopts",
    }
    flag_options = {
        "--archive", "--recursive", "--dirs", "--relative", "--links", "--copy-links",
        "--keep-dirlinks", "--copy-dirlinks", "--safe-links", "--hard-links", "--perms",
        "--acls", "--xattrs", "--owner", "--group", "--devices", "--specials", "--times",
        "--sparse", "--inplace", "--append", "--append-verify", "--preallocate",
        "--dry-run", "--whole-file", "--checksum", "--compress", "--verbose", "--quiet",
        "--stats", "--progress", "--human-readable", "--numeric-ids", "--itemize-changes",
        "--list-only", "--ignore-times", "--size-only", "--update", "--ignore-existing",
        "--existing", "--ignore-non-existing", "--ignore-missing-args", "--force",
        "--delay-updates", "--partial", "--prune-empty-dirs", "--protect-args",
        "--secluded-args", "--old-args", "--from0", "--copy-unsafe-links", "--del",
    }
    operands = []
    index = position + 1
    options = True
    while index < len(words):
        word = words[index]
        consumes_value = False
        if options and word == "--":
            options = False
        elif options and word.startswith("--"):
            option = word.split("=", 1)[0]
            consumes_value = option in value_options and "=" not in word
            if (operands and "=" not in word and option not in value_options | flag_options
                    and not option.startswith(("--delete", "--no-"))):
                return None
        elif options and word.startswith("-") and word != "-":
            # First value-taking letter owns the rest of a short bundle.
            for offset, letter in enumerate(word[1:], 1):
                if letter in "efBTM@":
                    consumes_value = offset == len(word) - 1
                    break
        else:
            operands.append(word)
        index += 1
        if consumes_value:
            if index >= len(words):
                return None
            index += 1
    return operands[-1] if operands else None


def _selective_name_group(args):
    """A single positive OR of name filters, with only AND constraints outside."""
    if args.count('(') != 1 or args.count(')') != 1 or args.count('-delete') != 1:
        return None
    start, end = args.index('('), args.index(')')
    if start >= end or args.index('-delete') < end:
        return None
    group, branches = args[start + 1:end], []
    index = 0
    while index < len(group):
        if group[index] not in {'-name', '-iname'} or index + 1 >= len(group):
            return None
        branches.append(([(group[index], group[index + 1])], False))
        index += 2
        if index < len(group):
            if group[index] not in {'-o', '-or'} or index + 1 == len(group):
                return None
            index += 1
    outside = args[:start] + args[end + 1:]
    index = 0
    while index < len(outside):
        word = outside[index]
        if word in {'-type', '-mindepth', '-maxdepth', '-mmin', '-mtime', '-f'}:
            if index + 1 >= len(outside):
                return None
            index += 2
            continue
        if word.startswith('-') and word not in {
            '-delete', '-a', '-and', '-H', '-L', '-P', '-E', '-X', '-d', '-s', '-x',
            '-depth', '-mount', '-xdev', '-follow', '--',
        }:
            return None
        if word in {'!', ',', '-not', '-o', '-or', ';', '+'}:
            return None
        index += 1
    return branches or None


def _find_deletion_roots(args, *, include_follow_mode=False, include_depth_limits=False):
    """BSD/bfs roots anywhere, excluding values and nested command operands."""
    values = {
        '-name', '-iname', '-path', '-ipath', '-regex', '-iregex', '-type', '-xtype',
        '-mindepth', '-maxdepth', '-mtime', '-mmin', '-atime', '-amin', '-ctime', '-cmin',
        '-newer', '-anewer', '-cnewer', '-samefile', '-size', '-links', '-inum', '-perm',
        '-user', '-group', '-uid', '-gid', '-fstype', '-lname', '-ilname', '-flags',
        '-D', '-S', '-printf', '-fprint', '-fprint0', '-fls', '-regextype',
    }
    flags = {'-H', '-L', '-P', '-E', '-X', '-d', '-s', '-x', '-depth', '-mount',
             '-xdev', '-follow', '-empty', '-print', '-print0', '-printx', '-ls', '-prune',
             '-true', '-false', '-quit', '-noleaf', '-daystart', '-ignore_readdir_race',
             '-noignore_readdir_race', '-readable', '-writable', '-executable', '-nouser', '-nogroup'}
    roots, branches, filters = [], [], []
    follow = negated = grouped = False
    follow_mode = "P"
    mindepth, maxdepth = 0, None
    index = 0
    while index < len(args):
        word = args[index]
        if word in {'-exec', '-execdir', '-ok', '-okdir'}:
            index += 1
            while index < len(args) and args[index] not in {';', '+'}:
                index += 1
            if index == len(args):
                return None
        elif word == '-delete':
            branches.append((list(filters), negated))
        elif word in {'-o', '-or', ','}:
            filters = []; negated = False
        elif word in {'!', '-not'}:
            negated = True
        elif word in {'(', ')'}:
            grouped = True
        elif word in {'-a', '-and', '--'}:
            pass
        elif word == '-f' or word in values or word == '-fprintf' or re.fullmatch(r'-newer[acmBt][acmBt]', word):
            count = 2 if word == '-fprintf' else 1
            if index + count >= len(args):
                return None
            value = args[index + 1]
            if word == '-f':
                roots.append(value)
            elif word in {'-name', '-iname', '-path', '-ipath', '-regex', '-iregex'}:
                filters.append((word, value))
            elif word == '-mtime':
                filters.append((word, value))
            elif word in {'-mindepth', '-maxdepth'}:
                try:
                    depth = int(value)
                    if depth < 0:
                        raise ValueError
                except ValueError:
                    return None
                if word == '-mindepth':
                    mindepth = depth
                else:
                    maxdepth = depth
            index += count
        elif word in flags or re.fullmatch(r'-O[0-9]+', word):
            if word in {'-H', '-L', '-P'}:
                follow = word != '-P'
                follow_mode = word[1:]
            elif word == '-follow':
                follow = True
                follow_mode = 'L'
        elif word.startswith('-'):
            return None  # unknown primary cannot silently consume a protected root
        else:
            roots.append(word)
        index += 1
    if grouped:
        selective_group = _selective_name_group(args)
        if selective_group:
            branches, grouped = selective_group, False
    result = (roots or ['.'], follow, branches, mindepth, grouped)
    if include_follow_mode:
        result += (follow_mode,)
    return (*result, (mindepth, maxdepth)) if include_depth_limits else result


def _selective_find_filter(option, pattern):
    """A filename class needs literal content beyond wildcard punctuation."""
    if option not in {'-name', '-iname'}:
        return False  # path prefixes may select whole metadata/top-level trees
    tail = re.sub(r'\[[^\]]*\]', '', os.path.basename(pattern))
    return any(char.isalnum() or char == '_' for char in tail)


def _glob_matches_domains(pattern, domains):
    """Whether a glob intersects a bounded metadata object-name shape."""
    positions, index = {0}, 0
    while index < len(pattern):
        end = index + 1
        if pattern[index] == '[':
            start = end + (pattern[end:end + 1] == '!')
            start += pattern[start:start + 1] == ']'
            close = pattern.find(']', start)
            if close >= 0:
                end = close + 1
        token = pattern[index:end]
        if token == '*':
            positions = set(range(min(positions), len(domains) + 1)) if positions else set()
        else:
            matcher = re.compile(fnmatch.translate(token))
            positions = {p + 1 for p in positions if p < len(domains)
                         and any(matcher.fullmatch(c) for c in domains[p])}
        if not positions:
            return False
        index = end
    return len(domains) in positions


@lru_cache(maxsize=128)
def _metadata_name_filter(option, pattern):
    """Critical fixed names/shapes are only one layer of metadata protection."""
    if not _selective_find_filter(option, pattern):
        return False
    if option == '-iname':
        pattern = pattern.casefold()
    names = ('.git', 'HEAD', 'ORIG_HEAD', 'FETCH_HEAD', 'index', 'index.lock',
             'config', 'packed-refs', 'shallow', 'commondir', 'gitdir', 'description')
    if any(fnmatch.fnmatchcase(n.casefold() if option == '-iname' else n, pattern) for n in names):
        return False
    shapes = [('', count, '') for count in (38, 62)]
    shapes += [('pack-', count, suffix) for count in (40, 64)
               for suffix in ('.pack', '.idx', '.rev', '.bitmap', '.promisor', '.keep')]
    return not any(_glob_matches_domains(pattern, list(prefix) + ['0123456789abcdef'] * count + list(suffix))
                   for prefix, count, suffix in shapes)


def _metadata_traversal_reason(api, target, cwd, variables, branches, follow_mode, depth_limits):
    """Reject selected metadata and uncertainty in a bounded, read-only walk."""
    value, complete = api['_expand_known_vars'](target, variables)
    value, tilde_complete = _expand_tilde(value, variables)
    if not complete or not tilde_complete:
        return 'find metadata traversal cannot be resolved safely'
    minimum, maximum = depth_limits
    lexical = os.path.abspath(os.path.join(cwd, value))
    root = os.path.realpath(lexical)
    follow_descendants = follow_mode == 'L'
    try:
        try:
            root_info = os.lstat(os.path.normpath(lexical))
        except FileNotFoundError:
            return None  # an absent literal root has no reachable deletion
        if (stat.S_ISLNK(root_info.st_mode) and follow_mode == 'P'
                and not value.endswith(('/', '/.'))):
            return None  # find does not walk a non-followed command-line alias
        if stat.S_ISLNK(root_info.st_mode) and not stat.S_ISDIR(os.stat(lexical).st_mode):
            # A followed CLI file alias unlinks its entry, not its target. Resolve
            # only its parent so metadata-directory aliases remain protected.
            root = os.path.join(os.path.realpath(os.path.dirname(lexical)), os.path.basename(lexical))
        # Every root may contain nested metadata; -L also exposes alias targets.
        stack = [(root, 0, False, frozenset())]
        count = 0
        while stack:
            path, depth, metadata, ancestors = stack.pop()
            if maximum is not None and depth > maximum:
                continue
            info = os.lstat(path)
            linked = stat.S_ISLNK(info.st_mode)
            metadata |= '.git' in [part.casefold() for part in path.split(os.sep)]
            if linked and follow_descendants:
                info = os.stat(path)
                # A file alias is unlinked at its lexical path; directory aliases
                # expose their target's children to the traversal.
                if stat.S_ISDIR(info.st_mode):
                    metadata |= '.git' in [part.casefold()
                                          for part in os.path.realpath(path).split(os.sep)]
            name = os.path.basename(path)
            if metadata and depth >= minimum and any(negated or all(
                    fnmatch.fnmatchcase(name.casefold() if option == '-iname' else name,
                                       pattern.casefold() if option == '-iname' else pattern)
                    for option, pattern in filters if option in {'-name', '-iname'})
                    for filters, negated in branches):
                return 'find deletion selects repository metadata'
            if (linked and not follow_descendants) or not stat.S_ISDIR(info.st_mode):
                continue
            if maximum is not None and depth == maximum:
                continue
            identity = (info.st_dev, info.st_ino)
            if identity in ancestors:
                return 'find metadata traversal cannot be evaluated safely'
            ancestors = ancestors | {identity}
            with os.scandir(path) as entries:
                for entry in entries:
                    # Ordinary files cannot expose metadata children. Keep their
                    # count out of the directory/metadata discovery budget.
                    if not (metadata or entry.name.casefold() == '.git'
                            or entry.is_dir(follow_symlinks=follow_descendants)):
                        continue
                    count += 1
                    if count > 5000 or depth >= 64:
                        return 'find metadata traversal exceeds bounded probe'
                    stack.append((entry.path, depth + 1, metadata, ancestors))
    except OSError:
        return 'find metadata traversal cannot be evaluated safely'
    return None


def _bounded_temp_find_cleanup(api, args, cwd, variables, protected_cwd, created_paths):
    """A one-level selective temp-directory cleanup has statically safe roots."""
    if (args.count('-exec') != 1 or len(args) < 5
            or args[-5:-3] != ['-exec', 'rm'] or args[-3] not in {'-rf', '-fr', '-r', '-R'}
            or args[-2:] != ['{}', '+'] or any(word in args for word in ('-L', '-H', '-follow'))):
        return False
    predicates = args[:-5]
    if (predicates.count('-maxdepth') != 1 or predicates.count('-type') != 1
            or predicates[predicates.index('-maxdepth') + 1:][:1] != ['1']
            or predicates[predicates.index('-type') + 1:][:1] != ['d']):
        return False
    parsed = _find_deletion_roots(predicates + ['-delete'])
    if parsed is None:
        return False
    roots, _follow, branches, mindepth, grouped = parsed
    for target in roots:
        value, complete = api['_expand_known_vars'](target, variables)
        value, tilde_complete = _expand_tilde(value, variables)
        physical = os.path.realpath(os.path.join(cwd, value))
        if (not complete or not tilde_complete or not _find_root_filtered(target, branches, mindepth, grouped)
                or not any(api['_within'](physical, os.path.realpath(prefix))
                           for prefix in ('/tmp', '/private/tmp', '/var/folders', '/private/var/folders'))
                or _created_target_reason(api, target, cwd, variables, created_paths)
                or api['_rm_target_reason'](target, cwd, variables, protected_cwd)):
            return False
    return bool(roots)


def _find_root_filtered(target, branches, mindepth, grouped):
    """Skip breadth only when every deletion branch excludes its starting root."""
    if grouped or not branches:
        return False
    if mindepth > 0 and all(not negated and any(
            option == '-mtime' and re.fullmatch(r'\+[0-9]+', pattern)
            and int(pattern[1:]) > 0 for option, pattern in filters)
            for filters, negated in branches):
        return True  # aged entries below the root; never waives the repo root
    for filters, negated in branches:
        if negated or not filters:
            return False
        excludes_root = False
        for option, pattern in filters:
            if not _selective_find_filter(option, pattern):
                continue
            value = os.path.basename(target.rstrip('/'))
            if option == '-iname':
                value, pattern = value.casefold(), pattern.casefold()
            try:
                matches = bool(re.fullmatch(pattern, value)) if 'regex' in option else fnmatch.fnmatchcase(value, pattern)
            except re.error:
                return False
            excludes_root |= not matches
        if not excludes_root:
            return False
    return True


def _rm_reason_in_words(
    api: dict,
    words: list[str],
    position: int,
    cwd: str,
    variables: dict[str, str],
    *,
    dynamic_input: bool = False,
    protected_cwd: str | None = None,
    argument_variables: dict[str, str] | None = None,
    _depth: int = 0,
    _find_cache: dict[tuple, str | None] | None = None,
    _created_paths: list[CreatedPath] | None = None,
) -> str | None:
    """Inspect command positions, including wrapper-owned nested commands."""
    if _depth > api["_MAX_WRAPPER_DEPTH"]:
        return api["_wrapper_depth_reason"]()
    if argument_variables is None:
        argument_variables = variables
    if _find_cache is None:
        _find_cache = {}
    if _created_paths is None:
        _created_paths = []
    while (
        position < len(words)
        and words[position].lower() in api["_SHELL_CONTROL_PREFIXES"]
    ):
        position += 1
    if position >= len(words):
        return None
    command_name = os.path.basename(words[position]).lower()

    if command_name in {"sudo", "command", "builtin", "nohup", "exec", "doas"}:
        option_values = {
            "-u", "--user", "-g", "--group", "-h", "--host",
            "-p", "--prompt", "-C", "--close-from", "-a",
        } if command_name in {"sudo", "doas"} else ({"-a"} if command_name == "exec" else set())
        nested = api["_skip_options"](words, position + 1, option_values)
        return _rm_reason_in_words(
            api,
            words,
            nested,
            cwd,
            variables,
            dynamic_input=dynamic_input,
            argument_variables=argument_variables,
            protected_cwd=protected_cwd,
            _depth=_depth + 1,
            _find_cache=_find_cache, _created_paths=_created_paths,
        )

    if command_name == "env":
        for index in range(position + 1, len(words)):
            option = words[index]
            split_value = None
            remainder = index + 1
            if option in {"-S", "--split-string"} and remainder < len(words):
                split_value = words[remainder]
                remainder += 1
            elif option.startswith("--split-string="):
                split_value = option.split("=", 1)[1]
            if split_value is None:
                continue
            try:
                split_words = shlex.split(split_value)
            except ValueError:
                return "rm command carried by env split-string cannot be parsed safely"
            return _rm_reason_in_words(
                api,
                split_words + words[remainder:],
                0,
                cwd,
                variables,
                dynamic_input=dynamic_input,
                argument_variables=argument_variables,
                protected_cwd=protected_cwd,
                _depth=_depth + 1,
                _find_cache={}, _created_paths=_created_paths,
            )
        nested = api["_skip_options"](
            words,
            position + 1,
            {"-u", "--unset", "-C", "--chdir", "--argv0"},
        )
        local_variables = dict(variables)
        assignment_re = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*)=(.*)$", re.DOTALL)
        while nested < len(words):
            assignment = assignment_re.match(words[nested])
            if assignment is None:
                break
            expanded, complete = api["_expand_known_vars"](assignment.group(2), local_variables)
            if complete:
                value, complete = _expand_tilde(expanded, local_variables)
                local_variables[assignment.group(1)] = value if complete else None
            else:
                local_variables[assignment.group(1)] = None
            nested += 1
        return _rm_reason_in_words(
            api,
            words,
            nested,
            cwd,
            local_variables,
            dynamic_input=dynamic_input,
            argument_variables=argument_variables,
            protected_cwd=protected_cwd,
            _depth=_depth + 1,
            _find_cache=_find_cache, _created_paths=_created_paths,
        )

    if command_name in {"timeout", "gtimeout", "caffeinate", "arch", "stdbuf", "script", "flock"}:
        option_values = {
            "timeout": {"-s", "--signal", "-k", "--kill-after"},
            "gtimeout": {"-s", "--signal", "-k", "--kill-after"},
            "caffeinate": {"-t", "-w"}, "arch": {"-arch"},
            "stdbuf": {"-i", "-o", "-e", "--input", "--output", "--error"},
            "script": {"-t"}, "flock": {"-w", "--timeout", "-E", "--conflict-exit-code"},
        }[command_name]
        nested = api["_skip_options"](words, position + 1, option_values)
        if command_name in {"timeout", "gtimeout", "script", "flock"}:
            nested += 1  # duration, logfile, or lockfile operand
        return _rm_reason_in_words(
            api, words, nested, cwd, variables, dynamic_input=dynamic_input,
            argument_variables=argument_variables, protected_cwd=protected_cwd,
            _depth=_depth + 1, _find_cache=_find_cache, _created_paths=_created_paths,
        )

    if command_name == "time":
        nested = api["_skip_options"](
            words, position + 1, {"-o", "--output", "-f", "--format"}
        )
        return _rm_reason_in_words(
            api,
            words,
            nested,
            cwd,
            variables,
            dynamic_input=dynamic_input,
            argument_variables=argument_variables,
            protected_cwd=protected_cwd,
            _depth=_depth + 1,
            _find_cache=_find_cache, _created_paths=_created_paths,
        )

    if command_name == "nice":
        nested = api["_skip_options"](
            words, position + 1, {"-n", "--adjustment"}
        )
        return _rm_reason_in_words(
            api,
            words,
            nested,
            cwd,
            variables,
            dynamic_input=dynamic_input,
            argument_variables=argument_variables,
            protected_cwd=protected_cwd,
            _depth=_depth + 1,
            _find_cache=_find_cache, _created_paths=_created_paths,
        )

    if command_name == "eval":
        payload = " ".join(words[position + 1:])
        with api['shell_code_reading'](payload, 'both'):
            blocked, reason = is_dangerous_rm(api, payload, cwd=cwd, env=variables,
                _depth=_depth + 1, protected_cwd=protected_cwd, _created_paths=_created_paths)
        return reason if blocked else None

    if command_name in {"bash", "sh", "zsh", "dash", "ksh"}:
        for index in range(position + 1, len(words) - 1):
            option = words[index]
            if option == "--command" or (
                option.startswith("-") and not option.startswith("--") and "c" in option[1:]
            ):
                # Decoding argv loses outer PID/quote provenance; retain both
                # readings rather than narrowing the existing guarded policy.
                with api['shell_code_reading'](words[index + 1], 'both'):
                    blocked, reason = is_dangerous_rm(
                        api, words[index + 1], cwd=cwd, env=variables, _depth=_depth + 1,
                        protected_cwd=protected_cwd, _created_paths=_created_paths)
                return reason if blocked else None
        return None

    if command_name == "find":
        # Preserve the established cache-only prune cleanup. Exact grammar keeps
        # sibling actions, OR expressions and arbitrary dynamic roots conservative.
        args = words[position + 1:]
        if _bounded_temp_find_cleanup(api, args, cwd, argument_variables, protected_cwd, _created_paths):
            return None
        if (len(args) == 11 and args[:7] == [".", "-name", "__pycache__", "-type", "d", "-prune", "-exec"]
                and os.path.basename(args[7]) == "rm" and args[8] in {"-r", "-R", "-rf", "-fr"}
                and args[9:] == ["{}", "+"] and api["_outermost_repo_root"](cwd)):
            return None
        if "-delete" in words[position + 1:]:
            parsed = _find_deletion_roots(words[position + 1:],
                include_follow_mode=True, include_depth_limits=True)
            if parsed is None:
                return "find deletion roots cannot be parsed safely"
            roots, follow_symlinks, branches, mindepth, grouped, follow_mode, depth_limits = parsed
            for target in roots if branches else []:
                reason = _created_target_reason(api, target, cwd, argument_variables, _created_paths)
                if reason:
                    return reason
                filtered = _find_root_filtered(target, branches, mindepth, grouped)
                metadata_safe = filtered and all(not negated and any(
                    _metadata_name_filter(option, pattern) for option, pattern in filters)
                    for filters, negated in branches)
                reason = api["_rm_target_reason"](target, cwd, argument_variables, protected_cwd,
                    follow_symlinks=follow_symlinks, protected_only=filtered,
                    filtered_find=metadata_safe)
                if reason:
                    return reason
                if filtered or follow_mode == "L":
                    reason = _metadata_traversal_reason(api, target, cwd, argument_variables,
                        branches, follow_mode, depth_limits)
                    if reason:
                        return reason
        for index in range(position + 1, len(words)):
            if words[index] in {"-exec", "-execdir"}:
                # Preserve the conservative sibling scan: token-only parsing cannot
                # safely decide which `{}` terminator belongs to a nested find.
                # Memoization bounds repeated safe nested chains without skipping
                # a later destructive -exec clause.
                cache_key = (
                    id(words), index + 1, _depth + 1, dynamic_input,
                    id(variables), id(argument_variables),
                )
                if cache_key not in _find_cache:
                    _find_cache[cache_key] = _rm_reason_in_words(
                        api,
                        words,
                        index + 1,
                        cwd,
                        variables,
                        dynamic_input=dynamic_input,
                        argument_variables=argument_variables,
                        protected_cwd=protected_cwd,
                        _depth=_depth + 1,
                        _find_cache=_find_cache, _created_paths=_created_paths,
                    )
                reason = _find_cache[cache_key]
                if reason:
                    return reason
        return None

    if command_name == "xargs":
        nested = api["_skip_options"](
            words,
            position + 1,
            {
                "-a", "--arg-file", "-d", "--delimiter", "-E",
                "-I", "-L", "--max-lines", "-n",
                "--max-args", "-P", "--max-procs", "-s", "--max-chars",
            },
        )
        return _rm_reason_in_words(
            api,
            words,
            nested,
            cwd,
            variables,
            dynamic_input=True,
            argument_variables=argument_variables,
            protected_cwd=protected_cwd,
            _depth=_depth + 1,
            _find_cache=_find_cache, _created_paths=_created_paths,
        )

    if command_name == 'mkdir':
        index = position + 1
        options = True
        while index < len(words):
            target = words[index]
            index += 1
            if options and target == '--':
                options = False
                continue
            if options and (target == '--mode' or re.fullmatch(r'-[pv]*m', target)):
                index += 1
                continue
            if options and target.startswith('-'):
                continue
            expanded, complete = api['_expand_known_vars'](target, argument_variables)
            expanded, tilde_complete = _expand_tilde(expanded, argument_variables)
            path = os.path.abspath(os.path.join(cwd, expanded)) if complete and tilde_complete and cwd else None
            if path is None:
                _created_paths.append((None, 'directory'))
            while path and not os.path.exists(path):
                if api['_rm_target_reason'](path, cwd, argument_variables, protected_cwd,
                        protected_only=True, follow_symlinks=True, assume_directory=True):
                    _created_paths.append((path, 'directory'))
                parent = os.path.dirname(path)
                path = parent if parent != path else None
        return None

    if command_name in {"mv", "ln", "cp"}:
        args = words[position + 1:]
        operands = []
        destination_option = None
        index = 0
        options = True
        while index < len(args):
            word = args[index]
            if options and word == "--":
                options = False
            elif options and word.startswith("--target-directory="):
                destination_option = word.split("=", 1)[1]
            elif options and word.startswith("-t") and not word.startswith("--") and len(word) > 2:
                destination_option = word[2:]
            elif options and word in {"-t", "--target-directory", "-S", "--suffix"}:
                if index + 1 >= len(args):
                    return "path creation option cannot be resolved safely"
                index += 1
                if word in {"-t", "--target-directory"}:
                    destination_option = args[index]
            elif not options or not word.startswith("-"):
                operands.append(word)
            index += 1
        creates_path = command_name in {"mv", "ln"} or any(
            word in {"--recursive", "-r", "-R"} or
            (word.startswith("-") and not word.startswith("--") and any(c in word[1:] for c in "rRa"))
            for word in args
        )
        if creates_path and operands:
            sources = operands if destination_option else operands[:-1]
            if command_name == "mv":
                for source in sources:
                    reason = _created_target_reason(api, source, cwd, argument_variables, _created_paths)
                    if reason:
                        return reason
                    reason = api["_rm_target_reason"](source, cwd, argument_variables, protected_cwd, protected_only=True)
                    if reason:
                        return "protected root used by move or symbolic link"
            destination_operand = destination_option or operands[-1]
            if command_name == "ln" and not destination_option and len(operands) == 1:
                destination_operand = os.path.basename(operands[0].rstrip("/"))
            expanded, complete = api["_expand_known_vars"](destination_operand, argument_variables)
            expanded, tilde_complete = _expand_tilde(expanded, argument_variables)
            destination = os.path.abspath(os.path.join(cwd, expanded)) if complete and tilde_complete and cwd else None
            _created_paths.append(destination)
        return None

    if command_name == "rsync" and any(word == "--del" or word.startswith("--delete") for word in words[position + 1:]):
        destination = _rsync_destination(words, position)
        if destination is None:
            return "rsync deletion destination cannot be parsed safely"
        if re.match(r"^[^/]+:", destination):
            return None  # remote filesystems are outside this local boundary
        reason = _created_target_reason(api, destination, cwd, argument_variables, _created_paths)
        if reason:
            return reason
        return api["_rm_target_reason"](destination, cwd, argument_variables, protected_cwd, follow_symlinks=True)

    if command_name != "rm":
        return None

    arguments = words[position + 1:]
    flags = [word for word in arguments if word.startswith("-") and word != "-"]
    recursive = any(word == "--recursive" or
                    (not word.startswith("--") and any(c in word[1:] for c in "rR"))
                    for word in flags)
    if not recursive:
        return None
    targets = [word for word in arguments if word not in flags and word != "--"]
    if dynamic_input:
        return "rm target supplied dynamically by xargs"
    for target in targets:
        reason = _created_target_reason(api, target, cwd, argument_variables, _created_paths)
        if reason:
            return reason
        reason = api["_rm_target_reason"](target, cwd, argument_variables, protected_cwd)
        if reason:
            return reason
    return None


def is_dangerous_rm(
    api: dict, command: str, *, cwd: str | None = None, env=None, _depth: int = 0,
    _find_cache: dict[tuple, str | None] | None = None,
    protected_cwd: str | None = None,
    _created_paths: list[CreatedPath] | None = None,
):
    """Return `(blocked, reason)` after resolving cwd and shell assignments."""
    if _depth > api["_MAX_WRAPPER_DEPTH"]:
        return True, api["_wrapper_depth_reason"]()
    if _find_cache is None:
        _find_cache = {}
    if _created_paths is None:
        _created_paths = []
    active = api["shell_text_without_heredoc_bodies"](command)
    try:
        tokens = api['_shell_operator_words'](
            _without_redirections(api["_shell_text_with_comments_blanked"](active)))
    except ValueError:
        direct_rm = re.search(
            r"(?:^|[;&|(\n]\s*)(?:[^\s;&|]*/)?rm\b"
            r"(?=[^;&|\n]*(?:--recursive\b|-[A-Za-z]*[rR][A-Za-z]*))",
            active,
        )
        return (True, "rm command cannot be parsed safely") if direct_rm else (False, None)

    segments = []
    segment = []
    preceding_operator = None
    for token, is_operator in tokens:
        if is_operator and (all(char in ';&|()' for char in token)
                            or token.startswith((')$', ')`'))):
            if segment:
                segments.append((segment, preceding_operator, token))
                segment = []
            preceding_operator = token
            continue
        if token == "$" and not segment:
            continue
        segment.append(token)
    if segment:
        segments.append((segment, preceding_operator, None))

    variables = dict(os.environ if env is None else env)
    current = os.path.abspath(cwd or os.getcwd())
    if protected_cwd is None:
        protected_cwd = current
    previous = variables.get("OLDPWD", "")
    assignment_re = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*)=(.*)$", re.DOTALL)

    for words, operator_before, operator_after in segments:
        variables.update(PWD=current, OLDPWD=previous)
        argument_variables = dict(variables)
        local_variables = dict(variables)
        position = 0
        control_prefix_seen = False
        while (
            position < len(words)
            and words[position].lower() in api["_SHELL_CONTROL_PREFIXES"]
        ):
            control_prefix_seen = True
            position += 1
        assignments = []
        while position < len(words):
            assignment = assignment_re.match(words[position])
            if assignment is None:
                break
            expanded, complete = api["_expand_known_vars"](
                assignment.group(2), local_variables
            )
            if complete:
                value, complete = _expand_tilde(expanded, local_variables)
                local_variables[assignment.group(1)] = value if complete else None
            else:
                local_variables[assignment.group(1)] = None
            assignments.append((assignment.group(1), local_variables[assignment.group(1)]))
            position += 1
        if position == len(words):
            if (
                control_prefix_seen
                or operator_before == "||"
                or (operator_before == "&&" and operator_after != "&&")
            ):
                # A condition may execute the assignment; retain its unknown
                # marker so later literal-tail resolution cannot treat it as
                # an untouched inherited scratch variable.
                for name, _value in assignments:
                    variables[name] = None
            else:
                variables.update(assignments)
            continue

        command_name = os.path.basename(words[position])
        if command_name in {"export", "readonly", "declare", "typeset"}:
            for word in words[position + 1:]:
                assignment = assignment_re.match(word)
                if assignment is None:
                    continue
                expanded, complete = api["_expand_known_vars"](
                    assignment.group(2), argument_variables
                )
                if complete:
                    value, complete = _expand_tilde(expanded, argument_variables)
                else:
                    value = None
                variables[assignment.group(1)] = value if complete else None
                local_variables[assignment.group(1)] = value if complete else None
            continue
        if command_name == "popd":
            current = ""
            continue
        if command_name in {"cd", "pushd"}:
            if (
                control_prefix_seen
                or operator_before == "||"
                or (operator_before == "&&" and operator_after != "&&")
            ):
                current = ""
                continue
            if position + 1 >= len(words) or words[position + 1] == "-":
                current = ""
                continue
            target_position = position + 1
            if words[target_position] == "--":
                target_position += 1
            if target_position >= len(words) or words[target_position].startswith("-"):
                current = ""
                continue
            expanded, complete = api["_expand_known_vars"](
                words[target_position], argument_variables
            )
            if complete:
                expanded, complete = _expand_tilde(expanded, argument_variables)
            if complete:
                previous = current
                current = os.path.abspath(
                    expanded
                    if os.path.isabs(expanded)
                    else os.path.join(current, expanded)
                )
            else:
                current = ""
            continue

        reason = _rm_reason_in_words(
            api,
            words,
            position,
            current,
            local_variables,
            argument_variables=argument_variables,
            protected_cwd=protected_cwd,
            _depth=_depth,
            _find_cache=_find_cache, _created_paths=_created_paths,
        )
        if reason:
            return True, reason
    return False, None
