---
name: audio-dashboard
description: "Build audio narration dashboards. Triggers: STT-after-TTS exact word-timing, real word-click-seek read-along dashboard, AfterCode workflow, publish-to-tailnet delivery."
---

# Audio Dashboard

## Purpose

This is the one canonical golem-powers skill for audio narration dashboards, and
it is **self-contained and transferable**: the whole engine is vendored under
`vendor/` and driven by skill-local scripts under `scripts/`. Runtime/build paths
do NOT clone or reach into `$NARRATIONLAYER_ROOT`, `$AGENT_HTML_ROOT`, or
`$SKILL_CREATOR_ROOT`; the opt-in maintenance lint reads only the checkout named
explicitly by `NARRATIONLAYER_UPSTREAM`.
The only external requirements are machine-local binaries/daemon (verified by
`scripts/bootstrap.mjs`) and the environment-specific tailnet publish/probe step.

The invariant: never ship read-along timing from WPM math, line duration, fake
words, placeholder recap text, or old GolemPlaylist generators. A correct
dashboard keeps immutable raw Whisper `words.raw.json` for gates, separate
script-first repaired `words.json` for display, real transcript text, and
word-click seek to the clicked timestamp.

## When To Use

Use this for:
- AfterCode read-along dashboards.
- Narration dashboards that need exact word highlights or word-click seeking.
- Regenerating a broken audio dashboard that drifted, restarted, or showed
  placeholder/meta transcript text.
- Publishing an audio dashboard to the tailnet hub.

Do not use this for listen-only podcasts with no teleprompter requirement.

## Dashboard Types

The skill exposes two separate types through the same timing, evidence, and
tailnet pipeline. They share audio primitives, not presentation templates.

### Type: `cinema`

Use the default cinema type for narrated digests and story-mode briefings. Omit
`spec.type` or set `"type": "cinema"`. It stays on the vendored V4 renderer at
`vendor/agent-html/templates/v4-story-mode/`: a global Play-All story surface,
Q/A scenes, read-along teleprompter, and optional decision boxes appended below.

### Type: `decision-flow` — audio decision dashboard

Use decision-flow for questionnaires and batches of decisions. Its user-facing
name is **audio decision dashboard**. Set
`"type": "decision-flow"`. Its standalone template lives in
`templates/decision-flow/` and does not render or overwrite cinema. Each
decision is one self-contained ledger card whose `sceneIds` own all of that
card's audio. The card-local play button runs those clips in order, keeps the
real-word-timed teleprompter open while playing or paused, and collapses it only
when that decision's full section completes. Word clicks seek within the section
and retain the normal clip-to-clip flow. Next and Skip acknowledge the action,
advance to the following card, and autoplay it. Picks and free text persist under
the per-dashboard key `dbx:<spec.id>`, so a new dashboard ID cannot inherit an
older dashboard's answers; Copy answers exports paste-ready markdown.
Each card also exposes **↻ Restart**, which restarts that decision's audio and
teleprompter section from the beginning without advancing to another card.

Decision-flow is parallel to cinema, not a replacement. Cinema remains the
pure-listening narrated-digest/story surface with global Play-All. A decision
dashboard may set `cinemaUrl` to expose a small **Cinema listening mode** link to
its parallel rendition.

Author decision-flow narration for the operator, not for the agents who coined
the vocabulary: **assume the listener has zero prior context**. On first use,
define every internal term, codename, and agent-coined label in plain language
inside the narration itself, including what happened, why it matters, and what
changes between the options. Never ask the operator to decide on unexplained
jargon or rely on a separate plan, collab log, dashboard card, or glossary to
make the audio understandable.

Decision-flow fails closed unless every scene is owned by exactly one decision.
This keeps audio and questions woven together and prevents a cinema-style global
audio strip / separate question list from reappearing.

## Vendored Engine (what makes it portable)

Everything the pipeline needs is inside the skill:

