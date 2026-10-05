"""Consume ANSI-C quoted data without exposing its contents as shell syntax."""
import os
from contextlib import contextmanager
from contextvars import ContextVar

_reading = ContextVar("golems_ansi_c_reading", default=None)
_level_choices = ContextVar("golems_shell_level_choices", default=None)


class ShellReadingBudgetExceeded(BaseException):
    """The consistent shell-reading search exceeded its bounded branch count."""


class _ReadingRequired(BaseException):
    def __init__(self, key, readings):
        self.key, self.readings = key, readings


class _ShellCode(str):
    def __new__(cls, source, reading):
        result = super().__new__(cls, source)
        result.reading = reading
        return result


def shell_code(source, reading):
    """Keep a decoded executable payload's shell mode through recursive policy."""
    return _ShellCode(source, reading)


@contextmanager
def shell_code_reading(source, shell=None):
    selected = shell if shell is not None else getattr(source, "reading", None)
    if selected == "both":
        with ansi_c_reading(None):
            readings = ansi_c_readings(source)
        key = (_reading.get(), str(source))
        choices = _level_choices.get()
        selected = choices.get(key) if choices is not None else (_reading.get() or readings[0])
        if selected is None:
            if len(readings) > 1:
                raise _ReadingRequired(key, readings)
            selected = readings[0]
    if selected is None:
        yield _reading.get()
    else:
        with ansi_c_reading(selected):
            yield selected


def evaluate_shell_readings(callback, stop=None):
    """Replay the entire policy for each required decoded-level reading.

    One branch map is shared by target, cwd, expansion and hatch scans. A
    reading requested midway through policy evaluation restarts that policy;
    a partial scan can never authorize a different reading's targets.
    """
    if _level_choices.get() is not None:
        return [callback()]
    pending, results, attempts = [{}], [], 0
    while pending:
        attempts += 1
        if attempts > 128:
            raise ShellReadingBudgetExceeded("shell reading analysis budget exhausted; split the command")
        choices = pending.pop()
        token = _level_choices.set(choices)
        try:
            try:
                result = callback()
            except _ReadingRequired as request:
                pending.extend({**choices, request.key: reading} for reading in reversed(request.readings))
                continue
            results.append(result)
            if stop is not None and stop(result):
                break
        finally:
            _level_choices.reset(token)
    return results


def _preceding_dollars(source, start):
    count = 0
    index = start - 1
    while index >= 0 and source[index] == "$":
        slash = index - 1
        while slash >= 0 and source[slash] == chr(92):
            slash -= 1
        if (index - slash - 1) % 2:
            break
        count += 1
        index -= 1
    return count


def ansi_c_opens_at(source, start):
    if not source.startswith("$'", start):
        return False
    return _reading.get() != "bash" or _preceding_dollars(source, start) % 2 == 0


def ansi_c_readings(source):
    active = _reading.get()
    if active is not None:
        return (active,)
    index = 0
    while True:
        index = source.find("$'", index)
        if index < 0:
            return ("zsh",)
        if _preceding_dollars(source, index) % 2:
            return ("bash", "zsh")
        index += 2


@contextmanager
def ansi_c_reading(reading):
    token = _reading.set(reading)
    try:
        yield
    finally:
        _reading.reset(token)


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
