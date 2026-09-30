# Codex Model and Effort

Read this when choosing, dispatching, or verifying a Codex runtime. Current model policy
lives in `standards/model-roles.json`; resolve from the golems checkout with
`node scripts/model-roles.mjs <role> --field model|alias|effort|launcher_tier` (one field).
Keep resolver substitutions in generated commands. A swap requires a bench and one config edit.

Grounding: `$ORCHESTRATOR_ROOT/docs.local/research/2026-09-14-codex-model-effort-recommendations.md`, OpenAI primary model, subagent, pricing, and usage-limit docs.

## Role Defaults

Workers use `codex.implement`. Its resolved effort is a fallback; each plan phase records
`role · effort · why` and chooses effort from the actual mission. Resume retains the selected
session model and effort unless explicitly overridden. Verify launcher defaults against the role
config rather than assuming a bare launch is current. Coordination belongs to `claude.judgment`.

`codex.subagent.mechanical` is **CANDIDATE: bench before use**. Read its `status`, `gate`,
and effort from the config; do not dispatch it, choose it per job, or copy its former effort
rules before the bench. Until promotion, bounded mechanical work uses `codex.implement`.
If the resolved model is absent from the refreshed runtime catalog, stop and report the mismatch;
do not choose an older model automatically or infer runtime availability from API pages.

## Model Data (historical reference)

These pricing/context figures describe particular model IDs; they are data, not dispatch choices.
Recheck the linked primary source before using them for budgeting.

| Model | Standard input / output per 1M tokens | API context / max output | Source |
|---|---:|---:|---|
| `gpt-6-sol` | $2 / $10 | 1,050,000 / 128,000 | [OpenAI model page](https://developers.openai.com/api/docs/models/gpt-6-sol) |
| `gpt-5.6-sol` fallback | $4 / $20 | 1,050,000 / 128,000 | [OpenAI model page](https://developers.openai.com/api/docs/models/gpt-5.6-sol) |
| `gpt-6-luna` | $0.10 / $0.50 | 1,050,000 / 128,000 | [OpenAI model page](https://developers.openai.com/api/docs/models/gpt-6-luna) |

Those context figures are API maxima, not Codex-seat windows. The recorded CLI default was
400K unless `model_context_window` was raised in `~/.codex/config.toml`; do not change that key
without Etan. Recorded `gpt-6-sol` pricing above 272K input billed the full request at 2x input
and cache rates and 1.5x output. These are historical data, not a claim about today's runtime.
Read the seat's actual `info.model_context_window` from its session. Handoff timing follows
`/session-handoff`; an API spec sheet does not trigger a handoff.

## Decide From the Mission

1. **Worker model:** resolve `codex.implement` for implementation and Codex review lanes.
2. **Bounded work:** `medium` fits a clear acceptance boundary or established implementation pattern.
3. **Open-ended work:** `high` fits ambiguous implementation, review, security, or complex tracing.
4. **Named hard blocker:** `xhigh` requires a specific blocker and why more reasoning helps;
   `max` requires an evaluation, not just reachability or task importance.
5. **Read-heavy Codex children:** use named `recon` with the `codex.implement` model and
   mission-chosen effort. Verify its runtime; external agent configuration may carry a stale pin.
   A standalone read-only lane still routes to Cursor. The mechanical candidate cannot bypass its gate.
6. **Coordination:** use `claude.judgment` under `/agent-routing`, not a separate literal Codex lead tier.

Every brief names the role, effort, and one-line mission reason. For Claude/Codex, resolved
`default` effort means omit the effort flag. Quota changes concurrency, never acceptance;
unmeasured allowance ratios and the incremental value of `max` remain **NOT KNOWN**.

### Evidence: historical quota observations

The measured 5.6 fallback tiers gave Luna roughly 25x and Terra roughly 2.5x Sol's
local-message allowance per window; GPT-6 allowance ratios were **NOT KNOWN**. Spark was
documented as a separate pool, but Codex bugs #23150 and #20122 reported it draining or
depending on main quota. Effort changes token count, not price per token. Recheck before
using those observations for planning; none selects a dispatch model.

## Override Table

| Task shape | Role × effort | Rule |
|---|---|---|
| Bounded worker task | `codex.implement` × `medium` | Clear acceptance boundary. |
| Open-ended implementation or review | `codex.implement` × `high` | The mission justifies high. |
| One hard blocker | `codex.implement` × `xhigh` | Name the blocker; evaluate max first. |
| Read-heavy Codex child | `codex.implement` × `high` | Named `recon`; verify effective runtime. |
| Routine implementation | `codex.implement` × `medium` | Established pattern and acceptance boundary. |
| Mechanical candidate | `codex.subagent.mechanical` | **Do not dispatch before its bench.** |

## Dispatch and Verification

Visible lanes retain dynamic model resolution and explicit mission effort:

```bash
brainlayerCodex -s -m "$(node scripts/model-roles.mjs codex.implement --field model)" -E medium "<bounded implementation outcome>"
brainlayerCodex -s -m "$(node scripts/model-roles.mjs codex.implement --field model)" -E high "<open-ended implementation or review outcome>"
```

Codex custom agents live in `~/.codex/agents/*.toml`; defaults live in
`~/.codex/config.toml`. Do not edit host settings in a routing-doc lane. Resolve the worker
role when dispatching children and check any named or default subagent pin against it.
Do not use named `packet` while it selects the mechanical candidate before promotion.
The concurrency key is `max_concurrent_threads_per_session`; never retain legacy `max_threads`
beside it because Codex rejects the duplicate.

Verify every child's effective model and effort from its own `turn_context` after its own
`task_started` in `~/.codex/sessions/**/rollout-*.jsonl`. Never use prompt text, registry data,
parent metadata, agent names, or model self-identification as runtime proof.

Before dispatch, record:

```text
Mission shape: bounded/mechanical | open-ended | contradictory/adversarial
Choice: <role> · <mission effort, or resolved default> · <one-line why>
Model target: <resolved model; verify against runtime catalog>
Dispatch: <launcher/internal child path and explicit model/effort pin>
Verification: <child session JSONL whose turn_context will be read>
Unknowns: <NOT KNOWN for anything unmeasured>
```