| Concern | Skill-local file |
|---|---|
| TTS runner (fail-closed voice-profile gate, qwen3 daemon, `splitForBreathing`) | `vendor/narrationlayer/local-tts-runner.ts` (+ `profiles.ts`, `text-normalize.ts`) |
| Spoken-form/pronunciation overlay (synth input only) | `vendor/narrationlayer/pronunciation.yaml` + `pronunciation-config.ts` |
| STT-after-TTS word timing | `vendor/narrationlayer/word-timings.ts` (`runWhisperCliWordTimings`) |
| DP alignment / repair to script tokens | `vendor/narrationlayer/word-timing-repair.ts` (`normalizeWordTimingsForScript`) |
| Cinema renderer (Q/A, Play-All, teleprompter, `.note-area`) | `vendor/agent-html/lib/render-v4.mjs` + `vendor/agent-html/templates/v4-story-mode/` |
| Decision-flow renderer (ledger cards, card-local audio, answers) | `src/decision-flow.mjs` + `templates/decision-flow/` |
| Cinema QA | `vendor/qa/verify-cinema.mjs` |
| Decision-flow QA | `vendor/qa/verify-decision-flow.mjs` |
| Evidence gate | `src/audio-dashboard-evidence.mjs` |
| Acoustic artifact + onset-energy BUILD gates | `src/acoustic-artifact-gate.mjs` |
| Teleprompter drift BUILD gate | `src/teleprompter-drift-gate.mjs` |
| Transcript-fidelity BUILD gate | `src/transcript-fidelity-gate.mjs` |
| BUILD receipts sidecar | `src/build-receipts.mjs` |
| Rejected-take cache purge | `src/take-cache.mjs` |
| Narration vendor provenance + two-way drift lint | `vendor/narrationlayer/VENDOR-VERSION` + `scripts/lint-narration-vendor-drift.mjs` |
| Orchestration | `scripts/synth-segments.mjs`, `scripts/build-dashboard.mjs`, `scripts/bootstrap.mjs`, `scripts/validate-evidence.mjs`, `scripts/verify-tailnet-publish.mjs`, `scripts/audio-dashboard-generator.mjs` |

## Canonical Pipeline

Run these skill-local entries for the AfterCode read-along path (all relative to
this skill dir):

1. **Bootstrap** — `bun scripts/bootstrap.mjs` verifies bun, ffmpeg/ffprobe,
   whisper-cli + model, and the qwen3 daemon. It FAILS LOUD (never silent) if a
   hard dependency is missing.
2. **Synthesize + time** — `bun scripts/synth-segments.mjs --spec <job.json>`.
   For each scene it runs the vendored `local-tts-runner.ts` (`splitForBreathing`
   cadence, fail-closed voice-profile gate) to produce the WAV, transcodes an mp3,
   runs `runWhisperCliWordTimings` on the WAV, then DP-aligns the audio words to
   the script tokens with `normalizeWordTimingsForScript`. This is the exact
   STT-after-TTS step. It writes immutable raw Whisper `words.raw.json` plus a
   separate repaired display `words.json` (`{index,word,start,end}`) per segment
   and **refuses to ship estimated/even-split timing** (exits nonzero
   if alignment matches zero script words, or whisper returns nothing).
   BYO-audio: a scene may set `audioWav` to an existing real speech WAV to skip
   TTS (no daemon needed) and still get real STT timing.
   When using voice profile names in `reference`, set
   `NARRATIONLAYER_PROFILES_FILE` to the machine-local profiles YAML, or set
   `NARRATIONLAYER_ROOT` so the vendored runner can find profiles. Long
   synth/render runs must run inside a persistent session or detached daemon, not
   a backgrounded shell job that dies with the terminal.
   If the acoustic or onset-energy gate flags a TTS segment, re-roll only that
   segment with cache disabled:

   ```bash
   bun scripts/synth-segments.mjs --spec <job.json> --resynth-scene <segment-id> --no-cache
   ```

   This is mandatory for flagged TTS re-synths: cache-hit re-synth returns the identical glitched take,
   which is a silent false-green. For a flagged BYO
   segment, replace or edit its `audioWav` source instead; `--no-cache` cannot
   repair operator-supplied audio. BUILD attempts the frozen-take purge when
   acoustic-artifact, onset-energy, or transcript-fidelity rejects TTS audio and
   emits the authoritative `PURGED`, `MISSING`, `SKIP`, or `ERROR` outcome; the
   same boundary records `SKIP` for BYO audio even if a stale TTS receipt exists.
   `--resynth-scene` implies `--no-cache`; keep the explicit flag in TTS
   runbooks so the intent is visible. The TTS runner
   clears any old WAV-to-key receipt before an attempt and commits a new receipt
   atomically only after the selected take validates, so a failed reroll cannot
   rebind stale audio to a new cache key.
