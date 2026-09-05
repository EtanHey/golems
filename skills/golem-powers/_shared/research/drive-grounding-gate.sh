#!/usr/bin/env bash
set -euo pipefail

# drive-grounding-gate.sh — mechanical emit-gate for the DRIVE-WORKSPACE RULE.
#
# Etan's Gemini AND Claude research surfaces have his Google Drive WORKSPACE
# CONNECTED. Every deep-research prompt must REFERENCE the relevant Google
# Doc(s) by NAME so the agent pulls them itself via the Drive connector.
# A prompt must NEVER instruct Etan to attach / upload / drag files into the
# research surface — he should never have to attach anything.
#
# This gate scans an EMITTED deep-research prompt (the text that gets pasted
# into Gemini / Claude Desktop / Claude Web) for that forbidden language.
# It FAILS (exit 1) on any violation so the prompt is rewritten to
# reference-by-name before it is emitted.
#
# Usage:
#   drive-grounding-gate.sh <prompt-file>        # scan a file
#   echo "<prompt text>" | drive-grounding-gate.sh -   # scan stdin
#   drive-grounding-gate.sh --json <prompt-file>  # machine-readable verdict
#
# Exit codes: 0 = PASS (no attach/upload language), 1 = FAIL, 2 = usage error.

JSON=0
SRC=""

usage() {
  cat <<'EOF'
Usage: drive-grounding-gate.sh [--json] <prompt-file | ->

Scans an emitted deep-research prompt for forbidden attach/upload/drag
language. PASS means the prompt grounds itself by referencing Drive docs
by NAME (the connected Drive workspace surfaces them), never by telling
Etan to attach or upload files.

Exit: 0 PASS · 1 FAIL (violations printed) · 2 usage error
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --json) JSON=1; shift ;;
    --help|-h) usage; exit 0 ;;
    -) SRC="-"; shift ;;
    *) SRC="$1"; shift ;;
  esac
done

if [[ -z "$SRC" ]]; then
  usage >&2
  exit 2
fi

if [[ "$SRC" == "-" ]]; then
  CONTENT="$(cat)"
elif [[ -f "$SRC" ]]; then
  CONTENT="$(cat "$SRC")"
else
  echo "drive-grounding-gate: file not found: $SRC" >&2
  exit 2
fi

# Detection is negation-aware and CLAUSE-level (not naive substring matching):
#   - A PROHIBITION is compliant, not a violation. "do NOT attach", "nothing to
#     attach or upload", "reference by name, never upload" all PASS — they tell
#     Etan NOT to attach, which is exactly the rule.
#   - Matching is per-clause so a benign clause cannot mask a violating one on the
#     same line. "attach the file and save to context/" still FAILS on the first
#     clause; the trailing storage phrase does not whitewash it.
#   - The only benign form of an attach-verb is STORAGE upload ("upload ... to
#     Drive / to prompts/ / to results/"). `attach` and `drag` have no benign
#     form in an emitted prompt, so they always violate unless negated.
DGG_CONTENT="$CONTENT" python3 - "$JSON" <<'PY'
import json, os, re, sys

JSON = sys.argv[1] == "1"
content = os.environ.get("DGG_CONTENT", "")

# A forbidden instruction aimed at the user.
ATTACH   = re.compile(r'\battach\w*', re.I)
DRAG     = re.compile(r'\bdrag\b', re.I)
UPLOAD   = re.compile(r'\bupload\w*', re.I)
DROPFILE = re.compile(r'\bdrop(?:s|ped|ping)?\s+(?:the|your|these|this|a|an)\s+(?:\w+\s+)?(?:file|doc|document|folder)\b', re.I)
ADDFILE  = re.compile(r'\badd(?:s|ed|ing)?\s+(?:the|your|these|this|a|an)\s+(?:\w+\s+)?(?:file|doc|document|attachment|folder)\b', re.I)

# Prohibition / negation context. It only shields a forbidden verb when it
# governs that verb's local phrase; an unrelated prohibition before "and" must
# not shield a later instruction ("do not search and attach the file").
NEG = re.compile(r"\b(no|not|never|n't|do not|don't|does not|doesn't|without|"
                 r"nothing|none|avoid|instead of|rather than|no need|needn't|"
                 r"cannot|can't|won't|will not|shouldn't|should not)\b", re.I)

