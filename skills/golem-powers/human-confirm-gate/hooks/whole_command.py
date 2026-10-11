"""Deny-only evidence for executable expansions; never materialize shell argv.

This view cannot authorize anything. Exact literal/reference assignments can
supply evidence; operators, dynamic writers and substitutions remain unknown.
The original consumer still classifies the unchanged command and arguments.
"""
from __future__ import annotations

import re
from pathlib import Path
from dataclasses import dataclass

_NAME = r'[A-Za-z_][A-Za-z0-9_]*'
_REFERENCE = re.compile(r'\$(?:(' + _NAME + r')|\{[!#]?(' + _NAME + r'))')
_EXACT = re.compile(r'\$(?:(' + _NAME + r')|\{(' + _NAME + r')\})')
_DECLARATIONS = {'declare', 'typeset', 'local', 'export', 'readonly'}
_READ_VALUES = frozenset('adinNptu')
_PATH_CHAIN_COMMANDS = {'mkdir', 'cat', 'chmod', 'ls', 'echo', 'true', 'false'}
_CARDINALITY = re.compile(r'\$\{#' + _NAME + r'(?:\[@\]|\[\*\])?\}')
# ${name=word} / ${name:=word} assign in any word position, including data.
# Match lexer words before normal(): single-quoted/ANSI-C braces stay marked.
_ASSIGNING = re.compile(r'\$\{(!?)(' + _NAME + r'):?=')
_ESCAPED_DOLLAR = '\ue002'


def escaped_dollars(command, shell):
    """Mark backslash-escaped `$` for the writer probe only; it cannot expand.

    Quote state follows the shell. Substitution bodies run in a subshell and
    stay unchanged; any scan the lexer does not align with keeps every writer.
    """
    quotes = shell._impl_module('quotes')
    substitutions = shell._impl_module('substitutions')
    result, quote, i = list(command), None, 0
    while i < len(command):
        char = command[i]
        if quote == "'":
            quote = None if char == "'" else quote
        elif quote is None and quotes.ansi_c_opens_at(command, i):
            i = quotes.ansi_c_quote(command, i)[1]
            continue
        elif quote is None and char == '#' and (i == 0 or command[i-1].isspace() or command[i-1] in ';|&()<>'):
            end = command.find('\n', i)
            i = len(command) if end < 0 else end
            continue
        elif char == '\\' and i + 1 < len(command):
            if command[i+1] == '$': result[i+1] = _ESCAPED_DOLLAR
            i += 2
            continue
        elif command.startswith('$(', i) or char == '`':
            found = (substitutions._dollar_substitution(command, i) if char == '$'
                     else substitutions._backtick_substitution(command, i))
            if found is None: break
            i = found[1]
            continue
        elif char == '"' or char == "'" and quote is None:
            quote = None if quote == char else char
        i += 1
    return ''.join(result)


