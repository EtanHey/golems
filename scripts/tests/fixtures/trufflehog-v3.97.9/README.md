# TruffleHog false-positive fixture

`fp_terms_alnum.txt` is a derived, non-source copy of the false-positive terms
that can occur inside a lowercased AWS access-key ID. It contains 2,378 sorted,
unique terms from TruffleHog tag `v3.97.9`: the four detector list files plus
`DefaultFalsePositives`, normalized with lowercase and trim as
`bytesToCleanWordList` does, then restricted to `^[a-z0-9]+$`.

That filter is exact for this audit: a lowercased AWS ID is `[a-z0-9]`, so a
term containing punctuation, spaces, or any other non-alphanumeric character
cannot be its substring. The upstream UUID list currently contributes no terms after this
projection; the derivation test still covers that source with an alphanumeric
fixture so a future relevant entry cannot be skipped.

Upstream source SHA-256:

- `fp_badlist.txt`: `7a68ba7a4e1a17d074b5c3fa1c5ad4f098408248801e40f6b2ab55766f7a5a5b`
- `fp_programmingbooks.txt`: `2baa952fc96e914e48a9d94c65684a9d6d54ccac8731ad18ae3f15f2820eb562`
- `fp_uuids.txt`: `6b90516ec75d9957a034f3b05440d583e9332f8fdec4815646ce844e7b9d4dbd`
- `fp_words.txt`: `3ff15e4f8be6327e5ee7ff82d7f00d364277b0df220df6a1bf514df6a28fd8f8`

Exact derivation command, run from this repository with an upstream v3.97.9
checkout at `/path/to/trufflehog`:

```bash
python3 scripts/ci/trufflehog-fp-terms.py derive \
  /path/to/trufflehog/pkg/detectors \
  > scripts/tests/fixtures/trufflehog-v3.97.9/fp_terms_alnum.txt
```
