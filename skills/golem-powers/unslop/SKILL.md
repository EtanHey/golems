---
name: unslop
description: "Cut AI tells while keeping every receipt, number, path, and hedge intact. Triggers: unslop, cut the slop, wall of text, too verbose, rambly, make this readable. NOT for delivery cadence (see i-have-adhd), channel choice, or artifact length governance."
---

# Unslop

Edit text to remove AI patterns and add human voice, without ever damaging evidence.

## Scope

The rewrite target: written text that is faster to scan, with the decision first.

## Process

1. Scan for the patterns below.
2. Rewrite. Preserve meaning, match intended tone.
3. If the source contains a decision, answer, status, blocker, or ask, put it first (see "Lead with the decision").
4. Run the evidence check (see "Evidence is not style"). Restore any protected evidence you changed.
5. Add voice only when the source supports it (see "Adding soul").
6. Self-audit: "What makes this obviously AI generated?" Fix remaining tells.
7. Check the result is no longer than the input. Prefer shorter. If it grew, cut again.

## Evidence is not style

**LOCAL DIVERGENCE FROM UPSTREAM.** Upstream unslop says only "preserve meaning, match intended tone."
That is not enough for engineering artifacts, where the text is the audit trail. In one five-document
adoption run on 2026-08-23, upstream reformatted `15/15` into "15 of 15" and `29/29` into "29 of 29".
An independent replay did not reproduce that behavior, so treat it as a credible failure mode rather
than an invariant. Either form reads the same to a person, but only one matches a gate that greps for
the original token.

These are not style. Never touch them:

- **Numeric evidence tokens keep their exact form.** `29/29`, `15/15`, `2/15`, `12/12`, `v0.4.35`,
  `680K+`. Never expand `N/M` into "N of M". Never round or normalize the token.
- **Identifiers are verbatim**: URLs, file paths, commit SHAs, `#NNN` issue and PR refs, branch names,
  agent and surface ids, ISO timestamps, command lines. Copy them, do not retype them.
- **Uncertainty survives as uncertainty.** "candidate cause", "recon in flight", "unbuilt", "approximate",
  "not documented anywhere I read", "deliberately not merged", "NOT-ENOUGH-INFO". If the source hedged,
  the rewrite hedges. Confidence is a fact about the evidence, not a tone to improve.
- **Never convert pending verification into success.** "open, ready for review" does not become "shipped".
  "fix in flight" does not become "fixed". Preserve tense and modality too: "will be linked" does not
  become "linked here", and "may" does not become "does". This is the one failure that makes the skill
  worse than useless.
- **Never delete anything needed to reproduce a result**: the RED command, the GREEN command, the probe
  count, the failing assertion, the negative finding ("payload shape is not the cause").
- **Technical qualifiers survive.** Keep distinctions such as embedded versus top-level, requested versus
  effective, local versus deployed, and observed versus inferred. A shorter term is wrong if it merges
  states the source kept separate.
- **Retractions and revision notes stay prominent.** A memo that corrected itself must still say so.
  Keep the correction near the claim it revises. Do not tidy away the author being wrong.

If cutting a tell would cost a receipt, keep the receipt and leave the tell.

## Lead with the decision

**LOCAL DIVERGENCE FROM UPSTREAM.** Upstream has no ordering rule. The request that created this copy
asked what the reader needed in order to decide. The complaint was an unfindable decision, not an
AI tell.

- When one exists, the first line answers the question or names the decision. Status, blocker, or ask goes
  above the reasoning.
- If the reader must do something, that is the first sentence, not the conclusion.
- If the source has no decision or requested action, do not manufacture one or force a narrative into
  decision-first structure.
- Keep the scan anchors. Bold the measurement, the verdict, and the ask. Removing every bold span from a
  status report makes it prettier prose and a worse report. Pattern 15 bans bolding *every proper noun*,
  not bolding the number the reader came for.
- Keep tables and bullets that carry per-item data. Do not dissolve a status table into paragraphs.

