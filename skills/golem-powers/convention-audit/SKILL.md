---
name: convention-audit
description: "Use when code may have duplicated ownership, uncoordinated implementations, multiple writers, split lifecycle controls, live-copy drift, or missing single sources of truth. NOT for generic lint, style, security, or architectural research audits."
execute: scripts/run.sh
---

# Convention Audit

Answer one question:

> Where does one concept have multiple independent implementations that can silently diverge?

This is a report-only audit. Do not fix findings in the audited repository; each fix needs its own owning-repo PR loop.

## Run

```bash
bash skills/golem-powers/convention-audit/scripts/run.sh \
  --repo /absolute/path/to/repo \
  --output-dir /absolute/path/to/reports
```

The runner fans out raw `codex exec` workers across six concept lenses, then sends their candidates through a separate synthesis worker. Every worker requests `gpt-5.6-luna` with `max` reasoning. It may fall back to `xhigh` only when Codex explicitly rejects `max`; all other pin failures stop the run. A successful preflight must accept the requested model and effort, and its raw startup banner is retained in `pin-preflight.log`. That banner is acceptance evidence from the CLI, not independent server-side model telemetry. repoGolem aliases are forbidden because they can drop model and effort.

The time/query lens also receives a deterministic Python-source inventory for lower-bound SQLite `datetime()` comparisons. This is a narrow seed, not a general detector: the model workers remain responsible for other languages, query shapes, and convention families.

Raw lens outputs are candidates, not reports. They must be structurally valid, but a lens may cite a broad implementation entrypoint and a more specific divergent line. Those candidates still reach synthesis; the final synthesis output is rejected unless every divergent `path:line` also appears verbatim in its finding's implementation-site set. The runner checkpoints `run-log.json` through preflight, analysis, synthesis, and reporting. A handled failure overwrites it with `status: failed`, the failing stage and error, partial worker telemetry, and target-state verification when available.

## Finding Gate

Keep a finding only when all are true:

1. One concept has at least two independent implementation or ownership sites.
2. Every relevant site is listed as `file:line` and verified against the current tree.
3. At least one concrete drift state is explained; resemblance alone is insufficient.
4. A shared helper, owner, controller, or derivation shape would collapse the sites.

Callers that already share one helper are a must-not-flag control. Ignore naming, formatting, ordinary repeated syntax, generic lint, and speculative refactors. Workers may inspect only the audited repository root; external eval, collab, report, skill, and checkout paths are out of scope and may contain answer keys.

## Output Contract

Each finding includes the concept, every implementation site, only the divergent sites, and the smallest shared-helper shape. Each repo report also includes:

- requested model and effort accepted by the successful preflight, plus its raw banner evidence;
- whether detection was seed-assisted; when no seed fires, an explicit warning that unseeded lenses have no measured known-answer detection evidence;
- output tokens and wall-clock duration;
- Codex CLI cost telemetry, or an explicit `unavailable` value when the CLI emits none;
- raw worker logs and git-visible unchanged-target-state verification, with the verification scope recorded explicitly.
- on failure, a durable partial `run-log.json`; raw candidates remain non-actionable unless synthesis completes under the strict finding contract.

## Routing

- BrainLayer findings: `@bl-cleanup` primary, `@brainlayer` copied.
- VoiceLayer findings: flag for a successor seat; the previous seat is retired.
- Findings remain reports until the owning lane opens a separate implementation loop.

## Rollout Calibration Gate

Run BrainLayer first: it owns the known answer and its static seed fires there. Before authorizing VoiceLayer or cmuxlayer, use the BrainLayer report to select one independently verified defect outside the seed's SQLite-window family—such as live-copy drift, path/worktree identity, or split lifecycle ownership—and record whether an unseeded model lens found it. If no unseeded calibration point passes, do not spend the later repo runs.

## Common Mistakes

| Mistake | Correction |
|---|---|
| Running a broad conventions review | Ask only the single-source-of-truth question. |
| Flagging three callers of one helper | Return no finding; ownership is already shared. |
| Listing examples instead of every site | Re-scan and enumerate the full concept surface. |
| Reporting a requested pin as independent effective telemetry | Report it as a successful preflight acceptance and retain the startup banner. |
| Editing the target while auditing | Stop; raw workers run in a read-only sandbox and the runner verifies tracked and nonignored git-visible state. |
| Treating the static seed as broad discovery | State that it covers Python SQLite recent-window comparisons only. |
| Reading eval fixtures or answer keys from outside the target | Stop; workers and synthesis are scoped to the audited repository root. |
