"""Bind visible shell/function positionals without executing or reinterpreting data."""
import re
import shlex

_PARAMETER = re.compile(r'\$(?:([0-9@*])|\{([0-9]+|[@*])(?::\s*(-?[0-9]+)(?::([0-9]+))?)?\})')
UNKNOWN = '${positional-unknown}'
def bind(body, arguments, shell, zero=None, unknown_tail=False, ifs=' \t\n', split_args=None):
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
