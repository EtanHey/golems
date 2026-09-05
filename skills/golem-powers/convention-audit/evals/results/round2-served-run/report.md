# Convention audit — convention-audit-round2-served-target

- Revision: `3e4d5f2398b3ebac3b03b0ff15efe0fafaef2d4f`
- Accepted preflight model: `gpt-5.6-luna`
- Accepted preflight reasoning effort: `max`
- Output tokens: 18986
- Wall-clock: 184.54s
- Cost: unavailable (Codex CLI emitted no cost telemetry)
- Findings: 1

## Eval Provenance

| agent_or_arm | model_requested | model_effective | effort_effective | model_observation_source | effort_observation_source |
|---|---|---|---|---|---|
| authorized_round_2_served | gpt-5.6-luna | gpt-5.6-luna | max | CLI status line: round2-served-run/pin-preflight.log lines 7-13; 1 preflight observation applied to 7 workers by construction; per-worker banners are not emitted under --json | CLI status line: round2-served-run/pin-preflight.log lines 7-13; 1 preflight observation applied to 7 workers by construction; per-worker banners are not emitted under --json |

Findings are reports only. Fixes require a separate PR loop in the owning repository.

## 1. One-day recent-chunks timestamp window

Confidence: high

| Site | Diverges? | Evidence |
|---|---:|---|
| `recent_queries.py:1` | yes | Raw text comparison is format-dependent and excludes rows exactly at the cutoff. |
| `recent_queries.py:2` | yes | Datetime normalization and inclusive >= semantics can classify rows differently from the raw strict comparison. |

Shared-helper shape: One canonical recent-query owner in recent_queries.py should define timestamp normalization and the boundary operator; consumers should reference it instead of separate SQL constants.
