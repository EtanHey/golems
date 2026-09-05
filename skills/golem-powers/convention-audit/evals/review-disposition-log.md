# Review Disposition Log

Status: SKIPPED — CodeRabbit local auth server could not bind in the sandbox; fell back to an independent Claude Sonnet 5 review.

- CRITICAL: known-answer unit fixture proves aggregation but not live Luna discovery — ACCEPTED (blocks merge until `run_live_eval.py` produces a passing real-run artifact)
- HIGH: unrecognized Codex token telemetry silently reported zero — FIXED (unrecognized telemetry now stops the run)
- HIGH: effective-pin banner format lacks a live Luna/max capture — ACCEPTED (the parser fails closed; the live eval must verify the real banner before merge)
- MEDIUM: max fallback rejection heuristic lacked coverage — FIXED (explicit effort rejection and unrelated network failure are covered)
- MEDIUM: malformed structured payload could reach report rendering — FIXED (payload shape is validated before aggregation/rendering)
- LOW: known-answer unit negative assertion omitted the fourth correct site — FIXED (`p0_longitudinal_count.py:25` is now enforced)

## Iteration 2 Claude pair review

Reviewer artifact: `/opt/private/coordination/docs.local/reviews/2026-08-02-convention-audit/claude-pair-rereview.md`

- Code-review disposition: ACCEPT — B1/B2 and M1–M5 are resolved in code or honestly scoped.
- Ship-gate disposition: BLOCKED — the only authorized live run predates the control-isolation fix,
  so it provides no admissible live negative-control evidence; the shipped `run.sh` path also has no
  real-model served artifact.
- Post-review hardening: live JSONL now fails on answer-key/skill-root contamination, the ship gate
  requires that check's explicit marker, `fallback_used` is a JSON boolean, and git-state scope is
  recorded instead of implied to cover ignored contents.
- PR disposition: no commit, push, PR, or merge while the live gate is blocked.

## Authorized round-2 gate completion

- Clean isolated control: PASS — 3/3, zero findings, contamination marker present, Luna/max,
  no fallback, 7,155 output tokens, 168.605 seconds.
- Real-model shipped `run.sh`: PASS — exit 0, seven workers, report/run-log/preflight artifacts,
  target state unchanged, Luna/max, no fallback, 18,986 output tokens, 184.544 seconds.
- Ship-gate disposition: GREEN; full PR loop authorized. Independent remote review remains routed
  by `@skillcreator` and is not replaced by the local Claude pair-review ACCEPT.

## PR #647 independent review iteration

Reviewer verdict: ITERATE (`orchestrator/collab/msgs/2026-08-03-convention-audit-review-verdict.md`).

- Important false positive: FIXED — the static seed emits divergence only for a mixed raw/normalized
  family; an all-raw regression test was RED then GREEN.
- Seed-assisted evidence disclosure: FIXED in eval #1 and every rendered report header.
- Multi-repo authorization: FIXED in routing — BrainLayer first; VoiceLayer/cmuxlayer conditional on
  one independently verified unseeded-lens BrainLayer calibration point.
- No new live Luna calls were spent.
