"""Deterministic validator for a plan-council judge ballot."""

from __future__ import annotations

import re

DEFAULT_SENTINEL = "DONE_COUNCIL_R1"

_HEADING = re.compile(r"^(?P<marks>#{2,6})\s+(?P<title>.+?)\s*$", re.MULTILINE)
_TABLE_SEPARATOR = re.compile(r"^\|(?:\s*:?-+:?\s*\|)+\s*$")
_SIGNATURE_LINE = re.compile(
    r"^\s*[—-]\s*(?P<identity>[^·\n]+?)(?P<rest>\s*·\s*[^\n]+)\s*$",
    re.IGNORECASE | re.MULTILINE,
)
_FINDING_START = re.compile(
    r"(?im)^\s*(?:#{2,6}\s+|[-*]\s+)?(?:\*\*)?(?P<label>F\d+)\b"
)
_FILE_LINE = re.compile(
    r"(?:^|[\s\x60(])(?:[\w.-]+/)*[\w.-]+\.[A-Za-z0-9]+:\d+(?:-\d+)?(?:[\s\x60).,;]|$)"
)
_COMMAND = re.compile(r"(?i)\b(?:command|run|reproduce)\s*:\s*\x60[^\x60]+\x60")
_QUERY = re.compile(r"(?i)\bquery\s*:\s*\x60[^\x60]+\x60|\x60\s*(?:SELECT|PRAGMA|WITH)\b[^\x60]*\x60")
_TRACKER_REF = re.compile(
    r"(?i)(?:\bPR\s*#?\d+|\bissue\s*#?\d+|https?://\S+/(?:pull|issues)/\d+)"
)
_BACKTICK_LOCATOR = re.compile(
    r"\x60(?:(?:/|~/|\./|\.\./)[^\n\x60]+"
    r"|[^\n\x60]*\.(?:py|md|jsonl|json|swift|ts|sh)(?::\d+(?:-\d+)?)?[^\n\x60]*"
    r"|(?:git|ls|launchctl|python\d*|pytest|rg|grep|sqlite3|brainlayer)\b[^\n\x60]*)\x60",
    re.IGNORECASE,
)
_NAMED_LOCATOR = re.compile(
    r"(?i)\bPID\s+\d+\b|\b[A-Z][A-Z0-9_-]+\s+§[\w.-]+"
)
_VERDICT = re.compile(
    r"\b(?:NO-GO|CONDITIONAL\s+GO|GO(?:\s*\((?i:gated)\))?|BLOCK|HOLD|RESHAPE|RESCOPE|REDESIGN)\b"
)
_SENTINEL_LINE = re.compile(r"^DONE_[A-Z0-9_]+\s*$")


def _finding(rule: str, where: str, evidence: str, severity: str = "gate") -> dict:
    return {"rule": rule, "where": where, "evidence": evidence, "severity": severity}


def _plain(value: str) -> str:
    value = value.replace(chr(96), "").replace("**", "").replace("__", "")
    return re.sub(r"\s+", " ", value).strip()


def _header_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", _plain(value).casefold())


def _family(value: str) -> str | None:
    lowered = value.casefold()
    if "fable" in lowered:
        return "fable"
    if "codex" in lowered or re.search(r"\bsol\b", lowered):
        return "sol"
    if "opus" in lowered:
        return "opus"
    return None


def _lane_key(value: str) -> str:
    label = _plain(value).casefold().replace("wave ", "w")
    label = re.sub(r"\s+", " ", label).strip()
    normalized = re.sub(r"[^a-z0-9]+", " ", label).strip()
    match = re.match(r"w?(\d+(?:\.\d+)?(?:-r\d+|[a-z])?)\b", label)
    if not match:
        return normalized
    code = match.group(1)
    if code == "3a" and "source class" in normalized:
        return "3a source class"
    if "-r" in code or "." in code:
        return code
    if code == "3" and "precondition" in label:
        return "w3 preconditions"
    if code == "3" and "two-host" in label:
        return "w3 two-host"
    return normalized


def _sections(text: str):
    matches = list(_HEADING.finditer(text))
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        yield match.group("title").strip(), text[match.end():end]


def _tables(text: str):
    lines = text.splitlines()
    for index in range(len(lines) - 1):
        header_line = lines[index].strip()
        separator = lines[index + 1].strip()
        if not (header_line.startswith("|") and _TABLE_SEPARATOR.match(separator)):
            continue
        headers = [_header_key(cell) for cell in header_line.strip("|").split("|")]
        rows = []
        cursor = index + 2
        while cursor < len(lines) and lines[cursor].strip().startswith("|"):
            cells = [cell.strip() for cell in lines[cursor].strip().strip("|").split("|")]
            if len(cells) == len(headers):
                rows.append(cells)
            cursor += 1
        yield headers, rows


