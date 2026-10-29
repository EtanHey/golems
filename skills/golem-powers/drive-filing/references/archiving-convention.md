# Archiving convention: detail

> `../SKILL.md` § Archiving convention states the rules. This file holds the manifest schema, the
> pre-delete check, the disk measurement commands and the reconciliation with the rest of the skill.

## MANIFEST.json (one per archive unit)

Write it before the upload, upload it inside the unit, and point the `_DRIVE-LEDGER.md` row at it.

```json
{
  "unit": "2026-10-29-whisper-benchmark",
  "source": "~/Gits/<repo>/docs.local/<lane>/2026-10-29-whisper-benchmark/",
  "host": "<hostname>",
  "producer": "<lead thread or plan id>",
  "archive": "Brain Drive/06_ARCHIVE/research/whisper-benchmark/2026-10-29/",
  "total_bytes": 48213,
  "files": [
    { "path": "run.log", "bytes": 48213, "sha256": "<64 hex>" }
  ],
  "restore": "<the command or MCP call that brings one file back, e.g. mcp__google-drive__downloadFile(<file-id>, <dest>)>"
}
```

- `files[].bytes` is the real byte count (`stat -f%z <file>`); `sha256` comes from `shasum -a 256 <file>`.
- `host` is the machine that produced the unit (`hostname -s`), so a restore knows where the source lived.
- Every file in the unit is listed. A file that is skipped as a regenerable derivative is named in the
  ledger's Skipped section with its rebuild command, not in `files`.

## Before deleting a local copy (rule 2)

All three, in order. A name match on Drive or in iCloud proves nothing.

1. **Present:** `listFolder` (Drive) or `ls -l` (iCloud) shows every `files[].path` at its manifest byte count.
2. **Hashes match:** re-hash the local copy you are about to delete; every value equals the manifest.
3. **Restore tested:** download one file from the archive to `docs.local/` and hash it; it must
   equal its manifest `sha256`.

Then rule 5 still applies: the deletion is yours only if you own the data. Record the check in the ledger
row (`verified: <date>, restored <file>`).

## Measuring free disk (rule 3)

```bash
diskutil info / | grep -i 'container free'   # free space in the APFS container
diskutil apfs list                           # per-volume allocation ("Capacity Consumed")
```

Finder's free figure counts purgeable space, and `du` sums logical sizes (clones and sparse files
inflate them), so neither proves that a cleanup freed anything. Report the before/after container free.

## Reconciliation with the rest of this skill

| Point | Convention draft | Skill before | Decision |
|---|---|---|---|
| Drive path | `06_ARCHIVE/<area>/<topic>/<YYYY-MM-DD>/` | `…/<date-or-tag>/` | The skill's layout wins. The date level is now always `YYYY-MM-DD`; a tag becomes a suffix (`2026-10-29-pre-refactor`). |
| Unit folder name | `<YYYY-MM-DD>-<topic>` | topic folders `<topic>-<domain>/` | Both. Topic folders stay undated containers. A unit that sits flat (a docs.local lane, iCloud, local staging) is `<YYYY-MM-DD>-<topic>`. On Drive the date is its own level, so the path carries it. |
| iCloud path | `Archive/<YYYY>/<topic>/` | none | `Archive/<YYYY>/<YYYY-MM-DD>-<topic>/`: the year folder from the table, the unit name from the naming rule. |
| docs.local rollup | none | `06_ARCHIVE/docs-local/<repo>/<area>/<YYYY-MM>` | Unchanged. `rollup.mjs` owns month units; its plan files are the manifest-equivalent for that flow until it emits MANIFEST.json (follow-up). |
| Local delete gate | manifest hashes + one-file restore | `listFolder` + ledger row | The convention wins: archive procedure step 7 now requires both. |
| docs.local deletability | n/a | "safe to delete, recoverable from Drive" | Only after the rule 2 check and with ownership (rule 5). |

## Follow-up rows (not built here)

- An inventory check that flags new top-level `~/` or `~/Desktop` folders made by agents (owned by the
  operator's user, recent birth time, a known lane pattern such as `m1-*`).
- Link the per-Mac leftover ledger kept by the local-files lead from § Archiving convention.
- `rollup.mjs` emitting a MANIFEST.json per upload unit.
