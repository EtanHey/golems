# Routing Verification and Incident Lessons

This is the audit and failure-diagnosis reference; read it when creating/checking a collab, diagnosing a route, or copying the routing template.

## Pre-Collab Gate

Every collab declares the route before spawning:

```markdown
## Agent Routing
| Task | Tool | Agent ID | Surface/Workspace | Goal File | Report Path | DONE Marker | Status |
|---|---|---|---|---|---|---|---|
| Scan schema | Cursor | agent:abc | surface:XX / workspace:1 | goals/schema.md | reports/schema.md | DONE_SCHEMA | PENDING |
| Implement fix | Codex | agent:def | surface:YY / workspace:1 | goals/fix.md | reports/fix.md | DONE_FIX | PENDING |
| Coordinate | Claude | self | self | collab.md | final-report.md | DONE_ORC | IN_PROGRESS |
```

If a row points at an existing managed worker, reuse that `agent_id` and supersede it with the full goal.

## Mid-Sprint Gate

1. Claude context above 50% while workers are idle -> route remaining gather/implementation work now.
2. Dead Cursor/Codex surface -> recover the managed lane within 60 seconds and redeliver its file-backed goal.
3. Claude running bulk SQL, grep, scans, or git-history analysis -> Cursor-work violation.
4. Dispatching lead with no worker monitor -> fired-and-forgot violation; flag the lead.
5. Repeated large scrollback reads despite a report/DONE contract -> wait on the artifact instead.
6. Goal narrowed from the user mission to one issue/PR -> supersede the same worker with the full mission.

## Post-Sprint Gate

Audit whether each lead used assigned workers and how much gathering Claude did. Claude doing more
than 30% of data gathering is a process finding. Completion is checked against the contracted
artifact, not worker narration or a DONE marker.

## Incident Lessons

- **AP1: idle Cursor while Claude gathers.** The first action after spawning a worker is delivery; verify it accepted work within 15 seconds.
- **AP2: Cursor changes files.** Cursor prompts say `READ-ONLY: Do NOT modify any files`, name the report path, and exit after findings.
- **AP3/AP6: invented Cursor limits or pinned models.** Cursor stays Auto-only; its default path is unlimited. Never skip audits for a blanket "Cursor Pro usage limit."
- **AP4: Claude implements.** A coordinating Claude does not implement; bounded collab/docs/research updates and disclosed tiny lead unblockers are the only carve-outs.
- **AP5: orchestrator writes long content.** For documents over 50 lines, delegate drafting; the orchestrator supplies a short outline and synthesizes.
- **AP7: model self-identification.** Codex text is not runtime proof. Read the child's post-`task_started` session `turn_context`.
- **AP9/AP11: raw or verbose launch.** Use `{repo}{Tool} -s`; launcher ceremony belongs to `/repogolem`.
- **AP10: skillCreator bypass.** Skill/hook/agent/global-setting work pauses until skillCreator is in the loop.

The historical `cursor-multitask/evals/results/headless-ab-2026-06-05.json` did not observe effective
runtime model/effort. It is non-comparable history and MUST NOT support numeric evidence.

Verbatim user corrections retained from the incidents:

> "So no cursors were run, it seems. Am I correct?"

> "I stopped Cursor because it seems like it sent it to do things I'm not looking for anyone to do things. This is research."

> "brainlayer cursor scan is GPT-5.4. What the hell?"

> "CORRECTION: Cursor Pro does NOT have a usage limit"

## Self-Check Before a Change

```text
PAUSE. Am I about to change code or files?
- Coordinating Claude? Route it to Codex unless this is a bounded, disclosed, isolated tiny lead edit.
- Domain agent with no assigned Codex? It may be the implementer.
- Domain agent with assigned Codex? Send it to that Codex.
- Read-only scan/query? Cursor.
- SkillCreator-domain path without skillCreator? Stop and route for audit.
```

Historical utilization data set an orchestrator target below 30 Write/Edit calls per session; treat
crossing it as a routing smell and inspect whether the lead absorbed worker work.

## Copy Template

```markdown
## Agent Routing (MANDATORY)

| Task | Tool | Rationale |
|---|---|---|
| [gathering task] | Cursor (read-only) | Scanning, no changes |
| [implementation task] | Codex | File changes |
| [coordination task] | Claude | Orchestration and user interaction |

Rules:
- Cursor prompts include "READ-ONLY: Do NOT modify any files" and name where the coordinator will record the returned findings.
- Cursor stays Auto-only with no model field.
- Codex consumes Cursor's distilled findings, not raw data.
- Visible launch form is `{repo}{Tool} -s`; `/repogolem` owns details.
- Reuse managed workers; supersede changed missions with one full file-backed goal.
- Leads monitor report/DONE artifacts and low-frequency health.
- Close only DONE, BLOCKED/NOT_GREEN with handoff, or TRANSFERRED with successor evidence.
```
