"""Would this Bash command print a secret? Policy over the shared shell parser.

The shared parser (_shared/shell_parse.py) answers "what does Bash execute";
this module only decides which of those commands would put a listed secret
file, a secret helper's stdout, a keychain password or a process environment
on screen.

AIDEV-NOTE: three tables carry the policy. SAFE commands never print a file
operand's content. PRINTERS do, unless a quiet flag (grep -l, jq 'keys') keeps
content off screen; a printer whose file operand cannot be resolved (a
variable, $(...), xargs input, cd into an unknown directory) is refused,
fail-closed. Any other command is refused only when an operand resolves to a
listed file. Keep new rules in those tables, not in ad-hoc branches.
"""
from __future__ import annotations

import fnmatch
import glob
import os
import re

from secret_paths import canon as _canon

DYNAMIC = object()  # an operand whose value only exists at run time

REASON_FILE = "it would print a file that holds a secret ({path})"
REASON_DYNAMIC = ("it prints a file whose name is only known when it runs ({word}), so it can't be checked; "
                  "run the lookup first, then name the file literally")
REASON_HELPER = "it runs {name}, whose output is a live secret"
REASON_KEYCHAIN = "it would print a keychain password (security {sub} {flag})"
REASON_ENV = "it would print environment variables, which can hold secrets ({what})"
REASON_CODE = ("inline {lang} code here touches the environment or names a secret file ({what}); "
               "code that needs a key belongs in a script file")
REASON_COPY = "it copies a secret file to a place the secret list does not cover ({path})"
REASON_SEARCH = "it searches a folder that holds secret files and prints matching lines ({path})"
REASON_SIZE = "the command is too large to check and names a secret location"
REASON_LINK = "it links or moves a secret file, which would let a later read skip this check ({path})"
REASON_ALIAS = "it reads {path}, which this same command links or copies from a file it can't vouch for"

SAFE = frozenset("""
ls gls eza exa lsd tree stat gstat file wc du test [ [[ realpath grealpath readlink greadlink
basename dirname touch chmod chown chgrp chflags rm grm unlink mkdir rmdir cd pushd popd
source . echo printf print true false : shasum sha1sum sha224sum sha256sum sha384sum
sha512sum md5 md5sum cksum b2sum sum lsof fuser trash mdls xattr export unset local declare
typeset readonly alias unalias type which whence hash find fd locate mdfind tee sleep wait
kill pkill date mktemp jobs exit return break continue shift set getfacl setfacl
""".split())

# Commands that only count or hash what they read on stdin.
SAFE_STDIN = frozenset("wc shasum sha1sum sha224sum sha256sum sha384sum sha512sum md5 md5sum cksum b2sum sum true false : test".split())

GREP_QUIET = ("-c", "--count", "-l", "--files-with-matches", "-L", "--files-without-match", "-q", "--quiet", "--silent")
GREP_VALUES = ("-A", "-B", "-C", "-D", "-d", "-m", "--include", "--exclude", "--exclude-dir", "--label",
               "--max-count", "--context", "--after-context", "--before-context", "--devices",
               "--directories", "--binary-files", "--color", "--colour")
RG_VALUES = ("-A", "-B", "-C", "-M", "-d", "-g", "-j", "-m", "-r", "-t", "-T", "-E", "--glob", "--iglob",
             "--type", "--type-not", "--type-add", "--max-columns", "--max-depth", "--threads",
             "--max-count", "--replace", "--encoding", "--sort", "--sortr", "--pre", "--pre-glob",
             "--context", "--after-context", "--before-context", "--color", "--colors",
             "--context-separator", "--field-match-separator", "--max-filesize", "--path-separator")


def _spec(values=(), quiet=(), program=False, prog_opts=(), file_opts=(), recursive=(), always_recursive=False,
          values2=(), files2=()):
    return {"values": frozenset(values), "quiet": frozenset(quiet), "program": program,
            "prog_opts": frozenset(prog_opts), "file_opts": frozenset(file_opts),
            "recursive": frozenset(recursive), "always_recursive": always_recursive,
            "values2": frozenset(values2), "files2": frozenset(files2)}


_GREP = _spec(GREP_VALUES, GREP_QUIET, True, ("-e", "--regexp"), ("-f", "--file", "--exclude-from"),
              ("-r", "-R", "--recursive", "--dereference-recursive"))
_RG = _spec(RG_VALUES, GREP_QUIET + ("--count-matches", "--files", "--type-list"), True,
            ("-e", "--regexp"), ("-f", "--file", "--ignore-file"), always_recursive=True)
_AG = _spec(("-A", "-B", "-C", "-G", "-m", "--depth", "--file-search-regex", "--ignore"),
            ("-c", "--count", "-l", "-L", "--files-with-matches", "--files-without-matches", "-g"), True,
            always_recursive=True)
# No quiet form: `sed -i '' 'w /dev/stdout' f` prints from an in-place edit.
_SED = _spec(("-l",), (), True, ("-e", "--expression"), ("-f", "--file"))
_AWK = _spec(("-F", "-v", "--assign", "--field-separator"), (), True, (), ("-f", "--file"))
_JQ = _spec(("--indent", "-L"), (), True, (), ("-f", "--from-file"),
            values2=("--arg", "--argjson"), files2=("--slurpfile", "--rawfile"))

