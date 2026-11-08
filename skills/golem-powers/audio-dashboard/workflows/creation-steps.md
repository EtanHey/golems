# Creation steps — intake to Lakebed delivery

Invoke `/audio-dashboard creation-steps`, then read this file completely.
The installed catalog exposes `/audio-dashboard` through its top-level SKILL.md;
`creation-steps` selects this linked workflow, not a separately registered command.
This is the ONE ordered creation procedure. SKILL.md and its references supply
field definitions and gate runbooks; orc supplies the intake, never another procedure.

Run builder commands from the installed audio-dashboard skill directory. Replace
angle-bracket placeholders with the job's actual paths; use absolute job paths.
Use the SAME `<job-dir>` for synthesis, BUILD and both evidence commands below.
Keep jobs, populated receipts, QA and media in private local storage, never commits.
Every nonzero command or non-PASS gate stops advancement. The intake/author/manual-QA
stop labels below are workflow checks, not claims of implemented runtime gates.

## 1. Intake

Command: read the filled relay block (`cat <relay.md>`) and its source material.
Orc hands the builder this skill/workflow plus exactly the information to build:

```yaml
content_brief_or_source_material: <brief, paths or links>
deadline: <date, time and timezone>
dashboard_id: <stable id>
operation: <new | maintenance of this existing id>
accepted_receipt_path: <latest accepted spec/design receipt>
accepted_receipt_sha256: <sha256 of that receipt>
extra_instructions_verbatim: <Etan's exact words, or explicitly none>
```

Pass: every field is filled, source material is readable, and the new/maintenance
identity is unambiguous. Preserve the receipt's delivery route, bridge contract,
accepted artifact/predecessor and permitted media configuration for the handoff.
skill-creator owns the instructions, template and gates; NarrationLayer owns
Lakebed publishing. Orc only relays content and extra instructions.

Stop: `INTAKE_INCOMPLETE` for a missing/unreadable field or conflicting id;
return the specific gap to the lead. `OWNER_UNAVAILABLE`: report BLOCKED with
the accepted URL; restore the owner path, never substitute a tailnet mirror.

## 2. Load the baseline

