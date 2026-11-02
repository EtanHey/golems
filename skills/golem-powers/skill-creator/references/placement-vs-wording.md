# Placement vs wording: which lever moves a skill

> Rule from skill-creator's measured loop (E2/E3, 2026-11-02; ratified by Etan via orc, 2026-11-02).
> Use it before writing any trigger or description change.

A skill has to clear two hurdles before it helps: it must **load**, and once loaded its text must be **followed**. Each hurdle has a different lever.

## (a) To get an unnamed skill to LOAD: placement

If the user never says the skill's trigger words, description wording alone barely moved the load on every case measured so far (below). Put the skill where the agent already looks:

- a **ROUTE row** in an always-loaded instruction file (global `AGENTS.md` § Routing), or
- a **hook**, when the input has a deterministic shape: a link, a file type, a command.

A hook is a non-blocking reminder (`additionalContext`). It never denies.

Measured so far (E2 /large-plan, E3 /research-lifecycle; the models and cases named in each row):

| Change | Load rate (base → arm) | Source |
|---|---|---|
| /large-plan, hand-written situation-first DESC | Haiku 0/30 → 0/30 | E2 |
| /large-plan, Anthropic's `improve_description.py` loop | proxy recall 0% on all 5 iterations; real catalog 0/30 → 0/30 | E2 |
| /large-plan, ROUTE row in global AGENTS.md | Sonnet 0/30 → 8/30 (p=0.005) | E2 |
| /large-plan, old ROUTE row vs old ROUTE row + BODY, on **Opus 5.5** | 10/30 → 12/30 (+6.7pp, p=0.79, not significant): no demonstrated BODY lift on those Opus cases | E2-opus |
| /large-plan, old ROUTE row → one precisely rewritten ROUTE row, on **Opus 5.5** | 10/30 → **30/30** unnamed (+66.7pp, p=1.4e-8); 0/15 false triggers; 15/15 controls. In-distribution, not held out; measures loading, not follow-through | R3 |
| /research-lifecycle, UserPromptSubmit hook on Docs/Gemini links | Haiku 0/48 → 48/48; Sonnet 3/48 → 48/48 (p=6.5e-24); 0/18 false loads | E3 |

**The model is part of the result.** With the old ROUTE row installed, Opus 5.5 loaded /large-plan on 10/30 unnamed prompts, where Haiku and Sonnet loaded it 0/30 without a row. Both E2-opus arms already carried that old row (their stamps show the same seat file), so E2-opus tested BODY, not ROUTE. On Opus, the ROUTE evidence is R3: rewriting that one row took it to 30/30. These rows hold for their cases and models only: measure on the model the seat actually runs before claiming a lever works there.

**Provenance.** The E2 and E3 Haiku/Sonnet runs did not record the effective reasoning effort, so the eval-provenance gate files them as NON_COMPARABLE. Cite them as observations, not as comparable shipping evidence. The E3 Opus re-measure recorded effort (the cell's session JSONL `effort` field) and passes the gate with `--require-comparable`: golems `skills/golem-powers/gemini-research/evals/results/e3-opus-grounding-prep-2026-11-02.json`.

Before you change a description, check:
1. Does the user actually say these words? Mine their real prompts (session JSONLs, BrainLayer). If they don't, expect description wording to do little (E2: 0/30 on Haiku, for two description variants) and measure before relying on it.
2. Is the input shape deterministic? Then write a hook, and test it against hard negatives: the same shape in a context that isn't this skill's.

## (b) Once the text is LOADED: precise, case-specific wording is the lever

Once the text is in context (system prompt, routing row, hook reminder, skill body), wording decides behaviour. Make it precise to the case that fails, and measure it per case.

- **T3 Code PR #27368** (closed; eval table in its body), https://github.com/pingdotgg/t3code/pull/27368:
  - One instruction line in `orchestrationInstructions.ts` took gpt-6.1-sol from 0/10 to 9/9 on `schedule-current-thread-no-read`. Guard cases held at 3/3.
  - With only the first sentence, Sol still re-read its own thread 3/9 times, to fetch a link. One precise extra clause ("…never for its link or to recheck a returned `boundThreadId`.") closed that residual.
- **R3 ROUTE row rewrite, the strongest example of this rule (precise wording in always-loaded text).** On Opus 5.5, the old row ("About to dispatch a worker…") named a moment Opus reached too late: in 12/21 misses it answered or edited the board and never dispatched. In 7/21 it counted a lane STATUS file as a collab. One rewritten row named the earlier moment ("a message brings new work … before you answer, edit the board or write the brief") and closed the substitute ("A lane brief, STATUS.md, BOARD.md or 'updates to the parent thread' is not a collab"). One more #27368-style clause ("A complaint or 'why doesn't it have X?' about missing or broken behavior is new work even when phrased as a question") took unnamed loads from 10/30 to 30/30 (p=1.4e-8), with 0/15 false triggers and 15/15 controls. Bounds: the row was written from these transcripts (one source thread), so it is in-distribution and not held out; it measures the load, not that the loaded body is then followed.
- **E2 BODY arm** ("## Before every dispatch" in /large-plan): Sonnet 14/30 → 23/30 (+30pp, p=0.03); Haiku 6/30 → 20/30. On Opus, with the old ROUTE row in both arms, BODY showed no demonstrated load lift (10/30 → 12/30, p=0.79).
- **E3 hook reminder:** the first reminder loaded the skill on every Docs link, including a CV and a doc link a PR review cited (Haiku 6/18 false loads). One precise clause ("Skip this only when the prompt itself says the doc is not research …") took that to 0/18, with link prompts still at 48/48.
- **E3 gemini-research body:** the skill loaded, but its § Grounding prep ("check whether the question needs current project state…") was the first action in 0/16 loaded runs on Haiku and 0/12 on Sonnet. Rewritten as the first action with a done condition, a preparation dispatch as the first relevant action (judged by the pinned semantic judge; loading /research-lifecycle yourself does not count) went 0/30 → 6/30 on Haiku and 0/30 → 9/30 on Sonnet (observations: effort not recorded). Loading was unchanged (Sonnet 12/30 → 13/30). On **Opus 5.5** with effort high recorded (comparable), the same change took it from 0/30 to 12/30 (+40pp, Fisher p=0.00012), with loading unchanged (21/30 → 20/30) and the web-only branch completing 3/3 in both arms (structural check).

## How to apply

| Situation | Lever | Measure |
|---|---|---|
| The user names the skill | none needed; check the controls stay green | controls |
| Unnamed, free-form phrasing | ROUTE row | unnamed load rate, false loads |
| Unnamed, deterministic shape (link, file type) | hook (reminder, never deny) | load rate on the shape, false loads on hard negatives |
| Loaded but not followed | precise wording in the loaded text, aimed at the failing case | per-case pass rate, guard cases unchanged |

Ship rule (per arm, same model): the rate the change targets rises ≥ +10pp, with 0 new false loads and no control regression. Report the Fisher p from `npm run eval:summarize` (skill-creator).
