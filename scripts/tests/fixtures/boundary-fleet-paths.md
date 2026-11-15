# Publication guard fleet corpus

`boundary-fleet-paths.json` contains tracked relative file paths and SHA-256
hashes of their Git blobs, captured read-only on 2026-11-15 from golems,
voicelayer, brainlayer and narrationlayer. Only repositories verified PUBLIC
with `gh repo view --json visibility` may supply rows. No source contents,
private prose or absolute checkout paths are included. JSON Unicode escapes
preserve real path strings while permitting publication through the old guard.

`boundary-credentials.test.mjs` writes each path and its path/hash JSON line to
an unallowlisted file in a temporary Git repository and invokes the real
pre-push scanner. Every forbidden class and push pattern must accept it.
The same suite checks invented credential shapes and false-positive paths.
CI runs this suite in `golem-powers-skill-tests.yml`.

## Local proof, 2026-11-15

- Base master: `954a2459b9c3d1eb731f17464457cd4b4718be81`.
  Its scanner and policy bytes match installed release `2026.11.14-954a245`.
- RED: run the credential suite with `BOUNDARY_PREPUSH_CHECKER` pointing to
  that release's `scripts/ci/boundary-prepush.mjs`: 52 pass, 12 fail.
  All four invented path cases and eight fleet corpus cases falsely refuse;
  all 40 invented credential/delimiter cases correctly refuse.
- GREEN: `node --test scripts/tests/boundary-credentials.test.mjs`:
  64 pass, zero fail (including all 20 fleet rows).
- `node --test scripts/tests/boundary-*.test.mjs`: 227 pass, zero fail.
- `bash scripts/tests/check-publish-boundary.test.sh`: 113 pass, zero fail.
- History-base suite: nine pass, zero fail. History-shards suite: PASS.
- Current-tree check: 3029 tracked paths, zero new violations (before this
  evidence paragraph, which adds no tracked path).
- Read-only VoiceLayer replay: head
  `39581ac29828df21ad7b2b3b300bdbb9a2b45333`, advertised base
  `f5994253af357bcd8be5c5bfd8f58db923699102`, using a four-field pre-push
  ref row: installed release REFUSED (`push-credentials`); branch PASS
  (two commits). No VoiceLayer push, hook edit or install performed.

Only the push pattern changes. The assignment-bound `credential-adjacent`
forbidden class and the tree/history fingerprint remain unchanged.
Round-one Claude security review found one blocking escape-boundary defect;
round two applies its exact approved regex. Final review, scan and installed-Mac
proof belong to the lead.


## Round two

The escape-aware boundary is copied byte for byte from the reviewer fix.
Fifteen refusal cases cover every reviewer escape probe, underscore/hyphen
prefixes, carriage returns, escaped quotes and ANSI parameter variants.
Against first-round head `a800afbd`, the revised suite is RED: 65 pass,
14 fail (missed credentials); all path lookalikes remain accepted.

The corpus retains 20 rows. Four private-repository rows were replaced with
public golems paths and blob hashes from base `954a2459`. All four source
repositories were verified PUBLIC using `gh repo view --json visibility`.
Private repositories must never supply corpus rows.
