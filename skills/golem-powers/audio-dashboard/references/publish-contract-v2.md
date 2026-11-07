# Audio-dashboard publish contract v2

skill-creator writes the handoff after BUILD, QA and pre-publish evidence. NarrationLayer is the sole Lakebed publisher and writes the delivery receipt. These local artifacts can contain private deployment details; never commit populated receipts, host config or media URLs.

## `<output-basename>.publish-handoff.json` (skill → NarrationLayer)

```json
{
  "schema": "audio-dashboard.publish-handoff.v2",
  "dashboardId": "<spec.id == dashboard-id meta>",
  "type": "decision-flow | cinema",
  "builtHtmlSha256": "<BUILD-gated single-file sha>",
  "sourcePath": "<relative built directory containing index.html and assets>",
  "answerKeys": [{ "key": "<persisted field id>", "kind": "text | radio | checkbox | select", "options": ["<for choices only>"] }],
  "sourceHtmlSha256": "<64 hex of sourcePath/index.html>",
  "buildReceiptsSha256": "<64 lowercase hex of BUILD receipts>",
  "answerPersistence": "PASS",
  "design": {
    "admission": "COMPARED | REDESIGN_APPROVED | FIRST_IN_LINEAGE",
    "lineage": "<existing design series>",
    "predecessorSha256": "<64 hex; null only for FIRST_IN_LINEAGE>",
    "redesign": { "reason": "<reason>", "approvedBy": "<approver or UNRECORDED>", "from": "<predecessor sha>" }
  },
  "jobPath": "<job path relative to handoff directory>",
  "mediaManifest": [{ "file": "assets/clip.mp3", "size": 1, "sha256": "<64 hex>" }],
  "createdAt": "<ISO timestamp>"
}
```

The inline manifest contains per-clip `{file,size,sha256}` records relative to sourcePath. The local source directory contains prepared index.html and extracted media; external HTTP(S) links open in a new tab. The prepared input copies index.receipts.json and index.design.json and includes asset-manifest.json with per-clip duration and both HTML hashes. answerKeys comes from persisted page controls, including radio names, grouped checklist indices, free text, per-card citation notes and cinema `_notes:` keys; playback preferences and editor drafts are excluded. `jobPath` is additive local custody metadata. `redesign` is omitted unless the existing design report records a redesign. Admission maps existing report statuses COMPARED/REDESIGN/BASELINE respectively; UNRECORDED never invents human approval. This mapping does not add the separate cross-series lineage-reset rule. The publisher must refuse FIRST_IN_LINEAGE when an accepted predecessor exists, missing approval where required, bad schemas, changed identity/source bytes, non-PASS answers, or an unavailable account provider.

## `<output-basename>.delivery.json` (NarrationLayer → skill)

```json
{
  "schema": "audio-dashboard.delivery.v2", "host": "lakebed",
  "url": "https://example.com/?d=<dashboardId>", "dashboardId": "<spec.id>",
  "sourceHtmlSha256": "<same as handoff and prepared index.html>", "servedShellSha256": "<expanded served shell sha>", "artifactSha256": "<whole shared bundle sha>",
  "staging": { "mode": "unlisted-candidate", "servedShellSha256": "<same as servedShellSha256>" },
  "accountProof": {
    "signedIn": true, "independentClient": true, "serverAck": true, "mutationDelta": 0, "existingRowsPreserved": 0, "method": "note-roundtrip", "probe": "existing-empty-field | dedicated-key", "markerSaved": true,
    "restoredAfterLocalKeysCleared": true, "cleanedUp": true, "disposableRecord": true, "at": "<ISO timestamp>"
  },
  "admission": { "design": "<handoff.design.admission>", "answerIdentity": "PASS", "providerReady": true, "gateVersion": "<nonempty version>" },
  "publishedAt": "<ISO timestamp>"
}
```

Configure `approvedDeliveryOrigins` as a nonempty array of exact HTTPS origins in `~/.config/golems/audio-dashboard.json`, or set `AUDIO_DASHBOARD_DELIVERY_ORIGINS` to that JSON array. There are no compiled-in trusted origins. Missing/malformed configuration gives MISSING_DELIVERY_CONFIG. `--delivery` checks schema, host, URL origin/route, identity, source hashes, served-shell staging equality, all account-proof booleans, nonnegative integer mutationDelta/existingRowsPreserved and admission echo. Missing delivery gives MISSING_HOSTED_DELIVERY; missing/false account proof gives MISSING_ACCOUNT_SYNC_PROOF. Legacy `--published` is accepted only to report that tailnet is media fallback; it cannot earn PASS.

builtHtmlSha256 binds the BUILD-gated file; sourceHtmlSha256 binds the prepared index.html. servedShellSha256 and artifactSha256 must be 64-hex, without comparison to the source.

The publisher stages with the real bridge and a disposable record, saves a note with server acknowledgement, reloads with browser-local pending keys removed, confirms account restoration, cleans up, then promotes the same candidate. Preserve existing user answers. Embedded consumers and BUILD PASS prove no account provider. The validator verifies a publisher attestation; it neither authenticates the issuer nor repeats a live account test. READY_FOR_HOSTED_PUBLISH is pre-publish only; final PASS requires `validate-evidence --delivery <receipt.json>`.

Backfilled deliveries use all three markers together: `backfilled: true`, `staging.mode: "none-backfill"`, `admission.design: "UNKNOWN_BACKFILL"`. Every other delivery/account check remains; without a handoff `--source-dir` supplies the prepared index.html for the source hash check. A matching handoff, if supplied, must still bind id/source. A valid backfill returns BACKFILL_ACCOUNT_PROVEN with exit 4, never PASS: it records real account proof for a page published outside admission, not acceptance. Design preservation is NOT_RUN and no design sidecar/history is advanced. Mixed markers are BACKFILL_MARKERS_MISMATCH (exit 3). probe is existing-empty-field or dedicated-key. cleanedUp means the probe value was restored; an empty probe row may remain until row deletion is supported.
