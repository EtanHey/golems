"""Symbolic mktemp results, scoped to this command; never run mktemp to guess a name."""
import os
import re
import shlex


class FreshTemp(str):
    """A fresh, unknown leaf below a verified temp parent (not a real pathname)."""


def temp_roots(variables):
    return {os.path.realpath(p) for p in ('/tmp', '/private/tmp',
            os.environ.get('TMPDIR', ''), variables.get('TMPDIR', ''))
            if p and os.path.isabs(p)}


def fresh_value(value, variables, expand):
    match = re.fullmatch(r'\$\((mktemp(?:\s[^()]*)?)\)', value, re.S)
    if not match:
        return None
    try:
        args = shlex.split(match[1])[1:]
    except ValueError:
        return None
    normalized = []
    for arg in args:
        match = re.fullmatch(r'-([dqu]*)([pt])(.*)', arg)
        if match:
            if match[1]:
                normalized.append('-' + match[1])
            normalized.append('-' + match[2])
            if match[3]:
                normalized.append(match[3])
        else:
            normalized.append(arg)
    args = normalized
    parent = variables.get('TMPDIR') or '/tmp'
    template = None
    temp_mode = False
    i = 0
    while i < len(args):
        arg = args[i]
        if arg in ('-p', '--tmpdir', '-t', '--suffix'):
            if i + 1 == len(args):
                return None
            i += 1
            val, complete = expand(args[i], variables)
            if not complete:
                return None
            if arg in ('-p', '--tmpdir'):
                parent, temp_mode = val, True
            elif arg == '-t':
                if '/' in val:
                    return None
                temp_mode = True  # BSD prefix / GNU temp-relative template
            elif '/' in val:
                return None
        elif arg.startswith('--suffix='):
            suffix, complete = expand(arg.split('=', 1)[1], variables)
            if not complete or '/' in suffix:
                return None
        elif arg.startswith('--tmpdir='):
            parent, complete = expand(arg.split('=', 1)[1], variables)
            if not complete:
                return None
            temp_mode = True
        elif arg == '--':
            if len(args[i + 1:]) != 1:
                return None
            template = args[i + 1]
            break
        elif arg.startswith('-'):
            if arg not in ('--directory', '--dry-run', '--quiet') and not re.fullmatch(r'-[dqu]+', arg):
                return None
        elif template is None:
            template = arg
        else:
            return None
        i += 1
    if template is not None:
        template, complete = expand(template, variables)
        if not complete or '..' in template.split('/'):
            return None
        if os.path.isabs(template):
            parent = os.path.dirname(template)
        elif '/' in template or not temp_mode:
            return None  # relative template is cwd-relative; no temp proof
    if not parent or not os.path.isabs(parent) or '..' in parent.split('/'):
        return None
    physical = os.path.realpath(parent)
    if not any(physical == root or physical.startswith(root + '/') for root in temp_roots({})):
        return None
    # Identity is symbolic: path-policy handles it before filesystem inspection.
    return FreshTemp(physical.rstrip('/') + '/__fresh_mktemp_leaf__')


def collapse_assignments(tokens):
    """The shared lexer emits unquoted $() as operators; retain exact assignments."""
    result = []
    i = 0
    while i < len(tokens):
        word, op = tokens[i]
        if (not op and re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*=\$', word)
                and tokens[i + 1:i + 2] == [('(', True)]):
            end = i + 2
            while end < len(tokens) and not tokens[end][1]:
                end += 1
            if end < len(tokens) and tokens[end] == (')$', True):
                body = shlex.join(t[0] for t in tokens[i + 2:end])
                result.append((word + '(' + body + ')', False))
                i = end + 1
                continue
        result.append((word, op))
        i += 1
    return result


def fresh_operand(target, variables):
    match = re.fullmatch(r'\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))', target)
    return bool(match and isinstance(variables.get(match[1] or match[2]), FreshTemp))


def has_literal_substitution(source):
    """Do not promote shell data/escaped dollars to a fresh assignment."""
    if re.search(r'\b(?:eval|source|function|alias|let)\b|\b\w+\s*\(\s*\)|printf\s+-v|(?:^|[;&]\s*)\.\s', source):
        return True  # shell state/function mutation cannot carry freshness
    quote = None
    i = 0
    while i < len(source):
        if source[i] == "\\" and quote != "'":
            if source[i + 1:i + 3] == '$(':
                return True
            i += 2
            continue
        if source[i:i + 2] == '$(' and quote == "'":
            return True
        if source[i] in "'\"":
            if quote == source[i]:
                quote = None
            elif quote is None:
                quote = source[i]
        i += 1
    return False


def is_temp_root(path, variables):
    return path in temp_roots(variables) or bool(re.fullmatch(
        r'/(?:private/)?var/folders/[^/]+/[^/]+/T', path))
