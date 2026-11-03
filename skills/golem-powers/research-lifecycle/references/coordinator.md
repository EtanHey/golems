# Research intake coordinator

Status: the receiving seat routes the whole batch here and ends its turn.
You own the report/prompt lifecycle, verification and one return summary.
Read the supplied verifier parameter; do not pick a separate implicit default.
You skip SKILL.md intake dispatch; never recursively dispatch a coordinator.
The brief names the lead as step owner; you cannot self-override the family rule.

## Intake and concurrent work

1. Inventory every supplied link, including already-filed reports. Delegate
   harvest/readback/filing/NotebookLM mirroring to a Drive-write-capable child per
   /agent-routing § Execution capability; wait for its receipt. Its task: locate the
   R-number prompt; use /drive-filing for the project destination. File the report
   as R{NN}-<slug>-result in results/ beside prompts/, verify by readback and
   record export_route. Missing associations stay PARKED, not guessed. Brief that
   child as the coordinator's harvest child: skip SKILL.md intake dispatch, verify
   nothing, and return the filed links plus a local export path for each report.
2. Pin the grounding corpus/code revision. Split on report headings and freeze
   exact numbered claim lists before grading. Pass each child its section,
   citations, list, baseline and references/verifier.md; require exact ID coverage.
3. Post the batch projection before fan-out (SKILL.md planning figures are
   estimates, not caps). Choose explicit per-call budgets, sum them against the
   batch budget and retain reported usage.
4. Start section verifiers. While they run, organize reports and associated
   prompts and orchestrate the lifecycle; the Drive-capable child performs its
   Drive/NotebookLM steps. Keep verification moving while waiting for its receipt.
   Do not promote unverified conclusions into context or memory as facts.
5. Collect evidence and send the flags, VERIFIED audit and decision-critical
   unresolved queue to one adjudicator. Normally use the other family. An
   explicit step-owner same-family override doubles the random VERIFIED audit
   from 85 to 170 (all if fewer); record that override and sample seed/IDs.
6. Follow references/adjudicator.md for audit expansion, final counts/rates,
   VERIFY-SUMMARY.md and safe fact/correction/proposal storage. Return one batch
   summary with per-report filed links, R-number associations, verdict counts,
   storage evidence, unresolved items and lifecycle gate results.

## API-key section verifiers

Run these commands from a golems checkout (a symlinked install works). A copied
skill without the checkout registry fails GOLEMS_CHECKOUT_REQUIRED.

For a Claude-family verifier parameter, resolve its model through the role
registry and use this launcher, not a subscription-backed delegate_task:

```bash
( set -e; set -a; . ~/.config/golems/anthropic-api.env; set +a;
  node skills/golem-powers/research-lifecycle/scripts/verify-section.mjs \
    --role "$VERIFIER_ROLE" --prompt-file "$SECTION_PROMPT" \
    --out "$SECTION_RESULT" --budget-usd "$SECTION_BUDGET_USD" )
```

The key is scoped to that subshell and the clean child's environment; never
print it, export it globally or write it into the project. The launcher offers
only Read, Grep, Glob, WebSearch and WebFetch, no ambient MCPs/hooks/credentials.
Read/Grep/Glob deny the real home credential directories and cell auth directory;
the child runs in its own cell. It rejects missing/wrong init apiKeySource, child failure, cell leaks and
unscannable artifacts. It redacts decoded JSON before atomic output, then cleans
its own cell. A failure leaves the section pending; never retry on subscription.
Read-only tools are not OS filesystem/network confinement; don't claim that.

For a Codex-family parameter, resolve its model and use delegate_task with
serviceTier default, effort high and a read-only verification task. Switch the
adjudicator family as required by the step, or record the owner's override and
expanded audit. No verifier may itself write memory.
