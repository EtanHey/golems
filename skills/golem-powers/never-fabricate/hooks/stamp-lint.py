#!/usr/bin/env python3
"""stamp-lint — PostToolUse (Write|Edit) advisory lint for stamp/status fabrication.

Phase-2 Fix-5 (weave 2026-06-07, B-taxonomy §4 Fix-5; adversary verdict: KEEP with
claim fix). Mechanizes never-fabricate R13/R15's "stamps are command output" for
collab/weave/handoff docs.

WHAT IT CATCHES — two subclasses ONLY (honest scope, per B-taxonomy-adversary CH4):
  1. STAMP subclass (~10 specimens, CORRECTIONS.md §4): NEW lines carrying an
     HH:MM wall-clock stamp — in a `### name (...)` message header or in stamp
     parentheses — whose time diverges >10 min from the actual clock. The
     19:05-stamped/18:49-written class (#0/F45, B1-F1, B1-F2, F44, F48, B1-F6).
  2. ARTIFACT-EXISTENCE subclass (S22 / specimen #0): a NEW status line claiming
     DONE/MERGED/COMPLETE with numbers that references an absolute file path that
     does not exist on disk ("staging DONE 18:04: 47 sessions..." written before
     any staging ran). Status lines are outputs, not plans.

WHAT IT DOES NOT CATCH (do not over-trust it): measurement errors (S28/B1-F3
triple-count), laundering/propagation (S31/B1-F7 — that is Fix-10's sweep),
stale citations (B1-F9), compressed quotes (B1-F11), completion over-claims
without a path (S29). Those classes need different mechanisms.

DESIGN — per-Write NEW-LINES-ONLY (the C4 anti-false-fire constraint, A5
cross-cutting #7: noisy enforcement trains seats to discount hooks):
  * Edit: lint only lines present in new_string and absent from old_string.
  * Write with a cache entry: lint only lines absent from the cached line-set.
  * Write creating a file (tool_response.type == "create"): all lines are new.
  * Write with NO cache and unknown/update type: line provenance is UNKNOWN —
    only FUTURE stamps may fire (old messages legitimately carry past stamps;
    never lint the whole file as if just written).
  * Past-divergence (>10 min behind the clock) fires ONLY on `### name (HH:MM)`
    message headers with known provenance — a backfilled header claims a
    write-time that never was (R13 retro rule). Past times in prose/status lines
    are treated as legitimate quotes of history and stay silent.
  * ISO/UTC evidence timestamps (HH:MM:SS, ...THH:MM, ...Z) are never stamps.
  * ADVISORY, NEVER DENY: exit 0 always; warnings go to the model via
    hookSpecificOutput.additionalContext with the real clock injected, so the
    writing seat sees its own future-stamp immediately. Fail open AND silent on
    any internal error — this lint must never block a write.

STATE: line-hash cache per target file under STAMP_LINT_STATE_DIR
(default ~/.claude/hooks/state/stamp-lint — durable, never /tmp).

ENV: STAMP_LINT_DISABLED=1 (skip) · STAMP_LINT_NOW="HH:MM" or ISO (pin clock,
tests) · STAMP_LINT_STATE_DIR (override cache dir, tests).
"""

import hashlib
import json
import os
import re
import sys
from datetime import datetime

TOLERANCE_MIN = 10
# FUTURE fires only inside this look-ahead window. The circular midnight wrap
# (23:58 -> 00:05 = +7) maps far-past stamps to large positive deltas; every
# observed future-stamp specimen was +10..+61 min, so beyond 6h "future" is far
# more likely a past stamp from earlier in the day than tomorrow's plan.
FUTURE_CAP_MIN = 360

# Target docs: collab/*.md, docs.local/weaves/*.md, docs.local/handoffs/**.md
# (each branch accepts relative paths too — Codex review on PR #502)
TARGET_RE = re.compile(
    r"(?:^|/)collab/[^/]+\.md$"
    r"|(?:^|/)docs\.local/weaves/[^/]+\.md$"
    r"|(?:^|/)docs\.local/handoffs/.+\.md$"
)

