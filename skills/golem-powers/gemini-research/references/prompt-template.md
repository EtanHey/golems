# Research goal
<Question and decision to inform; keeping the current approach is an allowed outcome.>

# Grounding
Use ONLY the documents named below, all in this research's own curated folder <Drive R{NN}-grounding folder>, for project facts. Do not read the shared project corpus.
Pull these documents via the connected Drive workspace; never ask for attachments.
- "<Verified findings + struck claims document title>"
- "<Current project facts document title>"
Verified findings + struck claims: "<Verified findings + struck claims document title>"
Admission questions (author supplies one or more per document; no answers here):
| document | question |
| --- | --- |
| <Verified findings + struck claims document title> | <question from the verified findings file> |
| <Current project facts document title> | <question from the current facts file> |
Admission check (hard stop; project-grounded runs only, the web-only block below has none). Before any analysis, output this table, one row per
document/question pair, and fill every cell from actually reading the file:
| document | question | readable (yes/no) | first heading or line read | answer |
| --- | --- | --- | --- | --- |
Only an affirmative, verified read passes: `readable: yes` plus the heading or line
actually read and the answer to its admission question. The author checks every
answer and first-line string against a private key before accepting the result. Any other row (readable: no, blank, missing, empty, truncated,
unreadable) means that file failed: output only this table and a MISSING FILES
list, and stop.
Read the verified findings and struck claims first. Do not revive struck claims
without new primary evidence. If a named document is inaccessible, say so and
leave project-specific conclusions unknown; do not substitute similarly named docs.
For explicitly authorized web-only research, replace this entire block with the
following lines; otherwise remove this example before emitting:
None — web-only research
Verified findings + struck claims: N/A — web-only
Reason: <owner's reason that no project state is needed>

# Owner asks (verbatim)
"<Exact owner ask>" (<source/date>)
Separate hard constraints from open questions; permission to explore is not a
recommendation. Do not paraphrase asks into stronger requirements.

# Scope
<Domains, time window, alternatives, decision criteria and excluded tangents.>

# Evidence against
Actively seek evidence against the preferred approach and the premises in the
owner's question. Include keeping the current approach, failure cases and costs.
Report counterevidence even when it changes the recommendation.

# Evidence labels
Separate DOCUMENTED (shipped code/changelog/release), OBSERVED (dated recording or
reproducible test with setup), CLAIMED (vendor/reviewer assertion), and PROPOSED
(plans, requirements, design docs: intended, not shipped). A doc describing planned
behaviour is PROPOSED unless code, a changelog or a release shows it shipped.
Use TARGET for unmeasured goals. Keep unknowns separate from facts. Closed-app internals
remain unknown without evidence; a video cannot establish the implementation.

# Sources and numbers
Prefer primary sources. Link the exact passage or code revision, with date,
release, platform, license/attribution and current issue/PR state where relevant.
A URL existing does not prove its claim. Check that it supports the wording.
Every measured number needs source, hardware, dataset, method and units.
Recompute every worked example and arithmetic result before reporting it.
Label unmeasured goals TARGET, never RESULT. Do not transfer a
benchmark between platforms, model variants, workloads or metrics.

# Desired output
Findings table: claim | label (DOCUMENTED / OBSERVED / CLAIMED / PROPOSED / TARGET) |
source + setup | counterevidence | confidence. Separate recommendations and targets from measured results. List
unknowns, struck claims, missing deliverables and the next measurement plan.

# Pre-fire checks
Author-only preparation: --emit removes this entire section from the researcher
prompt. Send only the emitted text to Gemini or NotebookLM; retain this record.
Copy each exact first heading/line and answer from the real source into this
private JSON key (one row per admission question). Never include it in researcher
text. If an answer occurs elsewhere in the emitted text, choose another question.
```admission-key
[
  {"document":"<Verified findings + struck claims document title>","question":"<question from the verified findings file>","answer":"<exact verified answer>","first_line":"<exact verified first line>"},
  {"document":"<Current project facts document title>","question":"<question from the current facts file>","answer":"<exact current answer>","first_line":"<exact current first line>"}
]
```
For web-only research remove this key along with the admission questions/table.
The prompt author obtains two independent readers' bias checks before emitting
the prompt; each reads the prompt and grounding before seeing the other's review.
Record their identities, findings and how each finding was resolved below; only
then check the boxes. The validator checks structure, not review truth or quality.
- [ ] Bias check 1 (<reviewer-one>): <premise/confirmation-bias findings and disposition>
- [ ] Bias check 2 (<reviewer-two>): <source/attribution/measurement-bias findings and disposition>
Return the generated research plan to its prompt author for START / EDIT before
Start Research; rerun preflight and affected bias checks after substantive edits.
