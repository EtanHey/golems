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
   - changing what a row measures (its `command` or `metric`, or a longer `timeout_s`), unless it is
     a pure tightening;
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

- **Strict schema:** an unknown key, in the file or in a row, is rejected (exit 2). A field nobody
  checks is a field a producer could later read unchecked.
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
- `timeout_s` (optional, positive integer): the producer's time limit for the row. Raising or
  removing it is loosening.
- Editing the evidence (`bug_sha`, `fix_sha`, `ref_kind`, `bug_fixture`, `fix_fixture`) is not
  loosening, but every such edit is listed in the table.

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
  --base-ref <base sha> [--baseline <base-results.json>] \
  [--pr-body-file <body.md>] [--runner <name>] [--marker <name>] [--title <text>] \
  [--repo <owner/name> --pr <number> --author <login>] [--out <table.md>]
```

- **`--head` is required.**
- **`--base-ref` is required too.** The script reads the row file as committed at that SHA
  (`git show`) and checks rule 5 across ALL its rows, whatever `--runner` selects. Only a base
  commit that verifiably has no row file is a bootstrap ("direction unchecked" in the table). A
  ref that is not a commit exits 2; there is no flag to skip the comparison. A row file that was
  renamed or copied from another base path, or deleted, exits 2: it is never a bootstrap.
- **What the caller supplies:** the two inputs the script cannot verify, the row file path and
  the base SHA, come from the CI workflow (a hardcoded path, and the event payload's base SHA),
  never from the PR's own files.
- **Posting:** with `--repo/--pr/--author` it upserts ONE comment whose first line is
  `<!-- ratchet-table: <marker> -->`, posted by `--author`. It creates the comment once and PATCHes
  it thereafter, and never touches another author's comment. Use one marker per producer.
- **Verdict line:** the comment's second line is always
  `<!-- ratchet-verdict: {"head":…,"ok":…,"real_pass":…,"real_total":…,"bootstrap":…} -->`. A consumer:
  - reads that line only (`readVerdict`), from the same comment the producer PATCHes: the OLDEST
    comment by the trusted author whose first line is the marker (`findSticky`);
  - checks that the comment's author is the producer it trusts;
  - FAILs a `bootstrap: true` verdict whenever the base branch has a row file.
- **Exit codes:**
  - `0`: every selected row PASS, and nothing loosened without a ruling.
  - `1`: any row FAIL or MISSING, no row selected, or an unruled loosening.
  - `2`: bad input (row file, arguments, base ref, a non-string SHA, PR body).
- **Other repos:** call the script pinned to a golems SHA (fetch
  `scripts/ratchet/table.mjs` at that SHA, or vendor that exact file with the SHA in a comment).
  It has no dependencies beyond node.

## Companion scripts (golems)

- `scripts/ratchet/run-rows.mjs --rows <file> --head <sha> --out <results.json> [--runner <name>]
  [--cwd <dir>]`: the generic producer. It runs each selected row's `command` (bash). A `pass` row
  is true only on exit 0. A numeric row must exit 0 and print its number on the last stdout line,
  or it is left out (MISSING).
- `scripts/ratchet/check-comment.mjs --repo --pr --marker --head --rows --runner --author <login>`
  exits 0 only when that producer's comment carries a fixed-line verdict for exactly `--head`
  with every real row of `--runner` PASS. The comment must be by an allowed author.
- golems' own producers:
  - `scripts/ratchet/local-run.sh` produces the per-PR candidate tier, in a scratch HOME;
  - `scripts/ratchet/live-rows.sh` produces the post-merge live tier, and the lead runs it.

## Convergence close: baseline and open targets (Etan, 2026-10-06)

The ratchet is the starting point of the §12 pristine sprint. At convergence close, each repo's
lead records two short artifacts:

- **`docs.local/ratchet/BASELINE-<date>.md`:** the ratchet table as merged on main, with its SHA
  and date.
- **Open targets:** every known failure or improvement that has no row yet, each with its issue
  or PR link and the row it would become. This list is the §12 sprint backlog, which starts by
  turning targets into rows and tightening ceilings.

## CI debt ceilings and live-tier freshness

`py-undefined-names` uses pinned pyflakes 4.0.0 `UndefinedName` diagnostics (F821),
starting at 299 on `61508f58`. It checks git-tracked Python only, excluding path components
`vendor`, `vendored`, `third_party`, `node_modules`, `.worktrees` and `docs.local`.
Syntax/read/tool errors are MISSING, never a zero count. The five `size-*` rows count newline
bytes (as `wc -l` does), starting at 1084/853/1078/792/613. Growth fails; reductions pass.
These static checks are `unit` rows: they enforce ceilings but do not claim installed proof.

`live-tier-freshness` makes CI watch the lead-only live tier. It finds the latest first-parent
commit on `origin/master` touching the same guarded directories as `guarded-paths.sh`, then
requires the merged master PR for that commit to carry the lead's `golems-ratchet-live` sticky
comment. The fixed-line verdict must match that merge SHA or a later first-parent master commit, have `bootstrap: false`, and
pass every real live row defined on master. Missing, stale, red, wrong-author receipts and API
failures fail closed. Candidate PR changes and later unguarded merges do not invalidate a receipt.
There is no grace window: a guarded merge becomes red until the lead installs and runs
`live-rows.sh --merged-pr <latest guarded PR> ...` after installing current master. A later unguarded master SHA is accepted for the receipt;
branch SHAs and receipts preceding the guarded merge are rejected. The receipt measures the live
install's status and token probe; this CI row checks the receipt, never uses lead tokens or
installs hooks. It is labeled `unit` so receipt checks cannot be mistaken for a live replay.

The existing required `ratchet` job enforces this row only on guarded-path PRs, and on master
pushes, plus hourly and on
manual dispatch. Non-guarded PRs are exempt before any live API request, so the lead install
cannot block unrelated work. Failure output prints the exact `live-rows.sh` command; run it from
the open lease PR checkout after the lead installs current master. After the lead publishes the receipt, rerun the failed master/PR ratchet jobs
(or dispatch the workflow); posting a comment alone does not rerun CI. This prevents a green CI
claim for merged-but-uninstalled guarded changes. It does not continuously inspect the machine:
after a passing receipt, later local tampering still requires a fresh lead live run to detect.

## Installed skill parity on both Macs

`installed-skill-parity` is a read-only `live` row: it inventories the local and SSH host's
`.claude/skills`, `.agents/skills`, and `.codex/skills` afresh. Names, entry shapes, readable
SKILL.md catalogs, supporting file hashes and executable bits must match. HOME prefixes are
normalized; bounded mirrored sources require explicit per-entry target aliases. Finder files,
`.git`, `node_modules`, `__pycache__`, `.pytest_cache`, `.pyc` files, and namespace metadata
outside actual skill trees are excluded. This proves parity of installed skill source content;
excluded dependencies/caches are not claimed byte-identical or runtime-equivalent. Harness-owned
nested skills are measured without writing their install. Missing SSH, Python, roots, content
or the required-readable manifest fails; there is no capability skip.

Set `RATCHET_SKILL_HOST` and `RATCHET_SKILL_REQUIREMENTS`; optionally set
`RATCHET_SKILL_IDENTITY` to select an existing SSH identity. The private requirements JSON is
`{"schema":2,"identities":["<local identity object>","<remote identity object>"],
"roots":{"<root>":{"readable":["class-a","namespace/class-b"],
"allow_broken":[],"allow_empty":[],"target_aliases":{}}}}`, with all three roots and nonempty
readable lists. Freeze required catalogs from the approved source before reconciliation;
never regenerate them to excuse a lost skill. An alias maps an entry to its ordered local,
remote normalized targets, not to a content exception. Keep host identities and real manifests
in durable private evidence, never public fixtures. The command also supports explicit
`--left/--right` fixture inputs, labeled `fixture`; the live row never supplies those flags.

Name/content parity and required readability are separate output fields. Explicitly approved
source-invalid entries remain in `disclosed_invalid`; they cannot satisfy a required-readable
entry. The initial source had one dangling entry on both hosts and an empty namespace on both;
its approved private manifest preserves these shapes without claiming zero dangling links or
restored content. Account-owned metadata and active sessions remain untouched. This filesystem
row does not prove UI/session reload; use a safe installed catalog command separately.

The initial failure/fix are frozen private before/after host-inventory pairs (`fixture-hash`),
with the same source commit on both sides: the repair changed the remote installed catalog,
not the source checkout's tracked HEAD. Synthetic class-only tests run through the Python
skill suite and reject missing/extra/broken/hash/mode/target drift, including required skills
lost on both hosts. Fresh live SSH proof accompanies the saved RED/GREEN pairs.

Schema 2 inventories pin SHA-256 digests of the observed IOPlatformUUID, normalized hostname,
and resolved HOME as `identity: {machine, hostname, home}`. Private requirements pin the ordered
local/remote objects as `identities`; equal machines, absent/malformed identities or mismatched
pins fail. Identity comes from each host's read-only macOS system observation, not the caller's
SSH label. JSON object/list/member types are strict. Normal output contains only booleans and
counts; root/entry/host-role diagnostics stay on stderr in the lead's local log.

The original schema 1 inventories and their hashes remain immutable historical name/content
evidence. They cannot supply fresh host identity proof. Schema 2 requirements and fresh host
observations are stored separately; the row's fix fixture points at the new identity-bearing pair.
Run class-only tests with `WEAVE_ALLOW_TMP=1 python3 -B -m unittest discover -s scripts/tests
-p test_installed_skill_parity.py`; their owned temporary directories are outside the measured
checkout and contain no durable evidence.
