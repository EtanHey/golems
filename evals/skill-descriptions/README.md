# W32 description trigger evaluation — lead r1 revision

Waiting for Etan's approval (dashboard decision 2); do not merge

The description truth pass rewrites 14 golems descriptions and repairs simple stale references. Library size is now **8,146 characters**, below the 8,202 budget by 56. Cursor retains #1224's T3 route; Gemini retains its no-NotebookLM description.

## Lead review r1 addressed
The six failing kickoff assertions pin an earlier measured trigger contract; calling them “retired literal text” was wrong. large-plan, agent-routing and pr-loop now retain **every pinned phrase and the before-any-git/gh requirement**, plus a trigger before starting another agent/dispatch. The kickoff test is unchanged. All 43 kickoff/ruling tests now pass; the description-cap suite also passes (8/8).

large-plan is 209 characters (cap 250), agent-routing 256 (cap 278), and pr-loop 145 UTF-16 code units / 144 Unicode characters (cap 156). **The large-plan and agent-routing text now differs from the Opus-measured descriptions.diff version. The revised text was re-measured on Haiku 5.5; historical Opus results are not evidence for this new wording.**

Cap-contract change retained: only large-plan gains a pinned exception at 250; default CAP remains 120. drive-filing's obsolete exception is removed because it fits 120. No assertion was loosened. Etan's decision 2 approval is still pending.

## Fresh r1 trigger evaluation
Haiku 5.5, API-key auth, one rep, catalog pinned to d6e82669fb231347945b49dc232a321e1174b3a4. Just these three skills were re-run: two original report positives and one near miss each, plus 16 full-turn kickoff/dispatch positives covering the pinned phrases. Baseline catalog versus final candidate catalog: 50 cells. Report-positive loads 1/6 → 2/6; report near-miss loads 0/3 → 0/3; added kickoff/dispatch-positive loads 13/16 → 13/16.

All 50 cells passed startup audit, API-key provenance and key-leak checks; no execution errors. r1 spend **$0.160830860**; mission cumulative **$0.356736255 / $2.00**, including initial smoke and the initial 86-cell run. The child-visible $0.05 cap was identical between batch arms; effort was not pinned. Admission reserved $0.10 per in-flight cell against cumulative spend. No real worker was dispatched.

| Skill | Report positives before → after | Near misses before → after | Added kickoff/dispatch positives before → after |
|---|---:|---:|---:|
| large-plan | 1/2 → 1/2 | 0/1 → 0/1 | 4/5 → 4/5 |
| agent-routing | 0/2 → 0/2 | 0/1 → 0/1 | 4/6 → 5/6 |
| pr-loop | 0/2 → 1/2 | 0/1 → 0/1 | 5/5 → 4/5 |

Trigger selection on real API calls with stub dispatch is measured; temporal ordering before actual git/gh execution and skill-body behavior are not measured. Near-miss labels come from the reports and may conflict with broad kickoff requirements. One rep is exploratory. Original cases are remeasurements, not independent additional observations to pool with the initial pass. The initial pass and adverse receipts remain in w32-* files; w32-r1-* files identify the revised three-skill evidence. The 11 other rewritten skills retain their initial-pass results; they were not re-run in the revised catalog.


## Local verification
- Kickoff/ruling suites: 43 pass, 0 fail, 278 assertions. Test file unchanged; prior six-failure receipt retained privately.
- Description cap: 8 pass, 0 fail; 51/51 combined local tests, 297 assertions.
- Skill library: OK skills=59 description_chars=8146 estimated_tokens=2037 max_description=plan-council:455
- Routing lint: in-sync, ok=true, routing hits=0, stale exemptions=0.
- Both v1 case files validate; git diff --check passes.
- Full package suite and exact-head hosted CI: not claimed by these local checks. The PR remains a draft awaiting decision 2 and lead disposition; do not mark ready.

## Scope and follow-ups
Four non-golems skills remain out of scope: anatomy, linear, emil-design-eng, improve-animations. cursor-workflows retains #1224; optional accurate unslop trim is skipped. gemini-research keeps its no-NotebookLM description.

Packaging/helper follow-ups: audio-dashboard eval/fixtures; brain-store-fallback fixtures and pain-points pointer; false-green-gate evals; frustration-capture hook test corpus; install-runbook-linter tests/fixtures; deploy-verify's missing Claude-catalog helper route.

Simple reference fixes already included: session-handoff JSONL field-map path, whats-new registry path, dead query-only /braindrive pointers in drive-filing and gemini-research. research-lifecycle still needs a separate executable contract repair: lifecycle-gate.mjs and its fixtures require /braindrive in resolvedWith, so replacing only the prose would leave the gate inconsistent.

The existing unchanged kickoff assertions are the guard for the r1 defect: the prior candidate failed six; revised descriptions pass all 43. Verdict: ITERATE. Current trigger selection still has misses. pr-loop regressed on the added CI/review-comments kickoff turn (5/5 → 4/5 added positives overall); agent-routing gained one added dispatch load. Passing the static tests is not a SHIP verdict.

Reduced receipts and source manifests: w32-r1-results.jsonl, w32-r1-surfaces.json. Cases: w32-r1-cases.jsonl. Initial artifacts remain historical. Raw transcripts are retained privately and SHA-256 pinned in reduced receipts; extracted public data is not independent custody proof.
