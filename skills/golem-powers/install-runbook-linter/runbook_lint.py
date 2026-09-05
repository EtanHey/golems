"""Install-runbook linter (gen-18 Track 6 D2).

A macOS onboarding runbook is false-green when it reads fine to a human but assigns
admin-only steps (`brew tap`/`trust`/`install --cask`, `sudo`) to a Standard (non-admin)
user, or skips a prereq preflight, or "verifies" an install by trusting the cask RECEIPT
instead of the on-disk bundle. The gen16 runbook audit failed exactly here (a Standard
user couldn't `brew install`). This linter turns that audit into a mechanical, replayable
gate.

Five rules:
  1. privileged-in-standard-phase — a privileged command (`brew tap/trust/install`,
     install `--cask`, `sudo`, `doas`, `/usr/bin/sudo`, `chown -R /opt/homebrew`,
     `npm install -g`) inside any non-admin phase, including neutral/unlabeled phases.
     Scans fenced code plus command-shaped non-fenced lines, while prose prohibitions
     ("happy-camper must not run `brew install`") and comments do not false-fire.
  2. cask-before-prereqs — a `brew install --cask` with no Prerequisites/preflight section
     earlier in the document.
  3. receipt-not-bundle-verify — an end-state verification that checks the cask receipt
     (`brew list --cask`) but never that cask's own on-disk bundle
     (`/Applications/…app`, a bundle `ls`). A receipt is false-green; the app bundle is
     the truth.
  4. inconsistent-identifier-spelling — load-bearing identifiers spelled in near-duplicate
     forms, such as `happy-camper` vs `happy-campep` or `VoiceBar` vs `Voicebar`.
  5. prereq-incompleteness — developer tools used in fenced code but not named in the
     Prerequisites/preflight section.

Pure functions over the runbook text — deterministic, no I/O.
"""

from __future__ import annotations

import re
import shlex

# Privileged operations a Standard (non-admin) user cannot perform.
_PRIVILEGED = [
    (re.compile(r"\bbrew\s+tap\b"), "brew tap"),
    (re.compile(r"\bbrew\s+trust\b"), "brew trust"),
    (re.compile(r"\bbrew\s+install\b"), "brew install"),
    (re.compile(r"\bbrew\s+install\b.*--cask\b|\bbrew\s+install\s+--cask\b"), "--cask"),
    (re.compile(r"(?:^|\s)/usr/bin/sudo\b"), "/usr/bin/sudo"),
    (re.compile(r"(?:^|\s)sudo\s"), "sudo"),
    (re.compile(r"(?:^|\s)doas\s"), "doas"),
    (re.compile(r"\bchown\s+-R\b[^\n#]*?/opt/homebrew(?:\b|/)"), "chown -R /opt/homebrew"),
    (re.compile(r"\bnpm\s+install\s+-g\b"), "npm install -g"),
]

# Sections are split on TOP-LEVEL (h2 `##`) headers — not just "Phase" headers — so a
# privileged code block under `## Setup` or `## Prerequisites` is still role-classified and
# linted (PR #527 Bugbot: pre-/non-phase code was skipped). `###`+ subsections stay inside
# their parent h2 section, so e.g. a Phase A's `### A3` brew block is under the admin phase.
_SECTION_HEADER = re.compile(r"^##\s+(.+)$")
_ANY_HEADER = re.compile(r"^#{1,6}\s+(.*)$")
_FENCE = re.compile(r"^\s*```")

_ADMIN_CUES = re.compile(r"\badmin\b|machine-wide|one-time", re.IGNORECASE)
_STANDARD_CUES = re.compile(
    r"\bstandard\b|happy-?camp(?:er|r)|user[- ]space|without admin|non-admin|per-user install",
    re.IGNORECASE,
)
_PREREQ_HEADER = re.compile(r"\b(prerequisites?|prereqs?|preflight|phase\s*0)\b", re.IGNORECASE)
# A per-user npm prefix (`npm config set prefix "$HOME/…"`, `NPM_CONFIG_PREFIX=$HOME/…`)
# makes `npm install -g` write to user space — so it is NOT an admin-only operation. The
# plan's rule is specifically "npm install -g INTO /opt/homebrew"; with a user prefix the
# global install is legitimate for a Standard user.
_USER_NPM_PREFIX = re.compile(
    r"npm\s+config\s+set\s+prefix\s+[\"']?(?:\$HOME|\$\{HOME\}|~|/Users/)"
    r"|NPM_CONFIG_PREFIX\s*=\s*[\"']?(?:\$HOME|\$\{HOME\}|~|/Users/)",
    re.IGNORECASE,
)

