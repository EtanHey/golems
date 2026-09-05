# Run a Plan Council

## Inputs

- One immutable plan/spec path and, when reviewing execution, its exact head SHA.
- Declared author identity and family (the author identity holds no seat; its family should).
- Complete lane list, read-only repo path, collab path, and one sentinel per seat.

## Pre-flight

1. Write the three briefs from [../references/seat-briefs.md](../references/seat-briefs.md), replacing
   every bracketed placeholder. Do not supply a common rubric.
2. Create 3 visible cmux panes. Use the repo launchers for Opus and Sol; use the raw Fable command.
3. Verify each pane within 30 seconds with cmux `read_screen`. Confirm its effective model, brief,
   repo, and read-only constraint. A missing/mismatched seat is not a council; relaunch it.
4. Start marker-count monitoring against the append-only collab. Use one supervised monitor per live
   lane; do not use bare `tail -f`. Record the monitor identity and stop it when the lane closes.

## Seat launch contract

| Seat | Required pin | Visible launch |
|---|---|---|
| R1 | Opus 5 | `<repo>Claude -s "Read and follow <R1-brief-path>"`; abort if the launcher does not report Opus 5. |
| R2 | GPT-5.6-Sol, xhigh | `<repo>Codex -s -E xhigh "Read and follow <R2-brief-path>"`; abort if the launcher does not report GPT-5.6-Sol/xhigh. |
| R3 | Fable 5 | `claude --dangerously-skip-permissions --model claude-fable-5 "Read and follow <R3-brief-path>"`. |

The launcher pin is authoritative for R1/R2; never pretend a rejected model override worked.

## Harvest and gate

1. Wait for all three distinct sentinels by marker count.
2. Run `python3 <plan-council-skill-dir>/council_lint_cli.py <collab> --seat <R1|R2|R3> --sentinel <seat-sentinel> --author-seat <author-voting-seat-or-nonseat-id>` for each seat, with every lane. If the author improperly took R2, pass `--author-seat R2`; when the author holds no seat, pass its non-seat ID. The CLI extracts a sentinel-delimited seat ballot from the shared collab before applying file-scoped rules.
3. Run `python3 <plan-council-skill-dir>/council_bias.py` across the ballot directory. Reject any declared merge that differs from
   `min(non-author-family)`.
4. Publish a table of lane scores, conservative reads, numeric bias, verdicts, and top changes.
5. Dispatch the lift round for every lane below 8.

If a running contract changes, send the correction in-pane. Editing its brief after boot does not
update the running judge.
