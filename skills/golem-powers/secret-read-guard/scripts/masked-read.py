#!/usr/bin/env python3
"""Print a secret-bearing file's STRUCTURE with every value redacted.

The one sanctioned way to look at a file secret-read-guard protects:

    python3 masked-read.py <file> [<file>...]

Every value becomes `<redacted len=N sha=xxxxxxxx>` (sha = first 8 hex of the
value's sha256, so two files can be compared without showing either). JSON,
YAML, env and TOML keep their keys and nesting; comments are dropped, because
people paste keys into comments. An unknown format prints key names only.

AIDEV-NOTE: never add a flag that prints a raw value; that is what the guard
exists to stop. Compare values by their sha instead.
"""
import hashlib
import json
import os
import re
import sys

MAX_BYTES = 4 * 1024 * 1024
KEY = r"[A-Za-z_][A-Za-z0-9_.-]*"


def redact(value):
    text = value if isinstance(value, str) else json.dumps(value)
    digest = hashlib.sha256(text.encode("utf-8", errors="surrogatepass")).hexdigest()[:8]
    return f"<redacted len={len(text)} sha={digest}>"


def mask_json(value):
    if isinstance(value, dict):
        return {str(k): mask_json(v) for k, v in value.items()}
    if isinstance(value, list):
        return [mask_json(v) for v in value]
    return redact(value)


def _strip_quotes(value):
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
        return value[1:-1]
    return value


def mask_env(lines):
    out = []
    for line in lines:
        stripped = line.strip()
        if not stripped:
            out.append("")
        elif stripped.startswith("#"):
            out.append("# <comment redacted>")
        else:
            m = re.match(rf"^(\s*(?:export\s+)?)({KEY})(\s*=\s*)(.*)$", line)
            out.append(f"{m.group(1)}{m.group(2)}={redact(_strip_quotes(m.group(4)))}" if m
                       else f"<line redacted len={len(stripped)}>")
    return out


def mask_toml(lines):
    out = []
    for line in lines:
        stripped = line.strip()
        if not stripped:
            out.append("")
        elif stripped.startswith("#"):
            out.append("# <comment redacted>")
        elif re.match(r"^\[\[?[^\]=]+\]\]?\s*(#.*)?$", stripped):
            out.append(re.sub(r"\s*#.*$", "", stripped))
        else:
            m = re.match(rf"^(\s*)((?:{KEY}|\"[^\"]*\")(?:\s*\.\s*(?:{KEY}|\"[^\"]*\"))*)\s*=\s*(.*)$", line)
            out.append(f"{m.group(1)}{m.group(2)} = {redact(_strip_quotes(m.group(3)))}" if m
                       else f"<line redacted len={len(stripped)}>")
    return out


def mask_yaml(lines):
    out = []
    for line in lines:
        stripped = line.strip()
        if not stripped:
            out.append("")
        elif stripped.startswith("#"):
            out.append(line[:len(line) - len(line.lstrip())] + "# <comment redacted>")
        elif stripped in ("---", "..."):
            out.append(stripped)
        else:
            indent = line[:len(line) - len(line.lstrip())]
            m = re.match(r"^(-\s+)?([^:#\s][^:#]*?|\"[^\"]*\"|'[^']*'):(\s+(.*))?$", stripped)
            if m:
                dash, key, value = m.group(1) or "", m.group(2), (m.group(4) or "").strip()
                if value and value not in ("|", ">", "|-", ">-", "|+", ">+"):
                    out.append(f"{indent}{dash}{key}: {redact(_strip_quotes(value))}")
                else:
                    out.append(f"{indent}{dash}{key}:" + (f" {value}" if value else ""))
            elif stripped.startswith("- "):
                out.append(f"{indent}- {redact(_strip_quotes(stripped[2:]))}")
            else:
                out.append(f"{indent}<line redacted len={len(stripped)}>")
    return out


def key_names(lines):
    names = []
    for line in lines:
        m = re.match(rf"^\s*(?:export\s+)?[\"']?({KEY})[\"']?\s*[:=]", line)
        if m and m.group(1) not in names:
            names.append(m.group(1))
    return [f"<unknown format: {len(lines)} lines; key names only>"] + names


def detect(path, text):
    base = os.path.basename(path).lower()
    base = re.sub(r"\.bak(?:[-._][^/]*)?$", "", base)
    try:
        return "json", json.loads(text)
    except ValueError:
        pass
    if base.endswith(".toml"):
        return "toml", None
    if base.endswith((".yaml", ".yml")) or ".conf" in base:
        return "yaml", None
    if base.endswith(".env") or base.startswith(".env") or base.endswith(".envrc"):
        return "env", None
    lines = [l for l in text.splitlines() if l.strip() and not l.lstrip().startswith("#")]
    if lines and all(re.match(rf"^\s*(export\s+)?{KEY}\s*=", l) for l in lines):
        return "env", None
    if lines and all(re.match(r"^\s*(-\s|[^:#\s][^:#]*:(\s|$))", l) for l in lines):
        return "yaml", None
    return "unknown", None


def render(path):
    with open(path, "rb") as stream:
        data = stream.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        return [f"<file larger than {MAX_BYTES} bytes; not read>"]
    text = data.decode("utf-8", errors="replace")
    kind, value = detect(path, text)
    lines = text.splitlines()
    if kind == "json":
        return ["# format: json"] + json.dumps(mask_json(value), indent=2).splitlines()
    body = {"env": mask_env, "toml": mask_toml, "yaml": mask_yaml}.get(kind, key_names)(lines)
    return [f"# format: {kind}"] + body


def main(argv):
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__.strip())
        return 0 if argv else 2
    status = 0
    for path in argv:
        print(f"== {path}")
        try:
            print("\n".join(render(path)))
        except OSError as exc:
            print(f"<cannot read: {exc.strerror}>")
            status = 1
    return status


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
