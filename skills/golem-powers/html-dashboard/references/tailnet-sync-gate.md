# Gate: Tailnet Post-Write Sync Gate (a gate of `html-dashboard`, not a skill)

> Etan ruling 2026-09-06: "they should be gates, not skills." This was a standalone
> catalog entry until it was folded into its parent skill. Run it from the parent's
> post-Write sync step; there is no `/tailnet-sync-gate` slash command any more.

> "why didn.t you publish the dashboard." Every dashboard MUST land on the canonical tailnet hub.
> A local `docs.local/*.html` you only `Write` + `open` orphans the dashboard the user cannot find.
> No "published/live" leaves the seat without a SAME-TURN mirror to the hub AND an HTTP-200 on the served URL.
> (R-004, BROKEN-OPEN since gen-7.)

## Scope

Blocks a dashboard 'published/live' claim unless the SAME turn mirrored it to the tailnet hub AND got HTTP 200.

## What It Is

A deterministic detector over an agent transcript: if the current turn **Writes a dashboard** (a `Write`
whose `file_path` ends in `.html` under a `docs`/`docs.local`/`dashboards` path) **and** makes a
**publish/done/live claim**, then the SAME turn must ALSO carry the mirror + the 200 probe. This is the
MECHANICAL gate the global CLAUDE.md "CANONICAL DASHBOARD HUB — always publish" rule and `/html-dashboard`
describe in prose. The pinned RED/GREEN transcript fixtures ARE the replayable gate (R-003/R-014 pattern).

## The Rule — required same-turn evidence

| Condition | Required same-turn evidence | Violation if missing |
|---|---|---|
| dashboard Write **+** publish/live claim | a **mirror** to `dashboards-serve/dashboards/` — a `Write`/`cp`/`rsync` to that path, a `publish_dashboard`/`publish_html` MCP tool, or a run of `sync-tailnet-dashboards.mjs` | `DASHBOARD_NOT_MIRRORED` |
| | **AND** an **HTTP 200** check against `$TAILNET_HUB_HOST` — `curl`/`wget '%{http_code}'` hitting that host, with `200` in the tool OUTPUT | `DASHBOARD_NOT_200` |
| no dashboard Write | — | PASS (N/A) |
| dashboard Write, no publish claim | — | PASS (N/A — still drafting) |

"Same turn" = the events since the last human message — the mirror tool calls and the curl **and its
result** the agent ran before the claim. Negated/in-progress statements ("still mirroring", "not yet
live") are not claims; a bare ✅ next to in-progress language does not arm the gate.

## Evidence is tool-only — prose never clears the gate

The false-green-gate lesson: evidence comes ONLY from REAL tool execution — `Bash` COMMAND strings, tool
NAMES, and tool_result OUTPUTS. Assistant narrative ("mirrored to the hub ✅, curl returned 200") is
EXCLUDED. The 200 only counts if a `curl`/`wget` COMMAND actually targeted the tailnet host AND its OUTPUT
shows `200` — a 200 in a passive `Read` of a log, a 200 against `localhost`, or a 404/500 from the host all
FLAG. MCP tool names are base-normalized (`mcp__agent-html-publisher__publish_dashboard` → `publish_dashboard`).

## How /pr-loop & /html-dashboard Consume It

`/html-dashboard` references this gate as the post-Write sync check. Before a worker emits a "published/
live/here's the dashboard" message, run the gate on the turn — this gate
(`bun skills/golem-powers/html-dashboard/scripts/tailnet-sync-gate-cli.mjs <transcript|->`, exit 3 = FLAG).
A FLAG means the dashboard is orphaned or unverified: mirror it to the serve dir (or run
`scripts/sync-tailnet-dashboards.mjs`), curl the served URL for 200, then claim. Composes with
`/false-green-gate` (the broader live-outcome gate) and `/never-fabricate` (read the output before reporting).

## Run It

Set `TAILNET_HUB_HOST` from a gitignored env file before running the gate. If it is unset, the HTTP-200
check fails closed; never guess or commit a deployment hostname.

```bash
bun test skills/golem-powers/html-dashboard/evals/tailnet-sync-gate.test.mjs   # replay (CI-safe)
bun skills/golem-powers/html-dashboard/scripts/tailnet-sync-gate-cli.mjs <transcript.jsonl|->
```

Programmatic: `import { detectTailnetSync } from "./src/tailnet-sync-gate.mjs"` → `{ verdict, claim, dashboardWrite, violations }`.

## Stated Limits (honesty rule)

- Evidence is marker-anchored over the same-turn blob; a mirror/probe described but not actually run can
  read as absent (the gate is fail-CLOSED — prose claims are FLAGged, never cleared). New evasion shapes are
  added as RED fixtures (R-003 model).
- "Same turn" is bounded by the last human message; a 200 probe run two turns earlier does not count (by
  design — the orphan class is precisely a stale or absent same-turn mirror/probe).
- The 200 host comes only from `TAILNET_HUB_HOST`; deployment values belong in gitignored env, while evals
  use `hub.example.invalid`.

## Provenance

RED specimens: R-004 dashboard-orphan family (local Write + "published ✅", no mirror/no 200), mirror-without-
200, prose-bypass (mirror+200 claimed in narrative, no tools), 200-on-wrong-host (localhost), 200-from-
passive-Read, stale-prior-turn-200, host-404. GREEN references: Write+mirror+curl-200, sync-script+200,
publisher-MCP+200 (tool-name normalization), non-dashboard turn (N/A), write-no-claim (N/A), checkmark-in-
progress (N/A).
