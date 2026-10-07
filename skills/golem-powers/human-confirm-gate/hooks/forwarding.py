"""Bind visible shell/function positionals without executing or reinterpreting data."""
import re
import os
from contextvars import ContextVar
import shlex

_PARAMETER = re.compile(r'\$(?:([0-9@*])|\{([0-9]+|[@*])(?::([0-9]+)(?::([0-9]+))?)?\})')
_EXACT_PARAMETER = re.compile(r'\$(?:[0-9@*]|\{(?:[0-9]+|[@*]|@:[0-9]+(?::[0-9]+)?)\})')
_mode = ContextVar('golems_simple_positional_binding', default=None)
_CODE_COMMANDS = {'echo', 'true', 'false', ':'}
_MUTATORS = {'shift', 'set', 'eval', 'builtin', 'command', 'exec', 'alias', 'unalias',
             '.', 'source', 'read', 'getopts', 'declare', 'typeset', 'local', 'export',
             'IFS', 'argv', 'BASH_ARGV', 'BASH_ARGC'}


def enabled():
    return _mode.get() is True


def _normal(word):
    return str(word).replace('\ue000', '{').replace('\ue001', '}')


def code_allowed(body, shell):
    """Positive grammar: one direct positional/data command, literal operands.

    No control flow, assignments, wrappers, nested definitions, substitutions,
    alternate parameter operators or interpreter-specific syntax is admitted.
    """
    lexer = shell._impl_module('tokens')
    try:
        words = lexer._shell_tokens(body, _operator_origin=True, _strict_quotes=True)
    except ValueError:
        return False
    while words and isinstance(words[-1], lexer._ShellOperator) and words[-1] == ';':
        words.pop()
    if not words or any(isinstance(w, lexer._ShellOperator) for w in words):
        return False
    words = [_normal(w) for w in words]
    import syntax
    forbidden = _MUTATORS | syntax.WRAPPERS | syntax.SHELLS | {'find', 'xargs'}
    if not (_EXACT_PARAMETER.fullmatch(words[0]) or words[0] in _CODE_COMMANDS):
        return False
    for word in words:
        if _EXACT_PARAMETER.fullmatch(word):
            continue
        if any(c in word for c in '$`={}[]*?') or any(part in forbidden for part in word.split()):
            return False
    return True


def command_allowed(command, shell, syntax):
    """Opt in only when every definition and top-level invocation is proven."""
    lexer = shell._impl_module('tokens')
    token = lexer._preserve_empty_words.set(True)
    try:
        definitions = shell._impl_module('units').raw_function_definitions(command)
        names = [name for name, _ in definitions]
        if len(names) != len(set(names)) or any(not code_allowed(body, shell) for _, body in definitions):
            return False
        words = lexer._shell_tokens(command, _operator_origin=True, _strict_quotes=True)
        segments, current, i = [], [], 0
        while i < len(words):
            if i+3 < len(words) and words[i] in names and words[i+1:i+4] == ['(', ')', '{']:
                if current: return False
                end = next((j for j in range(i+4, len(words)) if words[j] == '}'), None)
                if end is None: return False
                i = end+1
                continue
            word = words[i]
            if isinstance(word, lexer._ShellOperator):
                if word != ';': return False
                if current: segments.append(current)
                current = []
            else:
                current.append(_normal(word))
            i += 1
        if current: segments.append(current)
        if not segments: return False
        def invocation(argv):
            base = os.path.basename(argv[0])
            args = argv[1:]
            if base in syntax.SHELLS:
                # No option arity is guessed, including options after -c.
                return (base != 'fish' and len(args) >= 2 and args[0] == '-c'
                        and code_allowed(args[1], shell) and arguments(args[2:]))
            if argv[0] in names:
                return arguments(args)
            if base == 'xargs':
                child = syntax.xargs_payload(args)
                return bool(child) and os.path.basename(child[0]) in syntax.SHELLS and invocation(child)
            return False
        def arguments(args):
            return all(not shell._ASSIGNMENT_RE.match(a) and
                       not any(part in _MUTATORS | syntax.WRAPPERS | syntax.SHELLS | {'find', 'xargs'} for part in a.split())
                       for a in args)
        return all(invocation(argv) for argv in segments)
    except (ValueError, IndexError):
        return False
    finally:
        lexer._preserve_empty_words.reset(token)


