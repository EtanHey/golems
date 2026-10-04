# Routing restatement sweep — 2026-10-04

Status: PR 3a classifies baseline text and adds a gate. Pointer replacements remain
assigned to PRs 3b/3c. This inventory does not grant routing authority to any copy.

## Inventory

Baseline: `794413903835b458714b5ef57bdc68628fb99f7f`. The lead's 270-hit inventory
contains 266 golems hits across 101 files, plus four hits in two external files.
The baseline scan covers 321 tracked Markdown files, including archived skills.
This PR adds one inventory Markdown file, giving 322 files on its final head;
`agent-routing/**` keeps the existing SSOT exemption.

| Class | Hits | Treatment |
|---|---:|---|
| POINTER | 87 | Temporary `tag: "ssot-sweep"`; remove in assigned slice |
| DATA | 84 | Permanent, with historical/fixture/example reason |
| FUNCTIONAL | 25 | Permanent, with parser/frontmatter/guard-contract reason |
| FALSE POSITIVE | 70 | Permanent, with non-routing reason |

The CSV records every golems hit, its original line, a <=100-character excerpt,
classification, action/reason and slice. The allowlist has 264 exact marker rows
covering 266 occurrences; repeated identical markers carry explicit count caps.
Neither filename, timestamp nor model name alone determines an exemption.

External work for the lead (not edited here):

| Repo file | Baseline lines |
|---|---|
| skill-creator `AGENTS.md` | 199 |
| orchestrator `collab/TEMPLATE.md` | 131, 146, 147 |

## Gate use

From the golems checkout, run the same scan CI uses:

```bash
scans=()
while IFS= read -r -d '' file; do
  scans+=(--routing-scan "$file")
done < <(git ls-files -z 'skills/**/*.md')
node scripts/ci/canon-drift-lint.mjs --check \
  --routing-allowlist scripts/ci/routing-restatement-allowlist.json "${scans[@]}"
```

`--routing-allowlist` is explicit; existing raw `--routing-scan` and canon-only
`--check` behavior remains available. A hit must equal a trimmed marker line in
its named file. Extra occurrences fail. Every allowlist row must consume its
full count of actual scan hits, so removed/changed markers, deleted files and
omitted scan paths fail. Scan the full corpus when applying this baseline list;
for an isolated scan use an isolated list. Canon block hits cannot be allowlisted.

Line numbers can shift without changing exemptions. This gate retains the
existing line/clause detector: it catches detector-recognized new restatements,
not every possible paraphrase of routing policy. Scanner heuristics were not
changed in PR 3a.

## Pointer slice plan

| Slice | Families | Pointer hits | Editing budget |
|---|---|---:|---|
| 3b | pr-loop (19), coderabbit (9), cmux-agents (3) | 31 | <=400 handwritten changed lines |
| 3c | agada-bench (12), plan-council (12), skill-creator (10), large-plan (7), weave (5), codex-workflows (3), orc (3), collab-monitor (1), convention-audit (1), model-pin-gate (1), qa-video (1) | 56 | <=400 handwritten changed lines |

Budget method: contiguous paragraph/table/fence neighborhoods total 113 old
lines for 3b and 254 for 3c. Reserving one new pointer per hit gives estimated
handwritten totals of 144 and 310 lines, respectively. Generated
allowlist row removals are exempt from the handwritten budget. If a behavioral
issue or an unexpectedly broad rewrite appears, split that family again; do not
change tool contracts merely to remove a scan hit. Functional parser tokens and
agent frontmatter remain intact. Re-run the full gate after each slice so removed
temporary rows cannot linger.

## Detector follow-up proposal

70 hits are false positives. In a separate lint PR, consider clause boundaries
at Markdown table cells/headings/fences and distinguish bot command examples and
Blue Team terminology from model/role selection. Preserve wrapped assignment
coverage with RED counterexamples before narrowing the detector. Do not blanket
exempt an adapter, workflow or evidence directory.

## Verification coverage

- Entry points — Checked: imported `lintCanonDrift`, Node CLI, repeatable scan and new allowlist flag; existing symlink invocation test passes.
- Clients — Checked: CI shell array enumerates all tracked `skills/**/*.md`; raw scans retain old behavior.
- Providers — N/A: local filesystem linter has no service/model provider calls.
- Contracts — Checked: CSV columns, exact JSON markers/counts/classes/reasons/tags, malformed/duplicate rows, canon isolation.
- Reverse states — Checked: new hits, duplicate copies, changed/removed markers, omitted/deleted files, missing inputs and absent installed canon.
- Connection modes — Checked: installed canon is in sync locally; synthetic absent/drifted installs and Node/Bun invocation paths are tested. No network connection is needed by the linter.
- Docs — Checked: this inventory, CSV classification and workflow invocation explain the explicit gate and temporary debt.

The committed JSON proof records focused RED/GREEN and four caught mutations.
The remote PR body/report carries full-suite and exact-head CI results; local
checks alone do not establish hosted CI, review approval, merge or installation.