# HH:MM wall-clock token. Reject ISO/UTC evidence forms: no digit/T/: before,
# no :SS or Z after (2026-06-07T16:57:41Z is evidence, not a write-time stamp).
_HHMM = r"(?<![\dT:])([01]?\d|2[0-3]):([0-5]\d)(?!\s?[Z\d]|:)"
HHMM_RE = re.compile(_HHMM)
# `### name (... HH:MM ...)` message header — claims "this message written at HH:MM"
HEADER_STAMP_RE = re.compile(r"^#{1,6}\s+[^\n(]*\([^)]*" + _HHMM)
# parenthesized stamp anywhere: "(19:20)" / "(stamped 19:30 IDT)"
PAREN_STAMP_RE = re.compile(r"\([^)]*" + _HHMM + r"[^)]*\)")

# S22 artifact-existence: UPPERCASE status verb + numbers + absolute path token.
# Uppercase-only on purpose: status boards shout; prose "done" must not fire.
STATUS_RE = re.compile(r"\b(DONE|MERGED|COMPLETE|COMPLETED)\b")
PATH_TOKEN_RE = re.compile(r"(?<![:\w/])(?:~|/)(?:[\w.@-]+/)+[\w.@-]+")


def _now_minutes():
    pin = os.environ.get("STAMP_LINT_NOW", "")
    if pin:
        m = re.search(r"([01]?\d|2[0-3]):([0-5]\d)\s*$", pin)
        if m:
            return int(m.group(1)) * 60 + int(m.group(2)), m.group(0).strip()
    # Stamps in these docs are Asia/Jerusalem wall-clock by convention (R13);
    # compute "now" in the SAME timezone the warning prescribes, regardless of
    # the host process TZ (Codex review on PR #502). STAMP_LINT_TZ overrides.
    try:
        from zoneinfo import ZoneInfo
        now = datetime.now(ZoneInfo(os.environ.get("STAMP_LINT_TZ", "Asia/Jerusalem")))
    except Exception:
        now = datetime.now()  # fallback: host-local wall clock
    return now.hour * 60 + now.minute, now.strftime("%H:%M")


def _signed_delta(stamp_min, now_min):
    """Minimal circular distance in minutes, signed: + means stamp is in the
    FUTURE of the clock (handles the midnight seam)."""
    return (stamp_min - now_min + 720) % 1440 - 720


def _line_hash(ln):
    return hashlib.sha1(ln.encode("utf-8", "replace")).hexdigest()


def _cache_path(state_dir, file_path):
    return os.path.join(state_dir, hashlib.sha1(file_path.encode()).hexdigest() + ".lines")


def _read_cache(state_dir, file_path):
    """Cache is a MULTISET ('hash count' per line) so an appended DUPLICATE of an
    existing stamped/status line still counts as new (Codex review, PR #502)."""
    try:
        with open(_cache_path(state_dir, file_path)) as f:
            counts = {}
            for row in f.read().splitlines():
                parts = row.split()
                if not parts:
                    continue
                counts[parts[0]] = counts.get(parts[0], 0) + (
                    int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else 1
                )
            # empty/corrupted cache == missing cache: unknown provenance, never
            # "everything is new" (Bugbot review, PR #502)
            return counts or None
    except OSError:
        return None


def _write_cache(state_dir, file_path, lines):
    try:
        counts = {}
        for ln in lines:
            h = _line_hash(ln)
            counts[h] = counts.get(h, 0) + 1
        os.makedirs(state_dir, exist_ok=True)
        with open(_cache_path(state_dir, file_path), "w") as f:
            f.write("\n".join(f"{h} {c}" for h, c in sorted(counts.items())))
    except OSError:
        pass  # cache is best-effort; never fail the hook over it


def _multiset_new(lines, old_counts):
    """Lines beyond the multiset of previously-seen lines (order-preserving)."""
    avail = dict(old_counts)
    new = []
    for ln in lines:
        h = _line_hash(ln)
        if avail.get(h, 0) > 0:
            avail[h] -= 1
        else:
            new.append(ln)
    return new


def _was_create(payload):
    """Infer 'this Write created the file'. tool_response carries no create/update
    discriminator in documented payloads ({filePath, success} — Codex review,
    PR #502), so accept an explicit type field OR the classic 'File created
    successfully' response text. Unknown => conservative (future-only checks)."""
    resp = payload.get("tool_response") or {}
    if isinstance(resp, dict) and resp.get("type") == "create":
        return True
    try:
        text = resp if isinstance(resp, str) else json.dumps(resp)
    except (TypeError, ValueError):
        return False
    return "created successfully" in text.lower()