def _table_rows(text: str):
    for headers, rows in _tables(text):
        for cells in rows:
            yield headers, cells


def _index(headers: list[str], kind: str) -> int | None:
    if kind == "lane":
        matches = [i for i, header in enumerate(headers) if "lane" in header]
    elif kind == "score":
        matches = [i for i, header in enumerate(headers) if "score" in header]
        exact = [i for i, header in enumerate(headers) if header == "score"]
        if exact:
            return exact[0]
        return matches[0] if matches else None
    elif kind == "dimension":
        matches = [i for i, header in enumerate(headers) if "dimension" in header]
    elif kind == "weight":
        matches = [i for i, header in enumerate(headers) if header == "w" or "weight" in header]
    elif kind == "verdict":
        matches = [i for i, header in enumerate(headers) if "verdict" in header]
    else:
        matches = []
    return matches[-1] if matches else None


def _final_nonempty_line(text: str) -> str:
    return next(
        (
            line.strip()
            for line in reversed(text.splitlines())
            if line.strip() and not re.fullmatch(r"-{3,}", line.strip())
        ),
        "",
    )


def _first_content_is_table(text: str) -> bool:
    lines = text.splitlines()
    nonempty = [line.strip() for line in lines if line.strip()]
    if len(nonempty) >= 2 and nonempty[0].startswith("|") and _TABLE_SEPARATOR.match(nonempty[1]):
        return True
    start = 0
    for index, line in enumerate(lines):
        if re.match(r"^#{1,6}\s+", line):
            start = index + 1
            break
    substantive = []
    for line in lines[start:]:
        stripped = line.strip()
        if not stripped or re.match(r"^#{2,6}\s+", stripped):
            continue
        substantive.append(stripped)
        if len(substantive) == 2:
            break
    return len(substantive) == 2 and substantive[0].startswith("|") and bool(
        _TABLE_SEPARATOR.match(substantive[1])
    )


def _rubric(text: str) -> tuple[list[str], list[float]]:
    for heading, body in _sections(text):
        if "rubric" not in heading.casefold():
            continue
        dimensions, weights = [], []
        for headers, cells in _table_rows(body):
            dim_i, weight_i = _index(headers, "dimension"), _index(headers, "weight")
            if dim_i is None or weight_i is None:
                continue
            dimension = _plain(cells[dim_i])
            if not dimension or "total" in dimension.casefold():
                continue
            match = re.search(r"-?\d+(?:\.\d+)?", cells[weight_i])
            if match:
                dimensions.append(dimension)
                weights.append(float(match.group(0)))
        if dimensions:
            return dimensions, weights
    inline = re.search(
        r"(?is)rubric(?:\+weights)?(?:\*\*)?\s*:\s*(.+?)(?:\n\s*\n|\Z)",
        text,
    )
    if inline:
        pairs = re.findall(r"([^·;%\n]+?)\s+(\d+(?:\.\d+)?)%", inline.group(1))
        dimensions = [_plain(name).strip(" .;—-") for name, _ in pairs]
        return dimensions, [float(weight) for _, weight in pairs]
    return [], []


def _lane_scores_and_verdicts(text: str) -> tuple[dict[str, float], list[tuple[str, float]], dict[str, str]]:
    scores, parsed, verdicts = {}, [], {}
    for headers, cells in _table_rows(text):
        lane_i, score_i = _index(headers, "lane"), _index(headers, "score")
        if lane_i is None or score_i is None:
            continue
        lane = _plain(cells[lane_i])
        match = re.search(r"-?\d+(?:\.\d+)?", _plain(cells[score_i]))
        if not lane or not match:
            continue
        score = float(match.group(0))
        key = _lane_key(lane)
        scores[key] = score
        parsed.append((lane, score))
        verdict_i = _index(headers, "verdict")
        if verdict_i is not None:
            verdicts[key] = _plain(cells[verdict_i])
    return scores, parsed, verdicts


def _finding_blocks(text: str):
    starts = list(_FINDING_START.finditer(text))
    headings = list(_HEADING.finditer(text))
    for index, match in enumerate(starts):
        candidates = [other.start() for other in starts[index + 1:]]
        candidates.extend(
            heading.start()
            for heading in headings
            if heading.start() > match.start() and not re.match(r"(?i)^F\d+\b", heading.group("title"))
        )
        end = min(candidates) if candidates else len(text)
        yield match.group("label").upper(), text[match.start():end]


def _has_locator(finding: str) -> bool:
    return any(
        pattern.search(finding)
        for pattern in (
            _FILE_LINE,
            _COMMAND,
            _QUERY,
            _TRACKER_REF,
            _BACKTICK_LOCATOR,
            _NAMED_LOCATOR,
        )
    )


def _has_refuter(text: str) -> bool:
    return bool(re.search(r"(?i)\b(?:refute me with|falsifier)\s*:", text))


