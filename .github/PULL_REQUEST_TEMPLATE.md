## Summary

<!-- What does this PR do, and why? One logical change per PR. -->

## Size

<!-- size:XS (0-50) · size:S (51-150) · size:M (151-400) · size:L (over 400) hand-written added lines.
     Deletions and generated files don't count. A maintainer applies the label and CI checks it.
     Over 400? Split the PR, or add one line saying why it can't be split. -->

## Checks

<!-- Paste the output lines, not just ticks. -->

- [ ] `bun run test` passes (the package suite CI runs)
- [ ] `bash scripts/check-publish-boundary.sh` → PASS
- [ ] Touched `skills/`? `node scripts/ci/check-skill-library.mjs` → OK, and `bash scripts/ci/run-skill-tests.sh` passes
- [ ] Manually verified (if applicable)

## Vouched By

<!-- For first-time contributors: tag the person who invited you or reviewed your approach -->
<!-- Example: Vouched-by: @EtanHey -->
<!-- Returning contributors can leave this blank -->

## AI Contribution

<!-- If AI tools were used, note which ones (Claude, Cursor, Codex, etc.) -->
<!-- AI-generated code follows the same review standards as human code -->
