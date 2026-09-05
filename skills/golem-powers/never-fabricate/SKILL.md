---
name: never-fabricate
description: "Evidence gate: read files, run tests, verify outputs before claims. Triggers: results, green/complete claims."
---

# Never Fabricate Results

> If you haven't Read() the file, you don't know what's in it. Period.

## The Iron Law

```
NO CLAIMS ABOUT FILE CONTENTS WITHOUT Read() EVIDENCE
NO CLAIMS ABOUT TEST RESULTS WITHOUT RUNNING THEM
NO CLAIMS ABOUT AGENT OUTPUT WITHOUT READING IT
```

## What Counts as Fabrication

| Fabrication | Reality |
|-------------|---------|
| "All three audits say green" (without Read) | You don't know what they say |
| "Tests pass" (without running them) | You don't know if they pass |
| "Agent completed successfully" (without checking) | Agents lie too |
| "The file looks correct" (from system-reminder) | System-reminders are notifications, not reads |
| "Results are consistent" (from a glance) | A glance is not analysis |

## The Rule — HARD GATE

**Before ANY claim about contents, results, or status, complete the verification protocol.**

### When someone writes to a file (agent, CLI tool, Cursor, user):

```
1. READ the file with the Read tool — not from memory, not from system-reminders
2. PARSE the actual content — don't skim, read the FULL content
3. SUMMARIZE what you actually read — with specific evidence (quotes, numbers, line counts)
4. ONLY THEN report on it
```

### When tests run:

```
1. RUN the test command — execute it yourself
2. READ the full output — not just the exit code
3. COUNT failures, errors, warnings — report exact numbers
4. ONLY THEN claim pass/fail
```

### When an agent reports completion:

```
1. CHECK the actual output (file diff, test results, PR URL) — Read() the artifacts
2. VERIFY independently — don't trust the agent's self-report
3. ONLY THEN confirm completion
```

<output_contract>
EVERY verification claim MUST include:
- SOURCE: What you read (file path, command output, PR URL)
- EVIDENCE: Specific data from the source (quote, count, finding)
- VERDICT: Your conclusion based on the evidence

Example (RIGHT):
  "I Read() all three audit files. Model A: 3 issues found (2 medium, 1 low).
   Model B: clean pass. Model C: 1 critical — missing input validation on /api/users.
   Verdict: NOT all green — Model C has a critical finding."

Example (WRONG):
  "All three audits look green."
  (No Read(), no evidence, no specific findings = FABRICATION)
</output_contract>

## System-Reminders Are NOT Evidence

System-reminders tell you "this file changed." They are a **notification**, not a **source of truth**.

```
WRONG: "I saw in the system-reminder that the file was updated, and it looks good"
WRONG: "The subagent said it's complete, so we're good"
WRONG: "The user said tests pass, so I'll confirm it's green"
RIGHT: Read(file_path) → parse content → report what you actually read
RIGHT: Run the tests yourself → read output → count pass/fail → then claim
```

A notification popping up on your phone is not the same as reading the document.
A subagent claiming "done" is not the same as verifying the output.
A user saying "tests pass" is not license to skip verification — they might be wrong.

## Why This Matters

One fabricated "all green" can:
- Waste hours of debugging downstream
- Ship broken code to production
- Destroy trust permanently
- Cause the user to make decisions based on false information

From real incidents:
- Claude claimed "3 models validated, all complete and correct" without reading the file
- Claude claimed "tests pass" without running them
- Claude reported "review is clean" without reading review comments

## When To Apply

**ALWAYS before:**
- Summarizing any file contents
- Reporting on test results
- Reporting on agent output
- Claiming anything is "done", "green", "clean", "complete"
- Moving to the next task based on prior task results
- Relaying information from one agent to another
- Answering "is it safe to merge/ship/deploy?"

**Even when the user says "don't bother reading it" or "just confirm":**
- Read it anyway. The user is testing you, or doesn't realize the risk.
- Politely explain: "I need to verify before claiming it's done."

## R7: TOOL ADEQUACY RULE (VISUAL VERIFICATION GATE)

**The verification tool MUST be capable of observing the claimed property.** Using a text tool to verify a visual property is fabrication — you're reporting on something you literally cannot see.

### The Rule

```
BEFORE accepting any verification result:
1. CLASSIFY the claim domain (visual, content, behavioral, cross-site)
2. CHECK if your tool can observe that domain
3. If INADEQUATE → switch to an adequate tool or flag "VISUAL VERIFICATION NOT PERFORMED"
4. NEVER claim a visual fix is verified using text-only tools
```

### Tool Adequacy Matrix