def _has_live_receipts(text: str) -> bool:
    if any("receipt" in heading.casefold() and body.strip() for heading, body in _sections(text)):
        return True
    return bool(
        re.search(
            r"(?im)^\s*(?:\*\*)?receipts?\b[^\n]*(?:verified|live|myself)",
            text,
        )
    )


def extract_seat_ballot(text: str, seat: str, sentinel: str) -> str:
    lines = text.splitlines()
    seat_pattern = re.compile(
        rf"(?i)^#{{2,6}}\s+(?:@council-)?{re.escape(seat)}\b"
    )
    headings = [
        i for i, line in enumerate(lines)
        if seat_pattern.search(line.strip())
    ]
    if headings:
        start = end = None
        for position, candidate_start in enumerate(headings):
            next_heading = headings[position + 1] if position + 1 < len(headings) else len(lines)
            candidate_end = next(
                (
                    i
                    for i in range(candidate_start, next_heading)
                    if lines[i].strip() == sentinel
                ),
                None,
            )
            if candidate_end is not None:
                start, end = candidate_start, candidate_end
        if end is None:
            raise ValueError(f"sentinel {sentinel!r} not found after seat {seat!r}")
    else:
        end = next(
            (i for i, line in enumerate(lines) if line.strip() == sentinel),
            None,
        )
        if end is None:
            raise ValueError(f"sentinel {sentinel!r} not found")
        prior = [i for i, line in enumerate(lines[:end]) if _SENTINEL_LINE.match(line.strip())]
        start = prior[-1] + 1 if prior else 0
        while start < end and (not lines[start].strip() or lines[start].strip() == "---"):
            start += 1
    return "\n".join(lines[start:end + 1]) + "\n"


def validate_ballot(
    text: str,
    lanes=None,
    author_seat: str | None = None,
    sentinel: str = DEFAULT_SENTINEL,
) -> list[dict]:
    violations = []
    lanes = lanes or []
    if not _first_content_is_table(text):
        violations.append(_finding("table-not-first", "first content block", "ballot must begin with its scorecard table"))
    dimensions, weights = _rubric(text)
    if len(dimensions) < 2:
        violations.append(_finding("missing-rubric", "Rubric", "declare multiple named rubric dimensions with weights"))
    if not weights or abs(sum(weights) - 100.0) > 0.5:
        violations.append(_finding("rubric-weights-not-100", "Rubric", f"parsed weight total is {sum(weights):g}, expected 100 ±0.5"))
    scores, parsed_scores, _table_verdicts = _lane_scores_and_verdicts(text)
    for lane in lanes:
        if _lane_key(lane) not in scores:
            violations.append(_finding("unscored-lane", lane, "required lane has no numeric score"))
    for lane, score in parsed_scores:
        if not 1 <= score <= 10:
            violations.append(_finding("score-out-of-range", lane, f"score {score:g} is outside 1-10"))
    finding_blocks = list(_finding_blocks(text))
    cited_labels = {
        label for label, finding_text in finding_blocks if _has_locator(finding_text)
    }
    if finding_blocks and not cited_labels:
        violations.append(
            _finding(
                "unfalsifiable-finding",
                "Findings",
                "no F-numbered finding carries a concrete locator",
            )
        )
    else:
        for label, _finding_text in finding_blocks:
            if label not in cited_labels:
                violations.append(
                    _finding(
                        "unfalsifiable-finding",
                        label,
                        "individual finding has no concrete locator",
                        severity="warning",
                    )
                )
    if not _has_refuter(text):
        violations.append(
            _finding(
                "missing-refuter",
                "Findings",
                "consider stating how a finding can be refuted",
                severity="warning",
            )
        )
    if not _has_live_receipts(text):
        violations.append(
            _finding(
                "missing-live-receipts",
                "Live receipts",
                "consider listing receipts the judge verified itself",
                severity="warning",
            )
        )
    if not _VERDICT.search(text):
        violations.append(
            _finding(
                "missing-conditional-verdict",
                "Verdict",
                "state at least one explicit ballot-level gating verdict",
            )
        )
    signatures = list(_SIGNATURE_LINE.finditer(text))
    signature = signatures[-1] if signatures else None
    valid_judge = bool(
        signature
        and re.fullmatch(r"(?i)R\d+", _plain(signature.group("identity")))
        and signature.group("rest").count("·") >= 2
    )
    if not valid_judge:
        violations.append(_finding("missing-family-signature", "signature", "use '— R<n> · <declared family> · …'"))
    if author_seat and signature and _plain(signature.group("identity")).casefold() == _plain(author_seat).casefold():
        violations.append(_finding("author-scored", "signature", "the plan author may not hold the signed voting seat"))
    if _final_nonempty_line(text) != sentinel:
        violations.append(_finding("missing-sentinel", "final line", f"ballot must end with {sentinel!r}"))
    return violations