PRINTERS = {
    **{name: _spec() for name in """cat gcat tac nl rev more less most pg bat batcat zcat gzcat bzcat xzcat
       zstdcat zless zmore lzcat fold fmt pr expand unexpand paste column look comm join iconv uniq
       vi vim nvim view vimdiff nano emacs ed ex micro pico mcedit envsubst sdiff""".split()},
    "head": _spec(("-n", "-c")), "ghead": _spec(("-n", "-c")),
    "tail": _spec(("-n", "-c", "-b", "-s", "--lines", "--bytes", "--sleep-interval", "--pid")),
    "gtail": _spec(("-n", "-c", "-b", "-s", "--lines", "--bytes")),
    "cut": _spec(("-b", "-c", "-d", "-f", "--delimiter", "--fields", "--bytes", "--characters")),
    "sort": _spec(("-k", "-t", "-o", "-S", "-T", "--key", "--field-separator", "--output",
                   "--buffer-size", "--temporary-directory", "--parallel")),
    "diff": _spec(("-U", "-C", "-L", "--label", "--unified", "--context", "-I", "-x", "-X"), ("-q", "--brief")),
    "cmp": _spec(("-i", "-n", "--ignore-initial", "--bytes"), ("-s", "--silent", "--quiet")),
    "grep": _GREP, "egrep": _GREP, "fgrep": _GREP, "ggrep": _GREP, "zgrep": _GREP, "rgrep": _GREP,
    "rg": _RG, "ag": _AG, "ack": _AG, "pt": _AG,
    "sed": _SED, "gsed": _SED,
    "awk": _AWK, "gawk": _AWK, "nawk": _AWK, "mawk": _AWK,
    "jq": _JQ, "gojq": _JQ, "jaq": _JQ, "yq": _JQ,
    "base64": _spec(("-o", "--output", "-b", "--break", "-w", "--wrap"), (), False, (), ("-i", "--input")),
    "gbase64": _spec(("-w", "--wrap")),
    "xxd": _spec(("-c", "-g", "-l", "-o", "-s", "-n", "-C", "--cols", "--len", "--seek")),
    "hexdump": _spec(("-e", "-n", "-s"), (), False, (), ("-f",)),
    "hd": _spec(("-e", "-n", "-s")),
    "od": _spec(("-A", "-j", "-N", "-t", "-w", "--address-radix", "--skip-bytes", "--read-bytes", "--format")),
    "strings": _spec(("-n", "-t", "--bytes", "--radix", "-e", "--encoding")),
    "plutil": _spec(("-o", "-e", "-r")),
}

INTERPRETER_RE = re.compile(
    r"(python(\d+(\.\d+)?)?|pypy3?|node|nodejs|bun|deno|ruby|irb|perl|php|lua|luajit|osascript|"
    r"Rscript|R|julia|swift|kotlin|kotlinc|scala|tclsh|wish|expect|jimsh|pwsh|powershell|ts-node|tsx)$")
SHELLS = frozenset("bash sh zsh dash ksh fish".split())

# Wrappers whose next free word is the real command. Values: options that take a value.
WRAPPERS = {
    "sudo": ("-u", "-g", "-C", "-D", "-h", "-p", "-U", "-r", "-t", "-T"), "doas": ("-u", "-C"),
    "env": ("-u", "-C", "-S", "-P", "--unset", "--chdir", "--split-string"),
    "nohup": (), "time": (), "nice": ("-n",), "command": (), "builtin": (), "exec": ("-a",),
    "stdbuf": ("-i", "-o", "-e"), "caffeinate": ("-t", "-w"), "chronic": (), "unbuffer": (),
    "timeout": ("-s", "-k", "--signal", "--kill-after"), "gtimeout": ("-s", "-k", "--signal", "--kill-after"),
    # Multi-call binaries: `busybox env` runs the env applet.
    "busybox": (), "toybox": (),
    "watch": ("-n", "-d", "--interval"), "arch": (), "ionice": ("-c", "-n"), "taskset": (),
    "xargs": ("-I", "-n", "-P", "-L", "-s", "-d", "-E", "-J", "-R", "-a", "--max-args",
              "--max-procs", "--delimiter", "--arg-file"),
    "gxargs": ("-I", "-n", "-P", "-L", "-s", "-d", "-E", "-a"), "parallel": ("-j", "--jobs"),
}
RUNTIME_ARGS = frozenset(("xargs", "gxargs", "parallel"))
DURATION_FIRST = frozenset(("timeout", "gtimeout"))
COPIERS = frozenset("cp gcp mv gmv ln gln install ginstall rsync ditto scp".split())
COPIER_VALUES = ("-t", "--target-directory", "-S", "--suffix", "-m", "--mode", "-o", "--owner", "-g",
                 "--group", "-e", "--rsh", "--exclude", "--include", "--filter", "--backup-dir")
GIT_PRINTERS = frozenset("show diff log blame annotate cat-file grep format-patch whatchanged".split())
STDOUT_TARGETS = re.compile(r"^(-|/dev/(stdout|stderr|tty|fd/\d+))$")
JQ_KEY_ONLY = re.compile(
    r"^\s*(\.[A-Za-z0-9_\"\[\]\.]*\s*\|\s*)?"
    r"(keys|keys_unsorted|length|type|paths|\[paths\]|has\(\"[^\"]*\"\)|to_entries\s*\|\s*map\(\s*\.key\s*\))"
    r"(\s*\[\])?\s*$")
# Any reference to the environment in inline code, across languages: Python,
# Node/Deno/Bun, Ruby/Perl (ENV, %ENV), awk (ENVIRON), AppleScript (system
# attribute, do shell script), Tcl ($env(K), env(K), array get env, parray env),
# Swift (ProcessInfo...environment), Scala (sys.env), R/Kotlin (getenv), Julia (ENV).
ENV_ANY = re.compile(
    r"\b(os\.environ|environ|getenv|process\.env|ENV|ENVIRON|Deno\.env|Bun\.env|ProcessInfo|sys\.env)\b"
    r"|%ENV\b|\.environment\b"
    r"|\bsystem\s+attribute\b|\bdo\s+shell\s+script\b"
    r"|\$env\(|\benv\(|\barray\s+(get|names)\s+env\b|\bparray\s+env\b")
AWK_FAMILY = frozenset(("awk", "gawk", "nawk", "mawk"))
JQ_FAMILY = frozenset(("jq", "gojq", "jaq", "yq"))
# jq/yq environment access: the `env` builtin, $ENV, yq's env()/strenv().
# `.env` (a field named env) is not a reference.
JQ_ENV = re.compile(r"(^|[^A-Za-z0-9_$.])(env|strenv)\b|\$ENV\b")
OPEN_CALL = re.compile(r"\b(open|read_text|read_bytes|readFileSync|readFile|fopen|file_get_contents|"
                       r"File\.read|IO\.read|Path|load|loads|slurp)\s*\(")
EXEC_CALL = re.compile(r"\b(subprocess|check_output|Popen|os\.system|popen|execSync|execFileSync|spawnSync|"
                       r"spawn|exec|system|run)\b")
PATHLIKE = re.compile(r"[^\s'\"`()<>;|&,=:{}\[\]]+")
REDIRECT_RE = re.compile(r"^\d*(<<<|<<-|<<|<>|<&|<|>>|>&|>\||>|&>>|&>)$")
HEREDOC_OPS = frozenset(("<<", "<<-"))


