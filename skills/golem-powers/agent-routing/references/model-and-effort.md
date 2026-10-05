# Codex Model and Effort

Read this when choosing, dispatching, or verifying a Codex runtime. Current model policy
lives in `standards/model-roles.json`; resolve from the golems checkout with
`node scripts/model-roles.mjs <role> --field model|alias|launcher_tier` (one field).
Keep resolver substitutions in generated commands. A swap requires a bench and one config edit.

Grounding: `$ORCHESTRATOR_ROOT/docs.local/research/2026-09-14-codex-model-effort-recommendations.md`, OpenAI primary model, subagent, pricing, and usage-limit docs.

## Model Roles

Workers use `codex.implement`. Effort is chosen per `/large-plan` phase, recorded as
`role · effort · why`, and passed explicitly at dispatch. Resume retains the selected
session model and effort unless explicitly overridden. Verify launcher defaults against the role
config rather than assuming a bare launch is current. Coordination belongs to `claude.judgment`.

`codex.subagent.mechanical` is **CANDIDATE: bench before use**. Read its `status` and `gate`
from the config. Exception: Etan's 2026-10-04 ruling authorises this role for Codex-internal
mechanical sub-agents (default child and named `packet`) through the resolver's
`codex-internal-subagent` use. This is not a benchmark promotion. Headless or visible workers
continue to use `codex.implement`; other candidate uses remain gated.
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
2. **Phase effort:** choose effort per `/large-plan` phase and pass it explicitly at dispatch.
   Record the acceptance boundary, ambiguity, or specific blocker that justifies the choice.
3. **Evaluation:** task importance alone does not establish the value of more reasoning.
4. **Read-heavy Codex children:** use named `recon` with the `codex.implement` model and
   phase-selected effort passed explicitly at dispatch. Verify its runtime; external agent configuration may carry a stale pin.
   A standalone read-only lane still routes to Cursor. The mechanical candidate cannot bypass its gate.
5. **Coordination:** use `claude.judgment` under `/agent-routing`, not a separate literal Codex lead tier.

Every brief names the role, phase effort, and one-line reason, then passes that effort
explicitly at dispatch. Quota changes concurrency, never acceptance;
unmeasured allowance ratios and the incremental value of `max` remain **NOT KNOWN**.

### Evidence: historical quota observations

The measured 5.6 fallback tiers gave Luna roughly 25x and Terra roughly 2.5x Sol's
local-message allowance per window; GPT-6 allowance ratios were **NOT KNOWN**. Spark was
documented as a separate pool, but Codex bugs #23150 and #20122 reported it draining or
depending on main quota. Effort changes token count, not price per token. Recheck before
using those observations for planning; none selects a dispatch model.

## Phase Choices

For the effort rungs, see `/large-plan` § "Choosing effort per phase".

| Task shape | Role | Phase decision |
|---|---|---|
| Bounded or routine implementation | `codex.implement` | Record acceptance boundary and chosen phase effort. |
| Open-ended implementation or review | `codex.implement` | Record ambiguity and chosen phase effort. |
| One hard blocker | `codex.implement` | Name the blocker and why the chosen phase effort helps. |
| Read-heavy Codex child | `codex.implement` | Named `recon`; choose phase effort and verify runtime. |
| Internal mechanical child | `codex.subagent.mechanical` | Named `packet`; Etan-authorised internal use only, verify runtime. |

## Dispatch and Verification

Visible lanes retain dynamic model resolution and explicit phase effort:

```bash
: "${phase_effort:?Choose effort per /large-plan phase before dispatch}"
brainlayerCodex -s -m "$(node scripts/model-roles.mjs codex.implement --field model)" -E "$phase_effort" "<phase outcome>"
```

Codex custom agents live in `~/.codex/agents/*.toml`; defaults live in
`~/.codex/config.toml`. Do not edit host settings in a routing-doc lane. Resolve `codex.implement` for workers/recon and `codex.subagent.mechanical` for internal
mechanical children/packet; check each effective pin against its role.
The concurrency key is `max_concurrent_threads_per_session`. The model-only installer preserves
existing concurrency settings; review legacy `max_threads` separately before changing them.

Verify every child's effective model and effort from its own `turn_context` after its own
`task_started` in `~/.codex/sessions/**/rollout-*.jsonl`. Never use prompt text, registry data,
parent metadata, agent names, or model self-identification as runtime proof.

Before dispatch, record:

```text
Mission shape: bounded/mechanical | open-ended | contradictory/adversarial
Choice: <role> · <effort selected for this /large-plan phase> · <one-line why>
Model target: <resolved model; verify against runtime catalog>
Dispatch: <launcher/internal child path and explicit model/effort pin>
Verification: <child session JSONL whose turn_context will be read>
Unknowns: <NOT KNOWN for anything unmeasured>
```
