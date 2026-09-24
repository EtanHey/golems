---
name: grill-me
description: "Design-tree interview. Triggers: grill me, interview my plan, stress-test this design. NOT for implementation or one-question-at-a-time interviews."
disable-model-invocation: true
---

# /grill-me

> Ported and adapted from Matt Pocock's `skills/productivity/grilling/SKILL.md` and
> `skills/productivity/grill-me/SKILL.md` at upstream commit
> `c55ee46073ed923f86ce59a5eb3b6d895095d1b7`. Upstream is Copyright (c) 2026
> Matt Pocock and MIT licensed; see [LICENSE.upstream](LICENSE.upstream).
>
> Local shape: the upstream `grilling` body is folded into this user-invoked skill so a
> one-line wrapper does not add a second always-on description to the skill roster.
>
> Deliberate local divergence from upstream: retain Etan's voice-friendly lettered options,
> `1A 2C` shorthand, exactly one `Recommended` label per question, and the final <=6 frozen
> bullets. A recommendation is never a default.

Interview the user relentlessly until you reach a shared understanding. Map the subject as a
**design tree**: every decision branches into the decisions that hang off it.

## Work the whole frontier

Work the tree in **rounds**. The **frontier** is every decision whose prerequisites are already
settled: the questions you can ask now without guessing at answers you have not heard yet.

Ask the **whole frontier** in one round. Do not impose a fixed question-count cap. Number every
question, give it short **lettered options**, and mark exactly one option **Recommended** with a
one-line reason. Then wait for the user's answers before the next round.

Each round reshapes the tree. Fold in the user's decisions, recompute the frontier, and ask the
next round. A question whose answer depends on another open question belongs to a later round,
not the current one.

## Find facts without blocking the round

Finding facts is your job, never the user's. Read the plan and codebase first. When a frontier
question needs a fact from the filesystem, tools, or another available source, dispatch a
sub-agent to find it instead of asking the user.

Do not block the whole round on that exploration. Treat the running exploration as an unsettled
prerequisite: hold only its downstream questions and ask the rest of the frontier now. Fold the
fact into the tree when the sub-agent reports.

Facts belong to the agent. Decisions belong to the user: put every decision to them and wait.

## Round format

Keep labels short enough to answer by voice in one breath:

```text
## Round N

1. <question title>: <question body>
   A. <option>
   B. <option> (Recommended: <one-line reason>)
   C. <option>

---

2. <question title>: <question body>
   A. <option> (Recommended: <one-line reason>)
   B. <option>
   C. <option>

Answer like: 1B 2A, or 1B 2: <answer outside the options>
```

Separate every pair of questions in a round with a horizontal rule.

Read shorthand such as `1A 2C` as the user's decisions. If an answer is outside the options,
take it verbatim. Never answer for him. `Recommended` is advice, not a default. Never treat
silence as a choice; unanswered questions remain open.

## Stop only at shared understanding

The session is ready to close only when the frontier is empty: every branch of the design tree
was visited and nothing remains silently assumed. Emit **<=6 frozen bullets** summarizing the
settled decisions and the round that settled each one. Then wait.

Do not act on the plan until the user explicitly confirms shared understanding. If the user names
something still open, put it back into the tree and continue.