def arithmetic_data(command, shell):
    """Only numeric cardinality commands lose supplemental executable positions.

    Quotes/comments and substitution bodies keep their original evidence. No
    executable substitution or arbitrary arithmetic value is masked here;
    base inspection always receives the unchanged command.
    """
    structural = shell._impl_module('structure').structural_source(command)
    result = list(command)
    for match in re.finditer(r'(?<![\w$\\])\(\(([^()]*)\)\)', structural):
        body = command[match.start(1):match.end(1)]
        numeric = _CARDINALITY.sub('0', body)
        if _CARDINALITY.search(body) and re.fullmatch(r'[\s0-9+*/%<>=!&|^~?:-]+', numeric):
            result[match.start():match.end()] = ':' + ' ' * (match.end()-match.start()-1)
    return ''.join(result)


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
    parent = arithmetic_data(parent, shell)
    try:
        words, positions, segments, scopes = syntax.substitution_argv(parent, shell)
    except ValueError:
        return  # An unproved supplemental view must retain base inspection.
    try:
        probe = syntax.substitution_argv(escaped_dollars(parent, shell), shell)[0]
    except ValueError:
        probe = None
    if probe is None or len(probe) != len(words) or any(
            normal(p).replace(_ESCAPED_DOLLAR, '$') != normal(w) for p, w in zip(probe, words)):
        probe = words  # Unaligned provenance keeps every writer.
    # Locate data regions before examining executable positions. The legacy
    # lexer can expose a substitution inside an array or quoted data operand as
    # another command position; base recursion still inspects its actual body.
    arrays, array_values = set(), set()
    for i, word in enumerate(words[:-1]):
        if shell._ASSIGNMENT_RE.match(word) and words[i+1] == '(':
            array_values.add(i)
            depth, j = 1, i + 2
            arrays.add(i+1)
            while j < len(words) and depth:
                arrays.add(j)
                depth += (words[j] == '(') - (words[j] == ')')
                j += 1
    grammar = {'if', 'then', 'elif', 'else', 'fi', 'for', 'while', 'until',
               'do', 'done', 'case', 'esac', '{', '}', '(', ')'}
    heads = {}
    for i, word in enumerate(words):
        if (i not in arrays and positions[i] and not shell._ASSIGNMENT_RE.match(word)
                and word not in grammar):
            heads.setdefault(segments[i], i)
    values = {name: evidence(value, {}, syntax, ' \t\n') for name, value in initial.items()}
    ifs = initial.get('IFS', ' \t\n')
    conditional, scopes, beginning = False, [], True
    temporary, temporary_segment = {}, None
    # A literal directory assigned to a previously unbound name is a visible
    # path alternative, not proof that its conditional assignment ran. A fixed
    # suffix can retain base inspection; never turn this into a known binding.
    conditional_paths = {}
    def assign(name, value, uncertain=False):
        nonlocal ifs
        conditional_paths.pop(name, None)
        if uncertain:
            old = values.get(name, Evidence())
            value = Evidence(old.guarded or value.guarded, True)
        values[name] = value
        if name == 'IFS': ifs = value.literal
    def expansion_values():
        # Command names and ordinary arguments expand before prefix assignments.
        view = dict(values)
        for name, old in temporary.items():
            if old is None: view.pop(name, None)
            else: view[name] = old
        return view
    def expansion_ifs():
        if 'IFS' not in temporary: return ifs
        old = temporary['IFS']
        return old.literal if old is not None else ' \t\n'
    def literal(word):
        # This supplies evidence only, never executable argv or authorization.
        def replace(match):
            value = expansion_values().get(match[1] or match[2])
            return value.literal if value and not value.unknown and value.literal is not None else match[0]
        resolved = _EXACT.sub(replace, normal(word))
        resolved = syntax.expand_home(resolved, Path.home())
        return None if syntax.unresolved(resolved, Path.home()) else resolved
    def fixed_path(word, split_ifs):
        match = _EXACT.match(normal(word))
        if not match or split_ifs is None:
            return False
        prefix = conditional_paths.get(match[1] or match[2])
        suffix = normal(word)[match.end():]
        return (prefix is not None and suffix.startswith('/') and len(suffix) > 1
                and not syntax.unresolved(suffix, Path.home())
                and not any(c.isspace() or c in split_ifs for c in prefix + suffix))
    for i, word in enumerate(words):
        if temporary_segment is not None and segments[i] != temporary_segment:
            for name, old in temporary.items():
                if old is None: values.pop(name, None)
                else: values[name] = old
            if 'IFS' in temporary: ifs = values.get('IFS', Evidence(literal=' \t\n')).literal
            temporary, temporary_segment = {}, None
        # An expansion writer invalidates the path alternative wherever it
        # appears; an indirect writer may target any name. Quoted or escaped
        # text cannot write.
        for match in _ASSIGNING.finditer(str(probe[i])):
            if match[1]: conditional_paths.clear()
            else: conditional_paths.pop(match[2], None)
        head = heads.get(segments[i])
        data = head is not None and syntax.executable(words[head])[0] in syntax.DATA
        if i in arrays:
            continue
        if word in ('&', '|'):
            start = i - int(i > 0 and words[i-1] == '&')
            and_pair = (word == '&' and words[start:start+2] == ['&', '&']
                        and (start == 0 or words[start-1] != '&')
                        and (start+2 == len(words) or words[start+2] != '&'))
            if not and_pair: conditional_paths.clear()
            conditional, beginning = True, True
            continue
        if word == ';':
            conditional, beginning = False, True
            continue
        if data and i > head:
            continue
        if beginning and word in ('if', 'for', 'while', 'until', 'case', '{', '('):
            conditional_paths.clear()
            scopes.append({'if':'fi', 'for':'done', 'while':'done', 'until':'done',
                           'case':'esac', '{':'}', '(' : ')'}[word])
            continue
        if scopes and word == scopes[-1] and (beginning or positions[i] or word in ('}', ')')):
            conditional_paths.clear()
            scopes.pop(); beginning = True
            continue
        if beginning and word in ('then', 'do', 'else', 'elif') and scopes:
            beginning = True
            continue
        if not positions[i] or syntax.looked_up(words, positions, i):
            continue
        beginning = False
        args, _ = syntax.argv_at(words, segments, [()] * len(words), i)
        following = next((w for w in words[i+1:] if w in (';', '&', '|')), None)
        uncertain = conditional or bool(scopes) or following in ('&', '|')
        assignment = shell._ASSIGNMENT_RE.match(word)
        if assignment:
            name, value = assignment['name'], word.split('=', 1)[1]
            prefix = head is not None and head > i
            if prefix:
                temporary.setdefault(name, values.get(name))
                temporary_segment = segments[i]
            new = evidence(None if i in array_values else value, values, syntax, ifs)
            if assignment['append'] or assignment['subscript']:
                old = values.get(name, Evidence(unknown=True))
                new = Evidence(new.guarded or old.guarded, True)
            previously_unbound = name not in values
            assign(name, new, uncertain)
            if (previously_unbound and uncertain and not scopes and not prefix and not new.unknown
                    and not assignment['append'] and not assignment['subscript']
                    and new.literal is not None and new.literal.startswith('/')):
                conditional_paths[name] = new.literal
            continue
        base = syntax.executable(word)[0]
        if base in _DECLARATIONS:
            unknown = any(a.startswith('-') and a not in ('--', '-x', '-r', '-rx', '-xr') for a in args)
            argument_values, argument_ifs = expansion_values(), expansion_ifs()
            for arg in args:
                match = shell._ASSIGNMENT_RE.match(arg)
                if match:
                    name = match['name']; new = evidence(arg.split('=', 1)[1], argument_values, syntax, argument_ifs)
                    old = values.get(name, Evidence()) if match['append'] or match['subscript'] else Evidence()
                    opaque = new.unknown or unknown or bool(match['append'] or match['subscript'])
                    assign(name, Evidence(new.guarded or old.guarded, opaque,
                                          None if opaque else new.literal), uncertain)
                elif re.fullmatch(_NAME, arg) and arg not in values:
                    assign(arg, Evidence(unknown=True), uncertain)
        elif base == 'read':
            for name in read_destinations(args): assign(name, Evidence(unknown=True), uncertain)
        elif base in ('readarray', 'mapfile'):
            names = [a for a in args if re.fullmatch(_NAME, a)]
            for name in names or ['MAPFILE']: assign(name, Evidence(unknown=True), uncertain)
        elif base == 'printf' and '-v' in args:
            j = args.index('-v') + 1
            if j < len(args) and re.fullmatch(_NAME, args[j]):
                assign(args[j], Evidence(unknown=True), uncertain)
        elif base == 'unset':
            functions = any(a.startswith('-') and 'f' in a for a in args)
            if not functions:
                for name in args:
                    if re.fullmatch(_NAME, name): assign(name, Evidence(unknown=True), uncertain)
        split_ifs = expansion_ifs()
        path_witness = fixed_path(word, split_ifs)
        if base not in _PATH_CHAIN_COMMANDS or '$' in word or '`' in word:
            conditional_paths.clear()
        if base in syntax.DATA or '$' not in word and '`' not in word:
            continue
        expanded = expansion_values()
        split_ifs = expansion_ifs()
        related = [expanded[name] for name in references(word) if name in expanded]
        indirect = '${!' in normal(word)
        if indirect:
            related += [expanded[v.literal] for v in related if v.literal in expanded]
        hidden = guarded_text(normal(word), syntax, split_ifs) or any(v.guarded for v in related)
        # A substitution-only executable may produce all argv. A fixed path
        # suffix is not a whole-command value; base inspects its actual body.
        substitution_only = bool(normal(word)) and not normal(word).replace('${command-substitution}', '')
        whole = not args and (substitution_only or indirect or
                              any(v.unknown for v in related) and not path_witness or
                              bool(related) and split_ifs is None)
        bound = None if indirect else literal(word)
        known = (bound is not None and split_ifs is not None and
                 not any(c.isspace() or c in split_ifs for c in bound))
        if hidden or whole or not known and syntax.guarded_words(args):
            raise ValueError('opaque whole-command expansion may contain protected argv')