3. **Render** — `bun scripts/build-dashboard.mjs --spec <job.json>` routes by
   `spec.type`. The default `cinema` path renders the vendored `render-v4.mjs`
   cinema-with-answers; `decision-flow` renders the separate skill-local ledger
   template. Both use real
   per-word timing (`realWordTiming: true`), embedding each mp3 as a data URI,
   and writes the durable HTML to `spec.outputPath` (a repo
   `docs.local/dashboards/*.html` source). It refuses to write into a
   `dashboards-serve` tree. It also fails closed if rendered timing no longer
   exactly preserves `words.json` word spans, if word spans overlap/go backward,
   or if `abs(tpdata.total - ffprobe(mp3).duration) > 0.5s`.
   If the job spec includes a non-empty `decisions` array, this step also renders
   skill-local decision/answer boxes natively before writing HTML. The native
   surface uses `dbx:<spec.id>` as its default localStorage key, persists radio
   picks plus free text, and includes a Copy-answers markdown export so answers
   are never localStorage-only. Optional answer harvest is exposed via
   `spec.answerSink` or `spec.decisionSurface.answerSink`.
   BUILD runs four fail-closed gates before writing HTML: transcript fidelity
   compares RAW Whisper words to the script, the Acoustic Artifact Gate checks
   duration and pitch invariants, onset energy checks the opening WAV window,
   and teleprompter drift compares RAW Whisper words to the final rendered
   `tpdata`. A bad take cannot be hidden by repaired display words.
   Every gate upserts a BUILD row in `<output-basename>.receipts.json`; the
   schema-v1 sidecar includes the HTML SHA-256, portable engine disclosure,
   thresholds used, typed violations, and completed cache purges. It contains
   no absolute paths or host identity and survives a REJECT even though the HTML
   is withheld.
4. **QA** — run the verifier for the selected type:
   `bun vendor/qa/verify-cinema.mjs <html>` or
   `bun vendor/qa/verify-decision-flow.mjs <html>`. Both report scene/word
   coverage and monotonicity; decision-flow additionally verifies exact scene
   ownership, card-local controls, answer persistence, and the absence of a
   cinema/global Play-All surface.
5. **Evidence gate** — `bun scripts/validate-evidence.mjs --spec <job.json>
   [--published "<sync cmd>"]` runs `src/audio-dashboard-evidence.mjs` against the
   real rendered dashboard + job dir. Note: the gate only returns **PASS** once
   publish evidence is supplied via `--published` (the tailnet-sync invariant);
   without it the gate correctly reports `REJECTED: MISSING_TAILNET_SYNC` with
   every other invariant passing. Run it after step 6, or pass `--published`
   with the sync command you will run / did run.
6. **Publish + probe (env-specific)** — write stays in the repo
   `docs.local/dashboards/`, then run the tailnet sync
   (`$ORCHESTRATOR_ROOT/scripts/sync-tailnet-dashboards.mjs`) and immediately
   verify the served artifact with `scripts/verify-tailnet-publish.mjs --spec
   <job.json> --base-url <tailnet dashboards URL>`. The probe requires HTTP 200
   and matching served HTML bytes. Never copy into `dashboards-serve` directly.

The reference interaction shape is the cinema-with-answers lineage (Q/A section
structure, Play-All, read-along teleprompter, `.note-area` response textareas with
localStorage persistence so Wispr/VoiceBar can dictate into the focused input).

## Spoken-Form and Pronunciation Config

The vendored engine loads `vendor/narrationlayer/pronunciation.yaml` before each
TTS request. It collapses same-line spaced capitals (`P R` → `PR`) and then
applies the map, so ecosystem expansions are config rather than authoring hacks:

```yaml
acronyms:
  PR: "pull request"
  QA: "quality assurance"

heteronyms:
  live streams: "lyve streams"
```

The format matches `~/.voicelayer/pronunciation.yaml`: a top-level category with
indented `term: "pronunciation"` entries. To add or replace per-install terms,
set `NARRATIONLAYER_PRONUNCIATION_FILE` to one or more path-delimited YAML files.
The shipped file loads first and later files override earlier entries
case-insensitively. A configured file that is missing, malformed, or empty fails
synthesis loudly.