_CASK_INSTALL = re.compile(r"\bbrew\s+install\b.*--cask|\bbrew\s+install\s+--cask")
_RECEIPT_CHECK = re.compile(r"\bbrew\s+list\b|cask receipt|brew\s+info\b")
_BUNDLE_CHECK = re.compile(
    r"/Applications/|\.app\b|--version\b|-V\b|defaults read .*CFBundleShortVersion|"
    r"\bls\b.*\.app|on-disk|bundle version",
    re.IGNORECASE,
)
_NON_FENCED_COMMAND = re.compile(
    r"^\s*(?:(?:[-*]|\d+[.)])\s+)?(?:(?:\$|%)\s+)?"
    r"(?P<cmd>(?:/usr/bin/sudo|sudo|doas|chown|brew|npm)\b.*)$"
)
_APP_BUNDLE = re.compile(r"([A-Za-z0-9][A-Za-z0-9 _.-]*)\.app\b", re.IGNORECASE)
_IDENTIFIER_TOKEN = re.compile(r"[A-Za-z][A-Za-z0-9_-]{3,}")
_TOOL_BOUNDARY = r"(?<![A-Za-z0-9_-]){tool}(?![A-Za-z0-9_-])"
_DEVELOPER_TOOLS = {
    "brainlayer",
    "brew",
    "bun",
    "cargo",
    "claude",
    "cmuxlayer",
    "git",
    "go",
    "node",
    "npm",
    "pip",
    "pip3",
    "python",
    "python3",
    "ruby",
    "rustup",
    "socat",
    "swift",
    "uv",
    "voicelayer",
    "xcodebuild",
}
_IDENTIFIER_CANONICAL_ALLOWLIST = {
    "macos",
    # Happy Campr COMPANY name, intentionally distinct from the `happy-camper` account.
    "happycampr",
}


def classify_phase(title: str, body: str) -> str:
    """admin | standard | neutral, title-primary then body-fallback.

    The TITLE is the strongest signal of whose phase it is, so it decides first; only when
    the title is role-neutral do body cues break the tie. This means a Standard section
    whose role is stated in the body (not the header) is still classified Standard, and a
    Standard phase that merely mentions the admin boundary in its body is not flipped to
    admin (PR #527 Bugbot)."""
    if _STANDARD_CUES.search(title):
        return "standard"
    if _ADMIN_CUES.search(title):
        return "admin"
    if _STANDARD_CUES.search(body):
        return "standard"
    if _ADMIN_CUES.search(body):
        return "admin"
    return "neutral"


def parse_phases(markdown: str) -> list[dict]:
    """Split a runbook into sections on top-level (h2) headers. Each: {title, role,
    start_line, code_lines} where code_lines = [(lineno, text)] from fenced blocks and
    command-shaped non-fenced lines. `###`+ subsections are folded into their parent h2
    section's body/code."""
    lines = markdown.splitlines()
    headers = [i for i, ln in enumerate(lines) if _SECTION_HEADER.match(ln)]
    phases = []
    for idx, start in enumerate(headers):
        end = headers[idx + 1] if idx + 1 < len(headers) else len(lines)
        title = _SECTION_HEADER.match(lines[start]).group(1).strip()
        body_lines = lines[start + 1:end]
        body = "\n".join(body_lines)
        in_fence = False
        code_lines = []
        for offset, ln in enumerate(body_lines, start=start + 2):
            if _FENCE.match(ln):
                in_fence = not in_fence
                continue
            command = _command_from_markdown_line(ln, in_fence)
            if command is not None:
                code_lines.append((offset, command))
        phases.append({
            "title": title,
            "role": classify_phase(title, body),
            "start_line": start + 1,
            "code_lines": code_lines,
        })
    return phases


