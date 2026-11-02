# Placement vs wording: which lever moves a skill

> Rule from skill-creator's measured loop (E2/E3, 2026-11-02; ratified by Etan via orc, 2026-11-02).
> Use it before writing any trigger or description change.

A skill has to clear two hurdles before it helps: it must **load**, and once loaded its text must be **followed**. Each hurdle has a different lever.

## (a) To get an unnamed skill to LOAD: placement

If the user never says the skill's trigger words, description wording won't load it. Put the skill where the agent already looks:

- a **ROUTE row** in an always-loaded instruction file (global `AGENTS.md` § Routing), or
- a **hook**, when the input has a deterministic shape: a link, a file type, a command.

A hook is a non-blocking reminder (`additionalContext`). It never denies.

Description wording alone barely moves an unnamed load:

| Change | Load rate (base → arm) | Source |
|---|---|---|
| /large-plan, hand-written situation-first DESC | Haiku 0/30 → 0/30 | E2 |
| /large-plan, Anthropic's `improve_description.py` loop | proxy recall 0% on all 5 iterations; real catalog 0/30 → 0/30 | E2 |
| /large-plan, ROUTE row in global AGENTS.md | Sonnet 0/30 → 8/30 (p=0.005) | E2 |
| /research-lifecycle, UserPromptSubmit hook on Docs/Gemini links | Haiku 0/48 → 48/48; Sonnet 3/48 → 48/48 (p=6.5e-24); 0/18 false loads | E3 |

Before you change a description, check:
1. Does the user actually say these words? Mine their real prompts (session JSONLs, BrainLayer). If they don't, the description can't help.
2. Is the input shape deterministic? Then write a hook, and test it against hard negatives: the same shape in a context that isn't this skill's.

## (b) Once the text is LOADED: precise, case-specific wording is the lever

Once the text is in context (system prompt, routing row, hook reminder, skill body), wording decides behaviour. Make it precise to the case that fails, and measure it per case.

- **T3 Code PR #27368** (closed; eval table in its body), https://github.com/pingdotgg/t3code/pull/27368:
  - One instruction line in `orchestrationInstructions.ts` took gpt-6.1-sol from 0/10 to 9/9 on `schedule-current-thread-no-read`. Guard cases held at 3/3.
  - With only the first sentence, Sol still re-read its own thread 3/9 times, to fetch a link. One precise extra clause ("…never for its link or to recheck a returned `boundThreadId`.") closed that residual.
- **E2 BODY arm** ("## Before every dispatch" in /large-plan): Sonnet 14/30 → 23/30 (+30pp, p=0.03); Haiku 6/30 → 20/30.
- **E3 hook reminder:** the first reminder loaded the skill on every Docs link, including a CV and a doc link a PR review cited (Haiku 6/18 false loads). One precise clause ("Skip this only when the prompt itself says the doc is not research …") took that to 0/18, with link prompts still at 48/48.
- **E3 gemini-research body:** the skill loaded, but its § Grounding prep ("check whether the question needs current project state…") was followed 0/16 times. Rewritten as the first action with a done condition, prep went 0/30 → 9/30 on Sonnet (p=0.002) and 0/30 → 7/30 on Haiku (p=0.01). Loading was unchanged (12/30 → 13/30).

## How to apply

| Situation | Lever | Measure |
|---|---|---|
| The user names the skill | none needed; check the controls stay green | controls |
| Unnamed, free-form phrasing | ROUTE row | unnamed load rate, false loads |
| Unnamed, deterministic shape (link, file type) | hook (reminder, never deny) | load rate on the shape, false loads on hard negatives |
| Loaded but not followed | precise wording in the loaded text, aimed at the failing case | per-case pass rate, guard cases unchanged |

Ship rule (per arm, same model): the rate the change targets rises ≥ +10pp, with 0 new false loads and no control regression. Report the Fisher p from `npm run eval:summarize` (skill-creator).