Expansions and respells ride the ENGINE channel only. The renderer, repaired
`words.json` display series, and every teleprompter continue to receive the
original scene script. This is the B11 two-channel law: `pull request` or `lyve`
may enter the daemon input and `.spoken.txt`, but `P R` or `live` remains on
screen exactly as authored.

The TTS runner persists `.spoken.txt` as required provenance containing the exact
synth-input bytes. STT repair derives only the lexical spans that differ between
that transcript and the authored display script, then treats those spans as
approved aliases when attaching real Whisper timings to display tokens. The raw
Whisper series remains untouched; transcript fidelity checks the synth transcript,
and teleprompter drift accepts only the derived aliases. A missing or empty synth
transcript fails the TTS pipeline rather than falling back to estimated timing.

Context-dependent heteronyms currently use exact context phrases, longest first.
The shipped `live` examples cover the real s9q broadcast phrases while leaving
the /lɪv/ sense (“I live in Riverton”) untouched. Add a new phrase explicitly for
a new context; this is intentionally narrower than linguistic disambiguation.
The engine does **not** automatically read `~/.voicelayer/pronunciation.yaml`:
full shared-file wiring is the spec-gated B8 unification and remains out of scope
until that contract is ratified. An install may explicitly point at a compatible
overlay in the meantime.

## AfterCode Workflow

Dry-run the exact skill-local plan:

```bash
bun scripts/audio-dashboard-generator.mjs --workflow aftercode --dry-run
```

Run it in a persistent session after setting the machine-local environment (for
example `NARRATIONLAYER_PROFILES_FILE`, qwen3 daemon token, and the tailnet
dashboard base URL), and only when bun, whisper CLI, the qwen3 daemon, and the
job spec are ready:

```bash
bun scripts/audio-dashboard-generator.mjs --workflow aftercode --run --spec <job.json> --tailnet-base-url <tailnet dashboards URL>
```

The wrapper stays thin. It delegates to the **vendored** engine + skill-local
orchestration scripts, never to private engine checkouts.

### Job spec

`--spec` points at a JSON job (see `examples/job.json`):

```json
{
  "id": "my-dashboard",
  "title": "…", "kicker": "…", "heading": "…", "subtitle": "…",
  "outputPath": "$REPO_ROOT/docs.local/dashboards/my-dashboard.html",
  "scenes": [
    { "id": "c1q", "domain": "comms-layer", "title": "Q1 · …",
      "reference": "host-voice", "role": "host", "script": "…" },
    { "id": "c1a", "domain": "overview", "title": "…",
      "reference": "expert-voice", "role": "expert", "script": "…" }
  ],
  "decisions": [
    { "id": "ship-path", "title": "Ship path", "deadline": "today",
      "body": "Choose the path forward.", "options": ["Option A", "Option B"] }
  ]
}
```

`reference` is a registered voice profile name OR a direct `.wav` reference clip
path. A scene may also carry `audioWav` (existing WAV) for a daemon-free BYO run.
`decisions` is optional; when present it must be a non-empty array of
`{id,title,body,options,deadline?}` records, with `options` allowed to be empty
for free-text-only decisions.

For decision-flow, `decisions` is required and must be a non-empty array. Add
the type plus explicit scene ownership: every scene must appear in exactly one
decision's non-empty `sceneIds` array.

```json
{
  "type": "decision-flow",
  "id": "six-decisions",
  "title": "Six decisions",
  "outputPath": "$REPO_ROOT/docs.local/dashboards/six-decisions.html",
  "cinemaUrl": "./six-decisions-audio.html",
  "scenes": [
    { "id": "d1q", "title": "Question", "script": "…" },
    { "id": "d1a", "title": "Trade-off", "script": "…" }
  ],
  "decisions": [
    { "id": "d1", "rank": 1, "title": "Decision one", "status": "OPEN",
      "body": "Choose the path.", "options": ["Option A", "Option B"],
      "sceneIds": ["d1q", "d1a"],
      "rail": [{ "label": "Owner", "value": "Operator" }] }
  ]
}
```

## Bootstrap

Three dependency classes cannot travel inside a skill and must exist on the host.
`scripts/bootstrap.mjs` verifies them and FAILS LOUD with install hints — it never
silently falls back to estimated timing or system TTS.