# A shell inline comment starts at a `#` that is at line-start or preceded by whitespace
# (so a URL fragment `https://x#y` is NOT a comment). Strip from there to end of line.
_INLINE_COMMENT = re.compile(r"(?:^|\s)#.*$")


def _strip_inline_comment(text: str) -> str:
    return _INLINE_COMMENT.sub("", text)


def _command_from_markdown_line(text: str, in_fence: bool) -> str | None:
    code = _strip_inline_comment(text)
    if not code.strip():
        return None
    if in_fence:
        return code
    if _ANY_HEADER.match(text):
        return None
    match = _NON_FENCED_COMMAND.match(code)
    if not match:
        return None
    return match.group("cmd")


def _privileged_hits(text: str):
    # Strip inline + whole-line comments so `echo ok # brew install --cask` and
    # `# do not run brew install` inside a block never match.
    code = _strip_inline_comment(text)
    if not code.strip():
        return []
    return [label for rx, label in _PRIVILEGED if rx.search(code)]


def code_command_lines(markdown: str) -> list[tuple[int, str]]:
    """Document-wide [(lineno, comment-stripped text)] for real command lines. This scans
    fenced blocks plus command-shaped non-fenced lines while still ignoring prose mentions
    such as "do not run brew install"."""
    out = []
    in_fence = False
    for i, ln in enumerate(markdown.splitlines()):
        if _FENCE.match(ln):
            in_fence = not in_fence
            continue
        command = _command_from_markdown_line(ln, in_fence)
        if command is not None:
            out.append((i, command))
    return out


def _shell_words(text: str) -> list[str]:
    try:
        return shlex.split(text, comments=False, posix=True)
    except ValueError:
        return text.split()


def _concrete_cask_tokens(tokens: list[str]) -> list[str]:
    casks = []
    saw_cask = False
    for token in tokens:
        if token in {"&&", ";", "|"}:
            break
        if token == "--cask":
            saw_cask = True
            continue
        if not saw_cask or token.startswith("-"):
            continue
        if re.search(r"[$*?{}\[\]]", token):
            continue
        casks.append(token)
    return casks


def _casks_from_install(text: str) -> list[str]:
    tokens = _shell_words(text)
    for idx, token in enumerate(tokens):
        if token != "brew":
            continue
        if idx + 1 < len(tokens) and tokens[idx + 1] == "install" and "--cask" in tokens[idx + 2:]:
            return _concrete_cask_tokens(tokens[idx + 2:])
    return []


def _casks_from_receipt(text: str) -> list[str] | None:
    tokens = _shell_words(text)
    for idx, token in enumerate(tokens):
        if token != "brew":
            continue
        if idx + 1 < len(tokens) and tokens[idx + 1] in {"list", "info"} and "--cask" in tokens[idx + 2:]:
            casks = _concrete_cask_tokens(tokens[idx + 2:])
            return casks
    return None


def _bundle_slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", text.lower())


def _line_checks_own_bundle(text: str, cask: str) -> bool:
    cask_slug = _bundle_slug(cask)
    if not cask_slug:
        return False
    for match in _APP_BUNDLE.finditer(text):
        app_slug = _bundle_slug(match.group(1))
        if app_slug == cask_slug or cask_slug in app_slug or app_slug in cask_slug:
            return True
    return False


def _canonical_identifier(token: str) -> str:
    return re.sub(r"[-_]", "", token).lower()


def _has_internal_upper(token: str) -> bool:
    return not token.isupper() and bool(re.search(r"[a-z][A-Z]", token))


def _is_load_bearing_identifier(token: str, in_code_context: bool) -> bool:
    return _has_internal_upper(token) or (in_code_context and ("-" in token or "_" in token))


