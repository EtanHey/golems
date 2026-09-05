# Claude Web Migration Workflow

Use this when converting legacy Claude Web research batches from the Obsidian folder into the Drive-backed v2 layout.

## Preconditions

1. Run `bash skills/golem-powers/research/_shared/verify-account.sh`
2. Confirm the active Google account is `research-account@example.com`
3. Start with the smallest batch first, usually `batch-cmux`

## Dry Run

```bash
bash skills/golem-powers/claude-web-research/scripts/migrate-obsidian-to-drive.sh batch-cmux --dry-run
```

Review the JSON summary:
- `planned` count should match the number of source files that will land in Drive
- targets should split into `description.md`, `instructions.md`, `context/`, `prompts/`, and `results/`

## Real Run

```bash
bash skills/golem-powers/claude-web-research/scripts/migrate-obsidian-to-drive.sh batch-cmux
```

Expected outcomes:
- files upload into `Brain Drive/Research/cmux/`
- a `DEPRECATED.md` marker is written to the old Obsidian batch folder
- re-running the command skips unchanged files instead of duplicating them

## Verification

1. Check the JSON summary for `uploaded` vs `skipped`
2. Re-run the same command once
3. The second run should report `uploaded: 0` for unchanged files
4. Spot-check Drive for:
   - `Brain Drive/Research/<project>/description.md`
   - `Brain Drive/Research/<project>/instructions.md`
   - `Brain Drive/Research/<project>/context/`
   - `Brain Drive/Research/<project>/prompts/`
   - `Brain Drive/Research/<project>/results/`