**HARD (required for any real dashboard — STT + render):**
- `bun` — runs the vendored `.ts` engine (`curl -fsSL https://bun.sh/install | bash`)
- `ffmpeg` + `ffprobe` — transcode / duration (`brew install ffmpeg`)
- `whisper-cli` — STT word timings (`brew install whisper-cpp`)
- a whisper model — e.g. `~/.cache/whisper/ggml-large-v3-turbo.bin` (or set
  `NARRATIONLAYER_WHISPER_MODEL`)

**TTS-only (required only to synthesize NEW audio; BYO-audio needs none):**
- a reachable qwen3 TTS daemon (default `http://127.0.0.1:8880`)
- the daemon auth token (`~/.voicelayer/daemon.secret`)
- voice profiles — set `NARRATIONLAYER_PROFILES_FILE` (a `profiles.local.yaml`) or
  `NARRATIONLAYER_ROOT`, OR pass a direct `.wav` `reference` (no profiles needed).
  Voice profiles + their reference clones are inherently machine-local and are NOT
  vendored.

```bash
bun scripts/bootstrap.mjs            # exit nonzero if any HARD dep missing
bun scripts/bootstrap.mjs --require-tts   # also gate the daemon/token
```

## Acceptance Gate

**Gate: `scripts/render-done-gate-cli.mjs` — runs before DONE.** Before emitting a
"render done / give it a play / here's the mp3" message, replay the turn through
`bun skills/golem-powers/audio-dashboard/scripts/render-done-gate-cli.mjs <transcript|->`
(exit 3 = FLAG). It requires the SAME-TURN composite probe — `ls` + `ffprobe`
(size>0, duration>0) of the **claimed** mp3, plus a registered cloned voice
(fail-closed on a missing profile or a silent system-TTS fallback). The artifact
must be where it is claimed: a file-on-disk at the claimed path is enough, and an
HTTP-200 or an embedded-clickable player is required only when the claim points the
listener at a **served** surface (dashboard / URL). A FLAG means the claim is not
yet earned: run the missing probe, then claim. Full rule table and RED/GREEN
provenance: `references/render-done-gate.md`.

Before calling a dashboard done, verify these conditions (enforced by
`src/audio-dashboard-evidence.mjs` via `scripts/validate-evidence.mjs`):

- A cinema deliverable uses `render-v4.mjs` through `build-dashboard.mjs`, with
  Q/A sections, Play-All, read-along teleprompter, and `.note-area` response
  textareas. A decision-flow deliverable uses `src/decision-flow.mjs` plus
  `templates/decision-flow/`, with no global Play-All strip and exactly one
  owning card per scene. Missing answer-writing areas is a hard rejection for
  either type. Do not generate multiple replacement designs unless the operator
  explicitly asks for design exploration.
- The HTML includes per-section response capture: `.note-area` textareas,
  `data-note`/`data-title` metadata, localStorage save/restore, and copy/export.
- `words.raw.json` and `words.json` exist per segment. Every entry has a
  non-empty string `word` plus finite numeric `start` and `end`; raw words feed
  gates while repaired words feed display, and both timing series are monotonic.
- The dashboard declares real word timing (`realWordTiming: true`).
- Clicking a word seeks audio to that word's timestamp (must not restart the
  segment or reload the audio).
- The visible transcript is the real script/transcript, not placeholder text.
- The durable output path is a repo `docs.local/dashboards/*.html` file.
- Tailnet publication happens through sync, not direct writes to
  `dashboards-serve`.

## Transcript Fidelity and Teleprompter Drift BUILD Gates

`src/transcript-fidelity-gate.mjs` compares the raw Whisper transcript with the
script before HTML emission. It rejects strict tail prefixes or missing script tails as
`TAIL_TRUNCATION`, and rejects materially different, length-preserving long-word
substitutions as `PHONEME_CRITICAL_SUBSTITUTION`; adjacent material errors are
aggregated without losing either piece of evidence.
The substitution rule is calibrated on 33 fresh real WAV decodes: all 31 clean
scenes pass while the `s9q` `overnight`→`Overtime,` and `s13a`
`websocket`→`WebSeaCut` incidents reject. Regenerate the portable receipt with
`bun evals/generate-transcript-fidelity-calibration.mjs --job <job.json> --out
evals/fixtures/calibration/2026-07-17-fable-blind-weave-transcript-fidelity.json`.
Confidence is evidence, not a rejection threshold. A BYO scene without `script`
stays fail-closed as `SCRIPTLESS_SCENE_UNSUPPORTED` with a runbook to add the
script; a NOT_APPLICABLE verdict class remains a specification question.
Other transcript violations use the TTS fresh-take runbook only for TTS scenes;
a BYO violation instead requires replacing or editing its `audioWav` source.
Failures carry segment, source kind, metric, value, threshold, evidence, and an
actionable runbook.