def _edit_distance_one_or_less(left: str, right: str) -> bool:
    if left == right:
        return True
    if abs(len(left) - len(right)) > 1:
        return False
    if len(left) == len(right):
        return sum(a != b for a, b in zip(left, right)) <= 1
    if len(left) > len(right):
        left, right = right, left
    i = j = edits = 0
    while i < len(left) and j < len(right):
        if left[i] == right[j]:
            i += 1
            j += 1
            continue
        edits += 1
        if edits > 1:
            return False
        j += 1
    return True


def _identifier_occurrences(markdown: str) -> list[dict]:
    occurrences = []
    in_fence = False
    for lineno, line in enumerate(markdown.splitlines(), start=1):
        if _FENCE.match(line):
            in_fence = not in_fence
            continue
        inline_code_spans = [
            (match.start(), match.end())
            for match in re.finditer(r"`[^`]+`", line)
        ]
        for match in _IDENTIFIER_TOKEN.finditer(line):
            if match.start() > 0 and line[match.start() - 1] in "[]":
                continue
            if match.end() < len(line) and line[match.end()] in "[]":
                continue
            token = match.group(0)
            in_code_context = in_fence or any(
                start <= match.start() < end
                for start, end in inline_code_spans
            )
            occurrences.append({
                "token": token,
                "canonical": _canonical_identifier(token),
                "line": lineno,
                "load_bearing": _is_load_bearing_identifier(token, in_code_context),
            })
    return occurrences


def _identifier_spelling_violations(markdown: str) -> list[dict]:
    occurrences = _identifier_occurrences(markdown)
    by_token = {}
    for occ in occurrences:
        by_token.setdefault(occ["token"], []).append(occ)

    tokens = sorted(by_token)
    violations = []
    seen_pairs = set()
    for idx, left in enumerate(tokens):
        for right in tokens[idx + 1:]:
            pair_key = tuple(sorted((left, right)))
            if pair_key in seen_pairs:
                continue
            left_occ = by_token[left]
            right_occ = by_token[right]
            total_count = len(left_occ) + len(right_occ)
            has_load_bearing = any(occ["load_bearing"] for occ in left_occ) or any(
                occ["load_bearing"] for occ in right_occ
            )
            if total_count < 2 or not has_load_bearing:
                continue
            left_canon = left_occ[0]["canonical"]
            right_canon = right_occ[0]["canonical"]
            if left_canon in _IDENTIFIER_CANONICAL_ALLOWLIST or right_canon in _IDENTIFIER_CANONICAL_ALLOWLIST:
                continue
            if not _edit_distance_one_or_less(left_canon, right_canon):
                continue
            if (
                left_canon == right_canon
                and left.lower() == right.lower()
                and not (_has_internal_upper(left) or _has_internal_upper(right))
            ):
                continue
            if (
                left_canon == right_canon
                and "-" not in left
                and "-" not in right
                and "_" not in left
                and "_" not in right
                and (left.islower() or right.islower())
            ):
                continue
            seen_pairs.add(pair_key)
            line = min(left_occ[0]["line"], right_occ[0]["line"])
            violations.append({
                "rule": "inconsistent-identifier-spelling",
                "phase": None,
                "line": line,
                "evidence": f"{left} vs {right}",
            })
    return violations


def _prereq_section_text(markdown: str) -> str:
    lines = markdown.splitlines()
    start = None
    start_level = None
    for idx, line in enumerate(lines):
        match = _ANY_HEADER.match(line)
        if match and _PREREQ_HEADER.search(match.group(1)):
            start = idx
            start_level = len(line) - len(line.lstrip("#"))
            break
    if start is None:
        return ""

    end = len(lines)
    for idx in range(start + 1, len(lines)):
        stripped = lines[idx].lstrip()
        if not stripped.startswith("#"):
            continue
        level = len(stripped) - len(stripped.lstrip("#"))
        if 1 <= level <= start_level:
            end = idx
            break
    return "\n".join(lines[start:end])


def _tool_named_in_prereqs(tool: str, prereq_text: str) -> bool:
    pattern = _TOOL_BOUNDARY.format(tool=re.escape(tool))
    return bool(re.search(pattern, prereq_text, re.IGNORECASE))


