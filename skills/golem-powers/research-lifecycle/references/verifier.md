# Section verifier rubric

Status: required by VERIFY BEFORE STORE. Read-only verification; no subagents,
installs, credential changes or memory writes. Write only the assigned outputs.

## Inputs and fixed claim inventory

The coordinator supplies the harvested report, one section, its citation appendix,
a fixed numbered claim list, accessible grounding documents, and a pinned code or
corpus revision. Freeze that inventory before grading; do not select a different
list for another verifier. Each item has an ID, an exact quote and report location,
category and factual premises/recommendations depending on it. Flag extraction
mistakes separately; never silently paraphrase or weaken a claim to verify it.
Missing evidence or a baseline mismatch means UNVERIFIABLE, not a guessed answer.

## Check each claim from sources

- Products/repos/people: existence, ownership, license, features and availability.
- Numbers: recompute arithmetic on the exact inputs; check units, hardware,
  versions, dates, prices and benchmark comparison columns.
- APIs and behavior: check official documentation and the pinned implementation.
- Citations/quotes: open the actual cited source, including code blocks and
  relevant surrounding text. A source existing does not prove its attribution.
- Our docs/code: open the supplied corpus and revision; cite file:line and SHA.
  Do not substitute today's checkout for the research baseline.

Record present-state, attributed-spec or proposal framing from the exact words.
A report's own recommendation, proposed threshold or new design is PROPOSAL-OK,
not a false present-state assertion. Verify its factual premises separately.
Assertions that a supplied algorithm actually implements a behavior remain
checkable: proposal framing does not excuse an arithmetic or algorithmic defect.
Ambiguous proposal/present framing is UNVERIFIABLE pending clarification.

## Verdicts

| Verdict | Required evidence |
|---------|-------------------|
| VERIFIED | Fetched source or pinned file confirms the literal factual claim, not merely a weaker related claim |
| WRONG | Thing exists but its detail is incorrect; provide the correct fact |
| HALLUCINATED | Fabricated entity/quote/source, or an attribution absent from the cited source after reading it fully |
| UNVERIFIABLE | Cannot confirm or refute; record attempts, missing access and baseline ambiguity |
| PROPOSAL-OK | Report-authored proposal/spec; label as a proposal and record any separately checked premises |

Failure to fetch is not proof that something does not exist. Never verify from
memory or a search snippet alone. Record evidence actually opened, fetch date and
revision. Reconcile every input ID exactly once, including unresolved claims.

## Outputs

Write the assigned section JSON array and Markdown table. Each row carries
`id`, `claim`, `report_location`, `category`, `framing`, `verdict`, `evidence`,
`correction` (or null), `recommendation_impact` (or null), `baseline_revision`.
The table includes counts, coverage and unresolved dependencies. Validate JSON
and exact ID coverage before reporting completion. No brain_store from this leg.
