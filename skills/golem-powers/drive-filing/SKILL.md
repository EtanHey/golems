---
name: drive-filing
description: "Brain Drive upload, archive this, post-digest archival, docs.local cleanup/rollup. NOT for Gemini Deep Research/queries."
---

# /drive-filing — filing, archival, and the docs.local lifecycle

> One skill for everything that moves durable artifacts out of `docs.local/` (formerly `drive-usage`,
> `google-drive-archive`, and the `archive` skill).
> Drive queries use connected Drive search tools; this skill owns filing.
>
> Etan's pain: agents (except researchers) don't use Drive right and **leave artifacts scattered in `docs.local/`**. This skill makes filing automatic. **Rule of thumb: if an artifact should outlive this session, file it by § Machine hygiene: code and harnesses in a repo, personal or client documents in iCloud, other durable artifacts in the RIGHT Brain Drive folder — `docs.local/` is a cache, not a home.**

| Need | Go to |
|---|---|
| Which folder, what name | § Brain Drive folder model, § Decision tree, § Naming convention (below) |
| Put a heavy (>100KB / media / transcript) artifact into Drive, with ledger + brain_digest | § Archive a heavy artifact → [references/archive-procedure.md](references/archive-procedure.md) |
| Keep `docs.local/` legible over time (daily → monthly → Drive) | § docs.local lifecycle |
| Manifest schema, disk measurement commands, path reconciliation | [references/archiving-convention.md](references/archiving-convention.md) |

Not this skill: connected Drive search tools query existing files; `/gemini-research` does web research with Drive sources.

## Brain Drive folder model

Folder IDs are private deployment values. Resolve them from the environment or private operator
configuration; never copy live Drive IDs into this skill.

| Folder | id | What goes here |
|--------|----|----|
| `01_STANDARDS` | `${BRAIN_DRIVE_STANDARDS_FOLDER_ID}` | Canonical specs, conventions, locked schemas, standards docs (durable reference). |
| `02_GROUNDING` | `${BRAIN_DRIVE_GROUNDING_FOLDER_ID}` | Grounding corpora / reference data agents ground answers on. |
| `03_RESEARCH` | `${BRAIN_DRIVE_RESEARCH_FOLDER_ID}` | Research **prompts + results**. In-flight → `03_RESEARCH/Active/<topic>/` via `${BRAIN_DRIVE_RESEARCH_ACTIVE_FOLDER_ID}`. |
| `04_INGEST` | `${BRAIN_DRIVE_INGEST_FOLDER_ID}` | Raw inbound to be processed/digested (not yet curated). |
| `06_ARCHIVE` | `${BRAIN_DRIVE_ARCHIVE_FOLDER_ID}` | **Forever** storage of finished heavy artifacts (transcripts, audio/video, big audits/plans). Target of § Archive a heavy artifact. |

> Folder *semantics* (what each numbered folder means) are confirmed with brainlayer-LEAD (s:57, owns Drive/backup). Legacy non-numbered folders (`Research` ×2 duplicates, `Sessions`, `Collabs`, `_inbox-*`, `BrainBar Design Audit`) are pre-taxonomy scatter — **do not add to them**; file into the numbered model. (Consolidation of the legacy dupes is an s:57 cleanup task.)

Legacy `Brain Drive/Research/<project>/` folders are being moved under 03_RESEARCH/Active; if a prompt isn't found in Active, check the legacy path read-only and report it, never write there.

## Decision tree (where does THIS artifact go?)

1. **A research prompt or its results?** → `03_RESEARCH/Active/<topic>/` (e.g. `skills-eval/`). Drive-ground prompts by uploading the real artifacts beside them.
2. **A finished heavy artifact (>100KB / media / raw transcript / big audit)?** → § Archive a heavy artifact → lands in `06_ARCHIVE/<area>/<topic>/<YYYY-MM-DD>/`, leaves a `_DRIVE-LEDGER.md` pointer in `docs.local/`.
3. **A canonical standard / spec / locked schema?** → `01_STANDARDS/`.
4. **Grounding corpus / reference data?** → `02_GROUNDING/`.
5. **Raw, not-yet-digested inbound?** → `04_INGEST/`.
6. **Lightweight, session-scoped scratch?** → fine to leave in `docs.local/` — but if anyone else (or future-you) needs it, FILE it per 1–5.

