---
name: grill-me
description: "Frontier/round-based plan interview. Triggers: grill me, interview me about this plan, shared understanding, walk the design tree. NOT one-question-at-a-time."
---

# /grill-me — frontier rounds, not one question at a time

> Replaces the v1 stub that pointed at a `/grilling` skill which does not exist on this machine, and
> the retired one-question-per-turn method. Source: Matt Pocock, skills v1.2 (digest
> `docs.local/video-gems/2026-08-06-matt-pocock-skills-v1.2.0.md`). One-question-per-turn was
> "incredibly frustrating and dead slow" once only easy yes/no questions remained.

## Scope

The interview settles what is already decided, then asks ONLY the open independent decisions in numbered rounds with lettered options and one Recommended each; answer in shorthand (1A 2C).

## The loop

1. **Settle first.** Read the plan and the codebase. List what is already decided, with the line
   or file that decides it. Do not ask about anything on that list. If a question can be answered by
   exploring the codebase, explore the codebase instead of asking.
2. **Compute the frontier.** The frontier is the set of open decisions that do not depend on another
   open decision. Only frontier items get asked this round. Dependent items wait.
3. **Ask one round.** Number the questions (`1.`, `2.`, …). Give each **lettered options** (`A`, `B`,
   `C`) and mark exactly one **Recommended** with a one-line why. Three to six questions per round;
   never one, never twelve.
4. **Read shorthand answers.** The user answers `1A 2C 3B` or `1A, 2: something else`. Never answer
   for them. Never treat silence as a choice. If an answer is not one of the options, take it verbatim
   as the decision.
5. **Recompute the frontier** with the new decisions folded in. Dependent items that just became
   independent are the next round.
6. **Empty frontier = stop.** Emit **≤6 frozen bullets** — the decisions, each with the round it was
   made in — and wait for the user to say shared understanding is reached. Do not start implementing.

## Rules Etan set

- **Never answer for him.** A Recommended option is a recommendation, not a default. Unanswered
  questions stay open; they do not resolve to Recommended.
- **Options, not essays.** A question with no options is a question you have not finished thinking
  about. Go back and finish.
- **Voice-friendly.** The format exists so a round can be answered by dictation in one breath
  (`1A 2B 3A`). Keep option labels short enough to say aloud.
- **Codebase before questions.** Anything greppable is not a question.

## Output shape per round

```
## Round N — <frontier size> open decisions

1. <decision, one line>
   A. <option>
   B. <option>  ← Recommended: <one-line why>
   C. <option>

2. …

Answer like: 1B 2A 3C
```

## Termination shape

```
## Frozen (Round N reached an empty frontier)
- <decision> — R1
- <decision> — R2
…
Say "shared understanding" to close, or name what is still open.
```
