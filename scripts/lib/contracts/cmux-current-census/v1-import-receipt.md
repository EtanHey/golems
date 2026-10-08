# cmux current census v1: frozen input import

Status: EXACT_SCHEMA_FROZEN_INPUT / OFFLINE_CONSUMER_PREPARATION_ONLY.

This directory's v1/ contains the exact 24-file candidate frozen by the producer lead on 2026-10-08. Every source byte was copied unchanged, including historical candidate-status labels, zero digest placeholders, schema IDs and relative manifest entries.

Frozen identity:

- schema.json: `0b08d2c4370ed4801f86a96b5825c6b4b376e8d447c5df08e4beb0e6c79cf00e`
- contract.md: `5da92daa7e8deb1b045ad26a466a6295ac4399391fd4011234ff63aaf90d90c7`
- manifest.json: `c5ebed07725b7e6a5ba985fd1aec58c2fbe42fa0eaeeb2c9f4e3e3422e4ae6d7`
- fixtures/16-partial-kernel-identity.json: `064877ce8a6911d4b532f9d70c2911d0df7eb1bca7582bc94d037e1fac4b96f4`

The manifest binds 23 entries and excludes itself; this receipt is outside that inventory. Its mode fields describe the original private artifact receipt. Git does not preserve 0600 read bits; tracked checkout permissions do not attest producer permissions.

Atomic contract-data size justification: generated schema/scenario JSON, normative contract and manifest belong to one frozen identity, so they are imported together without trimming or regenerating their bytes. Generated data lines are exempt from the handwritten implementation limit; this unit adds no runtime code. Review this import independently from the later semantic core.

Fixtures are synthetic preparation inputs, not live census evidence. Their zero payload digests are placeholders. Published RFC bytes and their hash are reference data, not executed producer/consumer canonical-envelope agreement. This import grants no digest verification, COMPLETE census, source-trust, exporter, consumer activation, release or deletion authority. Immutable #733 legacy reader and GC caller are unchanged.
