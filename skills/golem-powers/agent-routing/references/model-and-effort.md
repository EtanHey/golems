# Codex Model and Effort

This is the detailed Codex model/effort law; read it whenever choosing, dispatching, or verifying a Codex runtime.

Grounding: `$ORCHESTRATOR_ROOT/docs.local/research/2026-09-14-codex-model-effort-recommendations.md`, OpenAI's primary model guide, subagent configuration, API model/pricing docs, and Codex usage limits.

## GPT-6 Defaults

Workers default to `gpt-6-sol`; leads stay on `gpt-6-astra`. A lead may choose
`gpt-6-luna` for a job that genuinely fits its bounded, mechanical strengths. No task category,
including review, automatically routes to Luna. When in doubt, choose Sol. If GPT-6 is unavailable
in the refreshed Codex runtime catalog, use the matching `gpt-5.6-sol` or `gpt-5.6-luna` fallback;
the 5.6 IDs are not operational defaults. Do not infer runtime availability from API pages.

| Model | Standard input / output per 1M tokens | API context / max output | Source |
|---|---:|---:|---|
| `gpt-6-sol` | $2 / $10 | 1,050,000 / 128,000 | [OpenAI model page](https://developers.openai.com/api/docs/models/gpt-6-sol) |
| `gpt-5.6-sol` fallback | $4 / $20 | 1,050,000 / 128,000 | [OpenAI model page](https://developers.openai.com/api/docs/models/gpt-5.6-sol) |
| `gpt-6-luna` | $0.10 / $0.50 | 1,050,000 / 128,000 | [OpenAI model page](https://developers.openai.com/api/docs/models/gpt-6-luna) |

Those context figures are API maxima, not Codex-seat windows. Codex CLI seats run with a 400K
window unless `model_context_window` is raised in `~/.codex/config.toml`; do not change that key
without Etan. On `gpt-6-sol`, a prompt above 272K input tokens bills the full request at 2x input
and cache rates and 1.5x output, so raising the seat window can cross the price step. Handoff at
about 75% of the seat's actual window, read from that session's own `info.model_context_window`;
never calculate the handoff threshold from an API spec sheet.

## Decide From the Mission

1. **Sol is the worker default.** Use `gpt-6-sol` for normal product implementation, ambiguous multi-file work, architecture, decomposition, review, and final acceptance. Choose `medium` for bounded work, `high` for open-ended work, and `xhigh` for a named hard problem.
2. **Sol high fits open-ended work.** Use it for implementation, review, security, or tracing complex logic and assumptions when the mission is open-ended.
3. **Sol xhigh is for a named hard blocker.** Name the blocker and why more reasoning can help. `max` requires an evaluation; reachability alone is not evidence that it pays.
4. **Read-heavy Codex children follow the same model rule.** Use `gpt-6-sol` at `high` for open-ended recon, large-file review, or parallel Codex children returning distilled evidence. Choose `gpt-6-luna` only when the actual read is bounded and mechanical, with a deterministic check. Spawn read-heavy children as the named `recon` agent and verify their effective model: its external configuration may still pin Terra. A standalone read-only lane still routes to Cursor. `gpt-5.6-terra` is documented as a fallback tier only, never a prescribed choice.
5. **Luna is a deliberate per-job choice.** A lead can choose `gpt-6-luna` when the actual task is truly bounded and mechanical, with an outcome and deterministic check. A category label alone never selects Luna. Use `medium` for bounded work; escalate effort only for a named difficulty. `max` requires an evaluation. **Luna low is banned.**
6. **Leads stay on Astra.** Use `gpt-6-astra` for Codex lead lanes; the Sol/Luna rollout does not move lead routing.

Effort is chosen per dispatch, not inherited as silent fleet policy. Every brief names the effort
and gives a one-line mission-shaped reason. The model-fit line stays in every review.

Quota affects concurrency, not acceptance: the measured 5.6 fallback tiers give Luna roughly 25x and Terra roughly 2.5x Sol's local-message allowance per window; GPT-6 allowance ratios are **NOT KNOWN**. Spark is documented as a separate pool, but open Codex bugs #23150 and #20122 report it draining or depending on main quota. Effort changes token count, not price per token. Treat all of these as planning inputs, never permission for weaker output.

## Override Table

| Task shape | Model x effort | Rule |
|---|---|---|
| Default worker; bounded task | `gpt-6-sol` x `medium` | Use Sol when in doubt. |
| Open-ended implementation or review | `gpt-6-sol` x `high` | The task, not its category, justifies high. |
| One genuinely hard blocker | `gpt-6-sol` x `xhigh` | Name the blocker; `max` requires an evaluation. |
| Open-ended read-heavy review or distilled Codex-child fan-out | `gpt-6-sol` x `high` | Use named `recon` and verify its effective model; standalone read-only remains Cursor. |
| Routine implementation in an established pattern | `gpt-6-sol` x `medium` | Pattern and acceptance boundary must already be clear. |
| Job specifically judged to fit Luna | `gpt-6-luna` x `medium` | Lead chooses it per job; bounded outcome and deterministic check required. Never Luna low. |

Spark is a separate-pool interactive option, not the default child or a substitute for this table.
Max's incremental value and a stable general max policy remain **NOT KNOWN**.

## Dispatch and Verification

Visible lanes pass effort explicitly:

```bash
brainlayerCodex -s -E medium "<implementation outcome>"
brainlayerCodex -s -E high "<review/security/complex-tracing outcome>"
brainlayerCodex -s -m gpt-6-luna -E medium "<bounded mechanical outcome plus deterministic check>"
```

Codex custom agents live in `~/.codex/agents/*.toml`; defaults live in
`~/.codex/config.toml`. Policy selects Sol for an unnamed child unless a lead judges another model a better fit.
The current global `default_subagent_model` and named `packet` settings outside this repo still
pin Luna 5.6; they need a separate config update. Named `recon` pins Terra high. Choose
`packet` only when its specific job fits Luna. The cap is
`max_concurrent_threads_per_session = 4`; never retain legacy `max_threads` beside it because
Codex rejects the duplicate.

Recon/read-heavy fan-out children MUST use named `recon`. Its external `~/.codex/agents/recon.toml`
still pins Terra; do not treat that pin as a prescription. Select Sol by default, use Luna only for
a genuinely bounded/mechanical read, and verify the child's effective model and effort from its
own turn context. Verify an unnamed child's effective model and effort rather than assuming a
default from its agent name.

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