`src/teleprompter-drift-gate.mjs` is also a BUILD publish blocker. It compares
the final rendered teleprompter words to `words.raw.json` across the whole
transcript, aligns contraction/split/merge lexical blocks before comparing
timing boundaries, coalesces canonical expansions after lexical fallback, and
includes tolerated substitute steps in timing comparison so a changed tail word
cannot bypass drift measurement. It weights the final third so accumulated tail
drift fires.
The banked GREEN fixture from
`GREEN-FIXTURE-insync-2026-07-06` is copied into
`evals/fixtures/green/03-teleprompter-drift-insync.json`; the paired RED fixture
skews only the final third so a head-only check cannot false-green it. The gate
also has a latency eval and must stay under the <5s stop-class budget.

Typed failures use the plain-language `TELEPROMPTER_DRIFT` name and a positive
runbook: regenerate the segment with real STT word timings, rebuild, then rerun
the drift gate.

## Voice Roles — Ben HOSTS, Theo EXPLAINS

> Public voice-role contract: **Ben is the HOST. Theo is the EXPERT. Ben asks,
> Theo explains unless a job explicitly overrides the roles.**

`src/voice-role-gate.mjs` owns this as two constants — `HOST_VOICE = "ben"`,
`EXPERT_VOICE = "theo"` — and nothing else in the build path may re-state it.
They are PERSONS, not profile ids: a person owns many profiles over time
(`theo-c4`, `theo-c4s`, `theo-n4a`), so pinning an id would rot on the next
cadence experiment while the ruling would not have changed.

A scene is gated when it declares BOTH a `role` of `host`/`expert` AND a voice
(`reference` or `profile`). The person is read from the profile prefix
(`ben-c1` -> `ben`). A contradiction **REJECTS the build** — it does not warn —
and it rejects on the SPEC, before synthesis, because an inversion is knowable
from the job file alone.

Why this gate is not redundant with the others: every other gate measures the WAV
or the transcript, and **both are perfectly consistent with the wrong voice saying
the right words.** `--role` reaches the TTS runner as informational only
(`local-tts-runner.ts:151`, "No engine effect"), so before this gate `role` was
decorative and the two fields could disagree forever. They did, twice, in
published dashboards.

**Override — stated, never inferred.** For the ~10%, set `voiceRoleOverride` on the
scene, or `voiceRoleOverrides: { "<sceneId>": "<reason>" }` on the job. The value
must be a non-empty reason, so the receipt records *why* the ruling was set aside,
not merely that it was. A blank string is not an override. An override on one
scene never excuses another.

## BUILD Receipts Sidecar

`build-dashboard.mjs` writes one schema-v1 sidecar next to the intended HTML:
`foo.html` pairs with `foo.receipts.json`. The writer owns the BUILD rows for
`voice-role`, `transcript-fidelity`, `acoustic`, `onset-energy`, and
`teleprompter-drift`, keyed by gate plus stage. `voice-role` is written first
because it runs pre-synthesis. `onset-energy` is the
fourth additive BUILD row; bridge admission's initial three-row expected set remains
compatible until its per-install config opts into the new row. PASS HTML is
bound by SHA-256. REJECT rows are written before
nonzero exit and retain the rendered-candidate hash while the rejected HTML is
withheld. D6d purges store only cache key, segment, reason, and ISO timestamp.
SYNTH, EVIDENCE, PUBLISH-SYNC, and BRIDGE-ADMISSION append their own rows when
those stage writers land; absence is never silently treated as PASS.

## Acoustic Artifact Gate

`build-dashboard.mjs` fails closed before HTML emission when synthesized audio violates
either sibling-relative acoustic invariant or an additive absolute backstop:

- **Duration/word sibling ratio:** for each segment, WAV duration divided by
  `words.json` word count must be no more than `1.25x` the median of same-role
  sibling segments.
- **Voiced-frame pitch outliers:** 40ms frames / 20ms hop, autocorrelation f0
  search 70-1000Hz, gated to loud and periodic speech frames only
  (`RMS >= 0.15 x segment p90 RMS` and autocorrelation peak `>= 0.55`). The gate
  counts voiced frames whose f0 exceeds `2x` the segment median f0.

