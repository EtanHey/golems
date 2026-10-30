# Archiving convention: detail

> [SKILL.md § Machine hygiene: no ad-hoc home folders](../SKILL.md#machine-hygiene-no-ad-hoc-home-folders)
> owns placement and deletion rules. This reference supplies the manifest schema, disk measurement
> commands and path reconciliation; the [archive procedure step 7](archive-procedure.md#7-optional-delete-the-local-heavy-copy)
> applies the single deletion gate.

## MANIFEST.json (one per archive unit)

Write it before upload, upload it inside the unit, and point the `_DRIVE-LEDGER.md` row at it.

```json
{
  "unit": "2026-10-29-whisper-benchmark",
  "source": "<repo>/docs.local/<lane>/2026-10-29-whisper-benchmark/",
  "host": "<hostname>",
  "producer": "<lead thread or plan id>",
  "archive": "Brain Drive/06_ARCHIVE/research/whisper-benchmark/2026-10-29/",
  "total_bytes": 48213,
  "files": [
    { "path": "run.log", "bytes": 48213, "sha256": "<64 hex>" }
  ],
  "restore": "<the command or MCP call that restores a file by its archive ID to a local destination>"
}
```

- `files[].bytes` is the byte count (`stat -f%z <file>`); `sha256` comes from `shasum -a 256 <file>`.
- `host` is the machine that produced the unit (`hostname -s`).
- List every archived payload file; the manifest itself is excluded from its own file list and
  `total_bytes`. List skipped regenerable derivatives with rebuild commands in the ledger instead.
- Every rollup unit needs a manifest too. Until `rollup.mjs` emits it, write it by hand before upload;
  the plan's paths and sizes do not supply hashes, host, producer or restore instructions.

## Measuring free disk (Machine hygiene rule 3)

```bash
diskutil info / | grep -i 'container free'   # free space in the APFS container
diskutil apfs list                           # per-volume allocation ("Capacity Consumed")
```

Record the host and before/after container free space and allocation. Apply § Machine hygiene rule 3
when reporting recovery; logical sizes and purgeable space are not physical recovery measurements.

## Reconciliation with the rest of this skill

| Section | Master convention | Delta |
|---|---|---|
| § Archive a heavy artifact; archive-procedure step 2 | Existing `06_ARCHIVE/<area>/<topic>/` placement | Use `YYYY-MM-DD` for the date level; tags are suffixes (`2026-10-29-pre-refactor`). Older folder shapes do not override this. |
| § Naming convention; § Machine hygiene: Naming and manifests | Local scratch/lane names use `YYYY-MM-DD-<topic>`; Drive units follow the archive and rollup layouts | Keep topic containers and the separate Drive date level. A flat local unit maps to `<topic>/<YYYY-MM-DD>/` on Drive. |
| § Machine hygiene: placement table | iCloud `Archive/<YYYY>/<topic>/` | Reconcile with the local naming rule: `Archive/<YYYY>/<YYYY-MM-DD>-<topic>/`. |
| § docs.local lifecycle | Month units use `06_ARCHIVE/docs-local/<repo>/<area>/<YYYY-MM>`; mtime plans preserve `<unitName>` | Month rollups are the sole date-level exception. At upload, mtime units add `<unitName>/<YYYY-MM-DD>/` using the newest-file date; the ledger and manifest record it. Each unit needs a hand-written manifest until the script emits one. |
| § Machine hygiene rules 2 and 5; archive-procedure step 7 | Verified archive bytes, a one-file restore, preservation proof outside the retiring scope, and explicit deletion authorization | Keep master's gate. Remove shortcuts in archive-procedure step 1 and its cache diagram; ownership or archive proof alone grants no deletion authority. |