class Context:
    def __init__(self, parser, secrets, home):
        self.parser = parser
        self.secrets = secrets
        self.home = home
        self.operator = parser._tokens._ShellOperator
        # Shell variables this command assigns itself: name -> raw words, or
        # None when the value only exists at run time ($(...), read, $@).
        self.vars = {}
        self.env = dict(os.environ)
        # Paths this command links or copies into place before a later read:
        # exact aliases, and directories whose listed-name files are unvouched.
        self.aliases = set()
        self.alias_dirs = set()


def _brace_expand(word, limit=64):
    match = re.search(r"\{([^{}]*,[^{}]*)\}", word)
    if not match:
        return [word]
    out = []
    for part in match.group(1).split(","):
        out.extend(_brace_expand(word[:match.start()] + part + word[match.end():], limit))
        if len(out) > limit:
            return None
    return out


_VAR_RE = re.compile(r"\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))")


def _expand_vars(ctx, word, cwds, depth=0):
    """Substitute variables whose values are known; None if any is not."""
    match = _VAR_RE.search(word)
    if match is None:
        return None if "$" in word else [word]
    if depth > 4:
        return None
    name = match.group(1) or match.group(2)
    if name in ctx.vars:
        values = ctx.vars[name]
    elif name == "HOME":
        values = [ctx.home]
    elif name == "PWD" and len(cwds) == 1 and cwds[0] is not None:
        values = [cwds[0]]
    elif name in ctx.env and name != "PWD":
        values = [ctx.env[name]]
    else:
        values = None
    if values is None:
        return None
    out = []
    for value in values:
        if not isinstance(value, str) or "`" in value:
            return None
        if value.startswith("~/") or value == "~":
            value = ctx.home + value[1:]
        expanded = _expand_vars(ctx, word[:match.start()] + value + word[match.end():], cwds, depth + 1)
        if expanded is None:
            return None
        out.extend(expanded)
        if len(out) > 64:
            return None
    return out


def resolve(ctx, word, cwds):
    """Absolute paths a word names, or None when they only exist at run time."""
    if word is DYNAMIC:
        return None
    if not isinstance(word, str) or not word:
        return []
    if word.startswith("~"):
        if word == "~" or word.startswith("~/"):
            word = ctx.home + word[1:]
        else:
            return None
    if "`" in word:
        return None
    words = _expand_vars(ctx, word, cwds)
    if words is None:
        return None
    words = [w for item in words for w in (_brace_expand(item) or [None])]
    if None in words or len(words) > 256:
        return None
    out = []
    for item in words:
        bases = [""] if item.startswith("/") else cwds
        for base in bases:
            if base is None:
                return None
            path = os.path.normpath(os.path.join(base, item))
            if re.search(r"[*?\[]", item):
                matches = glob.glob(path)
                if len(matches) > 256:
                    return None
                out.extend(matches or [path])
            else:
                out.append(path)
    return out


def _option_parse(spec, words):
    """Split a printer's argv into (files, quiet, recursive)."""
    files, quiet, recursive, program_given = [], False, spec["always_recursive"], False
    takes_value = spec["values"] | spec["prog_opts"] | spec["file_opts"]
    i, options = 0, True
    while i < len(words):
        word = words[i]
        if word is DYNAMIC:
            files.append(word)
        elif options and word == "--":
            options = False
        elif options and isinstance(word, str) and word.startswith("--"):
            name, eq, value = word.partition("=")
            if name in spec["quiet"]:
                quiet = True
            if name in spec["recursive"]:
                recursive = True
            if name in spec["values2"] or name in spec["files2"]:
                if name in spec["files2"] and i + 2 < len(words):
                    files.append(words[i + 2])
                i += 3
                continue
            if name in takes_value:
                if not eq:
                    i += 1
                    value = words[i] if i < len(words) else ""
                if name in spec["file_opts"]:
                    files.append(value)
                if name in spec["prog_opts"]:
                    program_given = True
        elif options and isinstance(word, str) and re.fullmatch(r"[-+]\d+", word):
            pass  # head -3, tail +5: a count, not a file
        elif options and isinstance(word, str) and word.startswith("-") and len(word) > 1:
            if word in spec["quiet"]:
                quiet = True
            for j, char in enumerate(word[1:], 1):
                flag = "-" + char
                if flag in spec["quiet"] and "=" not in word:  # -color=never is no count flag
                    quiet = True
                if flag in spec["recursive"]:
                    recursive = True
                if flag in takes_value:
                    value = word[j + 1:]
                    if not value:
                        i += 1
                        value = words[i] if i < len(words) else ""
                    if flag in spec["file_opts"]:
                        files.append(value)
                    if flag in spec["prog_opts"]:
                        program_given = True
                    break
        elif spec["program"] and not program_given:
            program_given = True
            if spec is _JQ and isinstance(word, str) and JQ_KEY_ONLY.match(word):
                quiet = True
        else:
            files.append(word)
        i += 1
    return files, quiet, recursive


def _free_words(words, values):
    """Non-option words of argv, skipping option values."""
    out, i, options = [], 0, True
    while i < len(words):
        word = words[i]
        if options and word == "--":
            options = False
        elif options and isinstance(word, str) and word.startswith("-") and word != "-":
            name = word.partition("=")[0]
            if name in values and "=" not in word:
                i += 1
            elif len(word) == 2 and word in values:
                i += 1
        else:
            out.append(word)
        i += 1
    return out


def _clusters(words, values):
    """Short-option letters before any value-taking letter, per word."""
    letters = set()
    for word in words:
        if not isinstance(word, str) or not word.startswith("-") or word.startswith("--"):
            continue
        for char in word[1:]:
            if char in values:
                break
            letters.add(char)
    return letters


def _unwrap(words, start):
    """Index of the real command after wrappers (timeout 5, xargs -I{}, sudo -u x...)."""
    dynamic, i, last = False, start, None
    while i < len(words):
        name = os.path.basename(words[i]) if isinstance(words[i], str) else ""
        if isinstance(words[i], str) and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*=.*", words[i]):
            i += 1
            continue
        if name not in WRAPPERS:
            return i, dynamic
        dynamic = dynamic or name in RUNTIME_ARGS
        values = WRAPPERS[name]
        last = i
        i += 1
        skipped_duration = name not in DURATION_FIRST
        while i < len(words):
            word = words[i]
            if isinstance(word, str) and word.startswith("-") and word != "-":
                if word.partition("=")[0] in values and "=" not in word:
                    i += 1
                elif len(word) > 2 and word[:2] in values and not word.startswith("--"):
                    pass
                i += 1
                continue
            if isinstance(word, str) and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*=.*", word):
                i += 1
                continue
            if not skipped_duration:
                skipped_duration = True
                i += 1
                continue
            break
    # A wrapper with nothing after it is the command itself (bare `env`, `xargs`).
    return last, dynamic


