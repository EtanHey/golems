# Plan a UX/UI change

Applies to **any change a user can see: UI, layout, copy, animation, front-end behaviour**.
Read this when choosing phases, including for a short plan. Backend-only work with
no visible effect keeps its own functional proof; it does not add these UX steps.

The plan must explicitly name real-app e2e, screenshots AND interaction recordings,
a separate `/qa-video` QA subagent, fix/recheck, and `claude.judgment` taste review
that cites those artifacts, followed by pr-loop. Generic “test, QA and review” is
incomplete. Assign these future owners even when source or product details are
pending; planning their handoffs does not dispatch them.

## Sequence and handoffs

Plan these steps in dependency order. The lead routes QA and review after the
implementer reports finished; workers never start their own reviewers. Explicit
user routing wins. Otherwise use [agent-routing](../../agent-routing/SKILL.md),
including its cross-vendor review and FRONTEND RULE. Resolve every role's model
through `node scripts/model-roles.mjs <role> --field model` from the golems root
(`standards/model-roles.json`); declare effort and why in the phase, and use normal
service. These are roles, not new model pins.

| Step | Owner / role | Artifact handed to the next step |
| --- | --- | --- |
| 1. Build against the actual design system | `claude.judgment` for visual/taste slices; `codex.implement` for plumbing | Finished source SHA, base SHA, affected surfaces and acceptance checklist. Load frontend-design and emil-design-eng, inspect existing tokens/states/motion, and reuse existing dependencies. |
| 2. Run e2e on the real app | `codex.implement` functional tester/recorder | Test command/results, real-client state assertions and before/after evidence. Cover the changed path, reverse/cancel paths, empty/single/multiple states, keyboard/focus and reduced motion where relevant. A motion regression needs an assertion that fails on the old behaviour. |
| 3. Capture the whole interaction | `codex.implement` recorder | Before/after screenshots at desktop and 390 px, recordings and one GIF per changed interaction, plus a manifest. Include relevant themes and breakpoint boundaries. Follow [pr-loop Visual proof](../../pr-loop/SKILL.md#visual-proof) for the authoritative proof requirements and publication format. |
| 4. Rigorous `/qa-video` subagent QA | Lead routes a QA seat under [qa-video](../../qa-video/SKILL.md); default readers `claude.judgment`, finding verifiers `claude.subagent.mechanical` | Checklist report with PASS / FAIL / INCONCLUSIVE per criterion, exact inspected coverage, before/after full-size frame citations and decoded PTS, findings and inspection ledger. Use QA mode and its evidence/refinement rules. A user-named reader overrides the default; authorize helper fan-out only when that route needs it. |
| 5. Fix and re-prove | Original implementer, same role as step 1 | Confirmed findings traced to causes, fail-first guard for a regression, fresh affected captures and updated manifest. QA rechecks the changed windows; preserve accepted design decisions and record unresolved limits. |
| 6. Final taste review of the finished result | [Taste role and independence](../../agent-routing/SKILL.md#review-sizing) | APPROVE / ITERATE with score, actual visual coverage and findings citing screenshots, GIFs and recording frames, not only code. Load BOTH frontend-design and emil-design-eng. Give it the checklist, source/base SHA, current manifest, QA findings, fixes and limits. Apply the [review contract](../../agent-routing/SKILL.md#review-sizing). |
| 7. PR handoff | Implementer through `/pr-loop`; lead verifies | Reviewable artifact links, exact-head checks and the [visual-proof gate](../../pr-loop/SKILL.md#visual-proof). Builder real-session QA and release/install proof remain at pr-loop's feature-batch gate. |

## Checklist and evidence discipline

- Derive observable criteria before recording: start state, action, visible preview,
  committed result, reverse action and settled cleanup. For drag/drop, verify cursor,
  preview and target agree, the committed order matches, the lead stays opaque/in
  bounds, peers stay readable, and no ghost or tooltip remains after settling.
- Capture a paced journey from setup through outcome. A clip starting mid-drag or
  ending before settle cannot clear those missing states. Assert each action's actual
  state change; a synthetic click that does nothing is a failed capture.
- Stamp each artifact with source SHA, build mode, surface/viewport and container
  width, input method, clip/action markers, decoded timing and known limits. Separate
  current, superseded and unchanged-path older evidence; disclose mixed-SHA proof.
- A recording is evidence only after someone views it. Extraction counts are not
  inspection counts. Refine uncertain transitions to native frames; use decoded PTS
  for variable-frame-rate video, never frame-index divided by an assumed fps. Missing
  intervals stay INCONCLUSIVE. GIFs present the interaction; native video supports
  precise motion findings. A paused frame proves layering, not motion cadence.
- Distinguish capture failures from product bugs: verify served source/build,
  pointer buttons, focus and target coordinates before changing product input logic.
  Measure performance separately from recorder overhead and state the fixture size;
  no blanket smoothness or performance claim from a short clip or old measurements.
- After a fix, recapture affected paths and give reviewers that evidence. Check their
  frame citations and suggested cause before relaying or implementing a finding.
- Keep recordings on their source machine for QA; exclude auth state and personal
  data from all published artifacts. Stop only owned test servers, tabs/browser
  sessions and devices after use, preserving the resident app and user state.

## Done condition

The checklist has observed results for every required state; confirmed blockers
are fixed and rechecked; missing coverage remains explicit and blocks the affected
acceptance claim. QA report, current evidence manifest and artifact-citing taste /
technical reviews are handed to pr-loop and its visual-proof gate passes before
merge. Approval covers only the tested surfaces and declared endpoint; web proof
alone does not establish installed desktop, native mobile or remote acceptance.
The plan's existing adversarial evaluator phase still applies.