UNKNOWN = '${positional-unknown}'
def bind(body, arguments, shell, zero=None, unknown_tail=False, ifs=' \t\n', split_args=None):
    if not code_allowed(body, shell):
        return body  # Leave unproved code untouched for the base inspection path.
    definition_mask = shell._mask_function_definition_bodies(body)
    tokens, positions, _, _ = shell._parse_bash(definition_mask)
    if any(positions[j] and t in ('shift', 'set') for j,t in enumerate(tokens)):
        arguments, zero, unknown_tail = [], None, True
    if any(t.startswith('IFS=') for t in tokens): ifs = None
    out, quote, i = [], None, 0
    def value(raw):
        return UNKNOWN if any(c in raw for c in '$`*?[]{}') else raw
    args = [value(a) for a in arguments]
    for j, raw in enumerate(arguments):
        normalized = raw.replace('\ue000', '{').replace('\ue001', '}')
        variadic = '$@' in normalized or bool(re.search(r'\$\{[^}]*@[^}]*\}', normalized))
        if args[j] == UNKNOWN and (variadic or split_args is None or split_args(raw)):
            # An expansion can contribute zero or many fields, shifting every
            # later positional. A quoted scalar still contributes one field.
            args[j:] = [UNKNOWN] * (len(args)-j)
            unknown_tail = True
            break
    zero = value(zero) if zero is not None else UNKNOWN
    while i < len(body):
        char = body[i]
        if char == '\\' and quote != "'":
            out.append(body[i:i+2]); i += 2; continue
        if char == "'" and quote != '"':
            quote = None if quote == "'" else "'"
        elif char == '"' and quote != "'":
            quote = None if quote == '"' else '"'
        elif quote != "'" and definition_mask[i] == char and (body.startswith('$(', i) and not body.startswith('$((', i) or char == '`'):
            found = shell._dollar_substitution(body, i) if char == '$' else shell._backtick_substitution(body, i)
            if found:
                inner = bind(found[0], arguments, shell, zero, unknown_tail, ifs, split_args)
                out.append('$(' + inner + ')' if char == '$' else '`' + inner + '`')
                i = found[1]; continue
        elif quote != "'" and definition_mask[i] == char and (match := _PARAMETER.match(body, i)):
            key, offset, length = match[1] or match[2], match[3], match[4]
            if key.isdigit():
                n = int(key)
                fields = [zero if n == 0 else args[n-1] if n <= len(args) else UNKNOWN if unknown_tail else '']
            else:
                fields = list(args)
                if offset is not None:
                    n = int(offset)
                    fields = ([zero] + args)[n:] if n >= 0 else [UNKNOWN] if unknown_tail else args[max(0,len(args)+n):]
                if unknown_tail: fields.append(UNKNOWN)
                if length is not None: fields = fields[:int(length)]
                if key == '*' and quote == '"': fields = [UNKNOWN] if ifs is None else [(ifs[:1] or '').join(fields)]
            if quote is None:
                if ifs is None: fields = [UNKNOWN]
                elif ifs:
                    fields = [f for v in fields for f in re.split('['+re.escape(ifs)+']+',v) if f]
                replacement = shlex.join(fields)
            else:
                def escaped(v):
                    if v == UNKNOWN: return v
                    return re.sub(r'([\\"$`])',r'\\\1',v)
                replacement = '" "'.join(escaped(v) for v in fields)
                if not fields:
                    if out and out[-1] == '"' and body[match.end():match.end()+1] == '"':
                        out.pop(); quote = None; i = match.end()+1; continue
                    replacement = ''
            out.append(replacement); i = match.end(); continue
        elif quote != "'" and definition_mask[i] == char and re.match(r'\$\{(?:[@*]|[0-9])', body[i:]):
            end = body.find('}', i)
            if end < 0: raise ValueError('unclosed positional expansion')
            out.append(UNKNOWN); i = end+1; continue
        out.append(char); i += 1
    return ''.join(out)