def _protected_var_name(ctx, words):
    for word in words:
        if not isinstance(word, str):
            continue
        for name in re.findall(r"\$\{?([A-Za-z_][A-Za-z0-9_]*)", word):
            if ctx.secrets.secret_var_re.search(name):
                return "$" + name
    return None


def _first_protected_path(ctx, paths, assume_exists=False):
    """The first path that is a listed file (or an alias made earlier in this command)."""
    for path in paths:
        if ctx.secrets.is_secret(path, assume_exists):
            return path
        folded = _canon(os.path.normpath(path))
        if folded in ctx.aliases:
            return path
        base = os.path.basename(path)
        if any(folded.startswith(d + "/") for d in ctx.alias_dirs) and (
                ctx.secrets.name_mentioned(base) or ctx.secrets.json_env_name(base)):
            return path
    return None


def _covered(ctx, path):
    s = ctx.secrets
    return s.path_pattern_match(path) or s.name_mentioned(path) or s.json_env_name(os.path.basename(path))


def _search_hits_root(ctx, path):
    if not os.path.isdir(path):
        return False
    path = _canon(os.path.normpath(path))
    for root in ctx.secrets.roots():
        root = _canon(root)
        if root == path or root.startswith(path.rstrip("/") + "/") or path.startswith(root + "/"):
            return True
    return False


def code_mentions(ctx, text, cwds):
    """Secret names, helpers or env dumps inside inline interpreter code."""
    s = ctx.secrets
    # Whole program, never per line: `k=os.environ['KEY']; print(k)` splits the
    # read from the print. Passing os.environ on (env={**os.environ}) stays fine.
    found = ENV_ANY.search(text)
    if found:
        # Final rule (round 2): inline code may not touch the environment at
        # all. Aliases (`e=os.environ; print(e)`) and names built at run time
        # leave no name to match; a script file is the sanctioned place.
        return "an environment read (" + found.group(0) + ")"
    for token in PATHLIKE.findall(text):
        token = token.rstrip(".,")
        if not token:
            continue
        if s.is_helper(token) and re.search(
                EXEC_CALL.pattern + r".{0,160}" + re.escape(token), text):
            return os.path.basename(token)
        paths = resolve(ctx, token, cwds) if ("/" in token or token.startswith("~")) else None
        if paths and _first_protected_path(ctx, paths):
            return token
        if token.startswith("~/") and s.path_pattern_match(ctx.home + token[1:]):
            return token
        if s.name_mentioned(token) and re.search(OPEN_CALL.pattern + r"[^)]{0,160}" + re.escape(token), text):
            return token
    return None


def _heredoc_body(raw, delimiter, cmd=""):
    """The body of the heredoc `cmd` opens with `delimiter` in the raw command."""
    word = str(delimiter).strip("'\"\\")
    if not word:
        return ""
    lines = raw.split("\n")
    opener = re.compile(r"<<-?\s*['\"\\]?" + re.escape(word) + r"['\"]?")
    starts = [k for k, line in enumerate(lines) if opener.search(line)]
    own = [k for k in starts if cmd and re.search(r"(^|[\s/;&|(])" + re.escape(cmd) + r"\b", lines[k])]
    if not starts:
        return ""
    body = []
    for later in lines[(own or starts)[0] + 1:]:
        if later.strip() == word:
            break
        body.append(later)
    return "\n".join(body)


_CODE_LONG = frozenset(("--eval", "--print", "--command", "--exec", "--execute", "--expression"))


def _inline_mode(cmd, args):
    """Does argv carry inline code, in any spelling?

    `-c CODE`, clustered `-Ic`/`-sc`, attached `-cCODE`/`-e'CODE'`, `--eval=CODE`,
    perl `-ne`/`-E`, php `-r`, node `-p`, `-` (stdin), `deno eval`, `bun -e`.
    Over-detecting only means the argv text is scanned too; it never allows more.
    """
    for word in args:
        if not isinstance(word, str):
            continue
        if word == "-":
            return True
        if word.startswith("--"):
            if word.split("=", 1)[0] in _CODE_LONG:
                return True
            continue
        if re.match(r"-[A-Za-z]*[ceErp]", word):
            return True
    return cmd in ("deno", "bun") and "eval" in args


def _inline_code(ctx, args, redirects, cmd="", cwds=()):
    """Code an interpreter runs from argv, a heredoc or a here-string.

    With inline mode on, the whole argv text is the code (attached and
    clustered spellings need no exact parse). A heredoc or here-string is code
    unless a positional argument names an existing script file.
    """
    codes = []
    if _inline_mode(cmd, args):
        codes.append(" ".join(a for a in args if isinstance(a, str)))
    positional = [a for a in args if isinstance(a, str) and not a.startswith("-")]
    script = any(os.path.isfile(p) for word in positional[:1] for p in (resolve(ctx, word, list(cwds)) or []))
    for op, target in redirects:
        op = op.lstrip("0123456789")
        if op in HEREDOC_OPS and not script:
            codes.append(_heredoc_body(getattr(ctx, "raw", "") or "", target, cmd))
        elif op == "<<<" and not script:
            codes.append(str(target))
    return [code for code in codes if code]


_ASSIGN = re.compile(r"([A-Za-z_][A-Za-z0-9_]*)=(.*)", re.S)
_DECLARERS = frozenset(("export", "local", "declare", "typeset", "readonly"))


def _bind(ctx, name, values):
    """Every value a variable may hold in this command; None = run time only."""
    if values is None or ctx.vars.get(name, []) is None:
        ctx.vars[name] = None
    else:
        ctx.vars[name] = list(dict.fromkeys(ctx.vars.get(name, []) + list(values)))


