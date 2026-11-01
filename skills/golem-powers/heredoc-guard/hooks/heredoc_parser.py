"""Pure outer-shell heredoc inspection. Never expand or execute shell text."""
import re


def _substitution(body):
    i = 0
    arithmetic = []
    while i < len(body):
        if body[i] == "\\":
            i += 2
            continue
        if body[i] == "`":
            return True
        if body.startswith("$(", i):
            if not body.startswith("$((", i):
                return True
            arithmetic.append(0)
            i += 3
            continue
        if arithmetic:
            if body[i] == "(":
                arithmetic[-1] += 1
            elif body[i] == ")":
                if arithmetic[-1]:
                    arithmetic[-1] -= 1
                else:
                    # A single close at this nesting falls back to $(...) in bash/zsh.
                    if not body.startswith("))", i):
                        return True
                    arithmetic.pop()
                    i += 2
                    continue
        i += 1
    return bool(arithmetic)


class _Scanner:
    def __init__(self, text):
        self.text, self.i, self.unsafe = text, 0, None

    def match(self, token):
        """Recognize operators across escaped newlines without altering bodies."""
        end = self.i
        for c in token:
            while self.text.startswith("\\\n", end):
                end += 2
            if end >= len(self.text) or self.text[end] != c:
                return None
            end += 1
        return end

    def quote(self, expand, depth, ansi=False):
        text, quote = self.text, self.text[self.i]
        self.i += 1
        out = []
        while self.i < len(text):
            c = text[self.i]
            if c == quote:
                self.i += 1
                return "".join(out)
            if ansi and c == "\\":
                if not expand:
                    raise ValueError("use a plain quoted delimiter instead of ANSI-C escapes")
                self.i += 2
                continue
            if c == "\\" and quote == '"' and self.i + 1 < len(text):
                after = text[self.i + 1]
                if after in '$`"\\\n':
                    out.append(after if after != "\n" else "")
                    self.i += 2
                    continue
            if expand and quote == '"' and self.expansion(depth):
                continue
            out.append(c)
            self.i += 1
        raise ValueError("unterminated quote")

    def expansion(self, depth):
        text = self.text
        end = self.match("$(")
        if end is not None:
            arithmetic_end = self.match("$((")
            arithmetic = arithmetic_end is not None
            self.i = arithmetic_end if arithmetic else end
            self.scan(")" if not arithmetic else "))", arithmetic, depth + 1)
            return True
        if text[self.i] == "`":
            self.i += 1
            self.scan("`", False, depth + 1)
            return True
        return False

    def delimiter(self):
        text, out, quoted, started = self.text, [], False, False
        while self.i < len(text) and text[self.i] in " \t":
            self.i += 1
        while self.i < len(text):
            c = text[self.i]
            if c in " \t\n;|&<>()":
                break
            if c in "'\"":
                out.append(self.quote(False, 0))
                quoted, started = True, True
                continue
            if c == "\\":
                self.i += 1
                if self.i == len(text):
                    raise ValueError("unfinished delimiter escape")
                if text[self.i] != "\n":
                    out.append(text[self.i])
                    quoted, started = True, True
            elif text.startswith("$'", self.i):
                self.i += 1
                out.append(self.quote(False, 0, ansi=True))
                quoted, started = True, True
                continue
            else:
                out.append(c)
                started = True
            self.i += 1
        if not started:
            raise ValueError("missing heredoc delimiter")
        return "".join(out), quoted

    def bodies(self, pending):
        text = self.text
        for delimiter, quoted, tabs in pending:
            body = []
            while self.i < len(text):
                line = ""
                while True:
                    end = text.find("\n", self.i)
                    end = len(text) if end < 0 else end
                    line += text[self.i:end]
                    self.i = end + (end < len(text))
                    slashes = len(line) - len(line.rstrip("\\"))
                    if quoted or not slashes % 2 or end == len(text):
                        break
                    line = line[:-1]
                if (line.lstrip("\t") if tabs else line) == delimiter:
                    if not quoted and _substitution("\n".join(body)):
                        self.unsafe = delimiter
                    break
                body.append(line)
            else:
                raise ValueError("unterminated heredoc")

    def scan(self, stop=None, arithmetic=False, depth=0):
        if depth > 40:
            raise ValueError("shell nesting exceeds inspection limit")
        text, pending, boundary = self.text, [], True
        while self.i < len(text):
            c = text[self.i]
            end = self.match(stop) if stop else None
            if end is not None:
                self.i = end
                if pending:
                    raise ValueError("heredoc body missing before closing shell expression")
                return
            if c == "\\":
                if self.i + 1 < len(text) and text[self.i + 1] != "\n":
                    boundary = False
                self.i += 2
                continue
            ansi_end = self.match("$'") if c == "$" else None
            if c in "'\"" or ansi_end is not None:
                if ansi_end is not None:
                    self.i = ansi_end - 1
                self.quote(True, depth, ansi=ansi_end is not None)
                boundary = False
                continue
            if c == "#" and boundary:
                end = text.find("\n", self.i)
                self.i = len(text) if end < 0 else end
                continue
            if c == "\n":
                self.i += 1
                self.bodies(pending)
                pending.clear()
                boundary = True
                continue
            if self.expansion(depth):
                boundary = False
                continue
            end = self.match("((") if c == "(" else None
            if end is not None:
                self.i = end
                self.scan("))", True, depth + 1)
                continue
            if c == "(":
                self.i += 1
                self.scan(")", arithmetic, depth + 1)
                continue
            end = self.match("<<<") if c == "<" else None
            if end is not None:
                self.i = end
                boundary = True
                continue
            end = self.match("<<") if not arithmetic and c == "<" else None
            if end is not None:
                self.i = end
                dash_end = self.match("-")
                tabs = dash_end is not None
                if tabs:
                    self.i = dash_end
                delimiter, quoted = self.delimiter()
                pending.append((delimiter, quoted, tabs))
                boundary = False
                continue
            boundary = c in " \t;|&<>"
            self.i += 1
        if stop or pending:
            raise ValueError("unterminated shell expression or heredoc")


def unsafe_delimiter(command):
    """Return the dangerous delimiter (including empty), or None; errors deny."""
    if not isinstance(command, str):
        raise ValueError("invalid command")
    if not re.search(r"<(?:\\\n)*<", command):
        return None
    if len(command) > 1024 * 1024 or "\0" in command:
        raise ValueError("invalid command or inspection limit exceeded")
    scanner = _Scanner(command)
    scanner.scan()
    return scanner.unsafe
