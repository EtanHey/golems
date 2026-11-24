"""Which paths hold secrets, from the data list in ../secret-files.json.

AIDEV-NOTE: policy data lives in secret-files.json; this module only matches.
It reads a candidate file only to answer "is this a Claude settings file with
an env block", and never returns or prints what it read.
"""
from __future__ import annotations

import fnmatch
import json
import os
import re
from pathlib import Path

SKILL_DIR = Path(os.path.realpath(__file__)).parents[1]
LIST_PATH = SKILL_DIR / "secret-files.json"
MASKED_READER = SKILL_DIR / "scripts" / "masked-read.py"
_JSON_SNIFF_BYTES = 1024 * 1024


class SecretList:
    def __init__(self, data: dict, home: str):
        self.home = home
        self.paths = [self._expand(p) for p in data["paths"]]
        self.names = list(data["names"])
        self.not_names = list(data.get("not_names", []))
        self.json_env_names = list(data.get("json_env_names", []))
        # APFS (the fleet's Macs) is case-insensitive: `.ENV` opens `.env`, so
        # every comparison below is casefolded, like the filesystem.
        self.backup_re = re.compile(data["backup_suffix_re"], re.I)
        self.helpers = list(data.get("helpers", []))
        self.secret_var_re = re.compile(data["secret_var_re"])
        for value in (self.names, self.not_names, self.json_env_names, self.helpers):
            if not all(isinstance(v, str) and v for v in value):
                raise ValueError("secret list entries must be non-empty strings")

    def _expand(self, pattern: str) -> str:
        if not isinstance(pattern, str) or not pattern:
            raise ValueError("secret list entries must be non-empty strings")
        if pattern == "~" or pattern.startswith("~/"):
            return self.home + pattern[1:]
        return pattern

    def _variants(self, path: str) -> list[str]:
        """The path plus its backup-stripped spellings (x.env.bak-1 -> x.env)."""
        out = [path]
        head, base = os.path.split(path)
        while True:
            stripped = self.backup_re.sub("", base)
            if not stripped or stripped == base:
                break
            base = stripped
            out.append(os.path.join(head, base))
        return out

    def _name_match(self, base: str) -> bool:
        base = base.casefold()
        if any(fnmatch.fnmatchcase(base, p.casefold()) for p in self.not_names):
            return False
        return any(fnmatch.fnmatchcase(base, p.casefold()) for p in self.names)

    def json_env_name(self, base: str) -> bool:
        return any(fnmatch.fnmatchcase(v.casefold(), p.casefold())
                   for v in self._variants(base) for p in self.json_env_names)

    def is_helper(self, name: str) -> bool:
        return isinstance(name, str) and os.path.basename(name).casefold() in {h.casefold() for h in self.helpers}

    def path_pattern_match(self, path: str) -> bool:
        """String-only match against the absolute `paths` patterns, casefolded."""
        return any(fnmatch.fnmatchcase(v.casefold(), p.casefold()) for v in self._variants(path) for p in self.paths)

    def name_mentioned(self, text: str) -> bool:
        """A bare listed name (auth.json, x.env) in code text; no file needed."""
        return any(self._name_match(os.path.basename(v)) for v in self._variants(text))

    def is_secret(self, path: str, assume_exists: bool = False) -> bool:
        """Absolute path -> does reading it print a secret?

        `assume_exists` treats a listed basename as protected even when no file
        is there yet (a printer's operand that this same command may create)."""
        candidates = [os.path.normpath(path)]
        try:
            real = os.path.realpath(path)
        except (OSError, ValueError):
            real = None
        if real and real not in candidates:
            candidates.append(real)
        for candidate in candidates:
            if self.path_pattern_match(candidate):
                return True
        for candidate in candidates:
            exists = os.path.isfile(candidate)
            if not exists and not assume_exists:
                continue
            for variant in self._variants(candidate):
                base = os.path.basename(variant)
                if self._name_match(base):
                    return True
                if (exists and self.json_env_name(base)
                        and _has_env_block(candidate, self.secret_var_re)):
                    return True
        return False

    def roots(self) -> list[str]:
        """Fixed directory prefixes of the absolute patterns (for recursive searches)."""
        out = []
        for pattern in self.paths:
            if not pattern.startswith("/"):
                continue
            fixed = re.split(r"[*?\[]", pattern, maxsplit=1)[0]
            root = fixed if fixed.endswith("/") else os.path.dirname(fixed)
            root = os.path.normpath(root)
            if root not in out and root != "/":
                out.append(root)
        return out


def _has_env_block(path: str, secret_var_re) -> bool:
    """A Claude settings file whose `env` block holds a secret-named key."""
    try:
        with open(path, "rb") as stream:
            data = stream.read(_JSON_SNIFF_BYTES + 1)
    except OSError:
        return False
    if len(data) > _JSON_SNIFF_BYTES:
        return True  # too large to judge: fail closed
    text = data.decode("utf-8", errors="replace")
    try:
        value = json.loads(text)
    except ValueError:
        # JSONC or broken JSON: judge the key names inside an "env": {...} spelling.
        block = re.search(r'"env"\s*:\s*\{(.*?)\}', text, re.S)
        keys = re.findall(r'"([^"]+)"\s*:', block.group(1)) if block else []
        return any(secret_var_re.search(k) for k in keys)
    env = value.get("env") if isinstance(value, dict) else None
    return isinstance(env, dict) and any(secret_var_re.search(str(k)) for k in env)


def load(home: str | None = None, list_path: str | os.PathLike | None = None) -> SecretList:
    home = home if home is not None else os.environ.get("HOME") or os.path.expanduser("~")
    source = Path(list_path) if list_path else LIST_PATH
    with open(source, encoding="utf-8") as stream:
        data = json.load(stream)
    if not isinstance(data, dict):
        raise ValueError("secret list must be a JSON object")
    return SecretList(data, os.path.normpath(home))
