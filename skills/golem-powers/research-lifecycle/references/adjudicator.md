# Independent adjudicator rubric

Status: required by VERIFY BEFORE STORE. One adjudicator for the report; different
model family from the section verifiers unless the lead named as step owner in
the coordinator brief explicitly
overrides that rule (record it and double the VERIFIED audit). Read-only except assigned outputs; no
subagents, installs, credential changes or memory writes.

## Queue and independence

Receive the fixed claim lists, original report sections/citations, section verdicts,
grounding corpus and exact code revision. Re-grade ALL WRONG/HALLUCINATED claims.
The coordinator also selects 85 VERIFIED claims (170 for an explicit same-family
override) uniformly at random without
replacement (all if fewer), records the seed, population and sampled IDs before
review, and sends a separate queue of decision-critical UNVERIFIABLE claims.
Never silently drop that unresolved queue or treat it as a VERIFIED audit.

Re-open each original source and classify exact framing as present,
attributed-spec or proposal. Reach a source-based judgment before comparing the
verifier's rationale; do not inherit its correction as gold. Read the full cited
page, including code blocks; confirm the supplied corpus/code baseline.
Use the [verifier rubric](verifier.md) verdict definitions. Report-owned designs
are PROPOSAL-OK, never VERIFIED. Check premises, arithmetic and any claim that a
supplied algorithm implements a behavior separately. Missing access stays
UNVERIFIABLE; an absent search result alone is not HALLUCINATED.

## Audit failure and partial completion

If the VERIFIED sample reveals a wrong pass, hold the affected section's facts
and expand review to all its VERIFIED claims before releasing that section.
The sample size is an audit policy, not proof that all remaining claims are true
or a population risk bound. Unaffected completed sections may proceed after their
audit closes. Keep unaudited/pending sections and decision-critical UNVERIFIABLE
premises out of fact storage and decisions that require them.

## Outputs and storage handoff

Write adjudication JSON/Markdown with one row per queued ID: `id`,
`verifier_verdict`, `framing`, `final_verdict`, `evidence`, `correction`,
`severity` (blocks/cosmetic), `recommendation_affected`, `baseline_revision`.
Validate exact queue coverage. Record every flip and its source evidence.

Write VERIFY-SUMMARY.md beside the report with report/revision hashes, model roles
and observed runtime models/effort, fixed-list coverage, initial/final counts for
all five verdicts, audit seed/IDs/population/expansions, unresolved decisions,
and evidence/output links. With factual denominator = total minus PROPOSAL-OK,
hallucination rate = HALLUCINATED / factual and error rate =
(WRONG + HALLUCINATED) / factual. Show numerators/denominators; use N/A when zero.
For partial work state completed/total coverage and label rates provisional.

Coordinator alone stores facts: VERIFIED from completed audited sections or
adjudication-resolved VERIFIED claims, with their evidence and baseline.
WRONG/HALLUCINATED may be stored only as corrections with the correct evidence,
never as the original false assertion. UNVERIFIABLE is never a stored fact.
PROPOSAL-OK stays in the report as a labeled proposal. For optional memory
retention, explicitly queue it for adjudication first and store it only as a
labeled proposal; never promote it to fact.