def _collect_vars(ctx, segments):
    for segment in segments:
        words = [t for t in segment if not isinstance(t, ctx.operator)]
        if not words or not all(isinstance(w, str) for w in words):
            continue
        if words[0] in ("for", "select") and len(words) >= 2:
            if len(words) >= 3 and words[2] == "in":
                _bind(ctx, words[1], words[3:])
            else:
                _bind(ctx, words[1], None)
            continue
        if words[0] in ("read", "mapfile", "readarray", "getopts"):
            for word in words[1:]:
                if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", word):
                    _bind(ctx, word, None)
            continue
        leading = True
        for k, word in enumerate(words):
            match = _ASSIGN.fullmatch(word)
            if match and (leading or words[0] in _DECLARERS):
                _bind(ctx, match.group(1), [match.group(2)])
            elif not (k == 0 and word in _DECLARERS) and not word.startswith("-"):
                leading = False


def _segments(ctx, tokens):
    """[(segment, operator that ends it)]; redirections stay inside."""
    out, current = [], []
    for token in tokens:
        if isinstance(token, ctx.operator) and not REDIRECT_RE.match(str(token)):
            out.append((current, str(token)))
            current = []
        else:
            current.append(token)
    out.append((current, ""))
    return [(segment, op) for segment, op in out if segment]


def judge(ctx, command, cwds, depth=0):
    """Refusal reason, or None when the command prints no secret."""
    if depth > 12:
        return REASON_DYNAMIC.format(word="nested shell")
    if depth == 0:
        ctx.vars = {}
        ctx.aliases, ctx.alias_dirs = set(), set()
    outer_raw, ctx.raw = getattr(ctx, "raw", None), command
    try:
        return _judge_command(ctx, command, cwds, depth)
    finally:
        ctx.raw = outer_raw


def _judge_command(ctx, command, cwds, depth):
    parser = ctx.parser
    active = parser._strip_heredoc_bodies(command)
    tokens = parser._shell_tokens(active, _operator_origin=True)
    reason, cwds = _judge_tokens(ctx, tokens, cwds, depth)
    if reason:
        return reason
    bodies = [body for body, *_ in parser._executable_subcommands(active)]
    try:
        # Extra views of the same substitutions (quoted ones stay one word in
        # the token stream); a scanner limit here loses no unquoted body.
        bodies += parser.dollar_paren_bodies(active)
        bodies += parser._backtick_bodies(parser.without_dollar_paren_bodies(active))
    except ValueError:
        pass
    for body in dict.fromkeys(bodies):
        reason = judge(ctx, body, cwds, depth + 1)
        if reason:
            return reason
    return None


def _collapse_substitutions(ctx, tokens):
    """One placeholder word per unquoted $(...) / `...`, plus each body's tokens.

    The tokenizer breaks `PATH=/a:$(dirname x) bun` at the parentheses; joined
    back, the outer command keeps its shape and the body is judged on its own.
    """
    out, bodies, i = [], [], 0
    while i < len(tokens):
        token = tokens[i]
        opens = (not isinstance(token, ctx.operator) and isinstance(token, str) and token.endswith(("$", "`"))
                 and i + 1 < len(tokens) and isinstance(tokens[i + 1], ctx.operator) and str(tokens[i + 1]) == "(")
        if not opens:
            out.append(token)
            i += 1
            continue
        depth, j = 0, i + 1
        while j < len(tokens):
            if isinstance(tokens[j], ctx.operator):
                text = str(tokens[j])
                if text == "(":
                    depth += 1
                elif text.startswith(")"):
                    depth -= 1
                if depth == 0:
                    break
            j += 1
        bodies.append(tokens[i + 2:j])
        word = str(token) + "(SUB)"
        close = str(tokens[j]) if j < len(tokens) else ")"
        if close.endswith("+") and j + 1 < len(tokens) and not isinstance(tokens[j + 1], ctx.operator):
            word += str(tokens[j + 1])
            j += 1
        out.append(word)
        i = j + 1
    return out, bodies


def _judge_tokens(ctx, tokens, cwds, depth):
    if depth > 12:
        return REASON_DYNAMIC.format(word="nested shell"), cwds
    tokens, bodies = _collapse_substitutions(ctx, tokens)
    pairs = _segments(ctx, tokens)
    _collect_vars(ctx, [segment for segment, _ in pairs])
    for body in bodies:
        reason, _ = _judge_tokens(ctx, body, cwds, depth + 1)
        if reason:
            return reason, cwds
    codes = []
    for index, (segment, op) in enumerate(pairs):
        reason, cwds, inline = _judge_segment(ctx, segment, cwds, depth)
        if inline:
            codes.extend(inline)
        if reason:
            return reason, cwds
        if index and pairs[index - 1][1] == "|":
            reason = _judge_piped_code(ctx, pairs[index - 1][0], segment, cwds, depth)
            if reason:
                return reason, cwds
    for code in codes:
        # Inline code (-c, -e, heredoc and here-string bodies) is judged by what it names.
        found = code_mentions(ctx, code, cwds)
        if found:
            return REASON_CODE.format(lang="interpreter", what=found), cwds
    return None, cwds


def _judge_shell_code(ctx, cmd, args, redirects, cwds, depth):
    """Shell text a shell, `eval` or `source` runs is judged as shell.

    `bash <<'EOF' ... EOF`, `sh <<< printenv`, `eval printenv`, `zsh -c CODE`
    behind a wrapper the shared parser doesn't know (`busybox sh -c`), and
    `source /dev/stdin <<EOF`. `source <(...)`/`. <(...)` run a process
    substitution's output, which only exists at run time: refused.
    """
    raw = getattr(ctx, "raw", "") or ""
    if cmd == "eval":
        text = " ".join(a for a in args if isinstance(a, str))
        return judge(ctx, text, cwds, depth + 1) if text else None
    if cmd not in SHELLS and cmd not in ("source", "."):
        return None
    if cmd in ("source", "."):
        if any(isinstance(t, ctx.operator) or t == "" for op, t in redirects if op.lstrip("0123456789") == "<") or (
                args and isinstance(args[0], str) and args[0].startswith("/dev/fd/")):
            return REASON_DYNAMIC.format(word=cmd + " <(...)")
    for k, word in enumerate(args):
        if (cmd in SHELLS and isinstance(word, str) and re.fullmatch(r"-[A-Za-z]*c[A-Za-z]*", word)
                and k + 1 < len(args) and isinstance(args[k + 1], str)):
            reason = judge(ctx, args[k + 1], cwds, depth + 1)
            if reason:
                return reason
    positional = [a for a in args if isinstance(a, str) and not a.startswith("-")]
    reads_stdin = (cmd in SHELLS and not positional) or (
        cmd in ("source", ".") and positional[:1] in (["/dev/stdin"], ["-"]))
    if not reads_stdin:
        return None
    for op, target in redirects:
        op = op.lstrip("0123456789")
        if op in HEREDOC_OPS:
            reason = judge(ctx, _heredoc_body(raw, target, cmd), cwds, depth + 1)
        elif op == "<<<":
            reason = judge(ctx, str(target), cwds, depth + 1)
        else:
            continue
        if reason:
            return reason
    return None