| Claim domain | What you're checking | Adequate tools | INADEQUATE tools |
|---|---|---|---|
| **Visual** (CSS, layout, color, overflow, spacing) | Rendered pixels | Playwright screenshot, computer-use screenshot | WebFetch, curl, grep, Read() |
| **Content** (text present, data correct, links exist) | Text/data values | WebFetch, curl, Read(), grep | — |
| **Behavioral** (click handlers, navigation, interactions) | Event responses | Playwright interaction, browser automation | Static text tools |
| **Cross-site consistency** (matching design, brand alignment) | Side-by-side comparison | Multiple Playwright screenshots | Any single-site tool |
| **Deployed state** (live URL works) | Production response | curl/WebFetch on deployed URL | Build directory grep, local dev server |

### What Counts as Visual Fabrication

| Fabrication | Why it's fabrication |
|-------------|---------------------|
| "CSS overflow fixed" (verified via WebFetch) | WebFetch returns HTML text. Overflow is a rendered pixel property. You cannot see overflow in text. |
| "Colors match the brand" (verified via grep for hex codes) | Grep finds the hex code in source. It cannot see what the browser renders — CSS specificity, media queries, or overrides may change the actual color. |
| "Layout looks correct" (verified via curl) | curl returns HTML structure. Flexbox/grid layout is computed at render time. Text cannot show layout. |
| "Footer is consistent across sites" (verified one site only) | Consistency requires comparison. You verified one site, not the relationship between them. |
| "Badge link works" (verified link text exists in HTML) | Link text existing ≠ link resolving. You need to click it or fetch the href target. |

### Verification Receipt Format

Every verification claim involving deployed or rendered output MUST include this receipt:

```
VERIFICATION RECEIPT:
- Claim: "[what you're claiming]"
- Domain: visual | content | behavioral | cross-site
- Tool used: [actual tool name]
- Adequate: YES/NO (can this tool observe this domain?)
- Evidence: [specific observation from the tool — screenshot description, response code, text match]
- If NO: "VISUAL VERIFICATION NOT PERFORMED — [what tool would be needed]"
```

**Example (RIGHT):**
```
VERIFICATION RECEIPT:
- Claim: "Copy icon no longer overflows container"
- Domain: visual
- Tool used: Playwright screenshot of deployed URL
- Adequate: YES (screenshot shows rendered layout)
- Evidence: Screenshot shows icon within bounds, text truncated with ellipsis
```

**Example (WRONG — but at least honest):**
```
VERIFICATION RECEIPT:
- Claim: "Copy icon no longer overflows container"
- Domain: visual
- Tool used: WebFetch
- Adequate: NO (WebFetch returns text, cannot observe CSS overflow)
- VISUAL VERIFICATION NOT PERFORMED — need Playwright screenshot
```

**Example (FABRICATION — what the overnight agents did):**
```
"Applied min-w-0 + text-ellipsis. Copy icon stays in bounds." ← no receipt, no tool named, no evidence
```

### Escalation When Adequate Tools Unavailable

If you cannot use an adequate tool (Playwright not available, no browser access):
1. **DO NOT claim the fix is verified.** You cannot verify what you cannot observe.
2. **State explicitly:** "Code change applied. VISUAL VERIFICATION NOT PERFORMED — I cannot take screenshots in this environment."
3. **Flag in collab/PR:** "Needs manual visual verification before merge."
4. This is honest. Claiming "fixed" without visual evidence is not.

## Composability

This skill is referenced by:
- `/pr-loop` — step 8 (read review before claiming clean)
- the false-green-gate hook — hook-side enforcement of the same evidence-before-assertions law (R15 is its visual-artifact extension)
- `/brain-store-fallback` — structural fallback when `brain_store` fails; never report "stored" when only fallback happened
- `/architectural-conformance-audit` — pre-R0 SOTA-vs-impl diff; fabrication mode at the architectural level (SOTA cited counter-example but impl shipped it anyway)
- All autonomous workflows — never trust, always verify
- Collab TEMPLATE.md — mandatory skill for overnight agents

## R6: URL IDENTITY RULE

Never label a URL based on surrounding context. A URL is its own identity.

- **WRONG:** "Theo's video (https://youtu.be/9d5bzxVsocw)" — if you haven't fetched it
- **RIGHT:** "URL: https://youtu.be/9d5bzxVsocw" — let the fetcher determine the title
- This applies to compaction summaries, handoff artifacts, and collab messages

## R8: AGENT COMPLETION VERIFICATION

**When ANY agent (subagent, cmux worker, Cursor, Codex) claims completion, verify BEFORE reporting to user.**

