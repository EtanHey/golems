# Fact Brief: brainlayer (2026-03-17)

## Source Summary
- Automated stats: 6 collected via /nightly-docs-update
- BrainLayer chunks reviewed: 12
- Git commits reviewed: 8 (PR #84 branch)
- Critique wave results: 3/3 PASS (Wave 2, after 1 fix)

## Verified Facts
- [STAT-1] Tests: 874 pass (846 Python + 28 Swift), 0 fail
- [STAT-2] BrainLayer chunks: 312,847
- [FACT-1] PR #84 merged 2026-03-17: BrainBar Swift daemon — 209KB native binary
- [FACT-2] Architecture: SQLite3 C API + FTS5 + POSIX socket + Content-Length MCP framing
- [FACT-3] Zero external dependencies (Foundation only)
- [FACT-4] Replaces 10 Python brainlayer-mcp processes (931MB total RSS) with 1 daemon (~40MB est.)
- [FACT-5] 28 Swift tests GREEN, 846 Python tests GREEN (zero regressions)
- [FACT-6] FTS5 backfill implemented for existing 312K chunk database
- [FACT-7] Security: 5 MAJOR + 4 MEDIUM fixes from self-review before CodeRabbit
- [FACT-8] Dual-protocol detection: Content-Length → MCP, NDJSON → existing protocol

## Stale Claims
- [STALE-1] README says "Python-based BrainLayer MCP server" — BrainBar Swift daemon now exists as alternative
- [STALE-2] README lists 846 tests — now 874 with Swift tests
- [STALE-3] Architecture section shows only Python process model — missing native daemon option

## Missing Content
- [GAP-1] No mention of BrainBar daemon anywhere in README
- [GAP-2] No documentation of dual-protocol detection pattern
- [GAP-3] Missing performance comparison (10 processes/931MB → 1 daemon/40MB)
- [GAP-4] No mention of FTS5 backfill for existing databases
- [GAP-5] LaunchAgent setup not documented

## Discrepancies
- [DISC-1] factChecker: FACT-3 says "zero external dependencies" but Package.swift imports Foundation. Technically correct (Foundation is a system framework, not an external dependency) but the claim is ambiguous. Recommend: "zero third-party dependencies" instead.

## Data Gaps
- None — all sources responded successfully

## Recommended Content Updates
1. **HIGH** Add BrainBar daemon section to README (FACT-1, FACT-2, FACT-4) — this is the biggest recent change
2. **HIGH** Update test count: 846 → 874 (STALE-2)
3. **MEDIUM** Add architecture diagram showing Python MCP + BrainBar options (STALE-3, GAP-2)
4. **MEDIUM** Add performance comparison table (GAP-3)
5. **LOW** Document LaunchAgent setup (GAP-5)
6. **LOW** Clarify "zero dependencies" → "zero third-party dependencies" (DISC-1)
