#!/usr/bin/env python3
"""prepare-mine-context.py — build grep + excerpt context for one weave miner.

A weave miner should NEVER read a whole multi-MB JSONL into context. This builds
a compact per-session context file = (the session-miner digest, if one exists)
+ keyword-grep excerpts with raw JSONL line numbers (jsonl_line=N). The miner
reads THIS, then greps the raw JSONL only for the lines it wants to quote verbatim.

Note: Digest section-N references are session-miner EVENT indices — NOT jsonl_line
numbers. Only jsonl_line= cites in the Grep excerpts section are safe for verbatim grep.

Handles both transcript formats:
  - Claude:  ~/.claude/projects/<slug>/<uuid>.jsonl   (type: user|assistant|tool_*)
  - Codex:   ~/.codex/sessions/**/*.jsonl             (type: response_item|event_msg|...)

Input: one session JSON object on stdin:
  {"label": "...", "src": "/abs/path.jsonl", "digest": "/abs/path.md" (optional),
   "source": "claude"|"codex" (optional — inferred from path if absent)}

Output: writes <ctx-dir>/<label-with-slashes-as-__>.md and prints its path.

Usage:
  echo '{"label":"orc","src":"/.../x.jsonl","digest":"/.../x.md"}' \
    | python3 prepare-mine-context.py --ctx-dir /path/to/mine-context
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

# The keyword net: corrections, failures, fixes, merges, blockers, verification.
PAT = re.compile(
    r"error|fail|fix|etan|correct|wrong|self-qa|verif|todo|blocked|merge|"
    r"revert|regress|frustrat|stop|don'?t|never|always|should have|"
    r"dashboard|collab|plan|lead|track|fan.?out",
    re.I,
)

COMMAND_MARKERS = ("<command-name>", "<command-message>", "<local-command")
RELAY_PREFIXES = ("<queue-operation>", "<last-prompt>", "<task-notification>")


def flatten_content(content) -> str:
    """Claude `message.content` is either a plain string OR a list of typed
    blocks (text / thinking / tool_use / tool_result). Flatten both to text so
    the keyword net actually sees the message body — the str-only path misses
    almost all real transcript content."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for b in content:
            if not isinstance(b, dict):
                parts.append(str(b))
                continue
            bt = b.get("type")
            if bt in ("text", "thinking"):
                parts.append(b.get("text") or b.get("thinking") or "")
            elif bt == "tool_use":
                parts.append(f"[tool_use {b.get('name','')}] {json.dumps(b.get('input', {}))[:600]}")
            elif bt == "tool_result":
                c = b.get("content")
                parts.append(f"[tool_result] {json.dumps(c)[:600] if not isinstance(c, str) else c[:600]}")
            else:
                parts.append(json.dumps(b)[:400])
        return "\n".join(p for p in parts if p)
    return ""


def _line_tag(line_no: int) -> str:
    """Explicit raw JSONL line cite — NOT session-miner digest event indices."""
    return f"jsonl_line={line_no}"


def is_claude_operator_turn(record: dict) -> bool:
    """True only for a raw Claude operator turn, never a synthetic user row."""
    if record.get("type") != "user" or record.get("isSidechain") or record.get("isMeta"):
        return False
    message = record.get("message")
    if not isinstance(message, dict):
        return False
    content = message.get("content", "")
    if isinstance(content, list) and any(
        isinstance(block, dict) and block.get("type") == "tool_result" for block in content
    ):
        return False
    text = flatten_content(content).strip()
    if not text or text.startswith("<system-reminder>"):
        return False
    if any(marker in text for marker in COMMAND_MARKERS):
        return False
    return not any(text.startswith(prefix) for prefix in RELAY_PREFIXES)