### The Rule

```
AFTER any agent claims "done", "complete", "live eval passed", "PR merged":
1. READ the actual output (cmux read_screen, Read() file, check PR URL)
2. VERIFY the claimed action occurred (list_surfaces for live eval, git log for PR)
3. ONLY THEN report completion to user
```

### Representative failure modes

| What Was Claimed | What Actually Happened | Who Caught It |
|---|---|---|
| "LIVE EVAL complete, Sonnet agent tested" | No new cmux surfaces spawned. Eval was simulated. | User asked "did it test on real tabs?" |
| "I understand the issue" (pattern-matched) | Agent had not actually read the worker output | Direct verification request |
| "Worker has the required skill" | Skill was not in its allowlist | Skill-path check |
| "All audits green" | Only bot reviews ran. Cursor audits skipped. | Post-merge review found missing rounds |
| "Document updated with new domains" | Text was not actually changed in the file | Content inspection |
| "A contact is a confirmed tester" | Person was inferred from an email address | Source verification |
| "Fixed everything" | Only audits ran; implementation was absent | Diff inspection |

### Verification Checklist for Agent Claims (use `gh` CLI, not `git log`, for PR state)

- [ ] Agent claims "live eval passed" → `cmux list_surfaces` — were new surfaces created?
- [ ] Agent claims "PR merged" → `gh pr view <N> --json state` — is state MERGED?
- [ ] Agent claims "tests pass" → run `npm test` / check CI — are they green?
- [ ] Agent claims "file updated" → `Read()` the file — is the content correct?
- [ ] Agent claims "skill exists" → `ls` the skill path — does it exist?
- [ ] Agent claims "stored in BrainLayer" → `brain_search` — is it findable?

**The cost of one fabricated "all green" is hours of debugging. The cost of one Read() is 2 seconds.**

## R9: RECOUNT-BEFORE-REPUBLISH

Any numeric claim (line count, entry count, byte size, process count, PR total,
file count) that appears in ≥2 artifacts of the same deliverable MUST be
re-verified at publish time via the underlying tool — never re-cited from memory
or from a sibling doc.

Concretely:
- Line counts → `wc -l <path>` at publish, not at draft
- Entry counts → re-parse the source file at publish (jq for JSON, ls | wc -l for dirs)
- "X.bak files exist" / "no X subdir" → `ls` at publish, never memory

Mechanism: stale numbers propagate. The first cite was verified; the 2nd-4th sites
are copy-paste with drift. The fix is a publish-time re-check at the deliverable seam.

**Evidence:** 4 line-count fabrications 2026-05-17 night (273→342, 108→107,
33→39, 25→26) — all from re-cite after one verified cite.

## R10: LIVE-CITATION GATE

Any `<absolute-or-repo-path>:<line-number>` citation that appears in a deliverable
(README, plan phase, HTML footer, brain_store note) MUST have been backed by a
`Read` call on that exact path within the same turn or within the last 5 turns.

If you intend to cite `foo.py:76`, you MUST have just Read foo.py and confirmed:
1. The file exists and has ≥76 lines
2. Line 76 actually contains the claimed code/behavior

NO "based on earlier session memory" cites. NO carrying file:line references
through compaction. After compaction, all file:line citations are downgraded
to suspect and must be re-Read.

For /large-plan and /goal outputs: a Phase 5 "pre-flight" step that re-Reads
every `<file>:<line>` in the deliverable's findings.md / README and confirms
presence is mandatory before SHIP.

**Evidence:** drain.py:76 fabrication 2026-05-17 (cited fcntl.flock at line 76;
actual file is 18 lines, no flock primitive). Source mechanism = grep-as-Read
substitution: agent grep'd, never Read surrounding context, fabricated context
from the grep alone.

## R11: SYSTEM-STATE CLAIMS REQUIRE TOOL EVIDENCE (gen-10 weave #23, 2026-06-05)

**Claims about physical or system state — RAM/leaks, daemon health, process liveness,
power/battery state, disk, "the pane can't open" — require evidence from a tool that
can observe that state.** This is R7 tool-adequacy applied to the machine itself.

| Claim | Required evidence | INADEQUATE |
|---|---|---|
| "cmux is leaking memory" | `ps` RSS / footprint output, read this turn | Vibes, slowness, prior-session memory |
| "daemon is down/up" | `pgrep -fl` / `launchctl list` output | A failed MCP call (could be the client) |
| "a pane can't open" | An actual failed `spawn_agent` call | Assumption — call it first |
| "battery/power is X" | `pmset -g batt` / `batt` output | Memory of an earlier reading |