## Naming convention
New standalone artifacts: `YYYY-MM-DD-<project>-<topic>-<kind>[-by-<producer>].<ext>`, lowercase kebab-case. Example: `2026-11-04-voicebar-focus-audit-by-author.md`. Topic must describe the work; `Theo.md`, `Model.md` and `2026-11-04-golems-theo-report.md` fail. Put a person/model attribution in `by-<producer>` (exactly one lowercase token), never in the project, topic or kind slots. Kinds: report, prompt, result, transcript, recording, audit, plan, review, frame, image, notes, receipt, manifest, data, archive, index, dashboard, summary, eval, log.

Before uploading a new standalone artifact, set `GOLEMS_ROOT` to the absolute golems checkout (normally `$HOME/Gits/golems`) and run `node "$GOLEMS_ROOT/scripts/drive/lint-name.mjs" <basename>` from any repo; nonzero blocks filing until renamed. Existing files and preserved archive members (including `MANIFEST.json` and frame names) are grandfathered: `--existing` reports issues without blocking or renaming. Research-lifecycle's sequential context/R-number names keep their own contract. Folders retain `<topic>-<domain>/`; keep local mirror and Drive names identical for 1:1 ledger mapping.

## Verify the ledger after uploads

Use one bullet per file: `- <local path> → Brain Drive/<exact path>/<name> | bytes=<integer> | SHA256=<64 hex> | account=<expected-email> | cloud=pending`. SHA256 is mandatory: missing or invalid hashes are malformed rows. Bare `Brain Drive/` paths require `account=<expected-email>`; mount paths derive it from `GoogleDrive-<account>` (an explicit account, if provided, must agree). Record hashes from the source manifest; metadata such as Drive ID/URL and manifest pointer may follow as extra pipe fields. Absolute Drive-for-Desktop paths containing `/My Drive/Brain Drive/` are also accepted. Old Markdown tables remain readable history; add a machine-readable pending row for verification.

```bash
GOLEMS_ROOT="${GOLEMS_ROOT:-$HOME/Gits/golems}"
node "$GOLEMS_ROOT/scripts/drive/verify-ledger.mjs" <ledger.md>            # dry-run; no ledger write
node "$GOLEMS_ROOT/scripts/drive/verify-ledger.mjs" <ledger.md> --apply    # only verified rows change
```

Run after each upload batch from any repo using the absolute `GOLEMS_ROOT`. The token has full Drive scope; the verifier only reads, using GET requests through the existing outside-repo OAuth guard. It checks the recorded account for every path, resolves every exact path (duplicates fail), compares bytes and the mandatory recorded SHA-256 (downloads remote bytes if Drive omits the checksum), and alone writes `cloud=verified <ISO timestamp>`. A local mount/cache is not sync proof. Missing, malformed, mismatched or unauthenticated rows remain pending with a reason on stdout; exit 1 means some rows remain, exit 2 is usage/ledger failure. Names in old rows are report-only. `--apply` is idempotent and never uploads or deletes. Deletion still requires the full preservation and authorization gates below.

## Machine hygiene: no ad-hoc home folders

Applies to both Macs. Each kind of artifact has one home:

| Kind | Lives in | Never in |
|---|---|---|
| Rerunnable source, harnesses, test kits, eval scripts, fixtures | A repo, committed; generated fixtures in its `docs.local/` or `fixtures/` with a regeneration recipe | `~/`, `~/Desktop`, `~/temp`, ad-hoc repo copies |
| Live lane reports, receipts, logs | Owning repo's `docs.local/<lane>/` on the machine that ran it | `~/m1-*`, `~/vlv*` / `~/.vl*`, `~/vl-harness*` copies, `~/BrainLayer-*`, Desktop handoff folders |
| Finished heavy artifacts, including benchmark runs | § Decision tree → § Archive a heavy artifact; leave `_DRIVE-LEDGER.md` | Local disk “for later” |
| Personal or client documents Etan keeps | iCloud Drive `Archive/<YYYY>/<YYYY-MM-DD>-<topic>/` | Desktop root |
| Models and caches (Whisper, HF, npm/bun) | Tool's own cache directory, one copy recorded in app config | `~/Documents`, duplicate caches |
| Worktrees | `~/.t3/worktrees/` or `<repo>/.worktrees/`; retire through the lifecycle contract | Other locations or ad-hoc repo copies |

**Naming and manifests.** Local scratch/lane folder names use
`YYYY-MM-DD-<topic>` in lowercase kebab-case, without machine prefixes (`m1-*`)
or retired names (Ralph). Drive placement follows the existing layout above
and the rollup targets below, including their `<YYYY-MM>` units; this local
folder rule does not rename Drive archive units.

Every archive unit carries `MANIFEST.json` with:

- Source path and host.
- Byte count and SHA-256 for each file.
- Producer (lead thread or plan).
- Restore command.

Schema and measurement commands: [references/archiving-convention.md](references/archiving-convention.md).

**Five rules:**

1. Agents create no ad-hoc folders in `~/` or `~/Desktop`. Use sanctioned T3
   scratch or repo `docs.local/` scratch under the
   [workspace lifecycle contract](../_shared/lifecycle/CONTRACT.md).
2. Delete a local archive copy only after the Drive or iCloud copy exists,
   manifest hashes match verified remote bytes, and a one-file restore drill
   succeeds. A matching name or folder listing is insufficient. Keep the ledger
   and preservation proof outside any retiring scope; follow the archive
   procedure and lifecycle contract for their additional verification gates.
3. Measure disk recovery with `diskutil` container free space and APFS allocation.
   Finder free space includes purgeable space; logical `du` sums do not prove
   physical recovery. Record the host and before/after measurements.
4. Leads reap their own lane leftovers at settle, after harvesting and releasing
   consumers under the lifecycle contract. Unowned leftovers go to the
   local-files lead's per-Mac ledger; never silently delete them.
5. Deleting data remains a one-way door. Reviewed empty directories may be
   removed with `rmdir`. Nonempty data needs an identified owner, verified
   preservation and Etan's explicit instruction for that deletion, or a door he
   already opened for that work (quote his authorization). A lead's own call
   is insufficient; archive proof alone grants no deletion authority.

**Enforcement follow-up (not implemented by this section):** add a report-only
inventory check for new agent-created top-level `~/` and `~/Desktop` directories
(uid 501, recent birthtime, patterns such as `m1-*`, `vlv*` / `.vl*`,
`vl-harness*` copies and `BrainLayer-*`). These are investigation signals,
not ownership or deletion proof. The local-files lead must register and link the
M4 Max and M1 Pro ledgers here once their canonical locations are confirmed;
until then, report unowned leftovers to that lead. Never infer a ledger path or
add a destructive home-wide reaper.

## The discipline (the one rule)
**Before you finish a task that produced a durable artifact: did you FILE it in its home, or leave it scattered in `docs.local/`?** Use the § Machine hygiene table: code and harnesses go to a repo, personal or client documents to iCloud, other durable artifacts to the right Brain Drive folder. If durable and still only local → file it now (the decision tree above, or § Archive a heavy artifact) and drop a one-line `_DRIVE-LEDGER.md` pointer. "It's in docs.local" is not "it's saved."

