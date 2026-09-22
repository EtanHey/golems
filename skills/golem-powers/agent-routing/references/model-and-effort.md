# Codex Model and Effort

This is the detailed Codex model/effort law; read it whenever choosing, dispatching, or verifying a Codex runtime.

Grounding: `$ORCHESTRATOR_ROOT/docs.local/research/2026-09-14-codex-model-effort-recommendations.md`, OpenAI's primary model guide, subagent configuration, API model/pricing docs, and Codex usage limits.

## Decide From the Mission

1. **Sol medium implements by default.** Use `gpt-5.6-sol` at `medium` for normal product implementation, including ambiguous multi-file work, architecture, decomposition, and final acceptance.
2. **Sol high is a named escalation.** Use it for review, security, or tracing complex logic and assumptions. Do not describe high as the safe implementation default.
3. **Sol xhigh or max is one gated hard blocker.** Name the blocker and why more reasoning can help. Reachability is not evidence that the higher rung pays.
4. **Terra high is the Codex-child fan-out tier.** Use `gpt-5.6-terra` at `high` for read-heavy recon, large-file review, or parallel Codex children returning distilled evidence. Spawn these as the named `recon` agent. A standalone read-only lane still routes to Cursor. Terra medium fits routine implementation in an established pattern.
5. **Luna executes mechanical packets.** Luna medium/high fits extraction, classification, and mechanical edits. Luna xhigh is the default for a bounded subagent packet. Hand Luna an outcome plus a deterministic test, never a procedure. Luna max is an escalation only after xhigh falls short and requires a written acceptance test; this is community practice, not an OpenAI recommendation. **Luna low is banned.**

Effort is chosen per dispatch, not inherited as silent fleet policy. Every brief names the effort
and gives a one-line mission-shaped reason. The model-fit line stays in every review.

Quota affects concurrency, not acceptance: Luna has roughly 25x and Terra roughly 2.5x Sol's local-message allowance per window. Spark is documented as a separate pool, but open Codex bugs #23150 and #20122 report it draining or depending on main quota. Effort changes token count, not price per token. Treat all of these as planning inputs, never permission for weaker output.

## Override Table

| Task shape | Model x effort | Rule |
|---|---|---|
| Default implementation, decomposition, architecture, final acceptance | `gpt-5.6-sol` x `medium` | Default; brief says why medium fits. |
| Review, security, complex tracing | `gpt-5.6-sol` x `high` | High needs one named reason. |
| One genuinely hard blocker | `gpt-5.6-sol` x `xhigh` or `max` | Gate to one blocker; say why lower effort is insufficient. |
| Read-heavy review or distilled Codex-child fan-out | `gpt-5.6-terra` x `high` | Use named `recon`; standalone read-only remains Cursor. |
| Routine implementation in an established pattern | `gpt-5.6-terra` x `medium` | Pattern and acceptance boundary must already be clear. |
| Extraction, classification, mechanical edits | `gpt-5.6-luna` x `medium` or `high` | Outcome plus deterministic check; never Luna low. |
| Bounded mechanical child packet | `gpt-5.6-luna` x `xhigh` | Prefer named `packet`; outcome and test are mandatory. |
| Packet escalation after xhigh fails | `gpt-5.6-luna` x `max` | Written acceptance test required; community practice only. |

Spark is a separate-pool interactive option, not the default child or a substitute for this table.
Max's incremental value and a stable general max policy remain **NOT KNOWN**.

## Dispatch and Verification

Visible lanes pass effort explicitly:

```bash
brainlayerCodex -s -E medium "<implementation outcome>"
brainlayerCodex -s -E high "<review/security/complex-tracing outcome>"
brainlayerCodex -s -m gpt-5.6-terra -E medium "<patterned outcome>"
```

Codex custom agents live in `~/.codex/agents/*.toml`; defaults live in
`~/.codex/config.toml`. Golems defaults pin Luna xhigh for generic children, named `recon` pins
Terra high, and named `packet` pins Luna xhigh. The cap is
`max_concurrent_threads_per_session = 4`; never retain legacy `max_threads` beside it because
Codex rejects the duplicate.

Recon/read-heavy fan-out children MUST use named `recon`. An unnamed child inherits the Luna xhigh
packet default, so it MUST receive a bounded outcome plus deterministic test.

Verify every child's effective model and effort from the child's own `turn_context` after its own
`task_started` in `~/.codex/sessions/**/rollout-*.jsonl`. Never use prompt text, registry data,
parent metadata, or model self-identification as proof.

Before dispatch, write one sentence for each field:

```text
Mission shape: bounded/mechanical | open-ended | contradictory/adversarial
Choice: <effective-model target> at <medium|high|xhigh|max>
Why: <signals from the mission, not task importance alone>
Dispatch: <launcher/raw internal path and explicit effort pin>
Verification: <child session JSONL whose turn_context will be read>
Unknowns: <anything not measured; write NOT KNOWN rather than extrapolating>
```
