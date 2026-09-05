"""launchd-plist secret linter (gen-18 Track 6 D7).

A launchd plist that hardcodes a secret in `EnvironmentVariables` or
`ProgramArguments` leaks it into the launchd-managed process on first load and
contaminates the whole fleet (the gen-18 specimen: a raw `GOOGLE_API_KEY` leaked this
way). The fix is to carry only an `op://` reference or `$VAR` env-indirection in the
plist, never the literal. This linter turns that rule into a mechanical, replayable gate.

Three rules (precision-biased — flag literal secrets, never indirection):
  1. raw-secret-value — a value matching a KNOWN provider key pattern (Google `AIza…`,
     OpenAI `sk-…`, GitHub `ghp_/gho_/ghs_/ghu_…`, Slack `xox…`, AWS `AKIA…`, a PEM
     private key, plus Stripe `sk_live_`, Anthropic `sk-ant-api03-`, and Twilio `AC…`)
     that is a literal (not `op://…`, not `$VAR`/`${VAR}`).
  2. literal-in-secret-named-var — an env var whose NAME says secret (`*_API_KEY`,
     `*_TOKEN`, `*_SECRET`, `*PASSWORD*`, `*CREDENTIAL*`, `*PRIVATE_KEY*`) whose value is a
     non-empty literal that is not an `op://` reference or `$`-indirection.
  3. command-substitution — a plist string containing `$(...)`; static launchd plists
     must not carry executable-looking command substitution where secrets are expected.

Pure functions over the plist (bytes / str / parsed dict) — deterministic, no I/O,
stdlib `plistlib` only.
"""

from __future__ import annotations

import plistlib
import re

# A value that is ENTIRELY a single indirection expression — a 1Password reference or one
# shell var — is the hardened form. It must be a FULL match: a value that merely STARTS
# with `$VAR` but then concatenates a literal (`${PREFIX}AIza…realkey`) is NOT pure
# indirection and must still be secret-scanned (PR #529 Bugbot). The `op://` arm allows
# internal spaces, since 1Password vault/item names can contain them (a secret APPENDED to
# such a reference is still caught by the always-on provider-pattern scan below).
_PURE_INDIRECTION = re.compile(r"^\s*(?:op://.+|\$\{?[A-Za-z_]\w*\}?)\s*$")

# Segment-based secret-name detection (PR #529 Bugbot: a plain substring match flagged
# `TOKENIZER`/`SECRETARY`). The key is split on `_`/`-` into segments; a segment must BE a
# secret term, or a `KEY` segment must be qualified by a secret-ish prefix segment.
_SECRET_SEGMENTS = {
    "SECRET", "SECRETS", "TOKEN", "PASSWORD", "PASSWD", "PASSPHRASE",
    "CREDENTIAL", "CREDENTIALS", "APIKEY",
}
_KEY_SECRET_PREFIXES = {"API", "ACCESS", "PRIVATE", "SECRET", "SIGNING", "ENCRYPTION"}


def _is_secret_name(key: str) -> bool:
    segments = re.split(r"[_\-]+", key.upper())
    sset = set(segments)
    if sset & _SECRET_SEGMENTS:
        return True
    for i, seg in enumerate(segments):
        if seg == "KEY" and i > 0 and segments[i - 1] in _KEY_SECRET_PREFIXES:
            return True
    return False

# Known provider secret shapes. Conservative, low-false-positive: each is a real,
# documented credential prefix/format.
_KNOWN_SECRET_VALUE = re.compile(
    r"AIza[0-9A-Za-z_\-]{20,}"          # Google API key
    r"|sk_live_[A-Za-z0-9]{20,}"        # Stripe live secret key
    r"|sk-ant-api03-[A-Za-z0-9_\-]{20,}"  # Anthropic API key
    r"|sk-[A-Za-z0-9]{20,}"             # OpenAI / Anthropic-style secret key
    r"|AC[0-9a-fA-F]{32}"               # Twilio Account SID / token-shaped identifier
    r"|gh[posu]_[A-Za-z0-9]{20,}"       # GitHub token (ghp_/gho_/ghs_/ghu_)
    r"|xox[baprs]-[A-Za-z0-9-]{10,}"    # Slack token
    r"|AKIA[0-9A-Z]{16}"                # AWS access key id
    r"|-----BEGIN [A-Z ]*PRIVATE KEY-----"  # PEM private key
)
_COMMAND_SUBSTITUTION = re.compile(r"\$\([^)]*\)")