## Quick reference (MCP)
- Upload: `mcp__google-drive__uploadFile(localPath, parentFolderId=<resolved private ID>)`. For text, pass `mimeType` from the extension (`.md` → `text/markdown`, `.txt` → `text/plain`, `.json` → `application/json`); a `.md` starting with `<!--` otherwise lands as `text/html`.
- New topic folder: `mcp__google-drive__createFolder(name, parent=<resolved private ID>)`.
- Find: `mcp__google-drive__search(query="'<RESOLVED_PRIVATE_PARENT_ID>' in parents", rawQuery=true)`.
- Heavy/forever: § Archive a heavy artifact.

## Research grounding folder contract

One folder per research holds only the curated documents that research needs as a
provenance record. Agents prepare ONE folder holding exactly the curated grounding
files with unique names. The hand-off names that folder and the files to attach;
the owner attaches them when he starts the run with Drive source off by default. A folder is not a Deep Research access route:
its connected Drive workspace provides title SEARCH only, not folder listing or
opening Docs by link. Native Google Docs do not solve this limitation. If Drive
is explicitly used, name each document by its exact title, unique across the whole
Drive with no duplicate or look-alike titles; expect search to miss documents.
Before the real run, one cheap Deep Research probe asks only for each named
file's first line, checked against the author key. Missing or mismatched lines
block the real run; retain the admission table/key for the real run too.

- **Where:** `Brain Drive/03_RESEARCH/Active/<topic>/R{NN}-grounding/` (via `${BRAIN_DRIVE_RESEARCH_ACTIVE_FOLDER_ID}`), beside that research's prompt and results.
- **Name:** `R{NN}-grounding` for the folder; files keep their `/research-lifecycle` context numbers. For the optional Drive route, titles must be unique across the whole Drive, not only inside this folder (include project, research number and topic to disambiguate).
- **Manifest:** `00-GROUNDING-MANIFEST.md` in the folder: one row per file with `title | why it is here | drive_file_id | revision_id`. Native Google Docs have no stable bytes, so identity is the Drive file id plus revision id, never a byte hash. Serialize each row as exactly `title|drive_file_id|revision_id` (the why stays out of the hash), UTF-8, LF line ends, rows sorted by `drive_file_id`; `manifest_sha256` is the sha256 of those lines joined by LF. The prompt names exactly the manifest's files and says to use ONLY them.
- **After harvest:** the folder is the research's record. Keep it as that record, or consolidate lasting findings into the topic's `context/` files per `/research-lifecycle`, so Drive stays in good context. Either way the folder link, the manifest and `manifest_sha256` stay in the harvest record so provenance keeps its identity. Archiving the folder (§ Archive a heavy artifact) is optional, not required.

## Archive a heavy artifact

Full procedure: [references/archive-procedure.md](references/archive-procedure.md) (was
`/google-drive-archive`). Fire it on "save this to Drive", "archive this", "put this in the
archive", a >100KB write to `docs.local/{research,audits,plans}/`, a post-`brain_digest` raw file,
or a `/tmp` cleanup that may hold forever-knowledge. The eight steps, in short:

1. Ephemeral or forever? Only originals go up; list regeneratable derivatives and how to rebuild them.
   Not archiving a file grants no deletion authority; apply § Machine hygiene rule 5.
2. Resolve `Brain Drive/06_ARCHIVE/<area>/<topic>/<YYYY-MM-DD>[-<tag>]/` (`research`, `audits`, `plans`,
   `repos`, `voice`); `mcp__google-drive__search` for precedent first.
3. `createFolder` per level, keeping every ID. 4. `uploadFile`; keep `id`, `link`, `size`.
5. `brain_digest` every text file (a background agent for >150KB).
6. Write `docs.local/<area>/<topic>/_DRIVE-LEDGER.md` (never committed) with pending rows, then run § Verify the ledger after uploads. Never mark rows verified by hand.
7. Write the ledger, then apply § Machine hygiene rules 2 and 5 as the single deletion gate:
   manifest hashes must match verified archive bytes, a one-file restore test must pass,
   and Etan must authorize deletion (or have already opened that door for this work, quoted).
   A `listFolder` result and ledger alone never authorize deletion.