def excerpt_claude(path: Path, max_lines: int = 400) -> tuple[list[str], int]:
    out: list[str] = []
    user_messages = 0
    for i, ln in enumerate(path.open(errors="replace"), 1):
        try:
            o = json.loads(ln)
        except json.JSONDecodeError:
            continue
        if is_claude_operator_turn(o):
            user_messages += 1
        if len(out) >= max_lines:
            continue
        t = o.get("type")
        if t == "user" and isinstance(o.get("message"), dict):
            s = flatten_content(o["message"].get("content", "")).strip()
            if len(s) > 20 and PAT.search(s):
                out.append(f"[{_line_tag(i)}] USER: {s[:1200]}")
        elif t == "assistant" and isinstance(o.get("message"), dict):
            s = flatten_content(o["message"].get("content", "")).strip()
            if s and PAT.search(s):
                out.append(f"[{_line_tag(i)}] ASST: {s[:800]}")
        elif t in ("tool_use", "tool_result") and PAT.search(ln):
            out.append(f"[{_line_tag(i)}] {t}: {ln[:500]}")
    return out, user_messages


def excerpt_codex(path: Path, max_hits: int = 160) -> list[str]:
    out: list[str] = []
    for i, ln in enumerate(path.open(errors="replace"), 1):
        if not PAT.search(ln):
            continue
        try:
            o = json.loads(ln)
        except json.JSONDecodeError:
            out.append(f"[{_line_tag(i)}] RAW: {ln[:400]}")
            continue
        typ = o.get("type", "")
        payload = o.get("payload") or {}
        if typ == "response_item":
            ptype = payload.get("type")
            if ptype == "message":
                role = payload.get("role", "")
                for part in payload.get("content") or []:
                    if isinstance(part, dict) and part.get("type") in ("input_text", "output_text", "text"):
                        txt = (part.get("text") or "").strip()
                        if txt and PAT.search(txt):
                            out.append(f"[{_line_tag(i)}] {role}: {txt[:1000]}")
            elif ptype in ("function_call", "custom_tool_call"):
                name = payload.get("name") or payload.get("tool_name") or ptype
                out.append(f"[{_line_tag(i)}] tool_call {name}: {json.dumps(payload)[:400]}")
        elif typ == "event_msg":
            msg = payload.get("message") or payload.get("text") or str(payload)[:500]
            out.append(f"[{_line_tag(i)}] event_msg: {str(msg)[:800]}")
        elif typ == "agent_message":
            out.append(f"[{_line_tag(i)}] agent: {(payload.get('message') or str(payload))[:800]}")
        else:
            out.append(f"[{_line_tag(i)}] {typ}: {str(payload)[:400]}")
        if len(out) >= max_hits:
            break
    return out


def infer_source(src: Path, declared: str | None) -> str:
    if declared:
        return declared
    s = str(src)
    if "claude/projects" in s:
        return "claude"
    if "codex" in s:
        return "codex"
    return "claude"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ctx-dir", required=True, type=Path, help="output dir for context files")
    ap.add_argument("--digest-chars", type=int, default=80000, help="max digest chars to embed")
    args = ap.parse_args()

    session = json.loads(sys.stdin.read())
    label = session["label"]
    src = Path(session["src"])
    digest = Path(session["digest"]) if session.get("digest") else None
    source = infer_source(src, session.get("source"))
    out_path = args.ctx_dir / (label.replace("/", "__") + ".md")
    args.ctx_dir.mkdir(parents=True, exist_ok=True)

    excerpts: list[str] | None = None
    user_messages: int | None = None
    if src.suffix == ".jsonl" and src.exists():
        if source == "claude":
            excerpts, user_messages = excerpt_claude(src)
        else:
            excerpts = excerpt_codex(src)

    lines = [
        f"# Mine context — {label}\n",
        f"**src:** `{src}`  ",
        f"**source:** {source}  ",
        f"**digest:** `{digest if digest else '(none)'}`  ",
    ]
    if user_messages is not None:
        lines.append(f"**user_messages:** {user_messages}")
    lines.append("\n")
    if digest and digest.exists():
        lines.append("## Digest\n\n")
        lines.append(digest.read_text(errors="replace")[: args.digest_chars])
        lines.append("\n\n")
    lines.append("## Grep excerpts (keyword hits — cite `jsonl_line=N` in evidence; NOT digest §N)\n\n")
    if excerpts is not None:
        lines.extend(excerpts if excerpts else ["_(no keyword hits in structured excerpt pass)_\n"])
    else:
        lines.append(f"_(src missing or not a .jsonl: {src})_\n")

    out_path.write_text("\n".join(lines))
    print(out_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
