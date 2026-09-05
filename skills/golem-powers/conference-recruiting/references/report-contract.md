# Report Contract

## Procedure

1. Anchor the clock. Resolve and validate `PROFILE SOURCE`, then search BrainLayer
   for preferences, prior sweeps, and pipeline leads and read current local
   application/handoff records. BrainLayer never replaces the profile source.
2. Fill the worker-brief template from profile-source lines before any delegation.
   Pin and verify worker models; run staggered waves of at most three.
3. Resolve every official conference site. Build a deduped company table from
   sponsor/exhibitor and speaker sources, or record the explicit speaker opt-out.
4. Resolve official careers pages and first-party ATS APIs. Read posting bodies,
   flag stale mirrors, and preserve fetch uncertainty.
5. Apply job-routing doctrine, then cross-check pipeline/contact state. Add the
   human column and sort by it before sponsor tier, title, req count, or location.
6. For warm routes, read the configured artifact inventory and referral protocol.
   Add new connectors through the profile source's owning workflow before use;
   choose one truthful resume and one concrete ask.
7. Write, copy, shortlist, and store the report.

## Output Path and Order

Write one date-stamped report to:

`docs.local/applications/conference-sweeps/<conference>-<YYYY-MM-DD>.md`

The report is ordered by verified human state first and configured location fit
second. Within a human-state band, follow the job-routing reference. Do not let
location-first ordering bury an active human route.

## Candidate Row

| Field | Required evidence |
|---|---|
| Company + role | Live first-party posting or clearly labelled fallback |
| Source signal | Sponsor tier, speaker, village/booth/CTF, or multiple |
| Body-confirmed level | Posting-body text, especially for slash titles |
| Is there a human here? | Active / reachable / stale / none / unknown, with source |
| Pipeline state | Prior apply, referral, rejection, contact attempt, or verified none |
| Route | Cold apply / referral-only / skip / could not determine |
| Location + direct URL | Same-turn verified |

## Required Sections

- conference coverage, including both sponsor and speaker status or an explicit
  speaker-mining opt-out;
- ranked candidate rows;
- watch list for verified companies with no matching live role;
- `could not check` for unresolved sources;
- stale-mirror conflicts and how they were resolved;
- 5–10 target shortlist with one-line reasons.

Empty sections state `no matching roles found as of <date>`. They are not padded
with plausible roles.

## Pipeline Integration

Copy the finished report only when the user has explicitly configured a secondary
destination. If none is configured, keep the primary report and state that no
secondary copy was made; never guess a vault or private-repo path. Brain-store the
conference, date, verified target count, top targets, important pipeline
exclusions, and any unresolved source gaps. Recount numeric claims at publish
time rather than copying counts from a worker summary.
