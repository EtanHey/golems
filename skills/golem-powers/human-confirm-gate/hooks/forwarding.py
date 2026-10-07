"""Bind visible shell/function positionals without executing or reinterpreting data."""
import re
import shlex

_PARAMETER = re.compile(r'\$(?:([0-9@*])|\{([0-9]+|[@*])(?::\s*(-?[0-9]+)(?::([0-9]+))?)?\})')
UNKNOWN = '${positional-unknown}'
EMPTY = '__golems_empty_argv__'


def preserve_empty_words(source):
    """The shared lexer drops empty quoted words; retain their argv positions."""
    out, quote, i = [], None, 0
    while i < len(source):
        char = source[i]
        if char == '\\' and quote != "'":
            out.append(source[i:i+2]); i += 2; continue
        if quote is None and char in "\"'" and source[i:i+2] == char*2:
            before, after = source[i-1:i], source[i+2:i+3]
            if (not before or before.isspace() or before in ';|&()<>') and (
                    not after or after.isspace() or after in ';|&()<>'):
                out.append(char+EMPTY+char); i += 2; continue
        if char == "'" and quote != '"': quote = None if quote == "'" else "'"
        elif char == '"' and quote != "'": quote = None if quote == '"' else '"'
        out.append(char); i += 1
    return ''.join(out)


def bind(body, arguments, shell, zero=None, unknown_tail=False, ifs=' \t\n'):
    """Bind quote-removed argv as data, keeping unknown input symbolic."""
    definition_mask = shell._mask_function_definition_bodies(body)
    tokens, positions, _, _ = shell._parse_bash(definition_mask)
    if any(positions[j] and t in ('shift', 'set') for j,t in enumerate(tokens)):
        arguments, zero, unknown_tail = [], None, True
    if any(t.startswith('IFS=') for t in tokens): ifs = None
    out, quote, i = [], None, 0
    def value(raw):
        if raw == EMPTY: return ''
        return UNKNOWN if any(c in raw for c in '$`*?[]{}') else raw
    args = [value(a) for a in arguments]
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
                inner = bind(found[0], arguments, shell, zero, unknown_tail, ifs)
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
                    fields = ([zero] + args)[n:] if n >= 0 else args[max(0,len(args)+n):]
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
