---
name: t3-visuals
description: "Show/visualize/chart/diagram/compare/status board in T3 with compact interactive HTML. Not standalone dashboards."
---

# T3 visuals

Use for inline T3 `html_render` visuals, across orc, coach and leads.
For a standalone published dashboard, use `/html-dashboard`; keep its delivery workflow.

## Choose the encoding

Pick the relationship the reader needs to see; honor a supplied visual/behavior reference.
| Question | Form |
|---|---|
| Which work is ready or blocked? | Grouped lane marks or a stage matrix |
| What changed? | Explicit Old/Before and New/After pairs, same scale and units |
| When, in what order, or for how long? | Timeline with exact local ranges on hover |
| Which option wins on which criteria? | Aligned decision scorecard; keep unknown/not-run cells |
| How did magnitude or shares change over time? | Line or stacked area; dashed forecast, solid observed |
| Where are the hotspots? | Weekday/hour heatmap with an ordered intensity legend |
| Where is the concentration, spread or hierarchy? | Concentration curve, distribution or treemap respectively |
| How does work move or depend on another step? | Directed flow; label each stage and handoff |
| Only one meaningful number? | One large value with unit/scope; no invented trend |

## Compose

Title the finding; put a few stable summary values above the data only when useful.
Give data the surface: hairlines/space, dense aligned rows, right-aligned exact values, sparse ticks.
Keep short identity, unit, population, period and denominator labels; distinguish build/test/merge/install.
Show missing/estimated results honestly; never turn silence into success or a count into a version.
No prose blocks inside or below the visual, expanded documents or explanatory lists; link long narrative separately.
Put omitted per-item meaning/precision in immediate hover AND keyboard-focus tooltips: one concise visible line.
Use custom tooltips, no native-title delay or entrance animation; copy `.tip,.tip::before,.tip::after{font-style:normal;white-space:nowrap;max-width:calc(100vw - 16px);transition:none;animation:none}` and clamp position to the viewport.
Anchor near the mark, clamp to the viewport; shorten meaningfully rather than wrap, clip or hide essential detail.
Color every status row/mark: green verified/ready, amber waiting/active, red blocked/error, gray not started/out of release.
Pair state color with text/shape and a nearby key; keep entity hues and magnitude scales stable across views.
Use light/dark-safe foreground/background pairs; measure all text/badges at ≥4.5:1 after alpha compositing.
Copy these opaque AA pairs; apply the surface to the visual root and the matching status class to each badge/mark:
```css
:root{--t3v-fg:#17212b;--t3v-muted:#435064;--t3v-bg:#ffffff;--t3v-ready-fg:#166534;--t3v-ready-bg:#dcfce7;--t3v-wait-fg:#713f12;--t3v-wait-bg:#fef3c7;--t3v-error-fg:#991b1b;--t3v-error-bg:#fee2e2;--t3v-idle-fg:#4b5563;--t3v-idle-bg:#e5e7eb}
@media(prefers-color-scheme:dark){:root{--t3v-fg:#f8fafc;--t3v-muted:#cbd5e1;--t3v-bg:#111820;--t3v-ready-fg:#86efac;--t3v-ready-bg:#153526;--t3v-wait-fg:#fde68a;--t3v-wait-bg:#3c2d14;--t3v-error-fg:#fca5a5;--t3v-error-bg:#3d2024;--t3v-idle-fg:#cbd5e1;--t3v-idle-bg:#27303b}}
.t3v-surface{color:var(--t3v-fg);background:var(--t3v-bg)}.t3v-muted{color:var(--t3v-muted)}
.t3v-ready{color:var(--t3v-ready-fg);background:var(--t3v-ready-bg)}.t3v-wait{color:var(--t3v-wait-fg);background:var(--t3v-wait-bg)}.t3v-error{color:var(--t3v-error-fg);background:var(--t3v-error-bg)}.t3v-idle{color:var(--t3v-idle-fg);background:var(--t3v-idle-bg)}
```
Local clocks always include am/pm, including heatmap/axis labels and both range endpoints: `new Date(t).toLocaleTimeString('en-US',{timeZone:'Asia/Jerusalem',hour:'numeric',minute:'2-digit',hour12:true}).toLowerCase()` → `"5:22 am"`; add date when needed and a space before the zone, e.g. `5:22 am Asia/Jerusalem` or `4:30 am–5:10 am Asia/Jerusalem`; never display ISO/UTC/Z.
Label selectively without tiny type; preserve identities and units at desktop and 390px, with hover for omitted precision.
Add linked hover/drill-down only when useful; update scope, KPIs, map, ranking and breadcrumb together.
Keep controls local and working (back/reset/replay when needed); motion must explain change and respect reduced motion.

## Before rendering

- Does the chosen form answer the actual question with the supplied data and scope?
- Can one glance find the result, units and each item's state without reading a text block?
- Do first/middle/edge hover and focus show one normal-font line immediately, within bounds?
- Are all text/badge contrasts measured, Old/New labels explicit, clocks local, and unknowns visible?
- Do desktop/390px and light/dark preserve labels, scale and working controls?

Pass the HTML to `html_preview`, then `html_render`; never start a server for an inline visual.