## Adding soul

Removing patterns is half the job. Sterile, voiceless writing is just as obvious.

- **Have opinions.** React to facts instead of neutrally listing pros and cons.
- **Vary rhythm.** Short sentences. Then longer ones that take their time. Mix it up.
- **Acknowledge complexity.** "Impressive but also kind of unsettling" beats "impressive."
- **Use "I" when it fits.** First person isn't unprofessional.
- **Let some mess in.** Perfect structure looks machine-made.
- **Be specific.** Not "this is concerning" but "there's something unsettling about agents churning away at 3am."

**Soul is voice, not new claims. LOCAL DIVERGENCE.** When you edit someone else's evidence-bearing report,
you may sharpen how a fact is said. You may not add an assessment the author did not make. In the primary
five-document adoption run, upstream's soul step invented "that gap is the real bug, more than the missed
keystroke is" and "that last gap worries me most". Neither appeared in the source. The independent replay
did not test invented claims, so this result is single-sourced. A single fabricated emphasis in a report
someone will act on still justifies a fail-closed rule.

Rule: if the rewrite asserts something you cannot point to in the source, delete it. On status reports, root
causes, PR reports, and handoffs, skip the soul step entirely and spend the effort on step 7 instead.

## Patterns to detect and fix

### Content

1. **Puffery.** "pivotal moment", "testament to", "evolving landscape", "setting the stage for", "indelible mark", "deeply rooted". Cut puffery, state what happened.
2. **Name-dropping.** Consolidate outlet lists only when their coverage is redundant and the input supplies
   equivalent report details. Preserve the full list when its breadth or independent corroboration is evidence.
   Never invent what an outlet said.
3. **Superficial -ing phrases.** "highlighting...", "ensuring...", "reflecting...", "showcasing...", "fostering...". Delete or expand with real sources.
4. **Promotional language.** "nestled", "vibrant", "breathtaking", "groundbreaking", "renowned", "stunning", "must-visit". Use neutral descriptions.
5. **Vague attributions.** "Experts believe", "Industry reports suggest", "Some critics argue". Name the
   source when the input supplies it. Otherwise preserve the attribution and mark it as weak. Never invent
   a source or delete a substantive claim just because its attribution is poor.
6. **Formulaic challenges.** "Despite challenges... continues to thrive." Replace with specific facts.

### Language

7. **AI vocabulary.** Additionally, crucial, delve, enduring, enhance, fostering, garner, interplay, intricate, landscape (abstract), pivotal, showcase, tapestry (abstract), testament, underscore, vibrant. Replace with plain words.
8. **Fancy ways to say "is".** "serves as", "stands as", "boasts", "features". Just say "is" or "has".
9. **"Not just X, but Y."** State the point directly instead.
10. **Rule of three.** Forcing ideas into groups of three. Use the natural number.
11. **Synonym cycling.** Protagonist, main character, central figure, hero all in one paragraph. Pick one, repeat it.
12. **False ranges.** "from X to Y" where X and Y aren't on a meaningful scale. List topics directly.

### Style

13. **Em dash overuse.** Prefer periods or commas. Do not mechanically replace every em dash with parentheses, an en dash, or a hyphen. If a thought needs separation, end the sentence.
14. **Colon overuse.** Colons are fine before a list or example. Not as mid-sentence connectors. Rewrite to let the point stand on its own without comparison framing.
15. **Boldface overuse.** Don't bold every proper noun or acronym. Do keep bold on the measurement, the verdict, and the ask.
16. **Inline-header lists.** The tell is a bold label and colon that restates the line: "**Performance:** Performance improved...". Convert those to prose. A bold lead-in that ends in a period, names the item, and is followed by genuinely new detail ("**Schema in TypeScript.** Tables live in one file.") is fine, not a tell.
17. **Title case headings.** Use sentence case.
18. **Decorative emojis.** Remove from headings and bullets.
19. **Curly quotes.** Replace with straight quotes. Exception: inside a verbatim quotation, copy the character as it was written.

