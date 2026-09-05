# Job Routing Doctrine

Use this after role existence is verified from a live first-party source. Sponsor
tier and req count are discovery signals; neither decides candidate fit.

## Title and Body Gate

| Posting evidence | Route | Rule |
|---|---|---|
| Unprefixed engineering title | Cold-applyable | Put in the cold-apply lane after profile fit and pipeline checks. |
| `Senior ...` title | Referral-only | Cold Senior is dead. Do not recommend a cold application. |
| `Senior / Principal ...` slug | Read body first | This is a dual-level req, not a level called “Senior Principal.” Route from the body-confirmed target. |
| Every relevant company req has the same Senior prefix | Level floor | Many reqs mean hiring volume, not flexibility. Seven Senior reqs mean seven seniors. |

When a referrer misreads a slash slug, clarify without arguing: send the req link,
quote the line in the body that names the actual target level, and ask them to
route based on that evidence.

## Rigidity Signals

Uniform seniority prefixes are direct evidence of a level floor. Company size is
secondary context: a large company often enforces bands more rigidly, while a
startup may bend for domain fit, but size never overrides the titles and posting
body in front of you.

Do not use req count as a flexibility proxy. Count answers “how much are they
hiring?” It does not answer “will they re-level this candidate?”

## Human-first Ranking

The report must include `Is there a human here?` and sort on verified human state
before sponsor prestige, req count, title excitement, or location.

Treat the configured profile source's `connectors` array as a relationship
roster, not as proof of live opportunity state. `unknown` is the safe default.
Promote it only when the profile source carries current contact evidence, a
separately verified current application/handoff record does, or the user
confirms the state; otherwise keep `unknown` and ask before ranking it as warm.

Recommended state vocabulary:

| State | Meaning |
|---|---|
| `active` | A named human has agreed to route this specific req or is currently handling it. |
| `reachable` | A real relationship exists and current contact state supports a concrete ask. |
| `stale` | A prior contact or referral exists but is unanswered, rejected, cooled, or needs a deliberate re-engagement route. |
| `none` | Current pipeline sources were checked and no human path was found. |
| `unknown` | Relationship or contact-attempt state is incomplete. Do not upgrade this to `reachable` or `unworked`. |

Within a human-state band, prefer:

1. level-compatible roles;
2. truthful headline/skill fit;
3. location constraints from the configured profile source;
4. fresh live postings;
5. stronger conference signals.

An active human does not make an over-level role level-compatible. A referral gets
the candidate read; it does not get the candidate re-leveled.

## Pipeline Cross-check Before Ranking

Search BrainLayer for leads, then verify against the current local application and
handoff records. Check at least:

- applications and duplicate submissions;
- recruiter/hiring-manager rejections;
- referrals already submitted;
- contact attempts and no-reply states;
- cooled or time-gated relationships.

The profile source's `connectors` array establishes that a relationship was
recorded. It does not by itself establish that a lead is active, unworked, or
safe to re-contact. Check only current sources that actually exist, preserve
`unknown` when they do not, and ask the user for missing contact state rather
than inventing opportunity status.

## Fast Decision Examples

- One unprefixed role with no human outranks a cold Senior role at the same fit.
- A referral-only Senior role can outrank the unprefixed role when a verified
  active referrer exists, but the level gap and disclosure remain visible.
- A company with ten uniformly Senior roles does not outrank a company with one
  level-compatible role merely because it has more openings.
