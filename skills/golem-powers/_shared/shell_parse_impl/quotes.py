"""Consume ANSI-C quoted data without exposing its contents as shell syntax."""
import os


def ansi_c_quote(source, start):
    """Return decoded data and the offset after `$'...'` (or EOF if unclosed).

    Numeric byte escapes use filesystem decoding, not Unicode code points.
    NUL terminates the value in Bash, but does not terminate its source span.
    Unknown escapes retain their backslash. No decoded content is executed.
    """
    # Find the lexical boundary before decoding: a control escape can consume
    # another data character, but must never consume the closing shell quote.
    end = start + 2
    while end < len(source) and source[end] != "'":
        end += 2 if source[end] == '\\' and end + 1 < len(source) else 1
    body = source[start + 2:end]
    after = end + 1 if end < len(source) else end
    source = body
    data = bytearray()
    i = 0
    escapes = {'a': 7, 'b': 8, 'e': 27, 'E': 27, 'f': 12, 'n': 10,
               'r': 13, 't': 9, 'v': 11, '\\': 92, "'": 39, '"': 34, '?': 63}
    while i < len(source):
        char = source[i]
        if char != '\\' or i + 1 == len(source):
            data.extend(os.fsencode(char))
            i += 1
            continue
        char = source[i + 1]
        i += 2
        if char in escapes:
            data.append(escapes[char])
            continue
        if char in '01234567xuU':
            octal = char in '01234567'
            digits = char if octal else ''
            limit = 3 if octal else {'x': 2, 'u': 4, 'U': 8}[char]
            alphabet = '01234567' if octal else '0123456789abcdefABCDEF'
            while i < len(source) and len(digits) < limit and source[i] in alphabet:
                digits += source[i]
                i += 1
            if digits:
                value = int(digits, 8 if octal else 16)
                if octal or char == 'x':
                    data.append(value & 255)
                elif value <= 0x10ffff:
                    data.extend(chr(value).encode('utf-8', errors='surrogatepass'))
                else:
                    data.extend(os.fsencode('\\' + char + digits))
                continue
        if char == 'c':
            if i < len(source):
                control = source[i]
                i += 1
                control_bytes = os.fsencode(control)
                data.append(control_bytes[0] & 31)
                data.extend(control_bytes[1:])
            else:
                data.append(92)
            continue
        data.extend(os.fsencode('\\' + char))
    return os.fsdecode(bytes(data).split(b'\0', 1)[0]), after
