# Conference Sources Reference

> Known conference sites and where their sponsor/speaker data lives.
> Verify before use — conference sites restructure yearly. Last checked: 2026-08-03.

## Hackers Summer Camp (Las Vegas, early August)

Treat `Hackers Summer Camp` as one required sweep across BSides Las Vegas, Black
Hat USA, and DEF CON. Do not silently reduce the request to Black Hat sponsors.

| Conference | Site | Sponsors | Speakers |
|---|---|---|---|
| BSides Las Vegas | bsideslv.org | /sponsors (yearly path varies) | /schedule or talks page |
| Black Hat USA | blackhat.com/us-{yy}/ | /us-{yy}/sponsors.html + Business Hall exhibitor list | /us-{yy}/briefings/schedule/ |
| DEF CON | defcon.org | Few formal sponsors — mine **villages**, contests, and talk affiliations instead | media server + schedule; villages have own sites |

Black Hat notes: the Business Hall exhibitor list is the richest company source
(hundreds of companies, tier-labeled). Often JS-rendered — use exa fetch or the
swapcard/expo platform JSON if the HTML fetch comes back empty.

DEF CON notes: anti-corporate culture, so "sponsor" signal is weak; speaker and
village-organizer affiliations are the real signal.

## Israel-relevant conferences

| Conference | Site | Notes |
|---|---|---|
| CyberTech Global TLV | cybertechisrael.com | Huge Israeli sponsor list — best local signal |
| BSides TLV | bsidestlv.com | Community, speaker affiliations |
| Cyber Week TAU | cyberweek.tau.ac.il | Academic + industry mix |
| Reversim Summit | summit.reversim.com | General Israeli engineering, sponsors hire |

## Career and ATS verification (try in order, then search)

1. `https://<domain>/careers`
2. `https://<domain>/company/careers`, `/jobs`, `/join-us`
3. First-party ATS board or API:
   - Greenhouse public jobs API:
     `GET https://boards-api.greenhouse.io/v1/boards/<board_token>/jobs?content=true`
   - Ashby public posting API:
     `GET https://api.ashbyhq.com/posting-api/job-board/<job_board_name>`
   - Other common boards: `jobs.lever.co/<company>`, `<company>.comeet.com`,
     `apply.workable.com/<company>`
4. Fallback web search: `"<company>" careers "<profile.location>"`

Greenhouse and Ashby API responses are first-party published-job evidence, but
still read the returned posting body and use its live apply URL. Do not use
authenticated application endpoints or expose API secrets.

## Stale-mirror detection

Treat Built In, portfolio boards, search snippets, and cached Greenhouse pages as
discovery routes until the first-party page/API confirms the req. A mirror is
suspect when:

- its title or location is absent from the current first-party board;
- the direct apply URL 404s, redirects to the board root, or names a closed req;
- dates or req IDs conflict across sources;
- a cached board exposes jobs much older than the rest of the live inventory.

Record the conflict and the route used to resolve it. If first-party confirmation
remains impossible, report `could not check`; never promote the mirror to a live
role and never downgrade uncertainty to `not hiring`.

Location-presence check: the company's own careers locations, first-party ATS
filters, official office pages, or clearly sourced headquarters records — note
the evidence in the report, don't assume.