def _stamp_findings(new_lines, provenance_known, now_min, now_str):
    out = []
    for ln in new_lines:
        header = HEADER_STAMP_RE.search(ln)
        m = header or PAREN_STAMP_RE.search(ln)
        if not m:
            continue
        stamp_min = int(m.group(1)) * 60 + int(m.group(2))
        stamp = f"{m.group(1)}:{m.group(2)}"
        delta = _signed_delta(stamp_min, now_min)
        if TOLERANCE_MIN < delta <= FUTURE_CAP_MIN:
            out.append(
                f"FUTURE STAMP: line stamps {stamp} but the actual clock is "
                f"{now_str} ({delta:+d} min). Line: {ln.strip()[:120]!r}"
            )
        elif delta < -TOLERANCE_MIN and header and provenance_known:
            # backfilled message header presented as live (R13 retro rule)
            out.append(
                f"BACKFILLED HEADER STAMP: new message header stamps {stamp} but "
                f"the actual clock is {now_str} ({delta:+d} min). If this is "
                f"retro work, label it retro. Line: {ln.strip()[:120]!r}"
            )
    return out


def _artifact_findings(new_lines):
    out = []
    for ln in new_lines:
        if not STATUS_RE.search(ln) or not re.search(r"\d", ln):
            continue
        for tok in PATH_TOKEN_RE.findall(ln):
            tok = tok.rstrip(".,;:!?)'\"")
            if any(c in tok for c in "*$"):
                continue
            if not os.path.exists(os.path.expanduser(tok)):
                out.append(
                    f"STATUS LINE REFERENCES NONEXISTENT ARTIFACT: {tok} does not "
                    f"exist on disk — status lines are outputs, not plans (S22 "
                    f"invented-staging class). Line: {ln.strip()[:120]!r}"
                )
    return out


def main():
    if os.environ.get("STAMP_LINT_DISABLED") == "1":
        return
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        return
    if payload.get("tool_name") not in ("Write", "Edit"):
        return
    tool_input = payload.get("tool_input") or {}
    file_path = tool_input.get("file_path") or ""
    if not TARGET_RE.search(file_path):
        return
    if not os.path.isabs(file_path):
        # resolve relative tool paths against the session cwd (Codex review, PR #502)
        file_path = os.path.join(payload.get("cwd") or os.getcwd(), file_path)

    state_dir = os.environ.get(
        "STAMP_LINT_STATE_DIR",
        os.path.expanduser("~/.claude/hooks/state/stamp-lint"),
    )
    try:
        with open(file_path, encoding="utf-8", errors="replace") as f:
            current_lines = f.read().splitlines()
    except OSError:
        return

    # ---- NEW-lines-only resolution (never lint the whole file) ----
    provenance_known = True
    if payload.get("tool_name") == "Edit":
        old_counts = {}
        for ln in (tool_input.get("old_string") or "").splitlines():
            h = _line_hash(ln)
            old_counts[h] = old_counts.get(h, 0) + 1
        new_lines = _multiset_new(
            (tool_input.get("new_string") or "").splitlines(), old_counts
        )
    else:  # Write
        cached = _read_cache(state_dir, file_path)
        created = _was_create(payload)
        if cached is not None and not created:
            new_lines = _multiset_new(current_lines, cached)
        else:
            new_lines = current_lines
            # no cache + not a fresh create => lines may be old: future-only
            provenance_known = created

    _write_cache(state_dir, file_path, current_lines)

    now_min, now_str = _now_minutes()
    findings = _stamp_findings(new_lines, provenance_known, now_min, now_str)
    if provenance_known:
        # NEW-lines-only applies to the artifact check too: on an
        # unknown-provenance rewrite an old DONE line whose artifact has since
        # expired must not warn (Codex review, PR #502)
        findings += _artifact_findings(new_lines)
    if not findings:
        return

    context = (
        "STAMP-LINT WARNING (advisory, never blocking) — never-fabricate R13/R15: "
        "stamps are command output; run `TZ=Asia/Jerusalem date '+%H:%M'` and stamp "
        "the REAL time. " + " | ".join(findings[:5])
        + " | Scope note: this lint catches future/backfilled stamps and "
        "nonexistent-artifact status lines ONLY; it cannot validate measurements, "
        "propagation, or quotes."
    )
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PostToolUse",
            "additionalContext": context,
        }
    }))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # advisory lint: fail open and silent, never break the write
        sys.exit(0)
    sys.exit(0)
