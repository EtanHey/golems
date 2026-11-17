# CLEAR-set archive proof

Scope: local classifier CLI and exact USTAR archive bytes. No Drive upload,
remote preservation, deletion, or installed-skill proof is claimed here.

Fail-first: the new `clear-set.test.mjs` against the unchanged classifier produced
0 pass / 3 fail: partial verification, named credential failure and staging were
unavailable. Plain whole-folder verification already refused the held folder.

Run the local regression suite:

```bash
bun test skills/golem-powers/drive-filing/scripts
```

| Scenario | Required result |
|---|---|
| Three CLEAR files plus one held file | Plain verify fails; partial verify passes |
| CLEAR member changed, removed, or now credential-shaped | Partial verify fails |
| Held path injected, CLEAR member omitted, or duplicate manifest row | Manifest fails |
| New file outside the saved set | Partial verify passes with new-unarchived:1 |
| Policy identity changed | Partial verify fails |
| Staged exact manifest | Tar verify passes; system tar reads the original member |
| Tar extra/duplicate entry, changed byte, or symlink entry | Tar verify fails |
| Source member replaced by a symlink | Staging fails |

The r1297 attack harness was replayed with its cases intact, scratch retained,
and its baseline comparator pointed at this lane's inherited origin/master
rollup. All 25 adversarial cases remained HOLD in both rollup and classify;
the clean control remained UPLOAD/CLEAR. This comparison does not claim to
replay r1297's original pre-hardening baseline. Generated credential-shaped
bytes remain in ignored local scratch, never public fixtures or reports.

The local CodeRabbit executable was unavailable (`command not found`). Other-vendor
review is routed by the lead after the implementer's handoff; it is not claimed
by this proof. Staging and preflight require stable source/output bytes through
upload and do not provide an atomic filesystem snapshot.
