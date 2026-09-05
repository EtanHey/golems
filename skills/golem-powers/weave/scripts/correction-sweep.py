#!/usr/bin/env python3
"""correction-sweep.py — Fix-10: the correction-propagation sweep (REPORT-only).

Why this exists (specimen S31 / B1-F7, weave 2026-06-07): a confessed-INVENTED
number ("47 sessions staged") was struck at its origin but a verbatim copy
survived in the retirement dump and reached the successor generation's boot
unannotated — laundering by literal copy. The prototype red-team's
APPLY-everywhere table did exactly this sweep once (2026-05-29) and was never
encoded (A4 §c.1, B-taxonomy M6/Fix-10).

What it does:
  Input  = a CORRECTIONS.md path + one or more target roots.
  For each §1 strike row, extract the struck literal strings (double-quoted
  text in the row's claim head, plus any `Strike "..."` instruction), grep
  them EXACTLY across the target trees, and emit a patched/not-patched table:

      file [line] | struck-string | ANNOTATED-or-RAW

  Exit codes: 0 = no un-annotated copy survives · 1 = >=1 RAW copy survives ·
  2 = usage/parse error (no §1 strike rows found, bad paths).

  REPORT-only: this script NEVER edits a file. Strikes stay human-applied
  (strike in place — strikethrough + pointer — never a silent edit).

ANNOTATED means (conservative, checkable, SAME line only):
  - the literal sits inside a ~~strikethrough~~ span on its line, OR
  - the hit line ITSELF carries a correction pointer token: "correction",
    "refuted", "struck", "superseded", "errata".
  Anything else is RAW. No neighbor-line credit: a pointer on an adjacent line
  must not clear an unstruck copy (fail CLOSED, A5 cross-cutting #2). The
  guard fails toward RAW (non-zero exit -> a human looks) rather than toward
  silently trusting a copy.

SCOPE LIMIT — stated honestly (B-adversary Fix-10 ruling: KEEP with scope
honesty): this sweep catches LITERAL-COPY laundering only. Derived-number
laundering ("~14 merges" -> 22 -> 42, or a struck count re-rendered in a new
sentence shape) escapes exact-literal grep BY CONSTRUCTION. That half is
closed by the canonical-source rule (the Fix-5 pairing): every load-bearing
number cites its source artifact, so a derived figure with no source cite is
challengeable on sight even when no grep can find it. Rows whose claim head
carries no exact literal are emitted as NO-LITERAL rows for MANUAL sweep —
they are surfaced, never silently dropped, but they do not gate the exit code.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

DEFAULT_EXTS = {".md", ".txt", ".html", ".json", ".jsonl", ".yaml", ".yml"}
EXCLUDE_DIRS = {".git", "node_modules", ".venv", "__pycache__", ".worktrees"}
# whole-word match: "unrefuted" must not satisfy "refuted" (Bugbot finding)
ANNOTATION_TOKEN_RE = re.compile(
    r"\b(?:corrections?|refuted|struck|superseded|errata)\b"
)
MIN_LITERAL_LEN = 6  # below this, exact-literal grep is noise, not evidence
MAX_BYTES_DEFAULT = 20 * 1024 * 1024

SECTION1_RE = re.compile(r"^##[^\n]*(?:§\s*1\b|\bREFUTED\b)", re.IGNORECASE)
# §1 ends ONLY at the next numbered corrections section (## §2 ...) — a quoted
# `## ` heading inside a strike row's body must not truncate the parse and
# silently drop later rows (Bugbot finding)
SECTION_END_RE = re.compile(r"^##[^\n]*§\s*\d")
ITEM_RE = re.compile(r"^\s*(\d+)\.\s")
BOLD_RE = re.compile(r"\*\*(.+?)\*\*", re.DOTALL)
QUOTED_RE = re.compile(r"[\"“]([^\"“”]+)[\"”]")
# everything after "Strike" up to the first period OUTSIDE quotes — quoted
# blocks are consumed whole so sentence-shaped struck literals keep their
# internal periods (`Strike "Done. All staged" in place` captures the full
# quote), and [^.] spans newlines so wrapped instructions still capture every
# quote (`Strike "A"\nand "B" in place` captures both)
STRIKE_INSTR_RE = re.compile(r"Strike\b((?:\"[^\"]*\"|“[^”]*”|[^.])*)")
ELLIPSIS_SPLIT_RE = re.compile(r"[;·…]")  # ; · …
STRIKETHROUGH_RE = re.compile(r"~~(.+?)~~")


def _collect_rows(body: list[str]) -> list[tuple[str, str]]:
    """Return [(row_id, row_text)] for the numbered strike rows of a §1 body."""
    rows: list[tuple[str, str]] = []
    current_id: str | None = None
    current: list[str] = []
    for line in body:
        m = ITEM_RE.match(line)
        if m:
            if current_id is not None:
                rows.append((current_id, "\n".join(current)))
            current_id = m.group(1)
            current = [line[m.end() :]]
        elif current_id is not None:
            current.append(line)
    if current_id is not None:
        rows.append((current_id, "\n".join(current)))
    return rows


def extract_literals(row_text: str) -> list[str]:
    """Struck literals: the FIRST quoted string in the bold claim head + every
    explicit `Strike "..."` instruction in the row.

    First-quote-only is a precision choice: in the §1 row shape ("wrong claim →
    where it lives → corrected truth") the head LEADS with the struck literal;
    later quotes in the head are context (e.g. §1.1 strikes the '~02:22 IDT'
    timing of a quote that is itself CONFIRMED — sweeping the confirmed quote
    would flag true copies as RAW, the exact false-fire noise that trains seats
    to discount hooks, A5 cross-cutting #7). Rows whose strikes are not
    quote-leading must carry a `Strike "..."` instruction or they surface as
    NO-LITERAL for manual sweep. Conservative: exact substrings only;
    ellipsis/semicolon-bearing quotes are split into their exact fragments."""
    candidates: list[str] = []
    head_match = BOLD_RE.search(row_text)
    if head_match:
        head_quotes = QUOTED_RE.findall(head_match.group(1))
        if head_quotes:
            candidates.append(head_quotes[0])
    for instr in STRIKE_INSTR_RE.findall(row_text):
        candidates.extend(QUOTED_RE.findall(instr))

    literals: list[str] = []
    for cand in candidates:
        parts = (
            [p.strip(" .,") for p in ELLIPSIS_SPLIT_RE.split(cand)]
            if ELLIPSIS_SPLIT_RE.search(cand)
            else [cand]
        )
        for part in parts:
            part = part.strip()
            if len(part) >= MIN_LITERAL_LEN and part not in literals:
                literals.append(part)
    return literals


def is_annotated(literal: str, lines: list[str], idx: int) -> bool:
    """SAME-line evidence only — a pointer token on a neighboring line must
    not clear an unrelated unstruck copy (Bugbot finding on the +/-1 window;
    fail CLOSED). Three rules, strictest first (Codex findings: the
    ALL-copies gate):
      1. every occurrence inside a ~~span~~          -> ANNOTATED
      2. SOME occurrences struck, others raw         -> RAW (the wrapping
         convention is in play on this line; an unwrapped duplicate beside a
         struck copy is exactly the laundering pattern — a pointer token must
         NOT rescue it)
      3. zero struck: pointer token OUTSIDE the literal itself AND exactly
         ONE occurrence on the line                  -> ANNOTATED
         (a single pointer cannot vouch for multiple raw duplicates, and a
         literal that happens to contain a token word — e.g. a struck claim
         with "superseded" in it — must not self-clear)"""
    line = lines[idx]
    total = line.count(literal)
    struck = sum(span.count(literal) for span in STRIKETHROUGH_RE.findall(line))
    if total and struck >= total:
        return True
    if struck:
        return False
    lowered = line.replace(literal, "").lower()
    return total == 1 and bool(ANNOTATION_TOKEN_RE.search(lowered))


def iter_target_files(roots: list[Path], exts: set[str], skip: set[Path]):
    for root in roots:
        if root.is_file():
            if root.resolve() not in skip:
                yield root
            continue
        for p in sorted(root.rglob("*")):
            if not p.is_file() or p.suffix.lower() not in exts:
                continue
            # exclusions apply to the path RELATIVE to the sweep root, so a
            # target that itself lives under e.g. .worktrees/ still gets swept
            if any(part in EXCLUDE_DIRS for part in p.relative_to(root).parts):
                continue
            if p.resolve() in skip:
                continue
            yield p


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description="Fix-10 correction-propagation sweep (REPORT-only, literal-copy class)."
    )
    ap.add_argument("corrections", type=Path, help="path to CORRECTIONS.md")
    ap.add_argument("roots", type=Path, nargs="+", help="target root(s) to sweep")
    ap.add_argument(
        "--ext",
        action="append",
        default=None,
        help="extra extension to scan (repeatable), e.g. --ext .py",
    )
    ap.add_argument("--max-bytes", type=int, default=MAX_BYTES_DEFAULT)
    args = ap.parse_args(argv)

    if not args.corrections.is_file():
        print(f"ERROR: corrections file not found: {args.corrections}", file=sys.stderr)
        return 2
    for r in args.roots:
        if not r.exists():
            print(f"ERROR: target root not found: {r}", file=sys.stderr)
            return 2

    rows = _collect_rows_from_file(args.corrections)
    if not rows:
        print(
            f"ERROR: no §1/REFUTED strike rows found in {args.corrections} — nothing to sweep.",
            file=sys.stderr,
        )
        return 2

    exts = set(DEFAULT_EXTS)
    if args.ext:
        exts.update(e if e.startswith(".") else "." + e for e in args.ext)

    row_literals: list[tuple[str, list[str], str]] = []
    for row_id, row_text in rows:
        lits = extract_literals(row_text)
        head = BOLD_RE.search(row_text)
        head_text = (head.group(1) if head else (row_text.splitlines() or [""])[0])[:90]
        row_literals.append((row_id, lits, head_text.replace("\n", " ")))

    skip = {args.corrections.resolve()}
    hits: list[tuple[str, int, str, str, bool]] = []  # file, line, literal, row, annotated
    skipped_big: list[str] = []
    unreadable: list[str] = []
    all_literals = [(rid, lit) for rid, lits, _ in row_literals for lit in lits]

    for f in iter_target_files(args.roots, exts, skip):
        try:
            if f.stat().st_size > args.max_bytes:
                skipped_big.append(str(f))
                continue
            lines = f.read_text(errors="replace").splitlines()
        except OSError as e:
            # fail CLOSED: an unreadable carrier is not a cleared carrier
            unreadable.append(f"{f} ({e})")
            continue
        for idx, line in enumerate(lines):
            for rid, lit in all_literals:
                if lit in line:
                    hits.append((str(f), idx + 1, lit, rid, is_annotated(lit, lines, idx)))

    raw_count = sum(1 for h in hits if not h[4])

    print("# correction-sweep — patched/not-patched table (REPORT-only)")
    print(f"# corrections: {args.corrections}")
    print(f"# targets: {', '.join(str(r) for r in args.roots)}")
    print(f"# strike rows: {len(rows)} · literals swept: {len(all_literals)}")
    print()
    print("| file [line] | struck-string | annotated-or-raw |")
    print("|---|---|---|")
    if hits:
        for path, lineno, lit, rid, annotated in hits:
            state = "ANNOTATED" if annotated else "RAW"
            print(f"| {path} [{lineno}] | {lit} (§1.{rid}) | {state} |")
    else:
        print("| (no copies of any struck literal found in the target set) | — | — |")
    print()

    no_literal = [(rid, head) for rid, lits, head in row_literals if not lits]
    if no_literal:
        print("## NO-LITERAL rows — MANUAL sweep required (derived/paraphrase class)")
        for rid, head in no_literal:
            print(f"- §1.{rid}: {head}")
        print(
            "- LIMIT: exact-literal grep cannot see derived numbers or re-worded"
            " claims; these rows need the canonical-source rule (numbers cite"
            " their source artifact) + a human pass."
        )
        print()
    if skipped_big:
        print("## SKIPPED (over --max-bytes) — not swept, not cleared")
        for s in skipped_big:
            print(f"- {s}")
        print()
    if unreadable:
        print("## UNREADABLE — not swept, not cleared")
        for s in unreadable:
            print(f"- {s}")
        print()

    annotated_count = len(hits) - raw_count
    print(
        f"## SUMMARY: {len(hits)} copies found · {annotated_count} ANNOTATED ·"
        f" {raw_count} RAW (un-annotated) · {len(no_literal)} NO-LITERAL rows"
    )
    if raw_count:
        print(
            "RESULT: FAIL — un-annotated copies survive. Strike them in place"
            " (never silent-edit) or record an explicit defer note, then re-run."
        )
        return 1
    if skipped_big or unreadable:
        # fail CLOSED: an unswept carrier is not a cleared carrier
        print(
            "RESULT: INCOMPLETE — some carriers were NOT swept (over"
            " --max-bytes and/or unreadable). Raise --max-bytes / fix"
            " permissions and re-run; an unswept carrier cannot be counted"
            " as clean."
        )
        return 1
    print("RESULT: PASS — every found copy is annotated.")
    return 0


def _collect_rows_from_file(path: Path) -> list[tuple[str, str]]:
    text = path.read_text(errors="replace")
    lines = text.splitlines()
    start = end = None
    for i, line in enumerate(lines):
        if start is None and SECTION1_RE.match(line):
            start = i + 1
        elif start is not None and SECTION_END_RE.match(line):
            end = i
            break
    if start is None:
        return []
    return _collect_rows(lines[start : end if end is not None else len(lines)])


if __name__ == "__main__":
    sys.exit(main())
