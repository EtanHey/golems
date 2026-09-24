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


## Rules R6–R20 (full text: [references/rules.md](references/rules.md))

Read the rule before applying it; this index is only for routing.

| Rule | One line |
|---|---|
| R6 URL identity | Never label a URL from surrounding context; the fetcher names it. |
| R7 Tool adequacy (visual gate) | The verifying tool must be able to observe the claimed property; text tools cannot verify visuals. Receipt format + escalation inside. |
| R8 Agent completion | Verify any agent's "done" yourself before reporting it (`gh` for PR state, not `git log`). |
| R9 Recount before republish | A number that appears in ≥2 artifacts is re-measured at publish time, never re-cited. |
| R10 Live citation | Every `path:line` citation is backed by a Read of that path within the last 5 turns. |
| R11 System-state claims | RAM, daemons, processes, power, disk: claims need output from a tool that observes them. |
| R12 Fresh spawn ≠ resumed | Never call a fresh-spawned agent "resumed", or the reverse. |
| R13 Synthesized time | No durations or relative times from guesswork; derive from logged clocks or say unknown. |
| R14 Relay/STT trust class | Relayed or dictated quotes and names rank below typed user turns. |
| R15 Artifact content | A delivered file is not evidence until its content has been opened and looked at. |
| R16 Verify before relay | Relaying a claim is making it: cost fields, handoff framing, entities, RESOLVED, dispatch. Checker: `scripts/verify-before-relay-check.mjs`. |
| R17 Root cause before fix | A fix proposed without a root cause is a fabricated fix. |
| R18 Truncated sweep | A list cut by `head`/limits is a sample; completeness claims state the command and its limit. |
| R19 Probe must not mutate | A readiness/health probe never loads what it is checking for. |
| R20 Closure vs DONE marker | Close against the contracted artifact (merged SHA, file at path), not the agent's DONE marker. |

## Composability

This skill is referenced by:
- `/pr-loop` — step 8 (read review before claiming clean)
- the false-green-gate hook — hook-side enforcement of the same evidence-before-assertions law (R15 is its visual-artifact extension)
- `/brain-store-fallback` — structural fallback when `brain_store` fails; never report "stored" when only fallback happened
- `/architectural-conformance-audit` — pre-R0 SOTA-vs-impl diff; fabrication mode at the architectural level (SOTA cited counter-example but impl shipped it anyway)
- All autonomous workflows — never trust, always verify
- Collab TEMPLATE.md — mandatory skill for overnight agents

---

## The Bottom Line

**Read it. Parse it. Then report.**

Not "I saw it flash by." Not "the system told me." Not "it should be fine."

Read. Parse. Report. No shortcuts.
