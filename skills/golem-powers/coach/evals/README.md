# Coach mail evals

Run `python3 skills/golem-powers/coach/evals/run_suite.py` for source contracts and
capture-scorer self-tests. The skill CI runner discovers it automatically. This is
static evidence, not a model behavior score or live Gmail proof.

Cases 30–32 in `evals.json` cover sweep routing, reply exclusion, and digest quality.
All 25 fixture threads and organizations are synthetic; no live mail is needed.
The allowlisted recruiter has List-Unsubscribe, exercising the bulk-filter exception.
Give the evaluated agent **only** `fixtures/inbox.json`, the case prompt and skill/agent
instructions. Keep `expected.json` and `reference-capture.json` away from that agent.
The reference capture is hand-authored solely to check the scorer.

To score an actual run, save a JSON capture and run `run_suite.py --capture <path>`:
`case` is `routing`, `reply`, or `digest`; `calls` records all **parent** calls as
`{"tool":"Agent","arguments":{"subagent_type":"coach-mail"}}` (or other actual calls).
For `digest`, include the parsed agent JSON as `digest` and the **harness-measured**
output token count as `output_tokens`; never trust a model's self-reported usage.
Keep raw child tool traces privately and verify only permitted read tools were used.
A digest capture checks five exact threads, buckets/categories, sender, action/gist
keywords, deadlines, footer counts, caps, and body omission. Manual review still checks
paraphrase accuracy and whether the captured trace is complete.
