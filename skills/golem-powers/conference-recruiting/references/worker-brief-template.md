# Worker Brief Template

> Required for every delegated fit or career-page check. Complete the evidence
> block before dispatch. Do not paraphrase the candidate's level from memory.

## Pre-dispatch Gate

1. Resolve, read, and validate the configured `PROFILE SOURCE` against
   [the contract](profile-contract.md).
2. Use `nl -ba` or an equivalent line-numbered read on the exact source file.
3. Copy only the relevant profile/constraint lines below, verbatim.
4. Read current application, referral, rejection, and contact-attempt records.
5. Pin a concrete worker model ID. Dispatch in staggered waves with at most three
   concurrent workers and verify the effective model after launch.

If the profile source or line provenance is unavailable, do not dispatch a
fit-ranking worker. Report the missing source to the coordinator.

## Copy This Brief

```markdown
# Conference career check: <company or bounded company slice>

As of: <YYYY-MM-DD HH:MM timezone>
Conference source: <official URL + sponsor tier / speaker / other tag>

## Canonical candidate profile — quote, do not summarize

Profile source: `<absolute-path-to-profile-source.yaml>`
Provenance: `<absolute-path-to-profile-source.yaml>:<start-line>`

> <exact profile-source line(s), copied verbatim>

Relevant constraints, each with independent provenance:

> `<path>:<line>` — <exact constraint text>
> `<path>:<line>` — <exact constraint text>

BrainLayer is supplemental only: use it for preferences and leads to current
pipeline records. It is not evidence for years, level, skills, artifacts, or
resume claims.

## Verified pipeline context

| Company | Application/referral/contact state | Evidence path or record | Checked at |
|---|---|---|---|
| <company> | <active / rejected / referred / contacted-no-reply / none found / unknown> | <source> | <timestamp> |

The profile source's `connectors` array proves a relationship was recorded; it
does not prove this is an unworked or active opportunity. Missing or stale
contact evidence remains `unknown` unless a separate current source or the user
confirms otherwise. Do not imply a contact-attempt store exists when none is
found.

## Task

1. Resolve the company's official careers page and first-party ATS source.
2. For JavaScript-heavy boards, try the documented public ATS API first.
3. Return only postings verified live this run. Aggregators and cached mirrors
   may discover candidates but cannot prove a role is open.
4. Read each posting body. A `Senior / Principal` slug is dual-level; report the
   level stated in the body and quote the evidence.
5. Classify the route:
   - unprefixed title → cold-applyable;
   - Senior title → referral-only; no cold Senior recommendation;
   - uniform Senior prefixes across the company → level floor, regardless of req count.
6. A referral changes who reads the candidate, not the level screen.

## Output

| Company | Role | Body-confirmed level | Location | Live URL | Verification route | Human/pipeline note | Route |
|---|---|---|---|---|---|---|---|

Also return:
- stale or conflicting mirrors found;
- pages that could not be checked (never convert these to `not hiring`);
- the exact body excerpt used for slash-title or experience-level decisions;
- effective worker model ID and how it was observed.

## Prohibited shortcuts

- Do not replace the quoted profile source with a memory or handoff summary.
- Do not infer flexibility from a high req count.
- Do not infer `unworked` from a connector roster entry.
- Do not call a mirror-only role live.
- Do not choose or build a resume; return role evidence to the coordinator.
```

## Coordinator Check

Reject the worker result if the profile block lacks exact file+line provenance,
the worker reports only its requested model alias, or the output silently turns
an unverifiable page into a hiring conclusion.