**Evidence:** gen-10 fabricated a "2.1GB cmux leak" and wasted a recovery round —
real RSS was 290MB (`ps` read at the time). gen-11 boot doc rule 2: never claim a
pane "can't open" without calling `spawn_agent` first; never claim a leak without
`ps` RSS evidence.

## R12: FRESH SPAWN ≠ RESUMED (gen-10 weave #23, 2026-06-05)

**Never claim an agent was "resumed" when it was fresh-spawned — and vice versa.**
Session continuity is a factual claim about state transfer: a resumed session kept
its context; a fresh spawn starts from zero and must be re-briefed. Conflating them
misleads the user about what the agent knows.

```
WRONG: "agents resumed" when they were fresh spawns
RIGHT: "agent X: fresh spawn (no prior context — re-briefed via handoff file);
       agent Y: resumed session <id> (context intact)"
```

Verification: a resume claim requires the resumed session id (launcher `-c` /
`--resume <id>` / `codex resume`) AND post-boot evidence the context is present
(the agent references prior state unprompted, or `read_screen` shows the restored
transcript). No id + no evidence = it's a fresh spawn; say so.

## R13: SYNTHESIZED TIME CLAIMS (gen-12 weave E02, 2026-06-06)

**Never synthesize durations or relative timestamps** ("fired ~30 min ago", "has
been running 30 minutes") from vibes, elapsed guesswork, or unstated assumptions.

```
WRONG: "the task fired about 30 minutes ago" without timestamp evidence
RIGHT: Derive timing from logged clocks (`timestamp` in JSONL, `gh pr view --json
       mergedAt`, `ps` start time, file mtime) — or say **unknown / not verified**
```

Also covers:

- **Retro work** written after the fact → mark explicitly as **retro** in collab
  and TASK_DONE posts (do not present backfilled status as live-present).
- **Hand-written collab timestamps** → stamp at write time with inline shell:
  `` `TZ=Asia/Jerusalem date '+%Y-%m-%d %H:%M:%S %Z'` `` — never guess offsets ahead
  of wall clock (orcui flagged 4–12 min stamp skew fleet-wide on the same day).

## R14: RELAY/STT TRUST CLASS (gen-12 weave E02, 2026-06-06)

Relay-attributed quotes and names are a **LOWER trust class** than raw
`type:user` turns with `promptSource:typed`.

Before attributing words or intent to the user:

1. **Verify the raw turn** — require `promptSource:typed` (or equivalent direct
   capture). NOT `queued_command`, NOT task-notification relay, NOT cmux
   `send_command` authored by an assistant.
2. **Label relay provenance** when relay-only: `operator-direct-via-relay` or
   `orc relay — verify before quoting as the user`.
3. **Decode known STT/dictation artifacts** before quoting dictated text in
   intent maps or skill evidence; transcribed product names are especially prone
   to near-homophone substitutions.

Red-team review caught the same class: a quote attributed to the operator came
from an agent relay that referred to the operator in third person. Relay speech
is not operator speech.

## R15: ARTIFACT CONTENT GATE (gen-13 weave E01, 2026-06-07)

**A delivered file is not evidence until its content is opened and looked at.**
"Uploaded file exists" ≠ "deliverable exists". Any artifact delivered to Drive,
to a user or collab (screenshot, render, audio, mock) must have its CONTENT
verified by the producer — view the actual pixels, listen to the actual audio —
against a defect checklist BEFORE upload.

```
WRONG: render → upload to Drive → post link → report "delivered"
       when the image was an empty crop or did not show the requested state
RIGHT: render → OPEN the artifact → check against the defect checklist →
       fix/re-render until it passes → ONLY THEN upload and report
```

1. **Producer gate:** NOTHING uploads until the producer has inspected it and it
   passes. Delivering an obviously broken render is the failure.
2. **Reviewer gate — every artifact, not a sample:** a reviewer must open EVERY
   artifact in a set. Opening 2 of 4 renders and directing work from list TEXT
   without opening a single reference image is fabrication-by-sampling
   The gate works only when applied to every artifact in the delivery set.
3. **Tool adequacy applies (R7):** "looked at" means a tool that can observe the
   content domain — image pixels viewed, audio played/transcribed. File size,
   upload success, a Drive URL, or `ls` output is metadata, not content.

This is the visual-artifact extension of the evidence-before-assertions law —
applied to every delivered file.

**Mechanical check (PR #502):** stamps are command output — `hooks/stamp-lint.py`
(advisory PostToolUse lint) cross-checks NEW collab/weave/handoff stamps against
the real clock and DONE/MERGED/COMPLETE lines against artifact existence; scope
is the stamp + artifact-existence subclasses ONLY (not measurement/propagation/
quote classes — see `hooks/INSTALL.md`).

## R16: VERIFY-BEFORE-RELAY (gen-18 Track 2 #4 / R-008 absorbed)

**Relaying a claim is making it.** When you repeat a cost field, a handoff's
framing, an entity identity, a "RESOLVED" status, or dispatch a research task, you
own that claim — and it needs the same-turn verification its class requires BEFORE
it leaves your turn. Five RED classes, each with a deterministic checker
(`scripts/verify-before-relay-check.mjs`) pinned by replayable fixtures
(`evals/fixtures/verify-before-relay/`):

| Class | What fires | The fix (same turn) |
|---|---|---|
| **cost-field-misread** | a usage `cost`/`costDollars` telemetry field relayed as the BILLED account amount | probe the actual invoice / billing console — the usage field is a per-call estimate, not the charge |
| **handoff-framing-accepted** | a handoff/summary's framing ("the render is done, listen") repeated as fact | run an independent live check of the underlying artifact this turn (ffprobe/ls/curl/Read) |
| **named-entity-conflation** | distinct entities (a company, a tool, a second account) relayed as the same thing — imp-10 repeated critical error | a **session-start `brain_store` disambiguation** recording each entity distinctly before relaying any claim that spans them |
| **freshness-RESOLVED-without-probe** | an item marked RESOLVED off a title / single source | an artifact-existence probe **AND** ≥2 independent evidence checks before resolving |
| **dispatch-research-without-ls-siblings** | a research/agent task dispatched without checking if it's already answered | `ls` the sibling `results/` dir **before** you spawn |

**Boot step — entity disambiguation:** at session start, when names that could be
confused appear (a company vs a tool vs a second Claude account), `brain_store`
each entity distinctly ("X is the company; Y is the tool; Z is the second account
— NOT the same") so later relays cannot conflate them. This is the documented fix
for the imp-10 repeated-critical-error class.

Evidence is read from REAL execution only (Bash commands, tool names, tool_result
outputs) — never assistant narrative (a worker can SAY "I checked the invoice";
the gate wants the curl/jq that did). DETERMINISTIC: same transcript in → same
verdict out. Run the checker:
`node skills/golem-powers/never-fabricate/scripts/verify-before-relay-check.mjs <transcript.json>`
(or `bun test skills/golem-powers/never-fabricate/scripts/__tests__/verify-before-relay.test.mjs`).

---

## R17: ROOT CAUSE BEFORE FIX (folded from superpowers:systematic-debugging, 2026-09-02)

**A fix proposed without a root cause is a fabricated fix.** Same iron law, applied
one step earlier: you may not claim to know what to change until you have evidence
of what broke. Folded here when the superpowers plugin was dropped (XS-2) — source
`superpowers/3.4.1/skills/systematic-debugging/SKILL.md` L16-22, L72-87, L192-213.

**The gate — before you propose ANY fix:**

1. **Read the error whole.** Full stack trace, line numbers, exit codes. Not the
   last line.
2. **Reproduce it.** If you cannot trigger it reliably, you are guessing — gather
   more data instead of proposing a change.
3. **Check what changed.** `git diff`, recent commits, new deps, config, env.
4. **Instrument every component boundary** when the system has more than one
   (CI → build → sign, API → service → DB): log what enters and what exits each
   layer, run ONCE, and read the evidence to find WHICH layer fails before you
   touch any of them. (L72-87)
5. **Trace backward to the source.** Where did the bad value originate? Fix at the
   source, not where it surfaced.

**One hypothesis, one change.** State it ("X is the root cause because Y"), make
the smallest change that tests it, verify. Failed? Form a NEW hypothesis — do not
stack a second fix on the first.

**THE FIX COUNTER — three strikes and it is the architecture.** (L192-213)

| fixes tried | what you do |
|---|---|
| 1-2 failed | return to step 1 and re-analyze with the new information |
| **3+ failed** | **STOP. Do not attempt fix #4.** Each fix revealing a new problem somewhere else is not a failed hypothesis — it is a wrong architecture. Surface it to your lead / to Etan with the evidence before changing anything else. |

**Red flags that mean you skipped the gate:** "quick fix for now", "just try
changing X and see", "it's probably X", "here are the main problems:" followed by
fixes and no investigation, or proposing a solution before tracing data flow.

---

## The Bottom Line

**Read it. Parse it. Then report.**

Not "I saw it flash by." Not "the system told me." Not "it should be fine."

Read. Parse. Report. No shortcuts.
