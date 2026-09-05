---
name: conference-recruiting
description: "Mine a conference for hiring targets and matching jobs. Triggers: tech or security conference, Hackers Summer Camp, BSides, Black Hat, DEF CON, conference sponsors, exhibitors, speakers. NOT for general job search or LinkedIn post drafting."
---

# Conference Recruiting Sweep

Conference sponsorship signals budget and presence; speaker, village, booth, and
CTF affiliations signal active technical teams. Neither signal proves candidate
fit. The sweep turns those signals into a verified, human-route-first pipeline.

## Signal Model

| Source | Signal | Strength |
|---|---|---|
| Platinum/Gold sponsor | Budget + current conference presence | Strong |
| Other paid sponsor/exhibitor | Budget exists | Medium |
| Speaker employer | Public technical culture | Medium |
| Village, booth, contest, or CTF host | Hands-on team | Medium |

## Core Rules

1. **Require a configured profile source; never guess.** Resolve `PROFILE SOURCE`
   only from an explicit path in the current request or from
   `CONFERENCE_RECRUITING_PROFILE_SOURCE` (explicit path wins). There is no
   default. Before any fit judgment or worker dispatch, verify that the resolved
   path is a readable regular file, read it, and validate it against the
   [profile contract](references/profile-contract.md). If it is unset, unreadable,
   or invalid, stop and ask the user to configure or repair it. BrainLayer may
   supplement preferences and pipeline history, but experience, positioning,
   artifact, connector, and disclosure claims come only from the profile source.
   Every worker brief quotes the relevant block verbatim with exact file+line
   provenance using [the worker template](references/worker-brief-template.md).
2. **Mine sponsors and speakers.** Resolve the official conference source, extract
   sponsors/exhibitors with tiers, and extract speaker affiliations; dedupe while
   retaining every source tag. Speaker mining may be omitted only as an explicit,
   reasoned opt-out recorded before the final report. Sponsor volume is never a
   silent opt-out. See [conference sources](references/conference-sources.md).
3. **Verify live hiring from first parties.** For JavaScript-heavy boards, try the
   official ATS API before mirrors. A cached or aggregator listing is discovery,
   not proof. Read the live posting body and direct apply URL. If verification
   fails after fallback search, report `could not check`, never `not hiring`.
4. **Route by actual level.** Unprefixed roles are cold-applyable. Senior-titled
   roles are referral-only; cold Senior is dead. A `Senior / Principal` slug is a
   dual-level req, not one title: read the body for the real level and clarify a
   referrer's misread with quoted body evidence. Uniform Senior prefixes are a
   level floor, not flexibility created by req volume. Apply
   [job-routing doctrine](references/job-routing.md).
5. **Rank by whether a live human exists, and sort by it.** Cross-check past
   applications, rejections, referrals, and whatever contact evidence actually
   exists before ranking. A connector roster is not proof of a live opportunity:
   `unknown` is the default, and only current profile-source evidence, a separately
   verified current record, or user confirmation may promote it. Never infer
   `unworked` or active state from a person's presence in the roster. The report
   must contain an `Is there a human here?` column and sort verified active paths
   first. A referral changes who reads the candidate, never what level the
   candidate is.
6. **Choose resumes from the configured artifact inventory.** Read the validated
   profile source's `artifacts` records. Shipment folder names are not variant
   identities; rendered headline strings are. Before a send, verify that the
   selected artifact path is a readable regular file. Send one resume per
   referrer human even for multiple roles. Per-role variants are allowed only
   across different recipients. Headline matching beats body tailoring, and no
   new tailoring build is the default. Repairing an untruthful headline is a
   defect fix, not a tailoring build, and is always allowed: block the send and
   route the repair/rebuild through the workflow that owns the profile source.
   If `artifacts` is empty or the selected path cannot be read, stop and ask the
   user; never re-derive inventory from folder names.
7. **Protect the referrer.** Before working a new lead, add the connector through
   the workflow that maintains the profile source and re-read the regenerated or
   updated source. Never edit a generated export directly. Send the chosen CV
   with the exact req link and an upfront, truthful years-gap disclosure. Make one
   concrete ask per human, with secondary options clearly secondary. A fast
   disclosed no is a cheap successful outcome, not a protocol failure. Follow the full
   [referral protocol](references/referral-protocol.md).
8. **Bound and prove fan-out.** Pin a concrete model ID for every worker, verify
   the effective runtime model, and stagger waves at a maximum of three concurrent
   workers. Any eval record must separately capture requested model, observed
   effective model ID, observed effective effort, and an allowed runtime
   observation source. An alias or model-table inference is not eval evidence.
9. **Ship one evidence-backed report.** Date-stamp it; sort by human route first
   and location second; include role title, body-confirmed level, location, source
   signal, pipeline state, human state, direct URL, and verification route. Keep
   watch and could-not-check sections. Never fabricate a role. Write the primary
   report, copy it only to explicitly configured secondary destinations,
   shortlist 5–10 targets, and brain-store the summary. Follow the
   [report contract](references/report-contract.md).

## Run

1. Resolve and validate `PROFILE SOURCE`, fill the worker template from it, then
   gather conference and live-job evidence in bounded, model-verified waves.
2. Apply job routing and pipeline history before ranking. For warm routes, read
   the configured artifact inventory and referral protocol before choosing the
   package.
3. Produce, copy, shortlist, and store the report exactly as the report contract
   specifies.

## Boundaries

- The profile-source owner owns resume artifacts, shipment paths, headline truth,
  and builder edits. This skill consumes the configured contract rather than
  copying volatile facts. It routes truth repairs through the owning workflow;
  the no-build default never permits a known false headline to keep shipping.
- General recruiting stays with the user's configured job-search workflow; this
  skill produces a conference-sourced input to that pipeline.
- `/never-fabricate` applies to every role, model-provenance claim, and completion
  claim.
