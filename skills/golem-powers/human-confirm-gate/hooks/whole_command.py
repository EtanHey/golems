"""Deny-only evidence for executable expansions; never materialize shell argv.

This view cannot authorize anything. Exact literal/reference assignments can
supply evidence; operators, dynamic writers and substitutions remain unknown.
The original consumer still classifies the unchanged command and arguments.
"""
import re
from dataclasses import dataclass

_NAME = r'[A-Za-z_][A-Za-z0-9_]*'
_REFERENCE = re.compile(r'\$(?:(' + _NAME + r')|\{[!#]?(' + _NAME + r'))')
_EXACT = re.compile(r'\$(?:(' + _NAME + r')|\{(' + _NAME + r')\})')
_DECLARATIONS = {'declare', 'typeset', 'local', 'export', 'readonly'}
_READ_VALUES = frozenset('adinNptu')


@dataclass(frozen=True)
class Evidence:
    guarded: bool = False
    unknown: bool = False
    literal: str | None = None


def normal(word):
    return str(word).replace('\ue000', '{').replace('\ue001', '}')


def references(word):
    return [m[1] or m[2] for m in _REFERENCE.finditer(normal(word))]


def guarded_text(text, syntax, ifs):
    # No split fields are ever used to authorize. Unknown IFS may select any
    # visible character as a delimiter, so also retain lexical policy words.
    fields = text.split()
    if ifs:
        fields += re.split('[' + re.escape(ifs) + ']', text)
    return syntax.guarded_words(fields)


def evidence(value, values, syntax, ifs):
    if value is None:
        return Evidence(unknown=True)
    value = normal(value)
    exact = _EXACT.fullmatch(value)
    if exact:
        return values.get(exact[1] or exact[2], Evidence(unknown=True))
    related = [values.get(name, Evidence(unknown=True)) for name in references(value)]
    unknown = ifs is None or any(c in value for c in '$`*?[]{}') or any(v.unknown for v in related)
    return Evidence(guarded_text(value, syntax, ifs) or any(v.guarded for v in related),
                    unknown, None if unknown else value)


def read_destinations(args):
    """Read option arity affects destinations, not the unknown input value."""
    names, i, options = [], 0, True
    while i < len(args):
        word = args[i]; i += 1
        if word == '--' and options:
            options = False; continue
        if options and word.startswith('-') and word != '-':
            for j, option in enumerate(word[1:], 1):
                if option not in _READ_VALUES:
                    continue
                value = word[j+1:]
                if not value and i < len(args):
                    value = args[i]; i += 1
                if option == 'a' and re.fullmatch(_NAME, value): names.append(value)
                break
        elif re.fullmatch(_NAME, word):
            names.append(word)
    return names or ['REPLY']


def check(command, initial, shell, syntax):
    """Replay evidence in the supplemental argv view, then refuse opaque code.

    Do not resolve parameter operators or remove the original fallback path.
    Evidence survives uncertain execution/scope: it can only add a denial.
    """
    parent = shell._impl_module('heredocs')._strip_heredoc_bodies(command, preserve_expansions=False)
    try:
        words, positions, segments, scopes = syntax.substitution_argv(parent, shell)
    except ValueError:
        return  # An unproved supplemental view must retain base inspection.
    # Positive parent-scope grammar. Arrays, functions, compounds and control
    # operators are left to the original consumer and recursive body checks.
    if any(w in ('|', '&', '(', ')', '{', '}', 'if', 'for', 'while', 'case') for w in words):
        return
    values = {name: evidence(value, {}, syntax, ' \t\n') for name, value in initial.items()}
    ifs = initial.get('IFS', ' \t\n')
    for i, word in enumerate(words):
        if not positions[i] or syntax.looked_up(words, positions, i):
            continue
        args, _ = syntax.argv_at(words, segments, scopes, i)
        assignment = shell._ASSIGNMENT_RE.match(word)
        if assignment:
            name, value = assignment['name'], word.split('=', 1)[1]
            new = evidence(value, values, syntax, ifs)
            if assignment['append'] or assignment['subscript']:
                old = values.get(name, Evidence(unknown=True))
                new = Evidence(new.guarded or old.guarded, True)
            values[name] = new
            if name == 'IFS':
                ifs = new.literal
            continue
        base = syntax.executable(word)[0]
        if base in _DECLARATIONS:
            # Only scalar literal/reference assignments have a known value.
            # Options with value semantics (arrays, integers, namerefs, etc.)
            # supply unknown evidence, never a rewritten executable.
            unknown = any(a.startswith('-') and a not in ('--', '-x', '-r', '-rx', '-xr') for a in args)
            for arg in args:
                match = shell._ASSIGNMENT_RE.match(arg)
                if match:
                    name = match['name']; new = evidence(arg.split('=', 1)[1], values, syntax, ifs)
                    old = values.get(name, Evidence()) if match['append'] or match['subscript'] else Evidence()
                    values[name] = Evidence(new.guarded or old.guarded,
                                            new.unknown or unknown or bool(match['append'] or match['subscript']))
                elif re.fullmatch(_NAME, arg) and arg not in values:
                    values[arg] = Evidence(unknown=True)
        elif base == 'read':
            for name in read_destinations(args): values[name] = Evidence(unknown=True)
        elif base in ('readarray', 'mapfile'):
            # Even a visible input is data with runtime splitting/array rules.
            names = [a for a in args if re.fullmatch(_NAME, a)]
            for name in names or ['MAPFILE']: values[name] = Evidence(unknown=True)
        elif base == 'printf' and '-v' in args:
            j = args.index('-v') + 1
            if j < len(args) and re.fullmatch(_NAME, args[j]): values[args[j]] = Evidence(unknown=True)
        elif base == 'unset':
            for name in args:
                if re.fullmatch(_NAME, name): values.pop(name, None)
        if base in syntax.DATA or '$' not in word and '`' not in word:
            continue
        related = [values[name] for name in references(word) if name in values]
        hidden = guarded_text(normal(word), syntax, ifs) or any(v.guarded for v in related)
        # A zero-argument substitution/unknown assigned value can produce the
        # entire executable and argv. A normal data operand cannot enter here.
        whole = not args and ('${command-substitution}' in normal(word) or any(v.unknown for v in related))
        exact = _EXACT.fullmatch(normal(word))
        bound = values.get(exact[1] or exact[2]) if exact else None
        known = bound is not None and bound.literal is not None and not any(c.isspace() for c in bound.literal)
        if hidden or whole or not known and syntax.guarded_words(args):
            raise ValueError('opaque whole-command expansion may contain protected argv')