def _split_segment(ctx, segment):
    """(cmd, args, redirects) of a segment's real command, or None."""
    words, redirects, i = [], [], 0
    while i < len(segment):
        token = segment[i]
        if isinstance(token, ctx.operator):
            redirects.append((str(token), segment[i + 1] if i + 1 < len(segment) else ""))
            i += 2
            continue
        words.append(token)
        i += 1
    if not words or not all(isinstance(w, str) for w in words):
        return None
    positions = ctx.parser._command_position_flags(words)
    starts = [k for k, flag in enumerate(positions) if flag]
    ci, _ = _unwrap(words, starts[0] if starts else 0)
    if ci is None:
        return None
    return os.path.basename(words[ci]).lstrip("\\"), words[ci + 1:], redirects


def _judge_piped_code(ctx, producer, consumer, cwds, depth):
    """Code piped on stdin into an interpreter or shell is inline code.

    `echo 'puts $env(K)' | tclsh`, `printf 'env' | sh`, `cat <<EOF ... EOF | node`.
    Literal echo/printf/heredoc text is judged; a variable or substitution in
    it means the code only exists at run time, so it is refused. Output of
    another command (`cat tool.py | python3`) is treated like a script file.
    """
    split = _split_segment(ctx, consumer)
    if split is None:
        return None
    cmd, args, _ = split
    shell = cmd in SHELLS
    if not (shell or INTERPRETER_RE.fullmatch(cmd)):
        return None
    if shell and any(a.startswith("-") and "c" in a[1:] and not a.startswith("--") for a in args):
        return None  # sh -c CODE: the payload is judged as shell already; stdin is data
    if not shell and _inline_mode(cmd, args):
        return None  # -c/-e code is scanned already; stdin is data
    positional = [a for a in args if not a.startswith("-")]
    if positional and positional[0] != "-":
        return None  # a script file reads stdin as data
    made = _split_segment(ctx, producer)
    if made is None:
        return None
    pcmd, pargs, predirects = made
    if pcmd in ("echo", "printf", "print"):
        words = [a for a in pargs if not (pcmd == "echo" and re.fullmatch(r"-[neE]+", a))]
        if any(_expand_vars(ctx, w, cwds) is None or "`" in w for w in words):
            return REASON_DYNAMIC.format(word="code piped into " + cmd)
        text = " ".join(words)
    elif pcmd == "cat" and not pargs and any(op.lstrip("0123456789") in HEREDOC_OPS for op, _ in predirects):
        target = next(t for op, t in predirects if op.lstrip("0123456789") in HEREDOC_OPS)
        text = _heredoc_body(getattr(ctx, "raw", "") or "", target, "cat")
    else:
        return None
    if shell:
        return judge(ctx, text, cwds, depth + 1)
    found = code_mentions(ctx, text, cwds)
    return REASON_CODE.format(lang=cmd, what=found) if found else None


