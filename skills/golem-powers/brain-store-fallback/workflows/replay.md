# Boot-Time Replay

Use this workflow at the start of a session that may call `brain_store`.

## Scope

Replay local fallback files from:

```text
docs.local/decisions/*.md
```

Only process files whose frontmatter has:

```yaml
intended_brain_store: true
```

and no non-empty `chunk_id`.

## Steps

1. List pending files.
2. If more than 100 pending files exist, stop and add a replay budget before
   processing. The current default is no cap because small N is expected.
3. For each pending file, parse frontmatter for:
   - `importance`
   - `tags`
   - `timestamp`
4. Read the body after the closing frontmatter marker.
5. Call `brain_store` with the body, original tags, and original importance.
6. If the call returns a concrete `chunk_id`, update only the frontmatter:
   - `retry_attempted: true`
   - `chunk_id: <returned id>`
7. If the call fails or returns no chunk id, update only:
   - `retry_attempted: true`
   - leave `chunk_id:` empty
8. Leave all files in place.

## Atomicity

When editing replay frontmatter, preserve the body byte-for-byte. Write through a
temporary file and rename it over the original if scripting this workflow.

## Reporting

Report counts honestly:

```text
Replay attempted: <N>
Stored in BrainLayer: <success count>
Still pending: <failure count>
Pending files: <paths>
```

Do not report `stored` for files that still lack a `chunk_id`.