Command: `cat <accepted-receipt>` and `shasum -a 256 <accepted-receipt>`;
read the accepted job/design and served predecessor identified by that receipt.
Set `acceptedBaseline: { path, sha256 }` in the job (path relative to the job
file, or absolute). Match the relay's latest accepted receipt hash.
Set `design.lineage` to `briefings` for nightly/eod/commute/huddle. Load its accepted
history under `~/.local/share/audio-dashboard/design-history/lineages/briefings/`.
For registry loss or another machine, set `designPreservation.previousPublished`
to a local copy of the accepted served HTML (relative to outputPath's directory).
An existing lineage head wins; a supplied predecessor must match it.

Pass: acceptedBaseline is verified; the accepted design and predecessor are
readable and agree with the lineage. A new dashboard id still uses that lineage.
Never use `--first-build` on `briefings`. A genuinely separate new product lineage
requires the named owner's first-in-lineage approval under publish contract v2;
do not invent approval or reset a briefing lineage to finish a job.

Stop: `ACCEPTED_BASELINE_RECEIPT_REQUIRED`, `PREVIOUS_BUILD_MISSING`,
`DESIGN_PREDECESSOR_CONFLICT`, `DESIGN_LINEAGE_RESET_REFUSED`,
`FIRST_IN_LINEAGE_UNAPPROVED`: recover the accepted receipt/predecessor or route
the actual new-product approval to the owner. Never waive a missing baseline.

## 3. Author

Command: edit `<job.json>` with the builder's editor, then parse it with
`bun -e 'JSON.parse(await Bun.file(process.argv[1]).text())' <job.json>`.
Start from the accepted job/spec, keeping its design and baseline binding.
Set `id` from Intake and `outputPath` to a repo `docs.local/dashboards/<id>.html`
source, never a served tree; author `scenes` and `decisions` using SKILL.md's job schema.

- Set explicit `type: "decision-flow"`; use cinema only on explicit request.
  Keep heading at most eight words and context in subtitle. Preserve the accepted design.
- Use two voices in separate scenes: host `ben-c1` asks a short question, expert
  from `GOLEMS_EXPERT_VOICE` explains with its registered profile. Declare each
  scene's host/expert role and reference; never speak role labels such as
  "Ben asks:", "Expert:", "Q:" or "A:". Define internal terms before asking for a decision.
- Place each decision card RIGHT AFTER the explainer card it depends on; never batch decisions at the end.
  Order the cards and their owned `sceneIds` together; every scene has exactly one owner.
- The card’s visible prose is what the audio says, or the card says plainly that
  the audio is a summary. Compare the entire visible prose to its owned scripts;
  do not silently shorten the narration. Reference-only sources/prompts stay separate.
- Put research prompts in `copyPrompt.text`, with a descriptive `label` and
  `notes` stating whether Google Docs/Drive must be on and whether research-lifecycle has run.
  Add `sources: [{ label, url }]` links so the Sources drawer is available.
  Never assume lifecycle ran; state its actual status and link supporting sources.
- Keep commands/pasteable paths in copyable code fences and repository-qualified
  PR/issue references as links. Use stable decision/answer ids for maintenance.

Pass: JSON parses, each rule above is checked against the actual card/scene order,
prose/scripts, voice profiles and research fields, and existing answer identities survive.

Stop: `AUTHORING_REVIEW_FAILED` (workflow check) requires fixing the specific
order, text/audio or research-note mismatch before synthesis. `SINGLE_VOICE_BUILD`,
`voice-role-inverted`, `ROLE_LABEL_SPOKEN`, `ROLE_LABEL_MISMATCH`,
`COPY_BLOCK_REQUIRED` require correcting the job, never bypassing the gate.
Enforcement forward pointer: X2 owns decision-after-explainer gates; X3 owns card-text/audio gates (separate PRs).

## 4. Synthesize

Command: `bun scripts/bootstrap.mjs --require-tts`, then
`bun scripts/synth-segments.mjs --spec <job.json> --job-dir <job-dir>` in a persistent session.
Spoken-form normalization is automatic on synth input; display text stays as
authored. Do not manually phoneticize the visible script. Retain the exact
`.spoken.txt`, immutable `words.raw.json`, repaired `words.json`, WAV and mp3.
Changed scripts need fresh audio; for a changed or rejected TTS scene run:

```bash
bun scripts/synth-segments.mjs --spec <job.json> --job-dir <job-dir> --resynth-scene <scene-id> --no-cache
```

Pass: dependencies pass and every scene has fresh matching audio and real
STT-after-TTS word timing; no estimated/even-split timing. Check audio freshness
against the changed scripts, not just artifact existence.

Stop: bootstrap/synth nonzero, `MISSING_SYNTH_PROVENANCE_SERIES`,
`SYNTH_PROVENANCE_STALE`, `TAIL_TRUNCATION`, `PHONEME_CRITICAL_SUBSTITUTION`:
repair the dependency or reroll only the failing TTS scenes without cache.
For BYO audio, replace/edit `audioWav` and rerun timing; cache rerolls cannot fix it.

## 5. BUILD

Command: `bun scripts/build-dashboard.mjs --spec <job.json> --job-dir <job-dir>`, then
`bun scripts/check-design-preservation.mjs --spec <job.json> --screenshots <proof-dir>`.

Pass: every BUILD gate is PASS in `<output-basename>.receipts.json`, bound to
the current HTML, including voice-role, transcript-fidelity, acoustic,
onset-energy, teleprompter-drift, answer-persistence, copy-blocks and
design-preservation. For the accepted briefing design, the design report is
PASS with status COMPARED, never BASELINE. An explicitly approved redesign uses
the contract's REDESIGN/REDESIGN_APPROVED admission and predecessor-bound approval.
Never use `--first-build` on `briefings`.

Stop: any REJECT/nonzero, including `TELEPROMPTER_DRIFT`,
`ONSET_ENERGY_ABSOLUTE_RMS_DBFS`, `ONSET_ENERGY_PEAK_DELTA_DB`,
`DURATION_WORD_ABSOLUTE_BACKSTOP`, `HIGH_F0_VOICED_FRAME_ABSOLUTE_BACKSTOP`,
`COPY_BLOCK_REQUIRED`, `REDESIGN_SCOPE_MISMATCH` and step 2/3 codes. Follow the
typed gate's runbook: reroll bad TTS takes, regenerate timing or restore the
accepted design, then rerun BUILD. Never weaken thresholds or ship stale HTML.

## 6. QA

Command: `bun vendor/qa/verify-decision-flow.mjs <html>` (explicit cinema:
`bun vendor/qa/verify-cinema.mjs <html>`), then open the built page in the approved
test browser and listen while exercising its controls.

Pass: verifier succeeds; check play/pause, real read-along, word-click seek,
Restart, Next/Skip, end-of-section transcript, response fields and copy/export.
Check desktop and narrow layout, badge contrast, keyboard/focus, Sources links,
copyPrompt's exact copied text and visible notes. Inspect card order and listen
to verify the host/expert separation and prose/audio match or explicit summary.
Record actual observations and any NOT_RUN; local fallback is not hosted sync proof.

Stop: `QA_REJECTED` or `MANUAL_QA_FAILED` (workflow check): fix the observed
defect, resynthesize changed scripts, then repeat BUILD and QA. Missing live QA
is NOT_RUN, never an inferred PASS from static tests.

## 7. Prepare publish

Command: `bun scripts/validate-evidence.mjs --spec <job.json> --job-dir <job-dir> --prepare-publish`.
This also prepares media from that job directory's real `segments/` tree.

Pass: READY_FOR_HOSTED_PUBLISH plus `<output-basename>.publish-handoff.json`,
prepared source directory, media/asset manifest and bound BUILD/design receipts.
This is pre-publish readiness, never delivery PASS. Read [publish contract v2](../references/publish-contract-v2.md).

Stop: `PUBLISH_HANDOFF_BUILD_REJECTED`, `PUBLISH_HANDOFF_DESIGN_REJECTED`,
`PUBLISH_HANDOFF_DESIGN_CHANGED`, `PUBLISH_HANDOFF_SOURCE_CHANGED`,
`ACCEPTED_BASELINE_RECEIPT_REQUIRED`, `SEGMENTS_DIR_REQUIRED`, `QA_REJECTED`,
`EVIDENCE_SOURCE_CHANGED`: restore matching inputs, rebuild/re-QA and prepare
again. Any subsequent byte change invalidates this handoff.

## 8. Handoff to NarrationLayer

Command: hand NarrationLayer the job, HTML, BUILD/design receipts, publish handoff,
prepared source directory and media manifest. NarrationLayer runs its sanctioned
publisher's `--check` command first, then stages, proves the account and promotes
the SAME candidate under [publish contract v2](../references/publish-contract-v2.md).
Use the publisher entry point supplied by NarrationLayer; never improvise a deploy
command in the builder. If it is unavailable, stop rather than publish directly.

Pass: NarrationLayer checks identity/source/admission and uses `unlisted-candidate`
for a new id or `in-place-maintenance` for an existing accepted id. Maintenance
retains the previous shell for rollback and preserves existing answers.
Prove a disposable note round trip: signed-in independent client, server ack,
restoration after browser-local pending keys are cleared, and probe cleanup.
Only after that proof promote the same candidate and return the Lakebed URL and
`<output-basename>.delivery.json`. Account failure rolls maintenance back.
Tailnet is media fallback/redirect only, never a dashboard shell or delivery proof.

Stop: failed `--check`, `MAINTENANCE_REQUIRED`, `MAINTENANCE_PREVIOUS_SHELL`,
`MAINTENANCE_DESIGN`, `INVALID_STAGING_MODE`, `PROVIDER_NOT_READY`,
`SAVED_LOCAL_ONLY`, `MISSING_ACCOUNT_SYNC_PROOF`: NarrationLayer repairs its
admission/provider/staging or rolls back; builder never substitutes device-only answers.

## 9. Validate delivery

Command: `bun scripts/validate-evidence.mjs --spec <job.json> --job-dir <job-dir> --delivery <receipt.json>`.

Pass: verdict PASS (exit 0), matching hosted URL/id/source, approved local HTTPS
origin, current answer runtime, staging/account proof and predecessor admission.
Only PASS advances accepted lineage history. Keep the validation output as the
PASS receipt beside the publisher delivery receipt.

Stop: `MISSING_DELIVERY_CONFIG`, `MISSING_HOSTED_DELIVERY`,
`MISSING_ACCOUNT_SYNC_PROOF`, `BUILD_RECEIPTS_SHA_MISMATCH`,
`DELIVERY_DESIGN_MISMATCH`, `EVIDENCE_SOURCE_CHANGED`: correct the named
configuration or bound evidence with NarrationLayer, then revalidate.
PASS_DEPRECATED_RUNTIME (exit 5) requires rebuilding the current runtime;
BACKFILL_ACCOUNT_PROVEN (exit 4) records history only. Neither earns acceptance.

## 10. Report

Command: read the delivery receipt and validation output (`cat <receipt.json> <validation-output>`);
report the URL, PASS receipt path and what changed to the lead.

Pass: the report names the accepted Lakebed URL, validated PASS evidence and
concrete content/design changes, including any remaining limitations. Keep
private receipt contents out of public reports. Delivery attestation is checked;
the validator neither authenticates its issuer nor repeats the live account test.

Stop: `DELIVERY_NOT_PASS` (workflow check) for a missing or non-PASS final receipt:
report BLOCKED with the exact failing code and owner; resume at that step.
Never describe BUILD or READY_FOR_HOSTED_PUBLISH as delivered.