def _judge_segment(ctx, segment, cwds, depth, runtime_operand=False):
    parser = ctx.parser
    words, redirects = [], []
    i = 0
    while i < len(segment):
        token = segment[i]
        if isinstance(token, ctx.operator):
            target = segment[i + 1] if i + 1 < len(segment) else ""
            redirects.append((str(token), target))
            i += 2
            continue
        words.append(token)
        i += 1
    if not words:
        return None, cwds, False
    positions = parser._command_position_flags(words)
    for body, *_ in parser._shell_command_payloads(words, positions, [0] * len(words)):
        reason = judge(ctx, body, cwds, depth + 1)
        if reason:
            return reason, cwds, False
    # The shared parser flags the first command word; walk wrappers it does
    # not know (timeout 5, watch -n 1) ourselves.
    starts = [k for k, flag in enumerate(positions) if flag]
    ci, dynamic = _unwrap(words, starts[0] if starts else 0)
    dynamic = dynamic or runtime_operand
    if ci is None:
        return None, cwds, False
    raw = words[ci]
    cmd = os.path.basename(raw).lstrip("\\") if isinstance(raw, str) else ""
    args = words[ci + 1:]
    if dynamic:
        args = args + [DYNAMIC]
    is_interp = bool(INTERPRETER_RE.fullmatch(cmd))
    interpreter = _inline_code(ctx, args, redirects, cmd, cwds) if is_interp else []

    for op, target in redirects:
        if op.lstrip("0123456789") in ("<", "<>", "<&") and not target.lstrip("-").isdigit():
            paths = resolve(ctx, target, cwds)
            if cmd in SAFE_STDIN:
                continue
            if paths is None:
                return REASON_DYNAMIC.format(word="< " + target), cwds, interpreter
            hit = _first_protected_path(ctx, paths, assume_exists=True)
            if hit:
                return REASON_FILE.format(path=hit), cwds, interpreter
        if op.lstrip("0123456789") == "<<<":
            var = _protected_var_name(ctx, [target])
            if var:
                return REASON_ENV.format(what=var), cwds, interpreter

    # The sanctioned masked reader: exactly `python3 <its real path> <files>`.
    # Any interpreter option (-X, -c, -m, -W, -I...) or other argv shape is not
    # exempt: `python3 -X <reader> -c CODE` never runs the reader.
    if (is_interp and cmd.startswith("python") and args and isinstance(args[0], str)
            and not args[0].startswith("-") and _is_masked_reader(ctx, args[0], cwds)):
        return None, cwds, False

    reason = _refused_command_reason(ctx, cmd, raw, args, cwds, is_interp)
    if reason:
        return reason, cwds, interpreter

    reason = _judge_shell_code(ctx, cmd, args, redirects, cwds, depth)
    if reason:
        return reason, cwds, interpreter

    if cmd in ("cd", "pushd", "popd"):
        free = _free_words(args, ())
        target = free[0] if free and cmd != "popd" else (None if cmd == "popd" else ctx.home)
        paths = resolve(ctx, target, cwds) if target is not None else None
        added = paths if paths else [None]
        return None, list(dict.fromkeys(cwds + added)), False

    if cmd in ("echo", "printf", "print"):
        var = _protected_var_name(ctx, args)
        if var:
            return REASON_ENV.format(what=var), cwds, False
        return None, cwds, False
    if cmd == "find" or cmd == "fd":
        return _judge_find(ctx, cmd, args, cwds, depth), cwds, False
    if cmd in SAFE:
        return None, cwds, False
    if cmd in COPIERS:
        return _judge_copy(ctx, cmd, args, cwds), cwds, False
    if cmd == "dd":
        source = next((a[3:] for a in args if isinstance(a, str) and a.startswith("if=")), None)
        dest = next((a[3:] for a in args if isinstance(a, str) and a.startswith("of=")), None)
        paths = resolve(ctx, source, cwds) if source else []
        if paths is None and (dest is None or STDOUT_TARGETS.match(dest)):
            return REASON_DYNAMIC.format(word="if=" + source), cwds, False
        hit = _first_protected_path(ctx, paths or [])
        if hit and (dest is None or STDOUT_TARGETS.match(dest) or not _covered(ctx, (resolve(ctx, dest, cwds) or [dest])[0])):
            return REASON_COPY.format(path=hit), cwds, False
        return None, cwds, False
    if cmd == "git":
        return _judge_git(ctx, args, cwds), cwds, False
    spec = PRINTERS.get(cmd)
    if cmd in AWK_FAMILY or cmd in JQ_FAMILY:
        pattern = ENV_ANY if cmd in AWK_FAMILY else JQ_ENV
        for word in args:
            found = pattern.search(word) if isinstance(word, str) else None
            if found:
                return REASON_CODE.format(lang=cmd, what="an environment read (" + found.group(0).strip() + ")"), cwds, False
    if spec is not None:
        var = _protected_var_name(ctx, args)
        if var:
            return REASON_ENV.format(what=var), cwds, False
        files, quiet, recursive = _option_parse(spec, args)
        if quiet:
            return None, cwds, False
        if recursive and not [f for f in files if f is not DYNAMIC]:
            for cwd in cwds:
                if cwd is None:
                    return REASON_DYNAMIC.format(word="current folder"), cwds, False
                if _search_hits_root(ctx, cwd):
                    return REASON_SEARCH.format(path=cwd), cwds, False
        for word in files:
            paths = resolve(ctx, word, cwds)
            if paths is None:
                return REASON_DYNAMIC.format(word="xargs/find input" if word is DYNAMIC else word), cwds, False
            hit = _first_protected_path(ctx, paths, assume_exists=True)
            if hit:
                return REASON_FILE.format(path=hit), cwds, False
            if recursive:
                for path in paths:
                    if _search_hits_root(ctx, path):
                        return REASON_SEARCH.format(path=path), cwds, False
        return None, cwds, False
    # Unknown command or interpreter: refuse only a resolved secret operand.
    for word in args:
        if word is DYNAMIC or not isinstance(word, str):
            continue
        candidates = [word]
        if word.startswith("-") and "=" in word:
            candidates.append(word.split("=", 1)[1])
        if "=@" in word:
            candidates.append(word.split("=@", 1)[1])
        if word.startswith("@"):
            candidates.append(word[1:])
        if word.startswith("file://"):
            candidates.append(word[len("file://"):])
        for candidate in candidates:
            hit = _first_protected_path(ctx, resolve(ctx, candidate, cwds) or [])
            if hit:
                return REASON_FILE.format(path=hit), cwds, interpreter
    return None, cwds, interpreter


def _script_word(args):
    for word in args:
        if not isinstance(word, str):
            return None
        if word in ("-c", "-m", "-"):
            return None
        if word.startswith("-"):
            continue
        return word
    return None


def _is_masked_reader(ctx, word, cwds):
    if not isinstance(word, str):
        return False
    from secret_paths import MASKED_READER
    paths = resolve(ctx, word, cwds)
    try:
        target = os.path.realpath(MASKED_READER)
        return bool(paths) and all(os.path.realpath(p) == target for p in paths)
    except OSError:
        return False