Calibration from the night-wrap seed: real glitch segments landed around
116-123 high-f0 voiced frames, clean siblings around 61-69, and the s3a-like
stable true-negative around 103-108. The threshold is therefore
`>112` high-f0 voiced frames plus a `> siblingMedian + 6` margin. Do not replace
this with global ffmpeg `astats` peak/RMS/flat-factor checks; those were
empirically uniform on the real glitches.
- **Absolute backstop for poisoned sibling medians:** when more than half of a
  same-role set is incident-heavy, sibling medians can normalize the artifact.
  The gate therefore also rejects `DURATION_WORD_ABSOLUTE_BACKSTOP` when
  duration/word exceeds 1.25s, and
  `HIGH_F0_VOICED_FRAME_ABSOLUTE_BACKSTOP` when the calibrated high-f0 count
  exceeds 112 but the sibling median is also high.

Typed failures name the segment, role, metric, measured value, threshold, and a
source-aware recovery step. A TTS rejection routes that segment's content-hash
receipt through the purge boundary and prints the authoritative `CACHE_PURGE`
outcome; only a `PURGED` result is recorded as a completed purge in the receipts
sidecar:

```bash
bun scripts/synth-segments.mjs --spec <job.json> --resynth-scene <segment-id> --no-cache
bun scripts/build-dashboard.mjs --spec <job.json>
```

A BYO rejection instead prints a `CACHE_PURGE ... status=SKIP` audit receipt and
requires replacing or editing the scene's `audioWav` source before synthesis and
BUILD; it never deletes a frozen TTS take through a stale receipt.

## Onset Energy BUILD Gate

The onset-energy member of the acoustic family uses the same PCM-s16 WAV parser,
applies a non-cancelling downmix by retaining the highest-magnitude channel in
each interleaved frame, and emits its own `onset-energy:BUILD` receipt row. Its
install calibration lives in one place in `src/acoustic-artifact-gate.mjs`:

- `ONSET_WINDOW_SECONDS=0.750`: RMS is measured from the exact segment boundary;
  leading silence counts because it makes the opener missable too.
- `ONSET_MIN_RMS_DBFS=-35`: a lower opening RMS rejects as
  `ONSET_ENERGY_ABSOLUTE_RMS_DBFS`.
- `ONSET_MAX_PEAK_DELTA_DB=26`: an opening more than 26 dB below the complete
  segment peak rejects as `ONSET_ENERGY_PEAK_DELTA_DB`.

The real RED fixture is an unnormalized 1221–1225 second extract from the
2026-07-16 L1 `voice_ask` QA recording. That surface is disclosed as the source;
the fixture transfers only the shared missable-opener defect class into the
narration BUILD gate. Its first 750 ms measure -56.547 dBFS, the extract peak is
-23.452 dBFS, and the delta is 33.094 dB. The earlier QA report's -8.13 dBFS
value is a real one-second transient on the raw source around t=1206s, about 15
seconds before this opener. It is outside the fixture window, so QA window
misalignment—not loudness normalization—explains the apparent discrepancy; the
committed fixture records both measured windows as raw-source truth.

The 33-scene `fable-blind-weave-2026-07-15` calibration has zero false trips:
onset RMS spans -26.032 to -18.576 dBFS and peak delta spans 14.410 to 22.794 dB.
Regenerate the portable receipt with:

```bash
bun evals/generate-onset-energy-calibration.mjs --job <job.json> --out evals/fixtures/calibration/2026-07-17-fable-blind-weave-onset-energy.json
```

An acoustic or onset REJECT writes typed evidence before exit and withholds any
stale or new HTML. A TTS reject attempts frozen-take cleanup through D6d and uses
the fresh-take reroll/build runbook shown above. A BYO reject has no TTS cache to
reroll, so its runbook instead names the scene and requires replacing or editing
its `audioWav` source before rerunning synthesis and BUILD. The shared D6d purge
boundary skips BYO artifacts even if they carry a stale TTS cache receipt, so
no acoustic, transcript-fidelity, onset-energy, or direct BUILD caller can purge
a prior TTS take for that BYO scene. Thresholds are install constants; there is
no per-run weakening flag.

Replay the eval (deterministic and offline; no TTS daemon/network, but `ffprobe`
is needed for mp3 duration checks):

