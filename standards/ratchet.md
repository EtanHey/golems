# Ratchet tables (all repos)

> Etan-ordered 2026-10-06. A ratchet table stops us going in circles: every bug we hit becomes a
> row that replays it against the real thing, and the row can only get stricter.
> Script: `scripts/ratchet/table.mjs` (repo-agnostic; any repo calls it with its own row file).

## The six rules

1. **Every row is a real failure we hit**, replayed against the REAL binary or service
   (a cmux NIGHTLY socket, not a fake screen; the real daemon/DB fixture; the real socket/app; a
   hook as the real installer installed it, not the hook's source). Each row is shown to FAIL on
   the bug commit and PASS on the fix commit, and records both SHAs (`bug_sha`, `fix_sha`).
   "Installed" in a per-PR row means installed into a scratch HOME, never the live machine (see
   below).
2. **Seed rows from the circles we went in.** Every bug that came back, or was "fixed" twice,
   becomes a row. Behavior rows (pass/fail) count as much as numeric ones.
3. **Required check.** The ratchet job is in the branch ruleset's required checks. A missing
   result, socket or binary is FAIL, never SKIP. So is a run that selects no rows.
4. **PR-comment table** on every PR: baseline | this PR | Δ | ceiling | status, as ONE sticky
   comment refreshed in place, so implementer and reviewer self-correct.
5. **Ratchet direction only.** Any PR may add a row or tighten a ceiling. These need a lead ruling
   in the PR body, one line per row, `ratchet-loosen: <row-id> <ruling>`:
   - loosening a ceiling;
   - flipping its direction;
   - moving a row to another runner;
   - demoting `real` to `unit`;
   - removing a row.
6. **Mock-green is not a row.** A row that cannot reach the real thing is labeled `unit`. It is
   shown and still fails the job when red (it is a test), but it never counts as ratchet evidence:
   the verdict counts real rows only, and a table with zero real rows is not a ratchet.

## Real, without touching the live machine

A row that needs a machine (an installed hook, a real binary) never mutates that machine's live
install to measure a candidate. Two tiers:

- **Candidate rows (per PR).**
  - **Where it runs:** the producer installs the PR head into a SCRATCH HOME (and a scratch
    `CODEX_HOME`), outside every repository. It uses the real installer, the real interpreter
    and the real binaries (git, ssh-keygen, gh, codex).
  - **Trusted keys:** keys a gate trusts are fixtures generated in that scratch HOME. Their pin
    is committed in the scratch tree only, never pushed. A token issuer such as
    `golems-lead-confirm` is called only against that fixture anchor.
  - **What it can replay:** bug and fix SHAs replay there freely. Nothing is mocked, so these
    rows are `real`.
  - **Where the table goes:** it is bound to the PR head.
- **Live rows (post-merge, lead-run).**
  - The lead runs them after installing the merged commit on the real machine, and posts them
    on the merged PR. Examples: the live `--status` with drift 0, or the live gate with a real
    lead-issued token.
  - They read the live install and never downgrade it.
  - **No ratchet run ever installs a candidate on, or replays a bug SHA against, the live HOME.**

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

- `id`: `[A-Za-z0-9_.:-]+`, the charset a `ratchet-loosen:` line can name.
- `kind`: `real` | `unit`. Real rows must carry `bug_sha` and `fix_sha`.
- `ref_kind` (optional): `commit` (default) or `fixture-hash`, for a failure that was fixed in a
  private fixture rather than a commit. It keeps the commit SHAs and adds `bug_fixture` and
  `fix_fixture`, the fixture content hashes on which the row FAILS and PASSES.
- `direction`: `max` (value ≤ ceiling), `min` (value ≥ ceiling), or `pass` (value must be boolean
  `true`; `ceiling` is `true`).
- `runner` (optional): which producer measures the row, e.g. `ci`, `mac` or `live`. `--runner`
  selects those rows, so each producer posts its own table.
- `command`: how the producer reproduces the row. The table script never runs it.

## Results file (one per run)

```json
{ "head_sha": "<the SHA measured>", "results": { "hooks-live-drift": 0, "gate": { "value": true, "detail": "579/579" } } }
```

- **Values:** a value is a number, a boolean, or `{ value, detail }`.
- **Bound to a SHA:** a results file bound to any SHA other than `--head` is stale, and every
  row is then MISSING. So is a file that is absent or unreadable.
- **Published verbatim:** `detail` is published as written, so keep secrets out of it. Cells are
  escaped, so no detail can break the table or forge a line.

## Running it

```bash
node scripts/ratchet/table.mjs --rows <rows.json> --results <results.json> --head <sha> \
  (--base-ref <base sha> | --bootstrap) [--baseline <base-results.json>] \
  [--pr-body-file <body.md>] [--runner <name>] [--marker <name>] [--title <text>] \
  [--repo <owner/name> --pr <number> --author <login>] [--out <table.md>]
```

- **`--head` is required.**
- **The base is required too.**
  - `--base-ref`: the script reads the row file as committed at that SHA (`git show`) and checks
    rule 5 across ALL its rows, whatever `--runner` selects.
  - `--bootstrap`: only for a base with no row file yet. The table then says "direction
    unchecked".
- **Posting:** with `--repo/--pr/--author` it upserts ONE comment whose first line is
  `<!-- ratchet-table: <marker> -->`, posted by `--author`. It creates the comment once and PATCHes
  it thereafter, and never touches another author's comment. Use one marker per producer.
- **Verdict line:** the comment's second line is always
  `<!-- ratchet-verdict: {"head":…,"ok":…,"real_pass":…,"real_total":…} -->`. A consumer reads that
  line only (`readVerdict`) and must check that the comment's author is the producer it trusts.
- **Exit codes:**
  - `0`: every selected row PASS, and nothing loosened without a ruling.
  - `1`: any row FAIL or MISSING, no row selected, or an unruled loosening.
  - `2`: bad input (row file, arguments, base, PR body).
- **Other repos:** call the script pinned to a golems SHA (fetch
  `scripts/ratchet/table.mjs` at that SHA, or vendor that exact file with the SHA in a comment).
  It has no dependencies beyond node.

## Convergence close: baseline and open targets (Etan, 2026-10-06)

The ratchet is the starting point of the §12 pristine sprint. At convergence close, each repo's
lead records two short artifacts:

- **`docs.local/ratchet/BASELINE-<date>.md`:** the ratchet table as merged on main, with its SHA
  and date.
- **Open targets:** every known failure or improvement that has no row yet, each with its issue
  or PR link and the row it would become. This list is the §12 sprint backlog, which starts by
  turning targets into rows and tightening ceilings.
