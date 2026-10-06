# Ratchet tables (all repos)

> Etan-ordered 2026-10-06. A ratchet table stops us going in circles: every bug we hit becomes a
> row that replays it against the real thing, and the row can only get stricter.
> Script: `scripts/ratchet/table.mjs` (repo-agnostic; any repo calls it with its own row file).

## The six rules

1. **Every row is a real failure we hit**, replayed against the REAL binary or service
   (a cmux NIGHTLY socket, not a fake screen; the real daemon/DB fixture; the real socket/app; the
   installed hook, not the hook's source). Each row is shown to FAIL on the bug commit and PASS on
   the fix commit, and records both SHAs (`bug_sha`, `fix_sha`).
2. **Seed rows from the circles we went in.** Every bug that came back, or was "fixed" twice,
   becomes a row. Behavior rows (pass/fail) count as much as numeric ones.
3. **Required check.** The ratchet job is in the branch ruleset's required checks. A missing
   result, socket or binary is FAIL, never SKIP.
4. **PR-comment table** on every PR: baseline | this PR | Δ | ceiling | status, as ONE sticky
   comment refreshed in place, so implementer and reviewer self-correct.
5. **Ratchet direction only.** Any PR may add a row or tighten a ceiling. Loosening a ceiling,
   flipping its direction, demoting `real` to `unit`, or removing a row needs a lead ruling in the
   PR body, one line per row: `ratchet-loosen: <row-id> <ruling>`.
6. **Mock-green is not a row.** A row that cannot reach the real thing is labeled `unit`. It is
   shown and still fails the job when red (it is a test), but it never counts as ratchet evidence:
   the verdict counts real rows only, and a table with zero real rows is not a ratchet.

## Row file (one per repo, JSON)

```json
{
  "schema": 1,
  "rows": [
    {
      "id": "hooks-live-drift",
      "metric": "hooks-live files drifted from the candidate after install",
      "kind": "real",
      "runner": "mac",
      "direction": "max",
      "ceiling": 0,
      "bug_sha": "<commit where the row FAILS>",
      "fix_sha": "<commit where the row PASSES>",
      "command": "scripts/ratchet/rows/hooks-drift.sh"
    }
  ]
}
```

- `kind`: `real` | `unit`. Real rows must carry `bug_sha` and `fix_sha`.
- `direction`: `max` (value ≤ ceiling), `min` (value ≥ ceiling), or `pass` (value must be `true`;
  `ceiling` is `true`).
- `runner` (optional): which producer measures the row, e.g. `ci` or `mac`. `--runner` selects
  those rows, so each producer posts its own table.
- `command`: how to reproduce the row by hand. The script never runs it; producers do.

## Results file (one per run)

```json
{ "head_sha": "<the SHA measured>", "results": { "hooks-live-drift": 0, "gate": { "value": true, "detail": "579/579" } } }
```

A value is a number, a boolean, or `{ value, detail }`. With `--head`, a results file bound to any
other SHA is stale and every row is MISSING. An absent or unreadable results file is MISSING too.

## Running it

```bash
node scripts/ratchet/table.mjs --rows <rows.json> --results <results.json> \
  [--head <sha>] [--baseline <main-results.json>] [--base-rows <rows.json at base>] \
  [--pr-body-file <body.md>] [--runner <name>] [--marker <name>] [--title <text>] \
  [--repo <owner/name> --pr <number>] [--out <table.md>]
```

- Prints the markdown table. With `--repo/--pr` it also upserts ONE comment that starts with
  `<!-- ratchet-table: <marker> -->` (create once, PATCH thereafter). Use one marker per producer.
- The comment ends with `<!-- ratchet-verdict: {"head":…,"ok":…,"real_pass":…,"real_total":…} -->`,
  so another job can check a producer's verdict for the exact PR head.
- Exit `0` all rows PASS and nothing loosened without a ruling; `1` any row FAIL or MISSING, or an
  unruled loosening; `2` malformed row file or arguments.
- `--base-rows` is the row file at the PR's base (`git show "$BASE_SHA:<path>"`); without it the
  direction check (rule 5) does not run, so CI always passes it.
