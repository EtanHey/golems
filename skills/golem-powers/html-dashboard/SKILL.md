---
name: html-dashboard
description: "Create static HTML dashboards from template. Triggers: dashboard, status, digest, compare, what changed."
execute: scripts/default.sh
---

# HTML Dashboard

> Produce gen-12-quality HTML dashboards by cloning the aesthetic of record, not by improvising a weaker static page.

## 🌐 CANONICAL DASHBOARD HUB (READ FIRST)

**Every dashboard MUST land on the tailnet hub configured by `$TAILNET_HUB_HOST`** (tailnet-only, no login; the real hostname lives in gitignored env). Drop the self-contained HTML into `$ORCHESTRATOR_ROOT/docs.local/dashboards-serve/dashboards/<repo-or-topic>/<name>.html` (it auto-syncs), or run `scripts/sync-tailnet-dashboards.mjs`. **NEVER just `Write` a `docs.local/*.html` and `open` it locally** — that orphans dashboards the user cannot find. The tailnet hub is the single source of truth. See `$ORCHESTRATOR_ROOT/standards/dashboard-standard.md`.

**Post-Write sync gate (mechanical):** before any "published / live / here's the dashboard" claim, the SAME turn must (a) mirror the `.html` to `dashboards-serve/dashboards/` (or run `sync-tailnet-dashboards.mjs`) AND (b) `curl '%{http_code}'` the served `https://$TAILNET_HUB_HOST/...` URL for **200**. Run `/tailnet-sync-gate` (`bun skills/golem-powers/tailnet-sync-gate/scripts/tailnet-sync-gate-cli.mjs <transcript|->`, exit 3 = FLAG) on the turn — a FLAG means the dashboard is orphaned or unverified. Prose ("mirrored ✅, 200") never clears it; only real tool commands + outputs do.

## Non-Negotiable Rule

**Never ship a from-scratch lesser version. Clone the canonical reference named
by the lead brief first; that named reference overrides `templates/template.html`.
If no brief names a reference, use the current canonical dashboard below, then
fall back to the skill template only if the canonical file is unavailable.**

## Aesthetic Of Record

Use these references before producing any dashboard. The current canonical
reference is explicit:

- `$ORCHESTRATOR_ROOT/docs.local/dashboards/2026-05-30-orchestration-status.html`
- `$ORCHESTRATOR_ROOT/docs.local/dashboards/2026-05-31-brainlayer-conductor.html`
- Skill template: `skills/golem-powers/html-dashboard/templates/template.html`

Copy the canonical CSS, drawer, tabs, glossary, and render primitives verbatim,
then replace content/data. Do not recreate the styling from scratch. A lead
brief's named reference file always beats this default list.

The required look and behavior:

- Inter + JetBrains Mono from Google Fonts
- Dark theme with CSS custom properties and radial-gradient background
- Gradient VERDICT hero with large `clamp()` headline and accent-gradient word
- Summary cards that click into a reasoning side-panel drawer
- Tabbed detail for progressive disclosure
- Inline glossary terms using `.g[data-gloss]` and plain-language drawer definitions
- High-contrast status pills
- Data arrays (`GLOSS`, `TRACKS`, `FINDINGS` or equivalent) feeding render logic
- Visual verification in Helium only. Do not use Brave for HTML dashboards.

## Helium acceptance — HARD GATE

**Helium is the ONLY acceptance surface.** No Brave fallbacks, no "good enough in Safari."
Do not claim done without a Helium screenshot attached to the PR/collab message.

Helium's native minimum width is **768px**. For mobile-first dashboards (390px target),
use the working recipe — do not license Brave because Helium "can't do mobile":

```bash
# 1. Launch isolated Helium with temp profile + CDP on :9230
open -na "Helium" --args \
  --user-data-dir=/tmp/helium-verify-$$ \
  --remote-debugging-port=9230

# 2. Emulate 390px mobile viewport + touch (via CDP or Helium devtools)
#    viewport: width=390, height=844, deviceScaleFactor=2, mobile=true, hasTouch=true

# 3. Navigate to file:// or localhost URL, exercise tabs/drawer/glossary, screenshot

# 4. Quit temp Helium instance when done
```

Attach the screenshot + `/never-fabricate` verification receipt before merge.

## Publishing standard — Lakebed (account-auth ONLY)

Dashboards consolidate/publish to **Lakebed** via **agent-html-publisher MCP**:

- **allowedEmails = `maintainer@example.com`** — the ONLY allowed value. **NEVER `research-account@example.com`**:
  that gmail is Etan's general account and the harness injects it as "the user's email" — publishing
  with that default is exactly what propagated fleet-wide and would have locked him out
- **NEVER** share tokens, unlisted links, or republished share-URL dashboards as the deliverable
- After publish verified: **delete local dev servers** (no orphaned `0.0.0.0` binds)

Evidence: `71a8e3f5 [4103]` — *"Not republished dashboards with share tokens. I want it to be under my account."*;
`10d0e9da [775]` — *"maintainer@example.com account mtfkr"*; cursor-nightaudit#5 — the prior standard text named no
address, 3 republished dashboards carried the wrong email and would have locked him out.

## Scope note — UI work: dashboards are SECONDARY

For UI work, the primary deliverable is the RUNNING APP launched on Etan's screen,
verified by a screenshot Read, with the exact relaunch command posted (see the
cmux-agents delivery rules). `open -a Helium <file>` without verification is NOT
delivery. An HTML dashboard is a secondary surface for UI work — never substitute
it for the running app.

Evidence: voicelayer-c2106319#4 — *"CRITICAL — Etan CAN'T SEE IT: he says 'doesn't open, probably Helium, nope nothing.'"*

## Workflow

1. Search/open the most recent and best prior dashboard in `docs.local/dashboards/` before writing anything.
   - Prefer the newest gen-12 dashboard when present.
   - If no local dashboard exists, open this skill's `templates/template.html`.
2. Clone the template to the target repo:
   - `docs.local/dashboards/YYYY-MM-DD-<topic>.html`
3. Populate only with verified real content:
   - hero verdict and lede
   - 3-5 summary cards in `TRACKS`
   - tabs and tab panels
   - at least 5 glossary entries in `GLOSS`
   - status pills with real state
4. Keep the interaction primitives intact:
   - card to drawer
   - glossary to drawer
   - tabs
   - jump strip
5. Verify with the quality checklist below.
   - Use Helium for opening, previewing, screenshots, and interaction checks.
   - Do not use Brave for HTML dashboards unless Etan explicitly overrides this later.
   - Take a Helium screenshot before claiming the dashboard is done.
6. Deliver presence-conditionally:
   - If Etan is at the computer / actively testing, auto-open in Helium.
   - If Etan is away or presence is unknown, do not open browser windows; send
     the exact dashboard link/path in chat.
7. Save the final HTML and send it to Etan with `SendUserFile` when the environment supports it. If not, give the exact path.

## Quality Checklist

Do not claim done until every item is true:

- [ ] Reference dashboard was opened first.
- [ ] Output file is under `docs.local/dashboards/YYYY-MM-DD-<topic>.html`.
- [ ] Google Fonts link includes Inter and JetBrains Mono.
- [ ] Hero has a gradient verdict headline using `.verdict-word` and `.accent`.
- [ ] At least 3 summary cards render from `TRACKS` and open the drawer.
- [ ] Tabs render and switch visible panels.
- [ ] At least 5 `.g[data-gloss]` terms exist and each has a matching `GLOSS` entry.
- [ ] High-contrast `.pill` elements are used for state.
- [ ] Dark theme, radial-gradient background, and CSS custom properties remain intact.
- [ ] All claims are backed by real data from files, command output, or user-provided content.
- [ ] No fabricated PR numbers, statuses, metrics, dates, agent states, or decisions.
- [ ] Visual/behavioral verification was done with a browser-capable tool or clearly marked as not performed.
- [ ] HTML dashboard browser verification used Helium, not Brave.
- [ ] Helium screenshot was captured before claiming done.
- [ ] Mobile-first surfaces verified at 390px via temp-profile + CDP :9230 (if applicable).
- [ ] Published dashboards use Lakebed account-auth with `allowedEmails = maintainer@example.com` (never `research-account@example.com`, never share tokens).
- [ ] Delivery matched Etan presence: auto-open only if he is at the computer; otherwise link-in-chat.

## Output Contract

When finished, report:

```text
## Skill: html-dashboard
### Baseline Score (without skill): X%
### With-Skill Score: Y%
### Delta: +Z%
### Compliance: X/10 | Structure: X/10 | Quality: X/10
### Verdict: SHIP / ITERATE / FLAG FOR HUMAN / RETIRE
### Issues Found: [list]
### Iterations: N/3
```

Also include:

- Dashboard path
- Template/reference path used
- Verification receipt