```bash
bun test evals/audio-dashboard.test.mjs
```

Reject any dashboard with WPM/even-split/estimated timing, placeholder recap
copy, `build-aftercode-cinema.mjs`, `golemplaylist-base.js`, direct
`dashboards-serve` output, empty words, missing word-click seek, or missing
tailnet sync evidence.

## Transfer & Update (getting this skill to another machine)

This skill travels as **files only** — do NOT clone `narrationlayer` / `agent-html`
/ `skill-creator` onto the target machine. Use the golems skill-sync path (NOT
`/sync-to-mac`, which is for the notarized Layers app):

1. **Transfer** — the skill lives at
   `$GOLEMS_ROOT/skills/golem-powers/audio-dashboard/`. Getting it onto another
   machine = get that directory there, by whichever golems mechanism is in use:
   - `git` the `golems` repo on the target (the skill is committed under it), or
   - `rsync -a "$GOLEMS_ROOT/skills/golem-powers/audio-dashboard/" <host>:<golems-root>/skills/golem-powers/audio-dashboard/`
     for a repo-free copy.
2. **Register** — committed ≠ installed. Run `golem-install` / `setup-symlinks`
   on the target (it auto-discovers `golem-powers/*/` and symlinks each into
   `~/.claude/skills`, `~/.agents/skills`, `~/.codex/skills`).
   Then verify `audio-dashboard` appears in the skill list of a fresh session.
3. **Bootstrap** — run `bun scripts/bootstrap.mjs` on the target; install any
   missing HARD deps it reports. For TTS, start the qwen3 daemon or use BYO-audio
   / a direct `.wav` reference.
4. **Update** — re-transfer the directory (step 1) and re-run the eval
   (`bun test evals/audio-dashboard.test.mjs`). Because the engine is vendored,
   updating the skill = updating these files; there is no separate engine repo to
   keep in sync. Re-vendor from source only when the upstream
   `narrationlayer`/`agent-html` engine changes and you deliberately pull it in.

   NarrationLayer maintenance is governed by the schema-v1 paired-hash manifest
   at `vendor/narrationlayer/VENDOR-VERSION`. Run the two-way comparison against
   an explicit checkout before and after any synchronization:

   ```bash
   NARRATIONLAYER_UPSTREAM=/path/to/narrationlayer bun scripts/lint-narration-vendor-drift.mjs
   ```

   Resolve a stamped vendor-first debt only from a clean committed upstream.
   The refresh command checks every required source marker, runs each debt's
   targeted upstream test, recomputes both sides of every pair, preflights the
   resulting manifest, and then replaces the stamp atomically:

   Manifest `testCommand` entries and whole debt-pair blessing form a reviewed-manifest trust boundary: same-PR review must verify the command and every byte riding inside the declared pair before resolution.

   ```bash
   NARRATIONLAYER_UPSTREAM=/path/to/narrationlayer bun scripts/lint-narration-vendor-drift.mjs --refresh-stamp --resolve-open-debt
   ```

   If the upstream path is missing, the lint emits a typed
   `UPSTREAM_UNAVAILABLE` record with value `stamp-only` and verdict `DEGRADED`.
   That is deliberately loud evidence that only vendored hashes were checked;
   never report it as a full upstream comparison. The separate agent-html
   `cinema.js` provenance debt remains on its existing ledger and is not covered
   by this NarrationLayer stamp.

## Supersedes

This skill is the one canonical read-along audio-dashboard path. It supersedes the
following *classes* of prior artifact (do not resurrect them):

- **GolemPlaylist V1 / multi-audio players** — e.g. `golemplaylist-base.js` and the
  old per-episode learning dashboards + `build-static-site.mjs`.
- **V4/AfterCode builders without real whisper timing** — e.g.
  `build-aftercode-cinema.mjs` and any cinema built from WPM/estimated timing.
- **External one-off synth/render scripts** the vendored engine now replaces:
  `aftercode-tonight-synth.ts`, `regen-*-real-word-timings.ts`, and
  `build-aftercode-tonight.mjs`.
- Podcast/card/research dashboards that are not read-along, narrationlayer forks,
  and VoiceBar player UIs — out of scope.

The exhaustive per-file list of superseded artifacts (episode-specific) lives in
git history of this file, not here — this section stays pattern-level and portable.