def _developer_tools_used(text: str) -> set[str]:
    used = set()
    for tool in _DEVELOPER_TOOLS:
        pattern = _TOOL_BOUNDARY.format(tool=re.escape(tool))
        if re.search(pattern, text):
            used.add(tool)
    return used


def _prereq_incompleteness_violations(markdown: str) -> list[dict]:
    prereq_text = _prereq_section_text(markdown)
    first_lines = {}
    for lineno, text in code_command_lines(markdown):
        for tool in _developer_tools_used(text):
            first_lines.setdefault(tool, lineno + 1)

    violations = []
    for tool in sorted(first_lines):
        if _tool_named_in_prereqs(tool, prereq_text):
            continue
        violations.append({
            "rule": "prereq-incompleteness",
            "phase": None,
            "line": first_lines[tool],
            "evidence": tool,
        })
    return violations


def lint_runbook(markdown: str) -> list[dict]:
    """Return a list of violations: {rule, phase, line, evidence}."""
    violations = []
    phases = parse_phases(markdown)
    user_npm_prefix = bool(_USER_NPM_PREFIX.search(markdown))

    # Rule 1: privileged commands inside any non-admin phase. Neutral/unlabeled sections
    # are treated as not privileged; a runbook must explicitly label machine-wide work as
    # admin-owned instead of relying on a silent neutral title.
    for phase in phases:
        if phase["role"] == "admin":
            continue
        for lineno, text in phase["code_lines"]:
            for label in _privileged_hits(text):
                # `npm install -g` is user-space-safe when a per-user npm prefix is set.
                if label == "npm install -g" and user_npm_prefix:
                    continue
                violations.append({
                    "rule": "privileged-in-standard-phase",
                    "phase": phase["title"],
                    "line": lineno,
                    "evidence": f"{label}: {text.strip()}",
                })

    lines = markdown.splitlines()
    code_lines = code_command_lines(markdown)

    # Rule 2: a cask install (in a code block) with no Prerequisites section earlier.
    first_prereq = next(
        (i for i, ln in enumerate(lines) if _ANY_HEADER.match(ln) and _PREREQ_HEADER.search(ln)),
        None,
    )
    for lineno, text in code_lines:
        if _CASK_INSTALL.search(text):
            if first_prereq is None or first_prereq > lineno:
                violations.append({
                    "rule": "cask-before-prereqs",
                    "phase": None,
                    "line": lineno + 1,
                    "evidence": text.strip(),
                })
            break  # one report is enough

    # Rule 3: verification trusts the cask receipt but never that cask's own on-disk
    # bundle. A different .app path must not satisfy a receipt check.
    code_text = [t for _ln, t in code_lines]
    installed_casks = {
        cask
        for text in code_text
        if _CASK_INSTALL.search(text)
        for cask in _casks_from_install(text)
    }
    has_cask = bool(installed_casks) or any(_CASK_INSTALL.search(t) for t in code_text)
    if has_cask:
        receipt_targets = []
        receipt_without_target = False
        for text in code_text:
            if not _RECEIPT_CHECK.search(text):
                continue
            casks = _casks_from_receipt(text)
            if casks is None:
                continue
            if casks:
                receipt_targets.extend(casks)
            else:
                receipt_without_target = True
        receipt = bool(receipt_targets) or receipt_without_target
        bundle = any(_BUNDLE_CHECK.search(t) for t in code_text)
        targets = sorted(set(receipt_targets) or installed_casks)
        missing_own_bundle = bool(targets) and any(
            not any(_line_checks_own_bundle(t, cask) for t in code_text)
            for cask in targets
        )
        if receipt and (missing_own_bundle or (not targets and not bundle)):
            violations.append({
                "rule": "receipt-not-bundle-verify",
                "phase": None,
                "line": None,
                "evidence": "verification checks the cask receipt (brew list) but never that cask's own on-disk bundle",
            })
    violations.extend(_identifier_spelling_violations(markdown))
    violations.extend(_prereq_incompleteness_violations(markdown))
    return violations