8. `brain_store` unusual archive decisions only.

Never: commit a 1.5GB transcript, `rm -rf /tmp/…` before the forever check, digest without
uploading, upload without a ledger row, re-upload what Drive already has.

## docs.local lifecycle

### Monthly qa-video archive

Job `monthly-qa-video-drive-archive`: first day of each month, Asia/Jerusalem, ONLY on the skill-creator lead's scheduling child (seat/role resolution: /agent-routing). The lead creates it after merge. Exact scheduled command: `node "$HOME/Gits/golems/scripts/drive/archive-qa-video.mjs" --apply`. Never add pruning to the scheduled command.

Configure `~/.config/golems/qa-video-archive.json` outside repos: `{"account":"<expected-email>","repos":[{"path":"<absolute-repo-root>","owner":"<producer>","harvestedRuns":["<completed-run-name>"]}]}`. The scheduled job reports a missing config path and these required fields on stderr (exit 2). Before activation, create the config and run a configured `--dry-run` with eligible runs. Owners register only harvested runs; unknown ownership/harvest state stays held. Default command (or `--dry-run`) reports counts/bytes without writes or Drive calls. For unconfigured read-only inventory, repeat `--repo <absolute-repo-root>` with `--dry-run`; those units remain held until owners register them. `--apply` uploads preserved members plus MANIFEST.json to `Brain Drive/06_ARCHIVE/docs-local/<repo>/qa-video/<YYYY-MM>/<run>/`, writes pending member rows, restores one image (or a member if no image), checks its bytes/hash, then runs the verifier. Existing members and MANIFEST.json keep their names. No derivative is omitted.

Old means newest member mtime before the first day of the preceding calendar month (Asia/Jerusalem month); current/previous months stay local. Producer holds (`active`, `pinned`, `hold`, `latest`, `partial`, `unharvested`), credentials/content scans, symlinks, unknown ownership and regenerable directories hold the whole run. Manifests and the ledger stay outside the run. Re-runs reuse matching remote files/rows; conflicts stop. The existing outside-repo OAuth guard provides authentication; never call `op`. The token has full scope; image fetch uses only GETs.

Local pruning is optional, never implied by archive success: only `--apply --prune-verified`, with ownership and explicit deletion authority under Machine hygiene rule 5, may remove unchanged members after every row is verified, every remote hash matches and a restore drill passes. It preserves the ledger/manifests; logical bytes are not physical disk recovery. An existing `.archive-lock` holds only that repo; other repos continue. The job names the lock on stderr and exits nonzero. Confirm no archive process is active, then clear only the empty lock directory with `rmdir` and rerun; never automatically delete it. Pending counts include each remaining ledger row once across runs. Pruning removes empty nested directories; any newly nonempty directories remain intact without a cleanup error.

For a missing cited image, use `node "$HOME/Gits/golems/scripts/drive/fetch-qa-image.mjs" <ledger.md> <original-image-path>`; it restores exact verified ledger bytes into `~/.cache/qa-video/`, reports the Drive path/ID/URL/hash, and never changes Drive or the ledger. Open that returned image before making a visual claim; ambiguity, missing bytes or hash/auth failure stays NOT DETERMINED.

`docs.local/` stays legible, "not just walls of MD files": daily items (`YYYY-MM-DD-*`) roll up into
monthly folders (`YYYY-MM/`), and months older than N go to Brain Drive through § Archive a heavy
artifact, with a `_DRIVE-LEDGER.md` pointer left behind. `/fleet-wrap` is to run it at sprint close
(skillcreator owns that call site; golems owns this skill).

```bash
node "$GOLEMS_ROOT/skills/golem-powers/drive-filing/scripts/rollup.mjs" --repo <path> --keep-months N            # dry-run (default): report only
node "$GOLEMS_ROOT/skills/golem-powers/drive-filing/scripts/rollup.mjs" --repo <path> --keep-months N --json     # the full plan
node "$GOLEMS_ROOT/skills/golem-powers/drive-filing/scripts/rollup.mjs" --repo <path> --keep-months N --apply    # month moves + plan file
```