def _refused_command_reason(ctx, cmd, raw, args, cwds, interpreter):
    s = ctx.secrets
    if s.is_helper(cmd):
        return REASON_HELPER.format(name=cmd)
    if interpreter or cmd in SHELLS or cmd in ("source", ".", "exec"):
        for word in args:
            if s.is_helper(word):
                return REASON_HELPER.format(name=os.path.basename(word))
    if cmd == "security":
        free = _free_words(args, ())
        sub = free[0] if free else ""
        if sub == "dump-keychain":
            return REASON_KEYCHAIN.format(sub=sub, flag="")
        if sub in ("find-generic-password", "find-internet-password"):
            letters = _clusters(args, set("acCDGjlsrtdpPk"))
            for flag in ("w", "g"):
                if flag in letters:
                    return REASON_KEYCHAIN.format(sub=sub, flag="-" + flag)
    if cmd == "ps":
        for word in args:
            if not isinstance(word, str):
                continue
            if word.startswith("-") and not word.startswith("--"):
                for char in word[1:]:
                    if char in "oOptUuGgMN":
                        break
                    if char == "E":
                        return REASON_ENV.format(what="ps -E")
            elif re.fullmatch(r"[A-Za-z]+", word) and "e" in word and word == word.lower():
                return REASON_ENV.format(what="ps " + word)
    if cmd == "launchctl":
        free = _free_words(args, ())
        if free and free[0] in ("print", "export", "dumpstate", "procinfo", "print-cache"):
            return REASON_ENV.format(what="launchctl " + free[0])
        if free and free[0] == "getenv" and any(isinstance(n, str) and s.secret_var_re.search(n) for n in free[1:]):
            return REASON_ENV.format(what="launchctl getenv " + " ".join(map(str, free[1:])))
    if cmd == "env":
        if not [w for w in _free_words(args, WRAPPERS["env"])
                if not (isinstance(w, str) and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*=.*", w))]:
            return REASON_ENV.format(what="env")
    # Final rule (round 2): environment-dumping builtins in any form or pipeline.
    letters = "".join(a[1:] for a in args if isinstance(a, str) and a.startswith("-") and not a.startswith("--"))
    what = (cmd + " " + " ".join(map(str, args))).strip()
    if cmd == "printenv":
        return REASON_ENV.format(what=what)
    if cmd in ("declare", "typeset") and (not args or "p" in letters or "x" in letters):
        return REASON_ENV.format(what=what)
    if cmd == "export" and (not args or "p" in letters):
        return REASON_ENV.format(what=what)
    if cmd == "set" and not args:
        return REASON_ENV.format(what=what)
    if cmd == "compgen" and ("e" in letters or any(a == "export" for a in args)):
        return REASON_ENV.format(what=what)
    return None


def _judge_find(ctx, cmd, args, cwds, depth):
    """find -exec / fd -x run a command over names known only at run time."""
    exec_opts = ("-exec", "-execdir", "-ok", "-okdir") if cmd == "find" else ("-x", "--exec", "-X", "--exec-batch")
    bounded = cmd == "find" and _find_cannot_reach_secrets(ctx, args, cwds)
    i = 0
    while i < len(args):
        if args[i] in exec_opts:
            j = i + 1
            sub = []
            while j < len(args) and args[j] not in (";", "+", "\\;"):
                sub.append(args[j])
                j += 1
            if sub:
                sub = [w for w in sub if w != "{}"]
                reason, _, _ = _judge_segment(ctx, sub, cwds, depth + 1, runtime_operand=not bounded)
                if reason:
                    return reason
            i = j
        i += 1
    return None


# Basenames the list can protect; a -name pattern matching none of them is bounded.
_SECRET_SAMPLES = (".env", "x.env", ".env.local", "auth.json", "settings.json", "settings.local.json",
                   "auth.json.bak-1", "x.env.bak-rotate-1", "cliproxyapi.conf", "environ", "config.yaml",
                   "claude-proxy-token")


def _find_cannot_reach_secrets(ctx, args, cwds):
    starts, patterns, k = [], [], 0
    while k < len(args) and isinstance(args[k], str) and not args[k].startswith(("-", "(", "!")):
        starts.append(args[k])
        k += 1
    for j, word in enumerate(args):
        if word in ("-name", "-iname") and j + 1 < len(args) and isinstance(args[j + 1], str):
            patterns.append(args[j + 1])
        elif word in ("-path", "-ipath", "-regex", "-iregex", "-o", "-or", "-not", "!"):
            return False  # alternatives or path filters: not worth proving
    if not patterns:
        return False
    for pattern in patterns:
        if "$" in pattern or any(fnmatch.fnmatch(sample, pattern) for sample in _SECRET_SAMPLES):
            return False
    for start in starts or ["."]:
        paths = resolve(ctx, start, cwds)
        if paths is None or any(_search_hits_root(ctx, p) for p in paths):
            return False
    return True


def _judge_copy(ctx, cmd, args, cwds):
    """cp/mv/ln/install/rsync/ditto/scp: no secret leaves the list's protection.

    Every check runs before any segment executes, so a link or copy made here
    is invisible to a later read in the same command unless it is recorded:
    links and moves of listed files are refused, every link destination is an
    alias that later reads refuse, and allowed copies taint their destination.
    """
    name = cmd[1:] if cmd in ("gcp", "gmv", "gln", "ginstall") else cmd
    free = _free_words(args, COPIER_VALUES)
    target_dir = None
    for k, word in enumerate(args):
        if word in ("-t", "--target-directory") and k + 1 < len(args):
            target_dir = args[k + 1]
        elif isinstance(word, str) and word.startswith("--target-directory="):
            target_dir = word.split("=", 1)[1]
    sources = free if target_dir is not None else free[:-1]
    dest = target_dir if target_dir is not None else (free[-1] if free else None)
    links = name == "ln" or (name == "cp" and any(
        isinstance(a, str) and (a in ("--link", "--symbolic-link")
                                or re.fullmatch(r"-[A-Za-z]*[ls][A-Za-z]*", a)) for a in args))
    dest_paths = resolve(ctx, dest, cwds) if dest is not None else []
    finals = []
    for source in sources:
        src_paths = resolve(ctx, source, cwds)
        base = os.path.basename(str(source).rstrip("/"))
        for path in dest_paths or []:
            finals.append(os.path.join(path, base) if (os.path.isdir(path) or target_dir is not None) else path)
        hit = _first_protected_path(ctx, src_paths or [])
        if hit and (links or name == "mv"):
            return REASON_LINK.format(path=hit)
        if hit:
            if isinstance(dest, str) and STDOUT_TARGETS.match(dest):
                return REASON_FILE.format(path=hit)
            if not dest_paths:
                return REASON_COPY.format(path=dest)
            for final in finals[-len(dest_paths):]:
                if not _covered(ctx, final):
                    return REASON_COPY.format(path=final)
                ctx.aliases.add(_canon(os.path.normpath(final)))
        for path in src_paths or []:
            if os.path.isdir(path):
                if _search_hits_root(ctx, path):
                    return REASON_LINK.format(path=path) if (links or name == "mv") else REASON_COPY.format(path=path)
                for final in finals[-len(dest_paths or []):] if dest_paths else []:
                    ctx.alias_dirs.add(_canon(os.path.normpath(final)))
    if name == "mv":
        for final in finals or dest_paths or []:
            if _covered(ctx, final):
                return REASON_LINK.format(path=final)  # onto a listed path
    if links:
        # Whatever the source, a read of the new name later in this command is
        # unchecked: the link doesn't exist yet when the command is judged.
        for final in finals or dest_paths or []:
            ctx.aliases.add(_canon(os.path.normpath(final)))
        if dest_paths is None or (dest is not None and not dest_paths):
            ctx.alias_dirs.add("")  # unknown link name: every listed basename is suspect
    return None


def _judge_git(ctx, args, cwds):
    i, local = 0, list(cwds)
    while i < len(args):
        word = args[i]
        if word == "-C" and i + 1 < len(args):
            local = [p for p in (resolve(ctx, args[i + 1], cwds) or [None])]
            i += 2
            continue
        if word in ("-c", "--git-dir", "--work-tree", "--namespace") and i + 1 < len(args):
            i += 2
            continue
        if isinstance(word, str) and word.startswith("-"):
            i += 1
            continue
        break
    if i >= len(args) or args[i] not in GIT_PRINTERS:
        return None
    for word in args[i + 1:]:
        if not isinstance(word, str) or word.startswith("-"):
            continue
        path = word.split(":", 1)[1] if ":" in word and not word.startswith("/") else word
        if not path:
            continue
        hit = _first_protected_path(ctx, resolve(ctx, path, local) or [])
        if hit:
            return REASON_FILE.format(path=hit)
    return None