### Communication artifacts

20. **Chatbot phrases.** "I hope this helps!", "Let me know if...", "Of course!", "Certainly!", "Found the smoking gun!" Remove.
21. **Cutoff disclaimers.** Remove vague caveats such as "While specific details are limited...". Keep measured unknowns, which are evidence.
22. **Sycophantic tone.** "Great question! You're absolutely right!" Respond directly.

### Filler

23. **Filler phrases.** "In order to" becomes "To". "Due to the fact that" becomes "Because". "It is important to note that" gets deleted.
24. **Excessive hedging.** "could potentially possibly be argued that it might" becomes "may". Collapse stacked hedges into one. Never collapse a hedge to zero.
25. **Generic conclusions.** "The future looks bright." State specific plans or facts.

### Jargon

26. **Abstract metaphor nouns.** Substrate, wedge, vector, locus, vantage, nexus, primitive (as noun), harness (as metaphor), surface (as in "API surface"), bedrock, scaffolding (as metaphor), modality, paradigm, gold-plating, ratchet (as metaphor), evacuate (for moving code), endgame, north star, flywheel. "Substrate" becomes "base". "Wedge in" becomes "add". "Vector" becomes "way". "Evacuate" becomes "move out". Pick the concrete word. Exception: a term that names a real thing in this fleet (surface as a cmux pane, primitive as a named MCP tool) is a proper noun, not a metaphor. Leave it.

### Plain speech

27. **Say what it does, not how it feels.** Name the mechanism or the number. Cut a sentence only when it is
    demonstrably generic filler and removing it preserves meaning. Cross-project reuse is not proof of
    filler. Portable requirements such as security rules may apply unchanged and still be essential.
28. **Shorten or split dense sentences.** If the reader has to backtrack to parse a sentence, break it in two or drop clauses. One idea per sentence.
29. **Active voice.** Prefer it. Catch "is/are/was/were + past participle" and name the actor. Passive is fine only when the actor is unknown or genuinely doesn't matter.
30. **Cut adverbs, or use a stronger verb.** "runs quickly" becomes "is fast" or the number. Replace
    "significantly improves" with a measured delta only when the source supplies one. Otherwise preserve
    the qualitative result and remove only wording that does not change its meaning.
31. **Prefer the plain word.** "utilize" becomes "use", "leverage" becomes "use", "facilitate" becomes "help", "numerous" becomes "many", "in the event that" becomes "if".

## What this skill does not fix

Measured against 30 days of this fleet's own sessions, 4 of the 7 observed readability failures are not
text problems and this skill does not reach them. Do not claim it does.

- Non-atomic delivery, everything in one turn. Use `i-have-adhd` and voice_ask.
- Durable artifacts too long to read at all. That is artifact governance, not editing.
- Density sent to the wrong channel. See "Reaching Etan" in the global instructions.
- A question emitted where an action was owed. See `agent-routing`.

## Sunset condition

This is a capability-uplift skill. It exists because a measured baseline needed it, and it should not
outlive that need.

Retire or reconsider it when, on the same frozen five-specimen adoption corpus, a without-skill
baseline agent:

1. keeps 100% of critical tokens in exact form (`check-preservation.sh` clean on all 5), and
2. keeps every hedge, retraction, and pending-state as pending, and
3. produces output no longer than the source, and
4. leads with the decision.

Re-run the A/B whenever the fleet's default model changes. If the baseline arm passes all four for two
consecutive model generations, delete this skill rather than carrying it. Record the run that justified
the retirement.

## Provenance

Forked from `https://github.com/cursor/plugins/blob/main/pstack/skills/unslop/SKILL.md` on 2026-08-23.
Four deliberate divergences from upstream, each caused by a measured failure on real fleet artifacts:
evidence preservation, lead-with-the-decision ordering, soul-adds-voice-not-claims, and the
no-longer-than-input check.