The last stdout line is the one-line summary `/fleet-wrap` records: `drive-filing rollup: mode=… files=…
bytes=… · monthly-moves=… · to-drive months=… files=… bytes=… · mtime-units=… bytes=… · held=… credentials-skipped=…`.
**Dating (v2):** an item's month is the first `YYYY-MM-DD` anywhere in its own name, else the first
`YYYY-MM` (`examplechannel-2026-09-19-015034/`, `probe-2026-03/`); an exact `YYYY-MM/` folder is the month itself.
An undated folder with a dated name somewhere below it is an *area* and is descended. An undated folder
with none is **one mtime unit** (the highest such folder), dated by the newest file inside; it joins the
upload plan once old but is **never moved**; its planned Drive target keeps its own path
(`…/<repo>/<area>/<unitName>`, no month segment: it mirrors the unmoved local path), so no two units share a target.
At upload, an mtime unit gets a date level: `…/<repo>/<area>/<unitName>/<YYYY-MM-DD>/`,
dated by its newest file (the date the plan used), recorded in the ledger and its `MANIFEST.json`. `--json` lists the 5 largest under
`mtimeUnits`. A unit with no files or only empty ones is counted (`empty-units=`) and never planned.
Undated files are counted and left alone. **Regenerable dirs** (`__pycache__`, `node_modules`, `.venv`,
`venv`, `.pytest_cache`, `.mypy_cache`, `.ruff_cache`, `.build`, `.next`, `.turbo`, `.probe`) are never
planned, never an mtime unit and never deleted; each is reported once as `skipped: regenerable <path>/`
with its size, and the summary adds `regenerable-skipped=N bytes=B`. A credential inside one still wins
(the dir is held). A month rolls up once it is over; months more than N back form
the upload plan, one unit per folder, targeting `Brain Drive/06_ARCHIVE/docs-local/<repo>/<area>/<YYYY-MM>`
(the one named exception to the `YYYY-MM-DD` date level: a rollup unit is a month).
`--apply` moves items into their month folders (never overwriting; a clash is reported as `conflict:`)
and first saves immutable `docs.local/_drive-filing/rollup-plan-<date>-<uuid>.json` intent.
A separate `rollup-progress-<date>-<uuid>.json` records source/destination locations (both during a move).
Reruns reconcile file identities before publishing `rollup-handoff-<date>-<uuid>.json` (`planFile` in `--json`);
conflicting or missing files stop with a progress path. Earlier plans stay intact. **The script never uploads or deletes.**
Newly held sources remain in place as `not-moved` with a reason. Safety checks run before the first move.
After the handoff is saved, completion markers keep settled intents out of future reads. With no moves or
unfinished intents, `--apply` writes nothing and prints the current inventory (`--json` has no `planFile`).
Human output names a saved handoff before its final summary. Receipts store absolute paths: resume at the same repo path.
Upload exactly the files in that handoff through the [archive procedure](references/archive-procedure.md)
(ledger + `brain_digest`), and nothing that is not in it. The plan is **not** a manifest (it lists paths
and sizes, with no hashes, host, producer or restore command): until `rollup.mjs` emits one, write each
unit's `MANIFEST.json` by hand before its upload and upload it with the unit.

**Credentials never move.** Always-held basenames are case-insensitive; a leading
YYYY-MM-DD- or YYYY-MM-DD_ may precede a shape. The canonical list is
[scripts/credential-policy.mjs](scripts/credential-policy.mjs); tests check this block:

<!-- credential-names:start -->
`.env`, `.env.*`, `.envrc`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `id_rsa*`, `id_ed25519*`, `*.keychain*`, `auth.json`, `credentials`, `credentials.json`, `.credentials.json`, `.netrc`, `.npmrc`, `.pypirc`, `token.json`, `*secret*.json`, `*.kdbx`, `.git-credentials`, `application_default_credentials.json`, `service-account*.json`, `*.p8`, `*.keystore`, `*.jks`, `.pgpass`, `Login Data`, `Login Data For Account`, `Cookies`, `Cookies-journal`, `Local State`, `Web Data`, `*.ovpn`, `wallet.dat`, `*_rsa`, `*_ed25519`, `*_ecdsa`
<!-- credential-names:end -->

The contextual paths `.docker/config.json`, `.kube/config` and `.aws/credentials`
always hold too. `.env.example` and `.env.sample` are exempt from the name hold;
they still require a full clean content scan. Known credential homes and browser
profiles remain held. Other directory components containing credential, secret,
token or env hold their subtree, except inside node_modules, site-packages,
vendor and .venv trees. Package names receive no directory-word hold, but their
member files still undergo name and content checks, even when regenerable files
are excluded from the upload list.

**Conditional name release.** A basename containing those words is held unless
its bytes prove real media or its complete supported text scans clean. Unknown
binary, including SQLite, holds; an extension is never proof of media.
Always-held credential shapes win even over a real media signature. Reports
contain file paths and rule names only, never matched values or raw decoder errors.
The entire month/mtime group or classified run holds on any hit or scan failure.

**Content scan.** Read the complete UTF-8 text, decompressing gzip/zstd by magic
bytes, and apply publication-policy credential-adjacent patterns plus provider
shapes and generic assignments (password/passwd/pwd/secret/token/api-key/access-key)
whose value is a non-empty literal, short or with symbols (`password=Tr0ub4dor&3`);
code and references stay clear: empty `NAME=` lines, keywords, `****`, `${X}`/`$X`,
member access, calls and `++n` (`token=++n`, `key=e.key`), and in code (not an
env/YAML line, `--flag=` or URL query) numbers, operators and bare identifiers,
JSON refresh_token/access_token/private_key/client_secret keys, JWTs, Google ya29,
Anthropic sk-ant and URL userinfo. False positives become named holds for owner
review. PNG, JPEG, GIF, ISO media ftyp, RIFF WAVE/WEBP/AVI, ID3/MPEG audio, FLAC,
Ogg and Matroska/WebM signatures identify media. Media bytes, including text after
the header, still receive credential-shape scans; hashes cover every raw byte.
A text file named .png or .mp4 is scanned as text. Media over the 64 MiB content
bound HOLD with `scan-size-limit`, rather than bypassing credential scanning.

Unsupported zip/xz/bz2/7z/tar/tgz/br/lz4/rar, nested compression and non-UTF-8
(including UTF-16), and base64-looking single blobs hold with scan-unsupported-decoder or scan-unsupported-encoding.
Recognizable compressors are detected by magic even with a different suffix;
known unsupported suffixes also hold (Brotli has no universal magic).
Input (including media) and decompressed text are limited to 64 MiB, every worker to
15 seconds. The whole-folder classifier uses a scaled run deadline (below);
the legacy rollup planner retains its 120-second scan limit. Size/time limits, unreadable
members, corruption, worker failures and policy errors fail closed with named reasons.

**Scan receipt and upload preflight.** The classifier emits each scanned member's
path, byte count and SHA-256 of the raw bytes read during scanning, including media.
Save the JSON outside the source run. Immediately before each upload step run
`node scripts/classify.mjs --verify <receipt.json>`: it rescans and rehashes the
whole run and refuses changed bytes, additions, deletions, new holds or invalid
receipts (exit 1). Only exit 0 permits upload. The planner also records scanMembers;
it never uploads. This is a preflight verifier, not an atomic upload transaction.

For read-only whole-folder classification including regenerable files, independent
of age, run `node scripts/classify.mjs <archive-run> [...]` from this skill directory.
Its JSON gives files, heldMembers, reason counts, member hashes and path/rule
receipts. A HOLD blocks upload; CLEAR is not remote-preservation proof.
Cleaning them up is the owner's call.

### Large-folder classification and partial manifests

