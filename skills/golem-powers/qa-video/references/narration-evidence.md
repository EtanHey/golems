# Narration-to-finding integrity (QA)

Run the sibling checker **in addition to** must-read-check.sh before the verdict gate.
`default.sh finalize <workdir> <qa-report.md> --transcript <judge-session.jsonl>` runs all three automatically.
All commands below are `python3 scripts/narration-evidence.py <action> ...`.
They make no provider calls. Evidence rows are plain TAB-separated lines in qa-report.md.

1. After must-read planning, run `plan <workdir>`. It seeds narrated-plan.json from
   the SRT and adds a continuous `narrated-span` cue from the first to last nonempty
   subtitle. Never omit silence between narrated items: dense sampling must cover
   that whole span. `check-gaps <workdir>` checks the actual cues.tsv union and exits
   3 on gaps (not the padded windows). Dense padding cannot mask an omitted span.
   Default item is `item-1`. For separate subjects, the judge writes narrated-items.json:
   `[ {"id":"item-1","start_s":2,"end_s":7} ]`. Every subtitle belongs to exactly
   one item. This grouping is an explicit judge decision, not a gatherer's guess.

2. Read the first pointer cue's full-size t_s frame, crop its target, then read that
   crop yourself. Log both through inspected.sh with `judge:` reasons. Run
   `reference <workdir> <item-id> <crop.png>`. This pins the crop path/hash in
   item-references.json; it must come from that item's earliest pointer cue's t_s
   frame. A later example cannot replace it. Before **every later sweep or gather**
   for the item, run `sweep <workdir> <item-id> <window-start-s> <fresh-brief.json>`.
   Send that generated brief with the sweep's frame paths and the reference image
   path to the reader. It asks **"is this the same defect as the reference?"**.
   Weak-cue overflow uses the same reference and gets a report row
   `GATHERED<TAB>srt_index<TAB>reference crop path<TAB>gathered, not judge-read`.
   The requesting brief's model exclusions still apply. item-sweeps.jsonl records
   the payload and brief path; the checker rejects missing/edited reference fields.
   A manifest is a payload receipt, not proof that a provider received the images.
   A script/helper that only accepts the current sheet cannot do this comparison:
   use a reader that can open the reference path and sweep frames, or return
   NEEDS_READERS with the generated per-item briefs. Do not silently drop the reference.

3. **The UI's indicator leads the re-render.** When choosing evidence because any
   visible state indicator changed (zoom badge, toggle, counter, spinner end),
   identify its change time from the dense frames, then extract a full-size frame
   at **change_s + at least 1 second**, using decoded PTS. Browser zoom is one
   example: the badge can show the next zoom while the page still shows the old
   render. Read the later frame; record it using
   `state <workdir> <indicator-id> <change_s> <frame>`. The command rejects early
   or unread frames and stores indicator-evidence.json. Use a unique ID per change;
   prior evidence cannot be overwritten. Beside its report citation:
   `INDICATOR<TAB>indicator-id<TAB>change_s<TAB>frame<TAB>pts_s`.
   Use the exact canonical values from the JSON (e.g. `6.0`, `7.000`). Every
   indicator-selected evidence frame needs this record, including level citations.

4. Every named level/value needs its own citation to a judge-read full-size frame:
   `LEVEL<TAB>level-id<TAB>frame<TAB>pts_s`. The source-derived IDs/values are in
   narrated-plan.json. The lexical seed recognizes numeric values (including %),
   quoted values, on/off and new-tab mentions. It deliberately over-collects numbers;
   it cannot understand all spoken values. The judge reads the full SRT and adds
   missed categorical/spelled-out values to additional-levels.json as objects with
   id, value, start_s, end_s (same fields as the seed). The checker recomputes the
   seed so editing the plan cannot erase an obligation. Frames must be within the
   subtitle window through end+2s; if no settled frame is available there, report
   missing evidence rather than assigning the previous render to the new value.
   A missing/hidden/not-visible claim by a gatherer stays NOT DETERMINED until
   **one** judge full-size check; this is independent of the ordinary spot-check cap.
   Record each such claim as:
   `GATHER_CLAIM<TAB>id<TAB>hidden|not visible|NOT DETERMINED<TAB>frame<TAB>pts_s<TAB>decision`.
   Decision is `visible`, `confirmed-hidden`, `judge-checked unresolved`, or
   `NOT DETERMINED`. Only the last permits empty frame/PTS. Never turn an unchecked
   negative claim into an absence statement. The judge may correct it to visible.

5. Put **all findings** under exactly one `## Findings` section, as rows:
   `FINDING<TAB>id<TAB>item-id<TAB>defect-class<TAB>frame<TAB>pts_s<TAB>judge's observed description`.
   Every finding needs a current judge inspection of that full-size frame. A
   gatherer-only class may appear only under `## Unverified gatherer claims`;
   never call it a finding or "low confidence". The canonical Findings section
   allows rows or empty content, no unsupported prose. The checker validates
   paths, decoded times and matching inspection hashes; whether a frame actually
   shows that defect class remains the judge's explicit visual attestation.

Run `check <workdir> <qa-report.md>` after writing the report, in the same turn as
the verdict. Exit 3 means the verdict is unearned. The gate checks references,
registered sweep briefs, indicator lag/citations, named values, negative claims,
continuous planned coverage and every finding's judge inspection. Missing image
reads remain missing; scripts cannot authenticate that an image tool opened a
frame or infer unseen provider calls, indicator changes or unreported claims.
The judge must record **all** sweeps, indicator-based choices and negative claims.