def _load(data) -> dict:
    if isinstance(data, dict):
        return data
    if isinstance(data, str):
        data = data.encode()
    return plistlib.loads(data)


def _is_pure_indirection(value: str) -> bool:
    return bool(_PURE_INDIRECTION.match(value))


def _path_label(parts: list[str], *, env: bool) -> str:
    if env and len(parts) == 1:
        return parts[0]
    label = "EnvironmentVariables." + parts[0] if env else parts[0]
    for part in parts[1:]:
        if part.startswith("["):
            label += part
        else:
            label += "." + part
    return label


def _leaf_key(parts: list[str]) -> str:
    for part in reversed(parts):
        if not part.startswith("["):
            return part
    return ""


def _string_violations(key: str, value: str, *, secret_key_name: str | None) -> list[dict]:
    if not value.strip():
        return []

    violations = []
    if _COMMAND_SUBSTITUTION.search(value):
        violations.append({
            "key": key,
            "rule": "command-substitution",
            "evidence": f"{key} contains command substitution; use an op:// reference or $VAR",
        })

    # A known provider secret embedded ANYWHERE is a leak — even behind a `$VAR` or
    # `op://` prefix (a secret APPENDED to a reference still sits in the file). A clean
    # op:// reference contains no provider-key-shaped run, so this won't false-fire on it.
    if _KNOWN_SECRET_VALUE.search(value):
        violations.append({
            "key": key,
            "rule": "raw-secret-value",
            "evidence": f"{key} holds a literal provider secret (use an op:// reference or $VAR)",
        })
        return violations

    if _is_pure_indirection(value):
        return violations  # entirely an op:// reference or one $VAR — the hardened form

    if secret_key_name and _is_secret_name(secret_key_name):
        violations.append({
            "key": key,
            "rule": "literal-in-secret-named-var",
            "evidence": f"{key} is a secret-named var with a literal value (use an op:// reference or $VAR)",
        })
    return violations


def _scan_env_value(value, parts: list[str]) -> list[dict]:
    if isinstance(value, str):
        return _string_violations(
            _path_label(parts, env=True),
            value,
            secret_key_name=_leaf_key(parts),
        )
    if isinstance(value, dict):
        violations = []
        for key, child in value.items():
            violations.extend(_scan_env_value(child, [*parts, str(key)]))
        return violations
    if isinstance(value, list):
        violations = []
        for idx, child in enumerate(value):
            violations.extend(_scan_env_value(child, [*parts, f"[{idx}]"]))
        return violations
    return []


def _scan_program_arguments(value, parts: list[str]) -> list[dict]:
    if isinstance(value, str):
        return _string_violations(
            _path_label(parts, env=False),
            value,
            secret_key_name=None,
        )
    if isinstance(value, dict):
        violations = []
        for key, child in value.items():
            violations.extend(_scan_program_arguments(child, [*parts, str(key)]))
        return violations
    if isinstance(value, list):
        violations = []
        for idx, child in enumerate(value):
            violations.extend(_scan_program_arguments(child, [*parts, f"[{idx}]"]))
        return violations
    return []


def lint_plist(data) -> list[dict]:
    """Return a list of violations: {key, rule, evidence}. `data` is plist XML bytes/str
    or an already-parsed dict. Secret VALUES are never echoed — only the key + rule."""
    parsed = _load(data)
    env = parsed.get("EnvironmentVariables", {}) if isinstance(parsed, dict) else {}

    violations = []
    if isinstance(env, dict):
        for key, value in env.items():
            violations.extend(_scan_env_value(value, [str(key)]))

    if isinstance(parsed, dict):
        violations.extend(_scan_program_arguments(parsed.get("ProgramArguments", []), ["ProgramArguments"]))
    return violations