# Benign STORAGE upload (saving back to Drive / project folders, or the MCP API).
BENIGN_UPLOAD = re.compile(
    r'upload\w*[^.;,\n]*\b(to|into)\b[^.;,\n]*'
    r'(drive|the project|prompts?/|results?/|context/|folder)|source_add', re.I)
PHRASE_BOUNDARY = re.compile(r'\b(?:and(?:\s+then)?|but|then|while|yet)\b', re.I)
FORBIDDEN_PATTERNS = (ATTACH, DRAG, UPLOAD, DROPFILE, ADDFILE)
POST_NEGATED_OBJECT = re.compile(
    r'^\s*(?:nothing\b|none\b|no\b(?:\s+\w+){0,3}\s+'
    r'(?:files?|docs?|documents?|attachments?|folders?|anything)\b)', re.I)
POST_NEGATION_EXCEPTION = re.compile(
    r'^\s*(?:but|except|other\s+than|besides?)\b', re.I)

def clauses_with_lineno(text):
    # Yield (lineno, clause) splitting each line on clause boundaries so a benign
    # clause can't shield a violating clause sharing the same physical line.
    for ln, line in enumerate(text.splitlines(), 1):
        for clause in re.split(r'[;.]|,(?=\s)', line):
            if clause.strip():
                yield ln, clause

def is_negated(clause, match):
    prefix = clause[:match.start()]
    # Coordinating/sequencing conjunctions begin a new instruction phrase. `or`
    # intentionally remains in scope so "nothing to attach or upload" passes.
    boundaries = list(PHRASE_BOUNDARY.finditer(prefix))
    if not boundaries:
        prefix_negated = NEG.search(prefix) is not None
    else:
        last_boundary = boundaries[-1]
        local_prefix = prefix[last_boundary.end():]
        prefix_negated = NEG.search(local_prefix) is not None

        if not prefix_negated:
            # Preserve a prohibition across a compound forbidden action such as
            # "do not drag and drop the file", without allowing an unrelated
            # action such as "do not search and attach" to shield attachment.
            prior_prefix = prefix[:last_boundary.start()]
            prior_segment = PHRASE_BOUNDARY.split(prior_prefix)[-1]
            prefix_negated = (
                NEG.search(prior_segment) is not None
                and any(pattern.search(prior_segment) for pattern in FORBIDDEN_PATTERNS)
            )

    if prefix_negated:
        return True

    # Postpositive prohibitions govern the verb's direct object: "attach
    # nothing" and "upload no files". Do not accept exception phrases such as
    # "attach nothing but the report", which still request an attachment.
    suffix = clause[match.end():]
    post_match = POST_NEGATED_OBJECT.match(suffix)
    return (
        post_match is not None
        and POST_NEGATION_EXCEPTION.match(suffix[post_match.end():]) is None
    )

def violates(clause):
    for pattern in (ATTACH, DRAG, DROPFILE, ADDFILE):
        for match in pattern.finditer(clause):
            if not is_negated(clause, match):
                return True
    for match in UPLOAD.finditer(clause):
        if not is_negated(clause, match) and not BENIGN_UPLOAD.search(clause):
            return True
    return False

viols = []
seen = set()
for ln, clause in clauses_with_lineno(content):
    if violates(clause):
        key = (ln, clause.strip())
        if key not in seen:
            seen.add(key)
            viols.append(f"{ln}:{clause.strip()}")

count = len(viols)
if JSON:
    print(json.dumps({"gate": "drive-grounding", "pass": count == 0,
                      "violation_count": count, "violations": viols}))
elif count == 0:
    print("✅ drive-grounding-gate PASS — no attach/upload/drag instruction; "
          "prompt references Drive docs by name (prohibitions like 'do not attach' are fine).")
else:
    sys.stderr.write(f"❌ drive-grounding-gate FAIL — {count} clause(s) instruct attach/upload/drag.\n")
    sys.stderr.write("   The Drive workspace is CONNECTED. Reference the doc(s) by NAME instead.\n")
    sys.stderr.write("   Offending clauses:\n")
    for v in viols:
        sys.stderr.write(f"     {v}\n")

sys.exit(1 if count else 0)
PY
