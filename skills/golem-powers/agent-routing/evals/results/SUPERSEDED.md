# Superseded statements in recorded results

Recorded outputs in this directory are kept as they were captured. They are
never rewritten. This note marks statements that later rulings replaced.

## Video QA reader (2026-10-31)

These recorded answers route video frames to a Gemini visual gatherer and
say Claude should not read the frames itself:

- `2026-10-01-routing-ssot-smoke.json`, case 45 answer
- `2026-09-30-model-role-routing-smoke.json`, case 45 in `response`
- `2026-09-30-model-role-sweep-smoke.json`, case 45 in `response`

That is superseded for video QA, debrief and review. The `/qa-video` runner now
views the contact sheets and the frames behind its findings itself, and connects
them over time. A `gemini.gather.visual` gatherer may still pre-sort bulk frames;
its text is a lead, never evidence. Current rule: `../../SKILL.md` decision
rule 7 and `../../../qa-video/SKILL.md`. Standalone frame OCR outside that
pipeline (`../evals.json` case 45) can still go to the gatherer.
