# Council Ballot — round 1 (GREEN fixture)

## Inputs read

- specs/feature-spec.md
- designs/architecture.md

## Candidate A

Score: 8/10

Strong separation of concerns; the retry path is well-bounded. Risk: the cache TTL is left
unstated, so a downstream reader could pick an unsafe default.

## Candidate B

Score: 6/10

Simpler, but conflates transport and policy in one module. The error taxonomy is incomplete
— no distinction between retryable and terminal failures.

## Candidate C

Score: 7/10

Good test-coverage plan and a clear migration story; the migration step lacks an explicit
rollback path, which should be added before build.

COUNCIL-BALLOT-COMPLETE