Run `node scripts/classify.mjs --receipt-dir <outside-source-directory> <archive-run>`
to save `receipt.json`, `scan-cache.json`, `upload-manifest.tsv` and `held.tsv`.
Without `--receipt-dir`, classification only prints JSON and writes nothing.
Receipt directories must be outside the source, including after resolving ancestor
symlinks; never place these files inside the archive. One source per receipt directory.

The classifier uses CPU count minus one workers (minimum 1, maximum 16); `--workers N`
accepts 1–32. Each worker is terminated after 15 seconds per member. The deadline is
60 seconds + raw bytes / 25 MiB per second + 5 milliseconds per file, capped at one
hour. `--budget-ms N` overrides it, up to 24 hours. Inventory time counts against
the deadline. Unscanned members remain HOLD with `scan-run-time-limit`.

Cache entries bind relative path, size, mtime and SHA-256 of all raw bytes, plus a
scanner/policy version hash. Cache hits rehash bytes before reusing CLEAR or a
definitive HOLD; transient failures are retried. Git internals/history are never
cached. The cache payload is HMAC-SHA256 authenticated with a 0600 key created at
`~/.local/state/golems/drive-scan-cache.key`, outside the source and receipt directory.
Unkeyed or altered caches count as misses. An invalid key location or permissions
refuses the run; the key is never included in receipts or archives. `--verify`
ignores the cache, rehashes and rescans every member; changed bytes or inventory
still refuse upload. Concurrent source changes require stopping and rescanning;
this remains a preflight, not a filesystem snapshot or upload transaction.

For a `.git` directory, the classifier streams all Git objects, including unreachable
blobs, commits, tags and trees, through `git cat-file --batch-all-objects --batch`.
Commit/tag text and blob decoding use the same content bounds; history media HOLD
instead of bypassing scanning. Tree entry names and contextual full paths receive
the credential-name and directory policy, including unreachable trees. Missing
referenced objects fail closed. Tree inventory/traversal is bounded to 500,000 entries
and 1,000,000 tree visits. Git is bound to the absolute `.git` directory with discovery
ceilings, `--no-lazy-fetch`, fsmonitor disabled and lazy fetching disabled in the
environment; an older Git rejecting the flag refuses the scan. Redirects (`commondir`,
`gitdir`, alternates, or a `.git` file) HOLD. Pack/index pairs must match Git's pack
and object counts and pass `verify-pack`. Loose objects must be consumed by Git,
match their object IDs and have no trailing compressed bytes. Git indexes require
checksum validation, `ls-files --stage` validation with fsmonitor off, and a full raw
credential scan. Only validated storage and reference text bypass unknown-binary
decoding. Commit graphs, reverse indexes and bitmaps remain ordinary content scans;
unknown binary metadata HOLDs. History hits hold Git
internals as `git-history-match`; `gitHistory.matches` gives blob IDs and paths when
Git can resolve them, never values. Git errors fail closed as `git-history-error`.

Only a successful `--verify` grants upload. A manifest from a cached classification
never grants upload by itself. `upload-manifest.tsv` contains only CLEAR members
(path, raw bytes, SHA-256);
`held.tsv` contains paths and reason lists. TSV path/reason cells use JSON quoting
so tabs and newlines cannot forge rows. Held members are never uploaded and never
deleted locally. An operator may prepare an archive from only the CLEAR manifest,
then classify and verify that new archive source separately. The original run's
HOLD receipt cannot pass `--verify`. A run containing any held member cannot remove
its source folder. CLEAR remains separate from remote preservation/deletion authority.

`unsupportedEncoding` ranks unsupported members by extension and recognized magic
(for example Mach-O, ELF, WebAssembly or SQLite). Unknown magic stays `unknown`;
reports never print raw header bytes. These categories grant no new allowances.

> **After creating/editing this skill it must be REGISTERED** (golem-install / symlink into `~/.claude/skills`) before any agent can invoke it — committed ≠ installed.
