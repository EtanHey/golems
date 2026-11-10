# Bugbot and issue closure fixture

This is an A/B text-behavior probe for an encoded workflow preference. The baseline
loads master PR-loop; the candidate loads the edited skill, PR-creation/review
references and CLI adapters. The same neutral seat and prompts reach
both arms. `cases.json` expectations and assertions are never sent to the model.
C1 is the routine-PR false-trigger probe; C2 preserves the core-risk request path;
C3 scores only literal `Fixes #42` in the body; C4 is the routine/no-activity
negative control. C5 requires the S endpoint Cursor pass before merge checks, C6 the exact
`bugbot run` trigger on an eligible PR, and C7 skips both passes on XS.
Three fresh repetitions per arm.

Run from the golems worktree:

```sh
node skills/golem-powers/pr-loop/evals/bugbot-issues/run.mjs \
  <skill-creator-root> <baseline-sha> <fresh-output-directory>
```

An optional fourth argument, `baseline`, `candidate` or `both`, selects arms.
A fifth argument selects comma-separated case IDs, for example `both C1,C3,C4`.
A later candidate may reuse a recorded baseline only with byte-identical prompts,
seat, baseline source hashes, model and effort; retain both iterations.

The #140 trigger adapter is tied to large-plan reads and dispatch events, so the
runner reuses its clean-cell lifecycle and runtime validator instead. Codex runs
with subscription auth and default service. Requested/effective model and observed
effort are recorded in the fixtures' schema-valid `provenance` entries.
Its private HOME is outside repos; user config, MCPs, apps, bundled skills and agents
are disabled.
No API key is loaded. Credentials are deleted with each cell; output is redacted.
Output directories must be fresh; existing evidence is refused before any child
work. Invalid executions retain raw output plus an `.error.json` receipt and stop
the batch outside all pass rates. Any tool event invalidates a run. The fixture asks for proposed commands/body
text, never executes GitHub commands, and proves output behavior only. It is not
proof of real GitHub, hosted checks, installed behavior or a live merge.

Score each assertion against the completed output. Inspect English semantically;
never add regexes over English. `no_bugbot_wait` requires immediate continuation
and no contradictory pending/awaiting gate. `body_unavailable` requires the exact
`Bugbot: unavailable (usage)` marker in a proposed PR-body update; a response-only
note or explicit refusal to update the body fails. `pinned_merge` requires an
explicit merge action tied to the supplied head. Count one Bugbot review request
for C2. C3 requires only literal `Fixes #42` in the body; it does not score
issue-state checks or closure, which master already demonstrated. C4 requires
no Bugbot request/wait/body entry or extra step and a pinned merge. A case passes only if all its
assertions pass. C5 requires a proposed read-only `cursor-agent` command without a model flag,
ordered before exact-head merge checks, plus a `Cursor pass:` body record with the supplied
head and finding count or an unavailable reason. C6 requires exactly `bugbot run` as the
trigger, with no `@cursor` mention. C7 requires no Cursor command or Cursor body entry. C5 predates the `--trust --mode ask` flags (Bugbot finding on #1211), so its recordings do not score them; the read-only flags are guarded statically by `scripts/tests/test_frontend_proof_guidance.py::test_cursor_endpoint_pass_is_enforced_read_only`.
C8 (draft, eligible) requires `gh pr ready` ordered before the one `bugbot run` request and no Bugbot request while the PR is a draft.
C9 (a body line claims a Bugbot review that the PR record does not show) requires the response to say the claim is unsupported, to give a corrected body line that does not say reviewed, and to request Bugbot once now that the PR is ready.
Keep quotes and answer hashes beside the manual judgments so
the lead-routed reviewer can inspect them. No paid judge is required.

The result artifact retains all repetitions, runtime provenance and source
hashes; failed iterations remain recorded. These are implementer-scored probes,
not an independent review. No live GitHub action runs. Baseline is master text,
not a skill-free arm. The Cursor endpoint extension is measured in [CURSOR-ENDPOINTS-RESULTS.md](CURSOR-ENDPOINTS-RESULTS.md).
Pre-review evidence remains historical; see RESULTS.md for
the corrected scope and the reviewer finding.

Runner guard tests (synthetic transport/validator, no model calls):
`WEAVE_ALLOW_TMP=1 node --test skills/golem-powers/pr-loop/evals/bugbot-issues/runner.test.mjs`.
Both tests fail on a control with the new guards removed and pass on this runner.
